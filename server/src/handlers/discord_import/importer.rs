//! Import d'un ZIP ArchiveForge déjà téléchargé : crée le serveur ForgeChat et
//! tout son contenu. En cas d'échec, le serveur créé et les fichiers copiés sont
//! supprimés (jamais de serveur à moitié importé).

use std::{
    collections::{HashMap, HashSet},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{anyhow, Context};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;
use zip::ZipArchive;

use super::format::*;
use super::UserError;
use crate::models::role::Permissions as P;

/// Messages insérés par transaction.
const BATCH: usize = 500;
const ICON_MAX: u64 = 8 * 1024 * 1024;

type Zip = Arc<Mutex<ZipArchive<std::fs::File>>>;

fn user_err(msg: impl Into<String>) -> anyhow::Error {
    anyhow::Error::new(UserError(msg.into()))
}

/// Copie des entrées du ZIP vers des fichiers générés par nous (jamais le chemin
/// du ZIP sur disque : pas de zip-slip). `None` = entrée absente, trop grosse ou illisible.
fn copy_entries(zip: &Zip, jobs: Vec<(String, PathBuf, u64)>) -> Vec<Option<u64>> {
    let Ok(mut z) = zip.lock() else { return jobs.iter().map(|_| None).collect() };
    jobs.into_iter()
        .map(|(entry, dest, max)| {
            let mut f = z.by_name(&entry).ok()?;
            if f.size() > max { return None; }
            let res = (|| -> std::io::Result<u64> {
                if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent)?; }
                let mut out = std::fs::File::create(&dest)?;
                std::io::copy(&mut (&mut f).take(max), &mut out)
            })();
            match res {
                Ok(n) => Some(n),
                Err(e) => {
                    tracing::warn!("Import Discord : copie de {entry} impossible : {e}");
                    let _ = std::fs::remove_file(&dest);
                    None
                }
            }
        })
        .collect()
}

/// Un message prêt à insérer.
struct Prepared {
    discord_id: String,
    id: Uuid,
    content: String,
    author: String,
    avatar: String,
    created_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
    pinned: bool,
    reply_ref: Option<String>,
    /// (filename, content_type, size, url)
    attachments: Vec<(String, String, i64, String)>,
}

pub struct Importer {
    db: PgPool,
    upload_dir: PathBuf,
    user_id: Uuid,
    import_id: Uuid,
    zip: Zip,
    entries: HashSet<String>,
    written: Vec<PathBuf>,
    names: Names,
    msg_map: HashMap<String, Uuid>,
    server_id: Option<Uuid>,
    done: u64,
    total: u64,
}

/// Point d'entrée : renvoie l'id du serveur créé. Nettoie tout en cas d'échec.
pub async fn run(db: &PgPool, upload_dir: &str, user_id: Uuid, import_id: Uuid, zip_path: &Path) -> anyhow::Result<Uuid> {
    let path = zip_path.to_path_buf();
    let (archive, entries) = tokio::task::spawn_blocking(move || -> anyhow::Result<_> {
        let file = std::fs::File::open(&path)?;
        let archive = ZipArchive::new(file)
            .map_err(|_| user_err("Le fichier téléchargé n'est pas une archive ZIP valide."))?;
        let entries: HashSet<String> = archive.file_names().map(String::from).collect();
        Ok((archive, entries))
    })
    .await??;

    let mut imp = Importer {
        db: db.clone(),
        upload_dir: PathBuf::from(upload_dir),
        user_id,
        import_id,
        zip: Arc::new(Mutex::new(archive)),
        entries,
        written: Vec::new(),
        names: Names::default(),
        msg_map: HashMap::new(),
        server_id: None,
        done: 0,
        total: 0,
    };
    match imp.import().await {
        Ok(id) => Ok(id),
        Err(e) => {
            imp.rollback().await;
            Err(e)
        }
    }
}

impl Importer {
    async fn rollback(&mut self) {
        if let Some(sid) = self.server_id {
            if let Err(e) = sqlx::query("DELETE FROM servers WHERE id=$1").bind(sid).execute(&self.db).await {
                tracing::error!("Import Discord : suppression du serveur {sid} impossible : {e}");
            }
        }
        for p in self.written.drain(..) {
            let _ = tokio::fs::remove_file(p).await;
        }
    }

