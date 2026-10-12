//! Synchronisation périodique Discord -> ForgeChat (migration 130).
//!
//! Le propriétaire (ou MANAGE_SERVER) lie son serveur ForgeChat à un serveur Discord
//! avec un bot à lui (jeton chiffré au repos, jamais renvoyé). Toutes les 24 ou 48 h,
//! le NOUVEAU contenu est importé : nouvelles catégories, nouveaux salons, nouveaux
//! messages (curseur par salon = dernier message importé) et nouveaux émojis. Les
//! catégories exclues (par défaut « actualité ») et tout élément supprimé côté
//! ForgeChat ne sont jamais (re)créés. Comme l'import d'archive, les messages sont
//! insérés en clair au nom d'auteurs « webhook » (pseudo et avatar Discord), même
//! dans un salon chiffré de bout en bout.
//!
//! Plusieurs instances : un verrou Redis (SET NX EX) par serveur.

use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::discord_api::{ApiError, DChannel, DMessage, DOverwrite, Discord};
use super::format::{
    build_content, channel_kind, clean_filename, convert_permissions, is_system, safe_ext, truncate, MessageData, Names,
};
use super::sync_rules::{self as rules, fold_name, snowflake};
use super::UserError;
use crate::{
    error::{AppError, Result},
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::Permissions as P,
    state::AppState,
};

const TOKEN_INFO: &str = "forgechat discord sync token v1";
/// Verrou d'une synchronisation en cours (renouvelé à chaque salon).
const LOCK_TTL_SECS: u64 = 3600;
/// Pages de 100 messages lues par salon et par passage ; la suite au passage suivant.
const MAX_PAGES_PER_CHANNEL: usize = 20;
/// Durée maximale d'un passage ; la suite est reprise 15 min plus tard.
const RUN_BUDGET: Duration = Duration::from_secs(40 * 60);
const ATTACHMENT_MAX: u64 = 25 * 1024 * 1024;
/// « Synchroniser maintenant » : au plus une fois toutes les 5 minutes.
const MANUAL_COOLDOWN_SECS: u64 = 300;

fn seal_token(server_id: Uuid, token: &str) -> String {
    crate::email_crypto::seal_with(TOKEN_INFO, &server_id.to_string(), token)
}

fn open_token(server_id: Uuid, stored: &str) -> Option<String> {
    crate::email_crypto::open_with(TOKEN_INFO, &server_id.to_string(), stored)
}

fn user_err(msg: impl Into<String>) -> anyhow::Error {
    anyhow::Error::new(UserError(msg.into()))
}

fn lock_key(server_id: Uuid) -> String {
    format!("discord_sync:lock:{server_id}")
}

// ─── Verrou Redis ───────────────────────────────────────────────────────────

async fn try_lock(state: &AppState, server_id: Uuid) -> Option<String> {
    let token = Uuid::new_v4().to_string();
    let mut redis = state.redis.lock().await;
    let ok: Option<String> = redis::cmd("SET")
        .arg(lock_key(server_id))
        .arg(&token)
        .arg("NX")
        .arg("EX")
        .arg(LOCK_TTL_SECS)
        .query_async(&mut *redis)
        .await
        .ok()
        .flatten();
    ok.map(|_| token)
}

/// Prolonge le verrou s'il est toujours à nous.
async fn renew_lock(state: &AppState, server_id: Uuid, token: &str) {
    let script = redis::Script::new(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end",
    );
    let mut redis = state.redis.lock().await;
    let _: std::result::Result<i64, _> =
        script.key(lock_key(server_id)).arg(token).arg(LOCK_TTL_SECS).invoke_async(&mut *redis).await;
}

async fn unlock(state: &AppState, server_id: Uuid, token: &str) {
    let script = redis::Script::new(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    );
    let mut redis = state.redis.lock().await;
    let _: std::result::Result<i64, _> = script.key(lock_key(server_id)).arg(token).invoke_async(&mut *redis).await;
}

async fn is_running(state: &AppState, server_id: Uuid) -> bool {
    let mut redis = state.redis.lock().await;
    redis::cmd("EXISTS").arg(lock_key(server_id)).query_async::<_, i64>(&mut *redis).await.unwrap_or(0) > 0
}

// ─── Planificateur ──────────────────────────────────────────────────────────

/// Tâche de fond (main.rs, toutes les 10 minutes) : lance les synchronisations échues.
pub async fn run_due(state: &AppState) {
    let due: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT server_id FROM discord_sync_configs
         WHERE enabled AND bot_token_enc IS NOT NULL AND (next_sync_at IS NULL OR next_sync_at <= NOW())
         ORDER BY next_sync_at NULLS FIRST LIMIT 5",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Synchro Discord : lecture des configurations impossible : {e}");
            return;
        }
    };
    for sid in due {
        sync_server(state, sid).await;
    }
}

