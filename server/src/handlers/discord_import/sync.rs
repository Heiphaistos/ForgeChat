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
//! Plusieurs instances : un verrou Redis (SET NX EX) par serveur ; un passage dont le
//! verrou a expiré ou a été repris s'arrête.
//!
//! Garde-fous : seul le propriétaire choisit le serveur Discord et le jeton ; budgets de
//! messages et d'octets par passage et par jour, pièces jointes imputées au quota de
//! stockage du propriétaire ; synchronisations simultanées bornées (sémaphore de
//! `AppState`) ; limites de débit Redis sur les routes ; disjoncteur global (discord_api).

use super::Att;
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

use super::discord_api::{ApiError, Busy, DChannel, DMessage, DOverwrite, Discord, Mode};
use super::format::{
    build_content, channel_kind, clean_filename, convert_permissions, is_system, safe_ext, truncate, MessageData, Names,
};
use super::sync_rules::{self as rules, fold_name, snowflake, Budget};
use super::UserError;
use crate::{
    error::{AppError, Result},
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::Permissions as P,
    state::AppState,
};

const TOKEN_INFO: &str = "forgechat discord sync token v1";
/// Verrou d'une synchronisation en cours (renouvelé à chaque page de messages).
const LOCK_TTL_SECS: u64 = 3600;
/// Synchronisations simultanées par processus (`AppState::discord_sync_slots`).
pub const MAX_CONCURRENT_SYNCS: usize = 3;
/// Créneaux que le planificateur laisse libres pour « Synchroniser maintenant ».
const SLOTS_KEPT_FOR_MANUAL: usize = 1;
/// Routes qui appellent Discord : appels par minute, par compte et par serveur.
const ROUTE_LIMIT_PER_MIN: i64 = 5;
/// « Synchroniser maintenant » : lancements par compte (tous serveurs) par heure.
const MANUAL_PER_USER_PER_HOUR: i64 = 6;
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

/// Prolonge le verrou s'il est toujours à nous. `false` : verrou expiré, repris par un
/// autre passage, ou Redis injoignable (propriété invérifiable) : le passage s'arrête.
async fn renew_lock(state: &AppState, server_id: Uuid, token: &str) -> bool {
    let script = redis::Script::new(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end",
    );
    let mut redis = state.redis.lock().await;
    let r: std::result::Result<i64, _> =
        script.key(lock_key(server_id)).arg(token).arg(LOCK_TTL_SECS).invoke_async(&mut *redis).await;
    matches!(r, Ok(1))
}

/// Erreur rendue quand le verrou n'est plus à nous.
fn lock_lost() -> anyhow::Error {
    user_err("Verrou de synchronisation perdu : passage interrompu, il reprendra plus tard.")
}

// ─── Limites de débit et compteurs du jour ──────────────────────────────────

/// Limite par compte et par serveur d'une route qui appelle Discord (Redis, 429).
async fn route_limit(state: &AppState, route: &str, user: Uuid, server_id: Uuid) -> Result<()> {
    use crate::handlers::auth_v2::hit;
    hit(state, &format!("discord_sync_rl:{route}:u:{user}"), ROUTE_LIMIT_PER_MIN, 60).await?;
    hit(state, &format!("discord_sync_rl:{route}:s:{server_id}"), ROUTE_LIMIT_PER_MIN, 60).await
}

fn day_key(server_id: Uuid, what: &str) -> String {
    format!("discord_sync:day:{}:{server_id}:{what}", Utc::now().format("%Y%m%d"))
}

async fn day_used(state: &AppState, server_id: Uuid, what: &str) -> u64 {
    use redis::AsyncCommands;
    let mut redis = state.redis.lock().await;
    let n: Option<i64> = redis.get(day_key(server_id, what)).await.ok().flatten();
    n.unwrap_or(0).max(0) as u64
}

async fn day_add(state: &AppState, server_id: Uuid, what: &str, n: u64) {
    use redis::AsyncCommands;
    if n == 0 {
        return;
    }
    let key = day_key(server_id, what);
    let mut redis = state.redis.lock().await;
    let _: std::result::Result<i64, _> = redis.incr(&key, n as i64).await;
    let _: std::result::Result<(), _> = redis.expire(&key, 2 * 86_400).await;
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

/// Tâche de fond (main.rs, toutes les 10 minutes) : lance les synchronisations échues,
/// la plus anciennement synchronisée d'abord (un serveur en retard, reprogrammé 15 min
/// plus tard, passe après ceux qui attendent depuis plus longtemps), chacune dans un
/// créneau du sémaphore partagé avec « Synchroniser maintenant ».
pub async fn run_due(state: &AppState) {
    let free = state.discord_sync_slots.available_permits().saturating_sub(SLOTS_KEPT_FOR_MANUAL);
    if free == 0 {
        return;
    }
    let due: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT server_id FROM discord_sync_configs
         WHERE enabled AND bot_token_enc IS NOT NULL AND (next_sync_at IS NULL OR next_sync_at <= NOW())
         ORDER BY last_sync_at ASC NULLS FIRST, next_sync_at ASC NULLS FIRST LIMIT $1",
    )
    .bind(free as i64)
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
        if state.discord_sync_slots.available_permits() <= SLOTS_KEPT_FOR_MANUAL {
            break;
        }
        let Ok(permit) = state.discord_sync_slots.clone().try_acquire_owned() else { break };
        let st = state.clone();
        tokio::spawn(async move {
            sync_server(&st, sid).await;
            drop(permit);
        });
    }
}