    async fn progress(&self, label: &str) {
        // Téléchargement = 0-20 %, import = 20-99 %
        let pct = 20 + if self.total == 0 { 0 } else { (self.done * 79 / self.total) as i32 };
        let _ = sqlx::query("UPDATE server_imports SET progress=$2, label=$3, updated_at=NOW() WHERE id=$1")
            .bind(self.import_id)
            .bind(pct.min(99))
            .bind(label)
            .execute(&self.db)
            .await;
    }

    async fn copy(&mut self, jobs: Vec<(String, PathBuf, u64)>) -> anyhow::Result<Vec<Option<u64>>> {
        let dests: Vec<PathBuf> = jobs.iter().map(|j| j.1.clone()).collect();
        let zip = self.zip.clone();
        let res = tokio::task::spawn_blocking(move || copy_entries(&zip, jobs)).await?;
        for (d, r) in dests.into_iter().zip(&res) {
            if r.is_some() { self.written.push(d); }
        }
        Ok(res)
    }

    fn in_zip(&self, entry: &str) -> bool {
        !entry.contains("..") && self.entries.contains(entry)
    }

    async fn read_export(&self) -> anyhow::Result<GuildExport> {
        if !self.entries.contains("export.json") {
            return Err(user_err("Archive invalide : export.json est absent de la racine du ZIP."));
        }
        let zip = self.zip.clone();
        tokio::task::spawn_blocking(move || -> anyhow::Result<GuildExport> {
            let mut z = zip.lock().map_err(|_| anyhow!("verrou ZIP empoisonné"))?;
            let f = z.by_name("export.json")?;
            // ponytail: export.json entièrement en mémoire (~2-3x sa taille). Parser
            // en flux si des exports de plusieurs Go apparaissent.
            serde_json::from_reader(BufReader::new(f)).map_err(|e| {
                tracing::warn!("Import Discord : export.json illisible : {e}");
                user_err("export.json est illisible ou n'a pas le format attendu d'un export ArchiveForge.")
            })
        })
        .await?
    }

    async fn import(&mut self) -> anyhow::Result<Uuid> {
        self.progress("Lecture de l'export").await;
        let mut g = self.read_export().await?;
        if g.channels.is_empty() && g.categories.is_empty() {
            return Err(user_err("L'export ne contient aucun salon."));
        }

        // Noms pour réécrire les mentions, et total pour la progression
        for m in &g.members {
            let n = m.display_name.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| m.username.clone());
            self.names.users.insert(m.id.clone(), n);
        }
        for r in &g.roles {
            self.names.roles.insert(r.id.clone(), r.name.clone());
        }
        self.names.roles.insert(g.id.clone(), "everyone".into());
        for c in &g.channels {
            self.names.channels.insert(c.id.clone(), c.name.clone());
            let all = c.messages.iter().chain(c.threads.iter().flat_map(|t| t.messages.iter()));
            for m in all {
                self.total += 1;
                if !m.author_id.is_empty() && !m.author_name.is_empty() {
                    self.names.users.entry(m.author_id.clone()).or_insert_with(|| m.author_name.clone());
                }
            }
            for t in &c.threads {
                self.names.channels.insert(t.id.clone(), t.name.clone());
            }
        }

        let server_id = self.create_server(&g).await?;
        let role_map = self.import_roles(&g, server_id).await?;
        let everyone: Uuid = sqlx::query_scalar("SELECT id FROM roles WHERE server_id=$1 AND is_everyone=true")
            .bind(server_id)
            .fetch_one(&self.db)
            .await?;
        self.import_emojis(&g, server_id).await?;
        self.progress("Création des salons").await;

        let mut cat_map: HashMap<String, (Uuid, Option<Vec<Overwrite>>)> = HashMap::new();
        for c in &g.categories {
            let id: Uuid = sqlx::query_scalar(
                "INSERT INTO categories (server_id, name, position) VALUES ($1, $2, $3) RETURNING id",
            )
            .bind(server_id)
            .bind(truncate(c.name.trim(), 100))
            .bind(c.position as i32)
            .fetch_one(&self.db)
            .await?;
            cat_map.insert(c.id.clone(), (id, c.permission_overwrites.clone()));
        }