/// Synchronise un serveur si personne d'autre ne le fait ; enregistre le résultat.
pub async fn sync_server(state: &AppState, server_id: Uuid) {
    let Some(lock) = try_lock(state, server_id).await else {
        tracing::debug!("Synchro Discord {server_id} : déjà en cours ailleurs");
        return;
    };
    let started = Instant::now();
    let result = run(state, server_id, &lock).await;
    unlock(state, server_id, &lock).await;

    let (status, error, imported, retry_in): (&str, Option<String>, i32, Option<i64>) = match &result {
        Ok(r) => {
            tracing::info!(
                "Synchro Discord {server_id} : {} message(s), {} salon(s), {} catégorie(s), {} émoji(s) en {:?}",
                r.messages, r.channels, r.categories, r.emojis, started.elapsed()
            );
            let warn = (!r.warnings.is_empty()).then(|| truncate(&r.warnings.join(" · "), 1000));
            let status = if warn.is_some() { "partial" } else { "ok" };
            (status, warn, r.messages as i32, r.backlog.then_some(15))
        }
        Err(e) => {
            tracing::warn!("Synchro Discord {server_id} en échec : {e:?}");
            let msg = e
                .downcast_ref::<UserError>()
                .map(|u| u.0.clone())
                .unwrap_or_else(|| "Erreur interne pendant la synchronisation ; nouvel essai plus tard.".into());
            ("error", Some(msg), 0, Some(6 * 60))
        }
    };
    // Prochain passage : l'intervalle choisi, plus tôt s'il reste du retard, 6 h après une erreur.
    let res = sqlx::query(
        "UPDATE discord_sync_configs SET last_sync_at=NOW(), last_status=$2, last_error=$3, last_imported=$4,
                next_sync_at = NOW() + COALESCE(make_interval(mins => $5::int), make_interval(hours => interval_hours::int))
         WHERE server_id=$1",
    )
    .bind(server_id)
    .bind(status)
    .bind(error)
    .bind(imported)
    .bind(retry_in.map(|m| m as i32))
    .execute(&state.db)
    .await;
    if let Err(e) = res {
        tracing::error!("Synchro Discord {server_id} : enregistrement du résultat impossible : {e}");
    }
}

// ─── Passage de synchronisation ─────────────────────────────────────────────

#[derive(Default)]
struct Report {
    categories: u32,
    channels: u32,
    messages: u32,
    emojis: u32,
    backlog: bool,
    warnings: Vec<String>,
}

struct Ctx<'a> {
    state: &'a AppState,
    server_id: Uuid,
    owner: Uuid,
    lock: &'a str,
    api: Discord,
    names: Names,
    report: Report,
    deadline: Instant,
}

/// Familles de salons compatibles pour rattacher un salon Discord à un salon existant.
fn family(kind: &str) -> u8 {
    match kind {
        "text" | "announcement" => 0,
        "voice" | "stage" => 1,
        "forum" | "media" => 2,
        _ => 3,
    }
}

/// Même nom, à la casse, aux accents et à la décoration près.
fn same_name(a: &str, b: &str) -> bool {
    let (fa, fb) = (fold_name(a), fold_name(b));
    if fa.is_empty() || fb.is_empty() {
        a.trim().to_lowercase() == b.trim().to_lowercase()
    } else {
        fa == fb
    }
}

fn parse_u64(s: &str) -> u64 {
    s.trim().parse().unwrap_or(0)
}