/// Synchronise un serveur si personne d'autre ne le fait ; enregistre le résultat.
/// L'appelant détient un créneau de `AppState::discord_sync_slots`.
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
                .or_else(|| e.downcast_ref::<Busy>().map(|b| b.0.clone()))
                .unwrap_or_else(|| "Erreur interne pendant la synchronisation ; nouvel essai plus tard.".into());
            ("error", Some(msg), 0, Some(6 * 60))
        }
    };
    // 1000 octets au plus (contrainte de la migration 131).
    let error = error.map(|e| rules::truncate_bytes(&e, rules::MAX_ERROR_BYTES));
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

impl Report {
    fn warn_once(&mut self, w: &str) {
        if !self.warnings.iter().any(|x| x == w) {
            self.warnings.push(w.to_string());
        }
    }
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
    budget: Budget,
    /// Messages encore permis aujourd'hui après ce passage (relance rapide si > 0).
    day_messages_left: u64,
}

const QUOTA_NOTE: &str = "quota de stockage atteint : pièces jointes non archivées";

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

/// Catégorie ForgeChat (non encore liée) dont les salons recoupent au moins la moitié de ceux d'une
/// catégorie Discord, et au moins deux : elle a été renommée ou stylisée autrement, c'est la même.
/// Une catégorie Discord à un seul salon reste trop ambiguë pour être rapprochée ainsi.
fn best_by_children<'a>(theirs: &[&str], ours: impl Iterator<Item = (Uuid, Vec<&'a str>)>) -> Option<Uuid> {
    let want: HashSet<String> = theirs.iter().map(|n| fold_name(n)).filter(|f| !f.is_empty()).collect();
    ours.map(|(id, names)| {
        let have: HashSet<String> = names.iter().map(|n| fold_name(n)).collect();
        (id, want.intersection(&have).count())
    })
    .filter(|(_, k)| *k >= 2 && *k * 2 >= want.len())
    .max_by_key(|(_, k)| *k)
    .map(|(id, _)| id)
}

/// Format réel d'un émoji téléchargé (PNG, GIF, WebP ou JPEG, lu dans les octets par
/// `image_probe`) : extension et type MIME, `None` pour tout le reste.
fn emoji_format(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    let (probe, _) = crate::handlers::image_probe::probe(bytes).ok()?;
    match probe.ext {
        "png" => Some(("png", "image/png")),
        "gif" => Some(("gif", "image/gif")),
        "webp" => Some(("webp", "image/webp")),
        "jpg" => Some(("jpg", "image/jpeg")),
        _ => None,
    }
}

fn parse_u64(s: &str) -> u64 {
    s.trim().parse().unwrap_or(0)
}