        let overwrite_ctx = (g.id.clone(), everyone, role_map);
        let mut channels = std::mem::take(&mut g.channels);
        channels.sort_by_key(|c| (c.position, snowflake(&c.id)));
        for mut ch in channels {
            let Some(kind) = channel_kind(ch.r#type) else {
                self.done += ch.messages.len() as u64 + ch.threads.iter().map(|t| t.messages.len() as u64).sum::<u64>();
                continue;
            };
            let parent = ch.parent_id.as_deref().and_then(|p| cat_map.get(p));
            let overwrites = ch.permission_overwrites.take().or_else(|| parent.and_then(|p| p.1.clone())).unwrap_or_default();
            let category_id = parent.map(|p| p.0);
            let channel_id = self.create_channel(server_id, category_id, &ch, kind, &ch.name, &overwrites, &overwrite_ctx).await?;

            // Salons vocaux : ForgeChat n'affiche pas de discussion écrite dans un
            // vocal, l'historique va dans un salon texte compagnon.
            let is_voice = matches!(kind, "voice" | "stage");
            let text_channel = if is_voice && (!ch.messages.is_empty() || !ch.threads.is_empty()) {
                let name = format!("{}-discussion", truncate(ch.name.trim(), 89));
                self.create_channel(server_id, category_id, &ch, "text", &name, &overwrites, &overwrite_ctx).await?
            } else {
                channel_id
            };

            if kind == "forum" {
                self.done += ch.messages.len() as u64;
                for t in std::mem::take(&mut ch.threads) {
                    self.import_forum_post(text_channel, t).await?;
                }
            } else {
                let msgs = std::mem::take(&mut ch.messages);
                self.import_channel_messages(text_channel, msgs, &ch.name).await?;
                for t in std::mem::take(&mut ch.threads) {
                    self.import_thread(text_channel, t).await?;
                }
            }
        }