async fn run(state: &AppState, server_id: Uuid, lock: &str) -> anyhow::Result<Report> {
    let row: Option<(String, Option<String>, Vec<String>, bool, Uuid)> = sqlx::query_as(
        "SELECT c.guild_id, c.bot_token_enc, c.excluded_categories, c.sync_emojis, s.owner_id
         FROM discord_sync_configs c JOIN servers s ON s.id = c.server_id WHERE c.server_id=$1",
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((guild, token_enc, excluded, sync_emojis, owner)) = row else {
        return Err(user_err("Synchronisation non configurée."));
    };
    let token = token_enc
        .as_deref()
        .and_then(|t| open_token(server_id, t))
        .ok_or_else(|| user_err("Jeton du bot Discord absent ou illisible : saisissez-le à nouveau."))?;

    let mut cx = Ctx {
        state,
        server_id,
        owner,
        lock,
        api: Discord::new(&token)?,
        names: Names::default(),
        report: Report::default(),
        deadline: Instant::now() + RUN_BUDGET,
    };
    cx.api.guild(&guild).await?;
    let channels = cx.api.channels(&guild).await?;
    let roles = cx.api.roles(&guild).await?;
    for r in &roles {
        cx.names.roles.insert(r.id.clone(), r.name.clone());
    }
    cx.names.roles.insert(guild.clone(), "everyone".into());
    for c in &channels {
        cx.names.channels.insert(c.id.clone(), c.name.clone().unwrap_or_default());
    }

    let mut map: HashMap<(String, String), Uuid> = sqlx::query_as::<_, (String, String, Uuid)>(
        "SELECT kind, discord_id, forgechat_id FROM discord_sync_map WHERE server_id=$1 AND kind <> 'message'",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|(k, d, f)| ((k, d), f))
    .collect();
    let fc_cats: Vec<(Uuid, String)> = sqlx::query_as("SELECT id, name FROM categories WHERE server_id=$1")
        .bind(server_id)
        .fetch_all(&state.db)
        .await?;
    let fc_chans: Vec<(Uuid, String, String, Option<Uuid>)> =
        sqlx::query_as("SELECT id, name, type, category_id FROM channels WHERE server_id=$1")
            .bind(server_id)
            .fetch_all(&state.db)
            .await?;
    let fc_roles: Vec<(Uuid, String, bool)> = sqlx::query_as("SELECT id, name, is_everyone FROM roles WHERE server_id=$1")
        .bind(server_id)
        .fetch_all(&state.db)
        .await?;
    let mut mapped: HashSet<Uuid> = map.values().copied().collect();

    // Catégories : Some(id) = cible ForgeChat, None = exclue ou supprimée côté ForgeChat.
    let mut cat_target: HashMap<String, Option<Uuid>> = HashMap::new();
    let mut cats: Vec<&DChannel> = channels.iter().filter(|c| c.r#type == 4).collect();
    cats.sort_by_key(|c| (c.position, snowflake(&c.id)));
    for c in cats {
        let name = c.name.clone().unwrap_or_default();
        if rules::is_excluded(&excluded, &c.id, &name) {
            cat_target.insert(c.id.clone(), None);
            continue;
        }
        if let Some(fc) = map.get(&("category".to_string(), c.id.clone())) {
            let alive = fc_cats.iter().any(|(id, _)| id == fc);
            cat_target.insert(c.id.clone(), alive.then_some(*fc));
            continue;
        }
        let existing = fc_cats.iter().find(|(id, n)| !mapped.contains(id) && same_name(n, &name)).map(|(id, _)| *id);
        let id = match existing {
            Some(id) => id,
            None => {
                let id = cx.create_category(&name, c.position).await?;
                cx.report.categories += 1;
                id
            }
        };
        cx.record_map("category", &c.id, id).await?;
        map.insert(("category".into(), c.id.clone()), id);
        mapped.insert(id);
        cat_target.insert(c.id.clone(), Some(id));
    }

    // Salons
    // Texte, vocal, annonces, conférence, forum, médias (pas les fils ni les types inconnus).
    let mut list: Vec<&DChannel> =
        channels.iter().filter(|c| matches!(c.r#type, 0 | 2 | 5 | 13 | 15 | 16) && channel_kind(c.r#type).is_some()).collect();
    list.sort_by_key(|c| (c.position, snowflake(&c.id)));
    // (salon Discord, salon ForgeChat, créé maintenant)
    let mut text: Vec<(&DChannel, Uuid, bool)> = Vec::new();
    for ch in list {
        let category = match ch.parent_id.as_deref() {
            Some(p) => match cat_target.get(p) {
                Some(Some(id)) => Some(*id),
                Some(None) => continue, // catégorie exclue ou supprimée
                None => None,
            },
            None => None,
        };
        let kind = channel_kind(ch.r#type).unwrap_or("text");
        let name = ch.name.clone().unwrap_or_default();
        let (fc_id, created) = match map.get(&("channel".to_string(), ch.id.clone())) {
            Some(fc) => match fc_chans.iter().find(|c| c.0 == *fc) {
                Some(_) => (*fc, false),
                None => continue, // supprimé côté ForgeChat : pas recréé
            },
            None => {
                let existing = fc_chans
                    .iter()
                    .find(|c| !mapped.contains(&c.0) && c.3 == category && family(&c.2) == family(kind) && same_name(&c.1, &name))
                    .map(|c| c.0);
                let r = match existing {
                    Some(id) => (id, false),
                    None => {
                        let id = cx.create_channel(category, ch, kind, &name, &guild, &roles, &fc_roles).await?;
                        cx.report.channels += 1;
                        (id, true)
                    }
                };
                cx.record_map("channel", &ch.id, r.0).await?;
                map.insert(("channel".into(), ch.id.clone()), r.0);
                mapped.insert(r.0);
                r
            }
        };
        let fc_kind = fc_chans.iter().find(|c| c.0 == fc_id).map(|c| c.2.as_str()).unwrap_or(kind);
        if matches!(ch.r#type, 0 | 5) && family(fc_kind) == 0 {
            text.push((ch, fc_id, created));
        }
    }

    // Messages
    let cursors: HashMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT discord_channel_id, last_message_id FROM discord_sync_cursors WHERE server_id=$1",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .collect();
    for (ch, fc_id, created) in text {
        if Instant::now() > cx.deadline {
            cx.report.backlog = true;
            break;
        }
        let stored = cursors.get(&ch.id).map(String::as_str);
        let last_imported = if stored.is_none() && !created {
            sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
                "SELECT MAX(created_at) FROM messages WHERE channel_id=$1 AND type='webhook'",
            )
            .bind(fc_id)
            .fetch_one(&state.db)
            .await?
        } else {
            None
        };
        let cursor = rules::initial_cursor(stored, last_imported);
        cx.sync_channel(ch, fc_id, cursor).await?;
    }

    if sync_emojis && Instant::now() < cx.deadline {
        cx.sync_emojis(&guild, &map).await?;
    }
    Ok(cx.report)
}

impl Ctx<'_> {
    async fn record_map(&self, kind: &str, discord_id: &str, fc: Uuid) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO discord_sync_map (server_id, kind, discord_id, forgechat_id) VALUES ($1, $2, $3, $4)
             ON CONFLICT (server_id, kind, discord_id) DO UPDATE SET forgechat_id = EXCLUDED.forgechat_id",
        )
        .bind(self.server_id)
        .bind(kind)
        .bind(discord_id)
        .bind(fc)
        .execute(&self.state.db)
        .await?;
        Ok(())
    }

    async fn create_category(&self, name: &str, position: i64) -> anyhow::Result<Uuid> {
        let name = truncate(name.trim(), 100);
        let name = if name.is_empty() { "catégorie".to_string() } else { name };
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (server_id, name, position, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
        )
        .bind(self.server_id)
        .bind(&name)
        .bind(position as i32)
        .bind(self.owner)
        .fetch_one(&self.state.db)
        .await?;
        self.state
            .broadcast_to_server_members(
                self.server_id,
                json!({ "type": "CATEGORY_CREATE", "server_id": self.server_id,
                        "category": { "id": id, "name": name, "position": position, "created_by": self.owner } })
                .to_string(),
            )
            .await;
        Ok(id)
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_channel(
        &self,
        category: Option<Uuid>,
        ch: &DChannel,
        kind: &str,
        name: &str,
        guild: &str,
        roles: &[super::discord_api::DRole],
        fc_roles: &[(Uuid, String, bool)],
    ) -> anyhow::Result<Uuid> {
        let name = truncate(name.trim(), 100);
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO channels (server_id, category_id, name, type, topic, position, is_nsfw, slowmode_delay, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
        )
        .bind(self.server_id)
        .bind(category)
        .bind(if name.is_empty() { "salon".to_string() } else { name })
        .bind(kind)
        .bind(ch.topic.as_deref().map(str::trim).filter(|t| !t.is_empty()))
        .bind(ch.position as i32)
        .bind(ch.nsfw.unwrap_or(false))
        .bind(ch.rate_limit_per_user.unwrap_or(0).clamp(0, 21600) as i32)
        .bind(self.owner)
        .fetch_one(&self.state.db)
        .await?;

        // Surcharges de rôle : @everyone, et les rôles ForgeChat de même nom.
        let everyone = fc_roles.iter().find(|r| r.2).map(|r| r.0);
        for ow in ch.permission_overwrites.iter().filter(|o: &&DOverwrite| o.r#type == 0) {
            let target = if ow.id == guild {
                everyone
            } else {
                let rname = roles.iter().find(|r| r.id == ow.id).map(|r| r.name.to_lowercase());
                rname.and_then(|n| fc_roles.iter().find(|r| !r.2 && r.1.to_lowercase() == n).map(|r| r.0))
            };
            let Some(target) = target else { continue };
            let (allow, deny) = (convert_permissions(parse_u64(&ow.allow)), convert_permissions(parse_u64(&ow.deny)));
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
            .execute(&self.state.db)
            .await?;
        }

        if let Ok(channel) = sqlx::query_as::<_, crate::models::channel::Channel>("SELECT * FROM channels WHERE id=$1")
            .bind(id)
            .fetch_one(&self.state.db)
            .await
        {
            let event = json!({ "type": "CHANNEL_CREATE", "server_id": self.server_id, "channel": &channel });
            self.state.broadcast_to_channel_members(id, event.to_string()).await;
        }
        Ok(id)
    }

    async fn sync_channel(&mut self, ch: &DChannel, fc_id: Uuid, mut cursor: u64) -> anyhow::Result<()> {
        let label = ch.name.clone().unwrap_or_default();
        for page_no in 0..MAX_PAGES_PER_CHANNEL {
            if Instant::now() > self.deadline {
                self.report.backlog = true;
                return Ok(());
            }
            renew_lock(self.state, self.server_id, self.lock).await;
            let page = match self.api.messages_after(&ch.id, cursor).await {
                Ok(p) => p,
                Err(ApiError::NoAccess) => {
                    self.report.warnings.push(format!("#{} : salon illisible pour le bot", truncate(&label, 60)));
                    return Ok(());
                }
                Err(ApiError::Fatal(e)) => return Err(e),
            };
            let step = rules::page_step(cursor, page, |m: &DMessage| snowflake(&m.id));
            if step.cursor == cursor {
                return Ok(());
            }
            self.store_messages(&ch.id, fc_id, step.fresh, step.cursor).await?;
            cursor = step.cursor;
            if !step.more {
                return Ok(());
            }
            if page_no + 1 == MAX_PAGES_PER_CHANNEL {
                self.report.backlog = true;
            }
        }
        Ok(())
    }

    /// Insère un paquet de messages et avance le curseur dans la même transaction :
    /// un passage interrompu reprend exactement là où il s'est arrêté, sans doublon.
    async fn store_messages(&mut self, discord_channel: &str, channel_id: Uuid, msgs: Vec<DMessage>, cursor: u64) -> anyhow::Result<()> {
        let db = &self.state.db;
        let ids: Vec<String> = msgs.iter().map(|m| m.id.clone()).collect();
        let already: HashSet<String> = sqlx::query_scalar(
            "SELECT discord_id FROM discord_sync_map WHERE server_id=$1 AND kind='message' AND discord_id = ANY($2)",
        )
        .bind(self.server_id)
        .bind(&ids)
        .fetch_all(db)
        .await?
        .into_iter()
        .collect();
        let refs: Vec<String> = msgs.iter().filter_map(|m| m.message_reference.as_ref()?.message_id.clone()).collect();
        let mut msg_map: HashMap<String, Uuid> = sqlx::query_as::<_, (String, Uuid)>(
            "SELECT discord_id, forgechat_id FROM discord_sync_map WHERE server_id=$1 AND kind='message' AND discord_id = ANY($2)",
        )
        .bind(self.server_id)
        .bind(&refs)
        .fetch_all(db)
        .await?
        .into_iter()
        .collect();

        struct Row {
            discord_id: String,
            id: Uuid,
            content: Option<String>,
            author: String,
            avatar: String,
            created_at: DateTime<Utc>,
            edited_at: Option<DateTime<Utc>>,
            pinned: bool,
            reply_to: Option<Uuid>,
            atts: Vec<(String, String, i64, String)>,
        }
        let mut rows: Vec<Row> = Vec::new();
        let mut written: Vec<std::path::PathBuf> = Vec::new();
        let upload_dir = std::path::PathBuf::from(&self.state.config.upload_dir);
        for m in msgs.into_iter().filter(|m| !already.contains(&m.id)) {
            for u in m.mentions.iter().chain(std::iter::once(&m.author)) {
                if !u.id.is_empty() {
                    self.names.users.insert(u.id.clone(), u.display());
                }
            }
            let data = MessageData {
                id: m.id.clone(),
                content: m.content.clone(),
                author_id: m.author.id.clone(),
                author_name: m.author.display(),
                author_avatar: m.author.avatar_url(),
                timestamp: m.timestamp.clone(),
                edited_timestamp: m.edited_timestamp.clone(),
                r#type: Some(m.r#type),
                pinned: Some(m.pinned),
                embeds: m.embeds,
                stickers: m.sticker_items,
                referenced_message_id: m.message_reference.and_then(|r| r.message_id),
                ..Default::default()
            };
            if is_system(&data) {
                continue;
            }
            let mut extra = Vec::new();
            let mut atts = Vec::new();
            for a in &m.attachments {
                let filename = clean_filename(&a.filename);
                let bytes = if a.size <= ATTACHMENT_MAX { self.api.download(&a.url, ATTACHMENT_MAX).await } else { None };
                let stored = match bytes {
                    Some(b) => {
                        let file = format!("{}.{}", Uuid::new_v4(), safe_ext(&filename));
                        let dest = upload_dir.join(&file);
                        match tokio::fs::write(&dest, &b).await {
                            Ok(()) => {
                                written.push(dest);
                                Some((file, b.len() as i64))
                            }
                            Err(e) => {
                                tracing::warn!("Synchro Discord : écriture de {filename} impossible : {e}");
                                None
                            }
                        }
                    }
                    None => None,
                };
                match stored {
                    Some((file, size)) => {
                        let ct = mime_guess::from_ext(&safe_ext(&filename)).first_raw().unwrap_or("application/octet-stream");
                        atts.push((truncate(&filename, 255), truncate(ct, 100), size, format!("/uploads/{file}")));
                    }
                    None => extra.push(format!("📎 {filename} (non archivé)")),
                }
            }
            let content = build_content(&data, &self.names, &extra);
            if content.trim().is_empty() && atts.is_empty() {
                continue;
            }
            let author = truncate(data.author_name.trim(), 80);
            let id = Uuid::new_v4();
            let reply_to = data.referenced_message_id.as_ref().and_then(|r| msg_map.get(r).copied());
            msg_map.insert(data.id.clone(), id);
            rows.push(Row {
                discord_id: data.id.clone(),
                id,
                content: (!content.is_empty()).then_some(content),
                author: if author.is_empty() { "Inconnu".into() } else { author },
                avatar: super::format::avatar_or_empty(data.author_avatar.as_deref()),
                created_at: super::format::parse_ts(&data.timestamp, &data.id),
                edited_at: data
                    .edited_timestamp
                    .as_deref()
                    .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                    .map(|d| d.with_timezone(&Utc)),
                pinned: data.pinned.unwrap_or(false),
                reply_to,
                atts,
            });
        }

        let res: anyhow::Result<()> = async {
            let mut tx = db.begin().await?;
            if !rows.is_empty() {
                sqlx::query(
                    "INSERT INTO messages (id, channel_id, user_id, content, type, reply_to, pinned, edited_at, created_at, webhook_display_name, webhook_avatar_url)
                     SELECT t.id, $2, $3, t.content, 'webhook', t.reply_to, t.pinned, t.edited_at, t.created_at, t.author, t.avatar
                     FROM UNNEST($1::uuid[], $4::text[], $5::uuid[], $6::bool[], $7::timestamptz[], $8::timestamptz[], $9::text[], $10::text[])
                          AS t(id, content, reply_to, pinned, edited_at, created_at, author, avatar)",
                )
                .bind(rows.iter().map(|r| r.id).collect::<Vec<_>>())
                .bind(channel_id)
                .bind(self.owner)
                .bind(rows.iter().map(|r| r.content.clone()).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.reply_to).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.pinned).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.edited_at).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.created_at).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.author.clone()).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.avatar.clone()).collect::<Vec<_>>())
                .execute(&mut *tx)
                .await?;

                let atts: Vec<(Uuid, DateTime<Utc>, &(String, String, i64, String))> =
                    rows.iter().flat_map(|r| r.atts.iter().map(move |a| (r.id, r.created_at, a))).collect();
                if !atts.is_empty() {
                    sqlx::query(
                        "INSERT INTO attachments (message_id, filename, content_type, size, url, created_at)
                         SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::timestamptz[])",
                    )
                    .bind(atts.iter().map(|a| a.0).collect::<Vec<_>>())
                    .bind(atts.iter().map(|a| a.2 .0.clone()).collect::<Vec<_>>())
                    .bind(atts.iter().map(|a| a.2 .1.clone()).collect::<Vec<_>>())
                    .bind(atts.iter().map(|a| a.2 .2).collect::<Vec<_>>())
                    .bind(atts.iter().map(|a| a.2 .3.clone()).collect::<Vec<_>>())
                    .bind(atts.iter().map(|a| a.1).collect::<Vec<_>>())
                    .execute(&mut *tx)
                    .await?;
                }
                let pins: Vec<&Row> = rows.iter().filter(|r| r.pinned).collect();
                if !pins.is_empty() {
                    sqlx::query(
                        "INSERT INTO pinned_messages (channel_id, message_id, pinned_by, pinned_at)
                         SELECT $1, t.id, $2, t.at FROM UNNEST($3::uuid[], $4::timestamptz[]) AS t(id, at)
                         ON CONFLICT DO NOTHING",
                    )
                    .bind(channel_id)
                    .bind(self.owner)
                    .bind(pins.iter().map(|r| r.id).collect::<Vec<_>>())
                    .bind(pins.iter().map(|r| r.created_at).collect::<Vec<_>>())
                    .execute(&mut *tx)
                    .await?;
                }
                sqlx::query(
                    "INSERT INTO discord_sync_map (server_id, kind, discord_id, forgechat_id)
                     SELECT $1, 'message', t.d, t.f FROM UNNEST($2::text[], $3::uuid[]) AS t(d, f)
                     ON CONFLICT DO NOTHING",
                )
                .bind(self.server_id)
                .bind(rows.iter().map(|r| r.discord_id.clone()).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.id).collect::<Vec<_>>())
                .execute(&mut *tx)
                .await?;
                sqlx::query("UPDATE channels SET last_message_id=$2 WHERE id=$1")
                    .bind(channel_id)
                    .bind(rows.last().map(|r| r.id))
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query(
                "INSERT INTO discord_sync_cursors (server_id, discord_channel_id, last_message_id) VALUES ($1, $2, $3)
                 ON CONFLICT (server_id, discord_channel_id) DO UPDATE SET last_message_id = EXCLUDED.last_message_id, updated_at = NOW()",
            )
            .bind(self.server_id)
            .bind(discord_channel)
            .bind(cursor.to_string())
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            Ok(())
        }
        .await;
        if let Err(e) = res {
            for p in written {
                let _ = tokio::fs::remove_file(p).await;
            }
            return Err(e);
        }
        self.report.messages += rows.len() as u32;
        Ok(())
    }

    async fn sync_emojis(&mut self, guild: &str, map: &HashMap<(String, String), Uuid>) -> anyhow::Result<()> {
        let list = match self.api.emojis(guild).await {
            Ok(l) => l,
            Err(ApiError::NoAccess) => {
                self.report.warnings.push("émojis illisibles pour le bot".into());
                return Ok(());
            }
            Err(ApiError::Fatal(e)) => return Err(e),
        };
        let emoji_dir = std::path::PathBuf::from(&self.state.config.upload_dir).join("emojis");
        for e in list {
            let Some(did) = e.id.filter(|i| i.bytes().all(|b| b.is_ascii_digit()) && !i.is_empty()) else { continue };
            if map.contains_key(&("emoji".to_string(), did.clone())) || e.available == Some(false) {
                continue;
            }
            let name: String = e
                .name
                .unwrap_or_default()
                .to_lowercase()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                .take(32)
                .collect();
            if name.is_empty() {
                continue;
            }
            let existing: Option<Uuid> = sqlx::query_scalar("SELECT id FROM custom_emojis WHERE server_id=$1 AND name=$2")
                .bind(self.server_id)
                .bind(&name)
                .fetch_optional(&self.state.db)
                .await?;
            let id = match existing {
                Some(id) => id,
                None => {
                    let animated = e.animated.unwrap_or(false);
                    let (ext, mime, max) = if animated { ("gif", "image/gif", 512 * 1024) } else { ("png", "image/png", 256 * 1024) };
                    let Some(bytes) = self.api.download(&format!("https://cdn.discordapp.com/emojis/{did}.{ext}"), max).await else {
                        continue;
                    };
                    let filename = format!("emoji_{}.{}", Uuid::new_v4(), ext);
                    tokio::fs::create_dir_all(&emoji_dir).await?;
                    tokio::fs::write(emoji_dir.join(&filename), &bytes).await?;
                    let id: Option<Uuid> = sqlx::query_scalar(
                        "INSERT INTO custom_emojis (server_id, name, url, mime_type, creator_id)
                         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (server_id, name) DO NOTHING RETURNING id",
                    )
                    .bind(self.server_id)
                    .bind(&name)
                    .bind(format!("/uploads/emojis/{filename}"))
                    .bind(mime)
                    .bind(self.owner)
                    .fetch_optional(&self.state.db)
                    .await?;
                    let Some(id) = id else {
                        let _ = tokio::fs::remove_file(emoji_dir.join(&filename)).await;
                        continue;
                    };
                    self.report.emojis += 1;
                    id
                }
            };
            self.record_map("emoji", &did, id).await?;
        }
        Ok(())
    }
}