async fn run(state: &AppState, server_id: Uuid, lock: &str) -> anyhow::Result<Report> {
    // (guilde, jeton chiffré, catégories exclues, émojis synchronisés, propriétaire, mode, cochés, décochés, nouveaux auto)
    type ConfigRow = (String, Option<String>, Vec<String>, bool, Uuid, String, Vec<String>, Vec<String>, bool);
    let row: Option<ConfigRow> = sqlx::query_as(
        "SELECT c.guild_id, c.bot_token_enc, c.excluded_categories, c.sync_emojis, s.owner_id,
                c.sync_mode, c.included_ids, c.excluded_ids, c.auto_include_new
         FROM discord_sync_configs c JOIN servers s ON s.id = c.server_id WHERE c.server_id=$1",
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((guild, token_enc, excluded, sync_emojis, owner, mode, included, excluded_ids, auto_include_new)) = row else {
        return Err(user_err("Synchronisation non configurée."));
    };
    let sel = rules::Selection {
        rules: excluded,
        included,
        excluded: excluded_ids,
        auto_include_new,
        content_only: mode == "content",
    };
    let token = token_enc
        .as_deref()
        .and_then(|t| open_token(server_id, t))
        .ok_or_else(|| user_err("Jeton du bot Discord absent ou illisible : saisissez-le à nouveau."))?;

    // Pièces jointes imputées au quota de stockage du propriétaire (uploads.rs).
    let owner_used: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(size), 0)::BIGINT FROM attachments WHERE uploader_id = $1")
            .bind(owner)
            .fetch_one(&state.db)
            .await?;
    let quota_left = state.config.upload_quota_bytes.saturating_sub(owner_used.max(0) as u64);
    let messages_today = day_used(state, server_id, "messages").await;
    let budget = Budget::new(day_used(state, server_id, "bytes").await, messages_today, quota_left);

    let mut cx = Ctx {
        state,
        server_id,
        owner,
        lock,
        api: Discord::new(&token, state.redis.clone(), Mode::Background)?,
        names: Names::default(),
        report: Report::default(),
        deadline: Instant::now() + RUN_BUDGET,
        day_messages_left: rules::MAX_MESSAGES_PER_DAY.saturating_sub(messages_today).saturating_sub(budget.messages_left),
        budget,
    };
    if cx.budget.bytes_left == 0 {
        cx.report.warn_once(QUOTA_NOTE);
    }
    cx.api.guild(&guild).await?;
    let channels = cx.api.channels(&guild).await?;
    let roles = cx.api.roles(&guild).await?;
    if !renew_lock(state, server_id, lock).await {
        return Err(lock_lost());
    }
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
    // Catégories Discord sans équivalent ForgeChat en mode « contenu » (jamais créées).
    let mut cat_absent: HashSet<String> = HashSet::new();
    let mut cats: Vec<&DChannel> = channels.iter().filter(|c| c.r#type == 4).collect();
    cats.sort_by_key(|c| (c.position, snowflake(&c.id)));
    for c in cats {
        let name = c.name.clone().unwrap_or_default();
        if !sel.category(&c.id, &name) {
            cat_target.insert(c.id.clone(), None);
            continue;
        }
        if let Some(fc) = map.get(&("category".to_string(), c.id.clone())) {
            let alive = fc_cats.iter().any(|(id, _)| id == fc);
            cat_target.insert(c.id.clone(), alive.then_some(*fc));
            continue;
        }
        let existing = fc_cats
            .iter()
            .find(|(id, n)| !mapped.contains(id) && same_name(n, &name))
            .map(|(id, _)| *id)
            .or_else(|| {
                // Catégorie renommée côté ForgeChat : celle dont les salons recoupent ceux de Discord.
                let theirs: Vec<&str> = channels
                    .iter()
                    .filter(|x| x.parent_id.as_deref() == Some(c.id.as_str()))
                    .filter_map(|x| x.name.as_deref())
                    .collect();
                best_by_children(
                    &theirs,
                    fc_cats.iter().filter(|(id, _)| !mapped.contains(id)).map(|(id, _)| {
                        (*id, fc_chans.iter().filter(|ch| ch.3 == Some(*id)).map(|ch| ch.1.as_str()).collect::<Vec<_>>())
                    }),
                )
            });
        let id = match existing {
            Some(id) => id,
            None if !sel.may_create() => {
                cat_absent.insert(c.id.clone());
                continue;
            }
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
        if !sel.channel(Some(true), &ch.id) {
            continue; // décoché (ou nouveau avec l'option désactivée) : ni créé ni synchronisé
        }
        let parent_absent = ch.parent_id.as_deref().is_some_and(|p| cat_absent.contains(p));
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
                    .filter(|_| !parent_absent)
                    .find(|c| !mapped.contains(&c.0) && c.3 == category && family(&c.2) == family(kind) && same_name(&c.1, &name))
                    .map(|c| c.0);
                let r = match existing {
                    Some(id) => (id, false),
                    None if !sel.may_create() => continue,
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
        if !renew_lock(state, server_id, lock).await {
            return Err(lock_lost());
        }
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

    /// Plafond de messages du passage (relance 15 min plus tard) ou du jour (relance
    /// à l'intervalle normal) atteint.
    fn out_of_messages(&mut self) {
        if self.day_messages_left > 0 {
            self.report.backlog = true;
        } else {
            self.report.warn_once("plafond quotidien de messages atteint : la suite au prochain passage");
        }
    }

    async fn sync_channel(&mut self, ch: &DChannel, fc_id: Uuid, mut cursor: u64) -> anyhow::Result<()> {
        let label = ch.name.clone().unwrap_or_default();
        for page_no in 0..MAX_PAGES_PER_CHANNEL {
            if Instant::now() > self.deadline {
                self.report.backlog = true;
                return Ok(());
            }
            if self.budget.messages_left == 0 {
                self.out_of_messages();
                return Ok(());
            }
            if !renew_lock(self.state, self.server_id, self.lock).await {
                return Err(lock_lost());
            }
            let page = match self.api.messages_after(&ch.id, cursor).await {
                Ok(p) => p,
                Err(ApiError::NoAccess) => {
                    self.report.warnings.push(format!("#{} : salon illisible pour le bot", truncate(&label, 60)));
                    return Ok(());
                }
                Err(ApiError::Fatal(e)) => return Err(e),
            };
            let mut step = rules::page_step(cursor, page, |m: &DMessage| snowflake(&m.id));
            if step.cursor == cursor {
                return Ok(());
            }
            // Plafond de messages : on garde les plus anciens, le curseur s'arrête au
            // dernier gardé, la suite au passage suivant.
            let granted = self.budget.take_messages(step.fresh.len());
            if granted < step.fresh.len() {
                step.fresh.truncate(granted);
                match step.fresh.last() {
                    Some(m) => step.cursor = snowflake(&m.id),
                    None => {
                        self.out_of_messages();
                        return Ok(());
                    }
                }
                step.more = true;
            }
            let taken = step.fresh.len() as u64;
            self.store_messages(&ch.id, fc_id, step.fresh, step.cursor).await?;
            day_add(self.state, self.server_id, "messages", taken).await;
            cursor = step.cursor;
            if self.budget.messages_left == 0 && step.more {
                self.out_of_messages();
                return Ok(());
            }
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
            atts: Vec<Att>,
            files: Vec<std::path::PathBuf>,
        }
        let mut rows: Vec<Row> = Vec::new();
        let mut day_bytes = 0u64;
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
            let mut files = Vec::new();
            for a in &m.attachments {
                let filename = clean_filename(&a.filename);
                // Budget d'octets (passage, jour, quota du propriétaire) : épuisé, le texte
                // du message est gardé avec une note, comme pour un fichier absent de l'archive.
                if a.size > self.budget.bytes_left {
                    self.report.warn_once(QUOTA_NOTE);
                    extra.push(format!("📎 {filename} (non archivé : quota de stockage atteint)"));
                    continue;
                }
                let max = ATTACHMENT_MAX.min(self.budget.bytes_left);
                let bytes = if a.size <= max { self.api.download(&a.url, max).await } else { None };
                let bytes = bytes.filter(|b| self.budget.charge_bytes(b.len() as u64));
                let stored = match bytes {
                    Some(b) => {
                        day_bytes += b.len() as u64;
                        let file = format!("{}.{}", Uuid::new_v4(), safe_ext(&filename));
                        let dest = upload_dir.join(&file);
                        match tokio::fs::write(&dest, &b).await {
                            Ok(()) => {
                                files.push(dest);
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
                files,
            });
        }

        let res: anyhow::Result<HashSet<String>> = async {
            let mut tx = db.begin().await?;
            let mut claimed: HashSet<String> = HashSet::new();
            if !rows.is_empty() {
                // Réservation des correspondances d'abord : seul le passage qui crée la ligne
                // insère le message. Un passage concurrent (verrou perdu) attend notre
                // validation sur le conflit, puis n'obtient rien : jamais de double import.
                claimed = sqlx::query_scalar::<_, String>(
                    "INSERT INTO discord_sync_map (server_id, kind, discord_id, forgechat_id)
                     SELECT $1, 'message', t.d, t.f FROM UNNEST($2::text[], $3::uuid[]) AS t(d, f)
                     ON CONFLICT DO NOTHING RETURNING discord_id",
                )
                .bind(self.server_id)
                .bind(rows.iter().map(|r| r.discord_id.clone()).collect::<Vec<_>>())
                .bind(rows.iter().map(|r| r.id).collect::<Vec<_>>())
                .fetch_all(&mut *tx)
                .await?
                .into_iter()
                .collect();

                // Messages déjà importés ailleurs : une réponse est rattachée à la copie existante.
                let lost: Vec<String> =
                    rows.iter().filter(|r| !claimed.contains(&r.discord_id)).map(|r| r.discord_id.clone()).collect();
                let mut remap: HashMap<Uuid, Option<Uuid>> = HashMap::new();
                if !lost.is_empty() {
                    let existing: HashMap<String, Uuid> = sqlx::query_as::<_, (String, Uuid)>(
                        "SELECT discord_id, forgechat_id FROM discord_sync_map
                         WHERE server_id=$1 AND kind='message' AND discord_id = ANY($2)",
                    )
                    .bind(self.server_id)
                    .bind(&lost)
                    .fetch_all(&mut *tx)
                    .await?
                    .into_iter()
                    .collect();
                    for r in rows.iter().filter(|r| !claimed.contains(&r.discord_id)) {
                        remap.insert(r.id, existing.get(&r.discord_id).copied());
                    }
                }
                let keep: Vec<&Row> = rows.iter().filter(|r| claimed.contains(&r.discord_id)).collect();
                if !keep.is_empty() {
                    sqlx::query(
                        "INSERT INTO messages (id, channel_id, user_id, content, type, reply_to, pinned, edited_at, created_at, webhook_display_name, webhook_avatar_url)
                         SELECT t.id, $2, $3, t.content, 'webhook', t.reply_to, t.pinned, t.edited_at, t.created_at, t.author, t.avatar
                         FROM UNNEST($1::uuid[], $4::text[], $5::uuid[], $6::bool[], $7::timestamptz[], $8::timestamptz[], $9::text[], $10::text[])
                              AS t(id, content, reply_to, pinned, edited_at, created_at, author, avatar)",
                    )
                    .bind(keep.iter().map(|r| r.id).collect::<Vec<_>>())
                    .bind(channel_id)
                    .bind(self.owner)
                    .bind(keep.iter().map(|r| r.content.clone()).collect::<Vec<_>>())
                    .bind(
                        keep.iter()
                            .map(|r| r.reply_to.and_then(|p| match remap.get(&p) { Some(x) => *x, None => Some(p) }))
                            .collect::<Vec<_>>(),
                    )
                    .bind(keep.iter().map(|r| r.pinned).collect::<Vec<_>>())
                    .bind(keep.iter().map(|r| r.edited_at).collect::<Vec<_>>())
                    .bind(keep.iter().map(|r| r.created_at).collect::<Vec<_>>())
                    .bind(keep.iter().map(|r| r.author.clone()).collect::<Vec<_>>())
                    .bind(keep.iter().map(|r| r.avatar.clone()).collect::<Vec<_>>())
                    .execute(&mut *tx)
                    .await?;

                    // Pièces jointes imputées au quota de stockage du propriétaire.
                    let atts: Vec<(Uuid, DateTime<Utc>, &Att)> =
                        keep.iter().flat_map(|r| r.atts.iter().map(move |a| (r.id, r.created_at, a))).collect();
                    if !atts.is_empty() {
                        sqlx::query(
                            "INSERT INTO attachments (message_id, filename, content_type, size, url, created_at, uploader_id)
                             SELECT t.m, t.f, t.c, t.s, t.u, t.at, $7
                             FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::bigint[], $5::text[], $6::timestamptz[])
                                  AS t(m, f, c, s, u, at)",
                        )
                        .bind(atts.iter().map(|a| a.0).collect::<Vec<_>>())
                        .bind(atts.iter().map(|a| a.2 .0.clone()).collect::<Vec<_>>())
                        .bind(atts.iter().map(|a| a.2 .1.clone()).collect::<Vec<_>>())
                        .bind(atts.iter().map(|a| a.2 .2).collect::<Vec<_>>())
                        .bind(atts.iter().map(|a| a.2 .3.clone()).collect::<Vec<_>>())
                        .bind(atts.iter().map(|a| a.1).collect::<Vec<_>>())
                        .bind(self.owner)
                        .execute(&mut *tx)
                        .await?;
                    }
                    let pins: Vec<&&Row> = keep.iter().filter(|r| r.pinned).collect();
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
                    sqlx::query("UPDATE channels SET last_message_id=$2 WHERE id=$1")
                        .bind(channel_id)
                        .bind(keep.last().map(|r| r.id))
                        .execute(&mut *tx)
                        .await?;
                }
            }
            // Le curseur n'avance jamais en arrière (passage concurrent plus en avance).
            sqlx::query(
                "INSERT INTO discord_sync_cursors (server_id, discord_channel_id, last_message_id) VALUES ($1, $2, $3)
                 ON CONFLICT (server_id, discord_channel_id) DO UPDATE SET last_message_id = EXCLUDED.last_message_id, updated_at = NOW()
                 WHERE discord_sync_cursors.last_message_id !~ '^[0-9]{1,21}$'
                    OR discord_sync_cursors.last_message_id::numeric < EXCLUDED.last_message_id::numeric",
            )
            .bind(self.server_id)
            .bind(discord_channel)
            .bind(cursor.to_string())
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            Ok(claimed)
        }
        .await;
        day_add(self.state, self.server_id, "bytes", day_bytes).await;
        let claimed = match res {
            Ok(c) => c,
            Err(e) => {
                for p in rows.iter().flat_map(|r| &r.files) {
                    let _ = tokio::fs::remove_file(p).await;
                }
                return Err(e);
            }
        };
        // Fichiers des messages importés entre-temps par un autre passage : inutiles.
        for p in rows.iter().filter(|r| !claimed.contains(&r.discord_id)).flat_map(|r| &r.files) {
            let _ = tokio::fs::remove_file(p).await;
        }
        self.report.messages += claimed.len() as u32;
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
                    let (ext, max) = if animated { ("gif", 512 * 1024) } else { ("png", 256 * 1024) };
                    let Some(bytes) = self.api.download(&format!("https://cdn.discordapp.com/emojis/{did}.{ext}"), max).await else {
                        continue;
                    };
                    // Comme un envoi d'émoji (emojis.rs) : format lu dans les octets, puis antivirus.
                    let Some((ext, mime)) = emoji_format(&bytes) else {
                        self.report.warn_once("émoji ignoré : format d'image non reconnu");
                        continue;
                    };
                    if crate::antivirus::check(&bytes).await.is_err() {
                        self.report.warn_once("émoji ignoré : refusé par l'antivirus");
                        continue;
                    }
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
        sync_mode: String,
        included_ids: Vec<String>,
        excluded_ids: Vec<String>,
        auto_include_new: bool,
        next_sync_at: Option<DateTime<Utc>>,
        last_sync_at: Option<DateTime<Utc>>,
        last_status: Option<String>,
        last_error: Option<String>,
        last_imported: i32,
    }
    let cfg: Option<Cfg> = sqlx::query_as(
        "SELECT guild_id, bot_token_enc IS NOT NULL AS has_token, interval_hours, excluded_categories, enabled, sync_emojis,
                sync_mode, included_ids, excluded_ids, auto_include_new, next_sync_at, last_sync_at, last_status, last_error, last_imported
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
            "sync_mode": "full", "included_ids": [], "excluded_ids": [], "auto_include_new": true,
            "next_sync_at": null, "last_sync_at": null, "last_status": null, "last_error": null,
            "last_imported": 0, "running": running,
        }),
        Some(c) => json!({
            "configured": true, "guild_id": c.guild_id, "has_token": c.has_token, "interval_hours": c.interval_hours,
            "excluded_categories": c.excluded_categories, "enabled": c.enabled, "sync_emojis": c.sync_emojis,
            "sync_mode": c.sync_mode, "included_ids": c.included_ids, "excluded_ids": c.excluded_ids,
            "auto_include_new": c.auto_include_new,
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
    if let Some(b) = e.downcast_ref::<Busy>() {
        // Limite de débit de Discord ou disjoncteur : 503, jamais d'attente dans la requête.
        return AppError::Unavailable(b.0.clone());
    }
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
    /// Absents : les valeurs enregistrées sont conservées (anciens clients).
    pub sync_mode: Option<String>,
    pub included_ids: Option<Vec<String>>,
    pub excluded_ids: Option<Vec<String>>,
    pub auto_include_new: Option<bool>,
}

/// PUT /api/servers/:server_id/discord-sync
pub async fn put_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<PutConfig>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    route_limit(&state, "put", claims.sub, server_id).await?;
    let guild = rules::validate_guild_id(&body.guild_id).map_err(bad)?;
    let interval = rules::validate_interval(body.interval_hours).map_err(bad)?;
    let excluded = rules::validate_excluded(&body.excluded_categories).map_err(bad)?;
    let mode = body.sync_mode.as_deref().map(rules::validate_mode).transpose().map_err(bad)?;
    let included = body.included_ids.as_deref().map(rules::validate_ids).transpose().map_err(bad)?;
    let excluded_ids = body.excluded_ids.as_deref().map(rules::validate_ids).transpose().map_err(bad)?;
    let new_token = match body.bot_token.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => Some(rules::normalize_token(t).map_err(bad)?),
        None => None,
    };

    // Le jeton enregistré n'est jamais redirigé vers un autre serveur Discord, et seul le
    // propriétaire change le serveur lié ou le jeton.
    let stored_guild: Option<String> = sqlx::query_scalar("SELECT guild_id FROM discord_sync_configs WHERE server_id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?;
    let owner: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))?;
    rules::check_config_change(stored_guild.as_deref(), &guild, new_token.is_some(), owner == claims.sub).map_err(|r| match r {
        rules::ConfigRefusal::OwnerOnly => AppError::ForbiddenMsg(r.message().into()),
        rules::ConfigRefusal::TokenRequired => bad(r.message()),
    })?;
    let previous = stored_token(&state, server_id).await?;

    // Nouveau jeton (donc éventuellement nouveau serveur) : vérifié auprès de Discord avant
    // d'être enregistré. Sans nouveau jeton, le serveur est forcément inchangé.
    let token = new_token.clone().or_else(|| previous.as_ref().map(|p| p.1.clone()));
    let mut guild_name = None;
    if let Some(t) = &new_token {
        let api = Discord::new(t, state.redis.clone(), Mode::Request).map_err(AppError::Internal)?;
        guild_name = Some(api.guild(&guild).await.map_err(discord_err)?.name);
    }
    if body.enabled && token.is_none() {
        return Err(bad("Renseignez le jeton du bot Discord pour activer la synchronisation."));
    }

    let sealed = new_token.as_deref().map(|t| seal_token(server_id, t));
    sqlx::query(
        "INSERT INTO discord_sync_configs (server_id, guild_id, bot_token_enc, interval_hours, excluded_categories, enabled, sync_emojis, updated_by, next_sync_at,
                                          sync_mode, included_ids, excluded_ids, auto_include_new)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), COALESCE($9, 'full'), COALESCE($10, ARRAY[]::TEXT[]),
                 COALESCE($11, ARRAY[]::TEXT[]), COALESCE($12, TRUE))
         ON CONFLICT (server_id) DO UPDATE SET
            guild_id = EXCLUDED.guild_id,
            bot_token_enc = COALESCE(EXCLUDED.bot_token_enc, discord_sync_configs.bot_token_enc),
            interval_hours = EXCLUDED.interval_hours,
            excluded_categories = EXCLUDED.excluded_categories,
            enabled = EXCLUDED.enabled,
            sync_emojis = EXCLUDED.sync_emojis,
            sync_mode = COALESCE($9, discord_sync_configs.sync_mode),
            included_ids = COALESCE($10, discord_sync_configs.included_ids),
            excluded_ids = COALESCE($11, discord_sync_configs.excluded_ids),
            auto_include_new = COALESCE($12, discord_sync_configs.auto_include_new),
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
    .bind(mode)
    .bind(included)
    .bind(excluded_ids)
    .bind(body.auto_include_new)
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
    // Effacer le jeton revient à le changer : propriétaire seulement (un administrateur
    // peut toujours désactiver la synchronisation).
    let owner: Option<Uuid> = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?;
    if owner != Some(claims.sub) {
        return Err(AppError::ForbiddenMsg(rules::ConfigRefusal::OwnerOnly.message().into()));
    }
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
    route_limit(&state, "run", claims.sub, server_id).await?;
    crate::handlers::auth_v2::hit(&state, &format!("discord_sync_rl:run_hour:u:{}", claims.sub), MANUAL_PER_USER_PER_HOUR, 3600)
        .await?;
    if stored_token(&state, server_id).await?.is_none() {
        return Err(bad("Enregistrez d'abord l'identifiant du serveur Discord et le jeton du bot."));
    }
    if is_running(&state, server_id).await {
        return Err(AppError::Conflict("Une synchronisation est déjà en cours.".into()));
    }
    // Créneau global (partagé avec le planificateur), pris avant le délai de 5 minutes.
    let permit = state.discord_sync_slots.clone().try_acquire_owned().map_err(|_| {
        AppError::Unavailable("Trop de synchronisations Discord en cours : réessayez dans quelques minutes.".into())
    })?;
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
    tokio::spawn(async move {
        sync_server(&st, server_id).await;
        drop(permit);
    });
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
    route_limit(&state, "categories", claims.sub, server_id).await?;
    // Toujours le serveur Discord ENREGISTRÉ avec le jeton enregistré (rien de la requête).
    let (guild, token) = stored_token(&state, server_id)
        .await?
        .ok_or_else(|| bad("Enregistrez d'abord l'identifiant du serveur Discord et le jeton du bot."))?;
    let excluded: Vec<String> = sqlx::query_scalar("SELECT excluded_categories FROM discord_sync_configs WHERE server_id=$1")
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
    let api = Discord::new(&token, state.redis.clone(), Mode::Request).map_err(AppError::Internal)?;
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

/// GET /api/servers/:server_id/discord-sync/tree : arbre complet du serveur Discord enregistré
/// (catégories > salons, forums et médias compris) avec l'état coché de chaque élément.
pub async fn list_tree(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_permission(&state, claims.sub, server_id, P::MANAGE_SERVER).await?;
    route_limit(&state, "categories", claims.sub, server_id).await?;
    let (guild, token) = stored_token(&state, server_id)
        .await?
        .ok_or_else(|| bad("Enregistrez d'abord l'identifiant du serveur Discord et le jeton du bot."))?;
    let (name_rules, included, excluded_ids, auto_include_new): (Vec<String>, Vec<String>, Vec<String>, bool) = sqlx::query_as(
        "SELECT excluded_categories, included_ids, excluded_ids, auto_include_new FROM discord_sync_configs WHERE server_id=$1",
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;
    let sel = rules::Selection { rules: name_rules, included, excluded: excluded_ids, auto_include_new, content_only: false };
    let api = Discord::new(&token, state.redis.clone(), Mode::Request).map_err(AppError::Internal)?;
    let all = api.channels(&guild).await.map_err(discord_err)?;
    let mut cats: Vec<&DChannel> = all.iter().filter(|c| c.r#type == 4).collect();
    cats.sort_by_key(|c| (c.position, snowflake(&c.id)));
    let mut chans: Vec<&DChannel> =
        all.iter().filter(|c| matches!(c.r#type, 0 | 2 | 5 | 13 | 15 | 16) && channel_kind(c.r#type).is_some()).collect();
    chans.sort_by_key(|c| (c.position, snowflake(&c.id)));
    let item = |c: &DChannel| {
        let kind = match c.r#type {
            16 => "media",
            t => channel_kind(t).unwrap_or("text"),
        };
        json!({ "id": c.id, "name": c.name.clone().unwrap_or_default(), "kind": kind, "selected": sel.channel(Some(true), &c.id) })
    };
    let categories: Vec<Value> = cats
        .iter()
        .map(|cat| {
            let name = cat.name.clone().unwrap_or_default();
            let kids: Vec<Value> = chans.iter().filter(|c| c.parent_id.as_deref() == Some(cat.id.as_str())).map(|c| item(c)).collect();
            json!({ "id": cat.id, "name": name, "selected": sel.category(&cat.id, &name),
                    "default_excluded": rules::default_excluded(&name), "channels": kids })
        })
        .collect();
    let loose: Vec<Value> = chans
        .iter()
        .filter(|c| c.parent_id.as_deref().is_none_or(|p| !cats.iter().any(|k| k.id == p)))
        .map(|c| item(c))
        .collect();
    Ok(Json(json!({ "categories": categories, "uncategorized": loose })))
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
        // « Polices » Unicode : un même nom écrit en gras sans empattement, italique ou serif
        // est la même catégorie (cause des doublons constatés sur Jötunheim).
        assert!(same_name("📜 ⭒ ⭒ ⭒ 𝙄𝙉𝙁𝙊𝙍𝙈𝘼𝙏𝙄𝙊𝙉 ⭒ ⭒ ⭒", "📜 ⭒ ⭒ ⭒ 𝗜𝗡𝗙𝗢𝗥𝗠𝗔𝗧𝗜𝗢𝗡 ⭒ ⭒ ⭒"));
        assert!(same_name("🚨⭒ ⭒ ⭒𝐀𝐢𝐝𝐞⭒ ⭒ ⭒", "🚨⭒ ⭒ ⭒𝗔𝗶𝗱𝗲⭒ ⭒ ⭒"));
        assert!(same_name("⭒𝐓𝐢𝐜𝐤𝐞𝐭-𝐇𝐞𝐥𝐩🗪", "⭒𝗧𝗶𝗰𝗸𝗲𝘁-𝗛𝗲𝗹𝗽🗪"));
        assert!(same_name("ＩＮＦＯ", "info"));
        assert!(!same_name("𝗜𝗡𝗙𝗢𝗥𝗠𝗔𝗧𝗜𝗢𝗡", "𝗜𝗡𝗙𝗢𝗥𝗠𝗔𝗧𝗜𝗤𝗨𝗘"));
    }

    #[test]
    fn renamed_category_is_matched_by_its_channels() {
        let (a, b) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let theirs = ["général", "règles", "annonces", "vocal"];
        let ours = vec![(a, vec!["📢・annonces", "Général", "règles"]), (b, vec!["autre"])];
        assert_eq!(best_by_children(&theirs, ours.into_iter()), Some(a));
        // Un seul salon recoupé : pas assez pour affirmer que c'est la même catégorie.
        let weak = vec![(a, vec!["général"])];
        assert_eq!(best_by_children(&theirs, weak.into_iter()), None);
        // Catégorie Discord à un seul salon : jamais rapprochée.
        assert_eq!(best_by_children(&["général"], vec![(a, vec!["général"])].into_iter()), None);
        assert_eq!(family("announcement"), family("text"));
        assert_ne!(family("voice"), family("text"));
    }

    /// Migration 139 : défauts = comportement antérieur, mode borné par une contrainte.
    #[tokio::test]
    #[ignore]
    async fn selection_columns_defaults_and_constraint() {
        let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
        let db = sqlx::PgPool::connect(&url).await.unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let tag = Uuid::new_v4().simple().to_string();
        let user: Uuid = sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
            .bind(&tag[..20])
            .bind(format!("{tag}@test.local"))
            .fetch_one(&db)
            .await
            .unwrap();
        let srv: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('dsel', $1) RETURNING id")
            .bind(user)
            .fetch_one(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO discord_sync_configs (server_id, guild_id) VALUES ($1, '123456789012345678')")
            .bind(srv)
            .execute(&db)
            .await
            .unwrap();
        let (mode, inc, exc, auto): (String, Vec<String>, Vec<String>, bool) =
            sqlx::query_as("SELECT sync_mode, included_ids, excluded_ids, auto_include_new FROM discord_sync_configs WHERE server_id=$1")
                .bind(srv)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!((mode.as_str(), inc.len(), exc.len(), auto), ("full", 0, 0, true));
        let bad = sqlx::query("UPDATE discord_sync_configs SET sync_mode='bogus' WHERE server_id=$1").bind(srv).execute(&db).await;
        assert!(bad.is_err());
    }
}