        Ok(server_id)
    }

    async fn create_server(&mut self, g: &GuildExport) -> anyhow::Result<Uuid> {
        let owned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE owner_id=$1")
            .bind(self.user_id)
            .fetch_one(&self.db)
            .await?;
        if owned >= 100 {
            return Err(user_err("Limite de 100 serveurs atteinte : supprimez-en un avant d'importer."));
        }
        let mut name = truncate(g.name.trim(), 100);
        if name.chars().count() < 2 {
            name = "Serveur importé".into();
        }
        let everyone_perms = g
            .everyone_permissions
            .as_ref()
            .map(|v| convert_permissions(parse_bits(v)))
            .unwrap_or(
                P::VIEW_CHANNEL | P::SEND_MESSAGES | P::READ_HISTORY | P::ADD_REACTIONS
                    | P::ATTACH_FILES | P::CONNECT_VOICE | P::SPEAK_VOICE | P::STREAM,
            );

        let mut tx = self.db.begin().await?;
        let sid: Uuid = sqlx::query_scalar(
            "INSERT INTO servers (name, owner_id, invite_code, is_public) VALUES ($1, $2, $3, false) RETURNING id",
        )
        .bind(&name)
        .bind(self.user_id)
        .bind(crate::handlers::servers::generate_invite_code())
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO roles (server_id, name, permissions, position, is_everyone) VALUES ($1, '@everyone', $2, 0, true)")
            .bind(sid)
            .bind(everyone_perms)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, true)")
            .bind(self.user_id)
            .bind(sid)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE server_imports SET server_id=$2, updated_at=NOW() WHERE id=$1")
            .bind(self.import_id)
            .bind(sid)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.server_id = Some(sid);

        // Icône, copiée comme upload_server_icon
        if let Some(icon) = g.icon_file.as_deref().filter(|f| self.in_zip(f)) {
            let ext = match safe_ext(icon).as_str() {
                "png" => "png",
                "gif" => "gif",
                "webp" => "webp",
                "jpg" | "jpeg" => "jpg",
                _ => "",
            };
            if !ext.is_empty() {
                let rel = format!("server-icons/{}.{}", Uuid::new_v4(), ext);
                let dest = self.upload_dir.join(&rel);
                if self.copy(vec![(icon.to_string(), dest, ICON_MAX)]).await?[0].is_some() {
                    sqlx::query("UPDATE servers SET icon=$2 WHERE id=$1")
                        .bind(sid)
                        .bind(format!("/uploads/{rel}"))
                        .execute(&self.db)
                        .await?;
                }
            }
        }
        Ok(sid)
    }

    async fn import_roles(&mut self, g: &GuildExport, sid: Uuid) -> anyhow::Result<HashMap<String, Uuid>> {
        let mut roles: Vec<&RoleData> = g.roles.iter().filter(|r| r.id != g.id).collect();
        roles.sort_by_key(|r| (r.position, snowflake(&r.id)));
        let mut map = HashMap::new();
        for (i, r) in roles.into_iter().enumerate() {
            let name = truncate(r.name.trim(), 100);
            let id: Uuid = sqlx::query_scalar(
                "INSERT INTO roles (server_id, name, color, permissions, position, mentionable, hoisted)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            )
            .bind(sid)
            .bind(if name.is_empty() { "rôle".to_string() } else { name })
            .bind((r.color & 0xFF_FFFF) as i32)
            .bind(convert_permissions(parse_bits(&r.permissions)))
            .bind(i as i32 + 1)
            .bind(r.mentionable.unwrap_or(false))
            .bind(r.hoist.unwrap_or(false))
            .fetch_one(&self.db)
            .await?;
            map.insert(r.id.clone(), id);
        }
        Ok(map)
    }

    async fn import_emojis(&mut self, g: &GuildExport, sid: Uuid) -> anyhow::Result<()> {
        for e in &g.emojis {
            let Some(file) = e.file.as_deref().filter(|f| self.in_zip(f)) else { continue };
            let (ext, mime, max) = match safe_ext(file).as_str() {
                "gif" => ("gif", "image/gif", 512 * 1024),
                "png" => ("png", "image/png", 256 * 1024),
                "jpg" | "jpeg" => ("jpg", "image/jpeg", 256 * 1024),
                "webp" => ("webp", "image/webp", 256 * 1024),
                _ => continue,
            };
            let name: String = e
                .name
                .to_lowercase()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                .take(32)
                .collect();
            if name.is_empty() {
                continue;
            }
            let filename = format!("emoji_{}.{}", Uuid::new_v4(), ext);
            let dest = self.upload_dir.join("emojis").join(&filename);
            if self.copy(vec![(file.to_string(), dest, max)]).await?[0].is_none() {
                continue;
            }
            sqlx::query(
                "INSERT INTO custom_emojis (server_id, name, url, mime_type, creator_id)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (server_id, name) DO NOTHING",
            )
            .bind(sid)
            .bind(&name)
            .bind(format!("/uploads/emojis/{filename}"))
            .bind(mime)
            .bind(self.user_id)
            .execute(&self.db)
            .await?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_channel(
        &mut self,
        sid: Uuid,
        category_id: Option<Uuid>,
        ch: &ChannelData,
        kind: &str,
        name: &str,
        overwrites: &[Overwrite],
        (guild_id, everyone, role_map): &(String, Uuid, HashMap<String, Uuid>),
    ) -> anyhow::Result<Uuid> {
        let name = truncate(name.trim(), 100);
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO channels (server_id, category_id, name, type, topic, position, is_nsfw, slowmode_delay)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        )
        .bind(sid)
        .bind(category_id)
        .bind(if name.is_empty() { "salon".to_string() } else { name })
        .bind(kind)
        .bind(ch.topic.as_deref().map(str::trim).filter(|t| !t.is_empty()))
        .bind(ch.position as i32)
        .bind(ch.nsfw.unwrap_or(false))
        .bind(ch.rate_limit_per_user.unwrap_or(0).clamp(0, 21600) as i32)
        .fetch_one(&self.db)
        .await?;

        // Surcharges de rôle uniquement : les membres Discord n'ont pas de compte ici.
        for ow in overwrites.iter().filter(|o| o.is_role()) {
            let target = if &ow.id == guild_id { Some(*everyone) } else { role_map.get(&ow.id).copied() };
            let Some(target) = target else { continue };
            let allow = convert_permissions(parse_bits(&ow.allow));
            let deny = convert_permissions(parse_bits(&ow.deny));
            if allow == 0 && deny == 0 {
                continue;
            }
            sqlx::query(
                "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
                 VALUES ($1, $2, 'role', $3, $4) ON CONFLICT (channel_id, target_id) DO NOTHING",
            )
            .bind(id)
            .bind(target)
            .bind(allow)
            .bind(deny)
            .execute(&self.db)
            .await?;
        }
        Ok(id)
    }

    /// Filtre, trie et prépare un paquet : copie des pièces jointes, contenu final.
    /// `inline_media` (fils/forums, sans table de pièces jointes) : liens /uploads dans le texte.
    async fn prepare(&mut self, msgs: &[MessageData], inline_media: bool) -> anyhow::Result<Vec<Prepared>> {
        self.done += msgs.len() as u64;
        let kept: Vec<&MessageData> = msgs.iter().filter(|m| !is_system(m)).collect();

        // (index du message, nom affiché, dest, url)
        let mut jobs = Vec::new();
        let mut targets = Vec::new();
        for (i, m) in kept.iter().enumerate() {
            for a in &m.attachments {
                let filename = clean_filename(&a.filename);
                let entry = zip_path_for_attachment(a.local_path.as_deref()).filter(|e| self.in_zip(e));
                let file = format!("{}.{}", Uuid::new_v4(), safe_ext(&filename));
                let dest = self.upload_dir.join(&file);
                targets.push((i, filename, entry.is_some(), format!("/uploads/{file}")));
                if let Some(entry) = entry {
                    jobs.push((entry, dest, u64::MAX));
                }
            }
        }
        let mut copied = self.copy(jobs).await?.into_iter();

        let mut extra: Vec<Vec<String>> = vec![Vec::new(); kept.len()];
        let mut atts: Vec<Vec<(String, String, i64, String)>> = vec![Vec::new(); kept.len()];
        for (i, filename, in_zip, url) in targets {
            let size = if in_zip { copied.next().flatten() } else { None };
            match size {
                Some(_) if inline_media => {
                    let is_media = matches!(safe_ext(&filename).as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "mp4" | "webm" | "mov");
                    extra[i].push(if is_media { url } else { format!("📎 {filename} : {url}") });
                }
                Some(size) => {
                    let ct = mime_guess::from_ext(&safe_ext(&filename)).first_raw().unwrap_or("application/octet-stream").to_string();
                    atts[i].push((truncate(&filename, 255), ct, size as i64, url));
                }
                None => extra[i].push(format!("📎 {filename} (non archivé)")),
            }
        }

        let mut out = Vec::with_capacity(kept.len());
        for (i, m) in kept.into_iter().enumerate() {
            let content = build_content(m, &self.names, &extra[i]);
            if content.trim().is_empty() && atts[i].is_empty() {
                continue;
            }
            let author = truncate(m.author_name.trim(), 80);
            out.push(Prepared {
                discord_id: m.id.clone(),
                id: Uuid::new_v4(),
                content,
                author: if author.is_empty() { "Inconnu".into() } else { author },
                avatar: avatar_or_empty(m.author_avatar.as_deref()),
                created_at: parse_ts(&m.timestamp, &m.id),
                edited_at: m.edited_timestamp.as_deref().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|d| d.with_timezone(&Utc)),
                pinned: m.pinned.unwrap_or(false),
                reply_ref: m.referenced_message_id.clone(),
                attachments: std::mem::take(&mut atts[i]),
            });
        }
        Ok(out)
    }

    async fn import_channel_messages(&mut self, channel_id: Uuid, mut msgs: Vec<MessageData>, name: &str) -> anyhow::Result<()> {
        sort_messages(&mut msgs);
        let mut last: Option<Uuid> = None;
        for chunk in msgs.chunks(BATCH) {
            let rows = self.prepare(chunk, false).await?;
            if rows.is_empty() {
                continue;
            }
            for r in &rows {
                self.msg_map.insert(r.discord_id.clone(), r.id);
            }
            let reply: Vec<Option<Uuid>> = rows.iter().map(|r| r.reply_ref.as_ref().and_then(|x| self.msg_map.get(x).copied())).collect();
            let mut tx = self.db.begin().await?;
            sqlx::query(
                "INSERT INTO messages (id, channel_id, user_id, content, type, reply_to, pinned, edited_at, created_at, webhook_display_name, webhook_avatar_url)
                 SELECT t.id, $2, $3, t.content, 'webhook', t.reply_to, t.pinned, t.edited_at, t.created_at, t.author, t.avatar
                 FROM UNNEST($1::uuid[], $4::text[], $5::uuid[], $6::bool[], $7::timestamptz[], $8::timestamptz[], $9::text[], $10::text[])
                      AS t(id, content, reply_to, pinned, edited_at, created_at, author, avatar)",
            )
            .bind(rows.iter().map(|r| r.id).collect::<Vec<_>>())
            .bind(channel_id)
            .bind(self.user_id)
            .bind(rows.iter().map(|r| (!r.content.is_empty()).then(|| r.content.clone())).collect::<Vec<_>>())
            .bind(reply)
            .bind(rows.iter().map(|r| r.pinned).collect::<Vec<_>>())
            .bind(rows.iter().map(|r| r.edited_at).collect::<Vec<_>>())
            .bind(rows.iter().map(|r| r.created_at).collect::<Vec<_>>())
            .bind(rows.iter().map(|r| r.author.clone()).collect::<Vec<_>>())
            .bind(rows.iter().map(|r| r.avatar.clone()).collect::<Vec<_>>())
            .execute(&mut *tx)
            .await
            .context("insertion des messages")?;

            let atts: Vec<(Uuid, DateTime<Utc>, &(String, String, i64, String))> =
                rows.iter().flat_map(|r| r.attachments.iter().map(move |a| (r.id, r.created_at, a))).collect();
            if !atts.is_empty() {
                sqlx::query(
                    "INSERT INTO attachments (message_id, filename, content_type, size, url, created_at)
                     SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::timestamptz[])",
                )
                .bind(atts.iter().map(|a| a.0).collect::<Vec<_>>())
                .bind(atts.iter().map(|a| a.2 .0.clone()).collect::<Vec<_>>())
                .bind(atts.iter().map(|a| truncate(&a.2 .1, 100)).collect::<Vec<_>>())
                .bind(atts.iter().map(|a| a.2 .2).collect::<Vec<_>>())
                .bind(atts.iter().map(|a| a.2 .3.clone()).collect::<Vec<_>>())
                .bind(atts.iter().map(|a| a.1).collect::<Vec<_>>())
                .execute(&mut *tx)
                .await
                .context("insertion des pièces jointes")?;
            }
            let pins: Vec<&Prepared> = rows.iter().filter(|r| r.pinned).collect();
            if !pins.is_empty() {
                sqlx::query(
                    "INSERT INTO pinned_messages (channel_id, message_id, pinned_by, pinned_at)
                     SELECT $1, t.id, $2, t.at FROM UNNEST($3::uuid[], $4::timestamptz[]) AS t(id, at)
                     ON CONFLICT DO NOTHING",
                )
                .bind(channel_id)
                .bind(self.user_id)
                .bind(pins.iter().map(|r| r.id).collect::<Vec<_>>())
                .bind(pins.iter().map(|r| r.created_at).collect::<Vec<_>>())
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            last = rows.last().map(|r| r.id);
            self.progress(&format!("Messages de #{}", truncate(name, 60))).await;
        }
        if last.is_some() {
            sqlx::query("UPDATE channels SET last_message_id=$2 WHERE id=$1")
                .bind(channel_id)
                .bind(last)
                .execute(&self.db)
                .await?;
        }
        Ok(())
    }

    /// Insère des messages de fil (`thread_messages`) ou des réponses de forum
    /// (`forum_replies`) : mêmes colonnes, pas de pièces jointes structurées.
    async fn insert_simple(&mut self, table: &str, parent_col: &str, parent: Uuid, rows: &[Prepared]) -> anyhow::Result<()> {
        if rows.is_empty() {
            return Ok(());
        }
        sqlx::query(&format!(
            "INSERT INTO {table} (id, {parent_col}, user_id, content, edited_at, created_at, webhook_display_name, webhook_avatar_url)
             SELECT t.id, $2, $3, t.content, t.edited_at, t.created_at, t.author, t.avatar
             FROM UNNEST($1::uuid[], $4::text[], $5::timestamptz[], $6::timestamptz[], $7::text[], $8::text[])
                  AS t(id, content, edited_at, created_at, author, avatar)"
        ))
        .bind(rows.iter().map(|r| r.id).collect::<Vec<_>>())
        .bind(parent)
        .bind(self.user_id)
        .bind(rows.iter().map(|r| r.content.clone()).collect::<Vec<_>>())
        .bind(rows.iter().map(|r| r.edited_at).collect::<Vec<_>>())
        .bind(rows.iter().map(|r| r.created_at).collect::<Vec<_>>())
        .bind(rows.iter().map(|r| r.author.clone()).collect::<Vec<_>>())
        .bind(rows.iter().map(|r| r.avatar.clone()).collect::<Vec<_>>())
        .execute(&self.db)
        .await
        .with_context(|| format!("insertion dans {table}"))?;
        Ok(())
    }

    fn thread_created_at(t: &ThreadData, first: Option<&Prepared>) -> DateTime<Utc> {
        t.created_at
            .as_deref()
            .and_then(|c| DateTime::parse_from_rfc3339(c).ok())
            .map(|d| d.with_timezone(&Utc))
            .or(first.map(|f| f.created_at))
            .unwrap_or_else(|| parse_ts("", &t.id))
    }

    async fn import_thread(&mut self, channel_id: Uuid, mut t: ThreadData) -> anyhow::Result<()> {
        sort_messages(&mut t.messages);
        let msgs = std::mem::take(&mut t.messages);
        let mut chunks = msgs.chunks(BATCH);
        let first_rows = match chunks.next() {
            Some(c) => self.prepare(c, true).await?,
            None => Vec::new(),
        };
        let first = first_rows.first();
        let title = truncate(t.name.trim(), 100);
        let thread_id: Uuid = sqlx::query_scalar(
            "INSERT INTO threads (channel_id, parent_message_id, title, creator_id, archived, created_at, webhook_display_name, webhook_avatar_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        )
        .bind(channel_id)
        .bind(self.msg_map.get(&t.id).copied())
        .bind(if title.is_empty() { "Fil".to_string() } else { title })
        .bind(self.user_id)
        .bind(t.archived.unwrap_or(false))
        .bind(Self::thread_created_at(&t, first))
        .bind(first.map(|f| f.author.clone()))
        .bind(first.map(|f| f.avatar.clone()))
        .fetch_one(&self.db)
        .await?;

        self.insert_simple("thread_messages", "thread_id", thread_id, &first_rows).await?;
        for c in chunks {
            let rows = self.prepare(c, true).await?;
            self.insert_simple("thread_messages", "thread_id", thread_id, &rows).await?;
        }
        sqlx::query(
            "UPDATE threads SET message_count = (SELECT COUNT(*) FROM thread_messages WHERE thread_id=$1),
                                last_reply_at = (SELECT MAX(created_at) FROM thread_messages WHERE thread_id=$1)
             WHERE id=$1",
        )
        .bind(thread_id)
        .execute(&self.db)
        .await?;
        self.progress(&format!("Fil « {} »", truncate(&t.name, 60))).await;
        Ok(())
    }

    async fn import_forum_post(&mut self, channel_id: Uuid, mut t: ThreadData) -> anyhow::Result<()> {
        sort_messages(&mut t.messages);
        // Message d'ouverture : celui qui porte l'id du fil (Discord), sinon le premier
        if let Some(pos) = t.messages.iter().position(|m| m.id == t.id) {
            let starter = t.messages.remove(pos);
            t.messages.insert(0, starter);
        }
        let msgs = std::mem::take(&mut t.messages);
        let (head, tail) = msgs.split_at(msgs.len().min(1));
        let opening = self.prepare(head, true).await?.pop();

        let title = truncate(t.name.trim(), 200);
        let post_id: Uuid = sqlx::query_scalar(
            "INSERT INTO forum_posts (channel_id, title, content, creator_id, locked, created_at, webhook_display_name, webhook_avatar_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        )
        .bind(channel_id)
        .bind(if title.is_empty() { "Sans titre".to_string() } else { title })
        .bind(opening.as_ref().map(|o| o.content.clone()).filter(|c| !c.is_empty()))
        .bind(self.user_id)
        .bind(false)
        .bind(Self::thread_created_at(&t, opening.as_ref()))
        .bind(opening.as_ref().map(|o| o.author.clone()))
        .bind(opening.as_ref().map(|o| o.avatar.clone()))
        .fetch_one(&self.db)
        .await?;

        for c in tail.chunks(BATCH) {
            let rows = self.prepare(c, true).await?;
            self.insert_simple("forum_replies", "post_id", post_id, &rows).await?;
        }
        sqlx::query(
            "UPDATE forum_posts SET reply_count = (SELECT COUNT(*) FROM forum_replies WHERE post_id=$1),
                                    last_reply_at = (SELECT MAX(created_at) FROM forum_replies WHERE post_id=$1)
             WHERE id=$1",
        )
        .bind(post_id)
        .execute(&self.db)
        .await?;
        self.progress(&format!("Post « {} »", truncate(&t.name, 60))).await;
        Ok(())
    }
}