// ─── Lien laissé par l'import d'archive ─────────────────────────────────────

/// Après un import d'archive : mémorise les correspondances catégories/salons, le
/// dernier message importé de chaque salon et l'identifiant du serveur Discord, pour
/// qu'une synchronisation ultérieure ne reprenne que la suite (désactivée par défaut).
pub async fn record_import(
    db: &sqlx::PgPool,
    server_id: Uuid,
    guild_id: &str,
    maps: &[(&'static str, String, Uuid)],
    cursors: &[(String, u64)],
) -> anyhow::Result<()> {
    if let Ok(g) = rules::validate_guild_id(guild_id) {
        sqlx::query("INSERT INTO discord_sync_configs (server_id, guild_id) VALUES ($1, $2) ON CONFLICT (server_id) DO NOTHING")
            .bind(server_id)
            .bind(g)
            .execute(db)
            .await?;
    }
    let maps: Vec<&(&str, String, Uuid)> = maps.iter().filter(|m| !m.1.is_empty() && m.1.len() <= 21).collect();
    sqlx::query(
        "INSERT INTO discord_sync_map (server_id, kind, discord_id, forgechat_id)
         SELECT $1, t.k, t.d, t.f FROM UNNEST($2::text[], $3::text[], $4::uuid[]) AS t(k, d, f)
         ON CONFLICT DO NOTHING",
    )
    .bind(server_id)
    .bind(maps.iter().map(|m| m.0.to_string()).collect::<Vec<_>>())
    .bind(maps.iter().map(|m| m.1.clone()).collect::<Vec<_>>())
    .bind(maps.iter().map(|m| m.2).collect::<Vec<_>>())
    .execute(db)
    .await?;
    let cursors: Vec<&(String, u64)> = cursors.iter().filter(|c| c.1 > 0 && !c.0.is_empty() && c.0.len() <= 21).collect();
    sqlx::query(
        "INSERT INTO discord_sync_cursors (server_id, discord_channel_id, last_message_id)
         SELECT $1, t.c, t.m FROM UNNEST($2::text[], $3::text[]) AS t(c, m)
         ON CONFLICT (server_id, discord_channel_id) DO NOTHING",
    )
    .bind(server_id)
    .bind(cursors.iter().map(|c| c.0.clone()).collect::<Vec<_>>())
    .bind(cursors.iter().map(|c| c.1.to_string()).collect::<Vec<_>>())
    .execute(db)
    .await?;
    Ok(())
}

// ─── API ────────────────────────────────────────────────────────────────────

async fn config_json(state: &AppState, server_id: Uuid) -> Result<Value> {
    #[derive(sqlx::FromRow)]
    struct Cfg {
        guild_id: String,
        has_token: bool,
        interval_hours: i16,
        excluded_categories: Vec<String>,
        enabled: bool,
        sync_emojis: bool,
        next_sync_at: Option<DateTime<Utc>>,
        last_sync_at: Option<DateTime<Utc>>,
        last_status: Option<String>,
        last_error: Option<String>,
        last_imported: i32,
    }
    let cfg: Option<Cfg> = sqlx::query_as(
        "SELECT guild_id, bot_token_enc IS NOT NULL AS has_token, interval_hours, excluded_categories, enabled, sync_emojis,
                next_sync_at, last_sync_at, last_status, last_error, last_imported
         FROM discord_sync_configs WHERE server_id=$1",
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;
    let running = is_running(state, server_id).await;
    Ok(match cfg {
        None => json!({
            "configured": false, "guild_id": "", "has_token": false, "interval_hours": 24,
            "excluded_categories": rules::DEFAULT_EXCLUDED, "enabled": false, "sync_emojis": true,
            "next_sync_at": null, "last_sync_at": null, "last_status": null, "last_error": null,
            "last_imported": 0, "running": running,
        }),
        Some(c) => json!({
            "configured": true, "guild_id": c.guild_id, "has_token": c.has_token, "interval_hours": c.interval_hours,
            "excluded_categories": c.excluded_categories, "enabled": c.enabled, "sync_emojis": c.sync_emojis,
            "next_sync_at": c.next_sync_at, "last_sync_at": c.last_sync_at, "last_status": c.last_status,
            "last_error": c.last_error, "last_imported": c.last_imported, "running": running,
        }),
    })
}

fn bad(m: &str) -> AppError {
    AppError::BadRequest(m.into())
}

/// Erreur Discord rendue à l'utilisateur (jeton refusé, bot absent du serveur…).
fn discord_err(e: anyhow::Error) -> AppError {
    match e.downcast_ref::<UserError>() {
        Some(u) => AppError::BadRequest(u.0.clone()),
        None => {
            tracing::warn!("Synchro Discord : {e:?}");
            AppError::Unavailable("Discord est injoignable pour le moment, réessayez plus tard.".into())
        }
    }
}

async fn stored_token(state: &AppState, server_id: Uuid) -> Result<Option<(String, String)>> {
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT guild_id, bot_token_enc FROM discord_sync_configs WHERE server_id=$1")
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?;
    Ok(row.and_then(|(g, t)| Some((g, open_token(server_id, t.as_deref()?)?))))
}

/// GET /api/servers/:server_id/discord-sync
pub async fn get_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    Ok(Json(config_json(&state, server_id).await?))
}

#[derive(Deserialize)]
pub struct PutConfig {
    pub guild_id: String,
    /// Absent ou vide : le jeton enregistré est conservé.
    pub bot_token: Option<String>,
    pub interval_hours: i64,
    pub excluded_categories: Vec<String>,
    pub enabled: bool,
    pub sync_emojis: Option<bool>,
}

/// PUT /api/servers/:server_id/discord-sync
pub async fn put_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<PutConfig>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    let guild = rules::validate_guild_id(&body.guild_id).map_err(bad)?;
    let interval = rules::validate_interval(body.interval_hours).map_err(bad)?;
    let excluded = rules::validate_excluded(&body.excluded_categories).map_err(bad)?;
    let new_token = match body.bot_token.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => Some(rules::normalize_token(t).map_err(bad)?),
        None => None,
    };
    let previous = stored_token(&state, server_id).await?;

    // Jeton ou serveur Discord modifié : vérifié auprès de Discord avant d'être enregistré.
    let token = new_token.clone().or_else(|| previous.as_ref().map(|p| p.1.clone()));
    let changed = new_token.is_some() || previous.as_ref().map(|p| p.0 != guild).unwrap_or(true);
    let mut guild_name = None;
    if let (Some(t), true) = (&token, changed) {
        let api = Discord::new(t).map_err(AppError::Internal)?;
        guild_name = Some(api.guild(&guild).await.map_err(discord_err)?.name);
    }
    if body.enabled && token.is_none() {
        return Err(bad("Renseignez le jeton du bot Discord pour activer la synchronisation."));
    }

    let sealed = new_token.as_deref().map(|t| seal_token(server_id, t));
    sqlx::query(
        "INSERT INTO discord_sync_configs (server_id, guild_id, bot_token_enc, interval_hours, excluded_categories, enabled, sync_emojis, updated_by, next_sync_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (server_id) DO UPDATE SET
            guild_id = EXCLUDED.guild_id,
            bot_token_enc = COALESCE(EXCLUDED.bot_token_enc, discord_sync_configs.bot_token_enc),
            interval_hours = EXCLUDED.interval_hours,
            excluded_categories = EXCLUDED.excluded_categories,
            enabled = EXCLUDED.enabled,
            sync_emojis = EXCLUDED.sync_emojis,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW(),
            next_sync_at = CASE WHEN discord_sync_configs.last_sync_at IS NULL THEN NOW()
                                ELSE discord_sync_configs.last_sync_at + make_interval(hours => EXCLUDED.interval_hours::int) END",
    )
    .bind(server_id)
    .bind(&guild)
    .bind(sealed)
    .bind(interval)
    .bind(&excluded)
    .bind(body.enabled)
    .bind(body.sync_emojis.unwrap_or(true))
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    let mut out = config_json(&state, server_id).await?;
    out["guild_name"] = json!(guild_name);
    Ok(Json(out))
}

/// DELETE /api/servers/:server_id/discord-sync : délie le serveur (jeton effacé). Les
/// correspondances et curseurs restent : un nouveau lien ne réimporte rien.
pub async fn delete_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    sqlx::query("DELETE FROM discord_sync_configs WHERE server_id=$1").bind(server_id).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// POST /api/servers/:server_id/discord-sync/run : « Synchroniser maintenant ».
pub async fn run_now(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    if stored_token(&state, server_id).await?.is_none() {
        return Err(bad("Enregistrez d'abord l'identifiant du serveur Discord et le jeton du bot."));
    }
    if is_running(&state, server_id).await {
        return Err(AppError::Conflict("Une synchronisation est déjà en cours.".into()));
    }
    let fresh: bool = {
        let mut redis = state.redis.lock().await;
        redis::cmd("SET")
            .arg(format!("discord_sync:manual:{server_id}"))
            .arg(1)
            .arg("NX")
            .arg("EX")
            .arg(MANUAL_COOLDOWN_SECS)
            .query_async::<_, Option<String>>(&mut *redis)
            .await
            .ok()
            .flatten()
            .is_some()
    };
    if !fresh {
        return Err(AppError::TooManyRequestsMsg("Synchronisation déjà lancée il y a moins de 5 minutes.".into()));
    }
    let st = state.clone();
    tokio::spawn(async move { sync_server(&st, server_id).await });
    Ok(Json(json!({ "started": true })))
}

/// GET /api/servers/:server_id/discord-sync/categories : catégories du serveur Discord
/// (pour choisir les exclusions), avec l'exclusion par défaut repérée.
pub async fn list_categories(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    let (guild, token) = stored_token(&state, server_id)
        .await?
        .ok_or_else(|| bad("Enregistrez d'abord l'identifiant du serveur Discord et le jeton du bot."))?;
    let excluded: Vec<String> = sqlx::query_scalar("SELECT excluded_categories FROM discord_sync_configs WHERE server_id=$1")
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
    let api = Discord::new(&token).map_err(AppError::Internal)?;
    let mut cats: Vec<DChannel> = api.channels(&guild).await.map_err(discord_err)?.into_iter().filter(|c| c.r#type == 4).collect();
    cats.sort_by_key(|c| (c.position, snowflake(&c.id)));
    let list: Vec<Value> = cats
        .iter()
        .map(|c| {
            let name = c.name.clone().unwrap_or_default();
            json!({
                "id": c.id,
                "name": name,
                "excluded": rules::is_excluded(&excluded, &c.id, &name),
                "default_excluded": rules::default_excluded(&name),
            })
        })
        .collect();
    Ok(Json(json!(list)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_sealed_per_server_and_never_plain() {
        crate::email_crypto::init_for_tests();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        // Jeton factice assemblé à l'exécution : un littéral à la forme d'un vrai jeton Discord
        // déclenche (à raison) la détection de secrets de GitHub et gitleaks.
        let tok = ["MTAxMjM0NTY3ODkwMTIzNDU2", "Gabcde", &"x".repeat(38)].join(".");
        let s = seal_token(a, &tok);
        assert!(!s.contains("MTAx"));
        assert_eq!(open_token(a, &s).as_deref(), Some(tok.as_str()));
        assert_eq!(open_token(b, &s), None, "AAD liée au serveur");
    }

    #[test]
    fn channel_matching_helpers() {
        assert!(same_name("Général", "general"));
        assert!(same_name("📢・annonces", "Annonces"));
        assert!(same_name("🎮", "🎮"));
        assert!(!same_name("🎮", "🎲"));
        assert_eq!(family("announcement"), family("text"));
        assert_ne!(family("voice"), family("text"));
    }
}
