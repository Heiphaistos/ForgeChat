//! Salons de serveur chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §10).
//!
//! Même mécanisme que les MP (`e2e_conv`) avec `Conv::Channel` : membres
//! autorisés = membres du serveur qui voient le salon. Les droits changent à
//! beaucoup d'endroits (départ, exclusion, rôles, surcharges…) : plutôt que d'y
//! émettre des événements, l'ensemble autorisé est recalculé à la demande. Une
//! époque dont un détenteur a perdu l'accès est marquée `rotate_needed` au
//! prochain envoi (409 EPOCH_STALE), l'émetteur crée alors l'époque suivante.
//! Le texte en clair est refusé dès que l'AUTEUR a une clé de compte (un grand
//! serveur public ne peut pas attendre que tous ses membres en aient une).

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::e2e_conv::{check_epoch, current_epoch, plaintext_allowed, Conv, Enc, ServerEnvelope},
    middleware::auth::Claims,
    state::{channel_audience_among, AppState},
};

/// Membres munis d'une clé auxquels l'époque courante manque, renvoyés à l'émetteur.
const MISSING_PAGE: i64 = 200;
/// Détenteurs connectés prévenus par une demande de clé.
const KEY_REQUEST_FANOUT: usize = 20;

/// Membres autorisés d'un salon : membres du serveur (hors bots) qui le voient.
pub async fn viewers(db: &PgPool, channel: Uuid) -> Result<Vec<Uuid>> {
    // ponytail: O(membres) à chaque appel ; mettre en cache par (salon, version des droits) si un très grand serveur le demande.
    let all: Vec<Uuid> = sqlx::query_scalar(
        "SELECT sm.user_id FROM server_members sm
         JOIN channels c ON c.server_id = sm.server_id
         JOIN users u ON u.id = sm.user_id
         WHERE c.id = $1 AND NOT u.is_bot",
    )
    .bind(channel)
    .fetch_all(db)
    .await?;
    Ok(channel_audience_among(db, channel, &all).await)
}

/// Un détenteur de l'époque ne voit plus le salon : il faut une nouvelle époque.
pub fn needs_rotation(holders: usize, still_viewing: usize) -> bool {
    still_viewing < holders
}

/// Époque courante d'un salon ; la marque périmée si un détenteur a perdu l'accès.
pub async fn channel_epoch(db: &PgPool, channel: Uuid) -> Result<Option<(i32, bool)>> {
    let cur = current_epoch(db, Conv::Channel(channel)).await?;
    let Some((epoch, false)) = cur else { return Ok(cur) };
    let holders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT member_id FROM conversation_keys WHERE conv_kind='channel' AND conv_id=$1 AND epoch=$2",
    )
    .bind(channel)
    .bind(epoch)
    .fetch_all(db)
    .await?;
    let still = channel_audience_among(db, channel, &holders).await;
    if !needs_rotation(holders.len(), still.len()) {
        return Ok(cur);
    }
    sqlx::query(
        "UPDATE conversation_epochs SET rotate_needed=TRUE, updated_at=NOW()
         WHERE conv_kind='channel' AND conv_id=$1 AND current_epoch=$2",
    )
    .bind(channel)
    .bind(epoch)
    .execute(db)
    .await?;
    Ok(Some((epoch, true)))
}

pub async fn has_key(db: &PgPool, user: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_keys WHERE user_id=$1)")
        .bind(user)
        .fetch_one(db)
        .await?)
}

/// Commande de bot (`/nom args`) enregistrée sur ce serveur : destinée au bot,
/// donc lisible par lui, elle reste en clair (affichée « non chiffré »).
pub async fn is_bot_command(db: &PgPool, server_id: Uuid, content: &str) -> bool {
    let Some(name) = content.strip_prefix('/').and_then(|r| r.split_whitespace().next()) else { return false };
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bot_commands WHERE server_id=$1 AND name=$2)")
        .bind(server_id)
        .bind(name.to_lowercase())
        .fetch_one(db)
        .await
        .unwrap_or(false)
}

/// Contenu d'un envoi ou d'une édition dans un salon (message, fil, forum,
/// sondage, message programmé) : rend le chiffré validé (JSON), ou None pour du
/// clair, permis seulement à un auteur sans clé ou à une commande de bot.
pub async fn check_content(
    db: &PgPool,
    channel: Uuid,
    author: Uuid,
    has_text: bool,
    enc: Option<&Value>,
    client_msg_id: Option<Uuid>,
    exempt: bool,
) -> Result<Option<Value>> {
    match enc.filter(|v| !v.is_null()) {
        Some(raw) => {
            if has_text {
                return Err(AppError::BadRequest("Contenu en clair et chiffré à la fois".into()));
            }
            if client_msg_id.is_none() {
                return Err(AppError::BadRequest("client_msg_id requis".into()));
            }
            let e = Enc::parse(raw)?;
            check_epoch(channel_epoch(db, channel).await?, e.epoch)?;
            Ok(Some(e.to_json()))
        }
        None => {
            if has_text && !exempt {
                plaintext_allowed(has_key(db, author).await?)?;
            }
            Ok(None)
        }
    }
}

/// Champs de réponse propres aux salons : `encrypt` (j'ai une clé), membres
/// sans l'époque courante, clé de récupération du serveur et époques qui
/// n'y sont pas encore enveloppées.
pub async fn extend_keys(
    db: &PgPool,
    channel: Uuid,
    me: Uuid,
    members: &[Uuid],
    current: Option<(i32, bool)>,
    out: &mut Value,
) -> Result<()> {
    out["encrypt"] = json!(has_key(db, me).await?);
    let missing: Vec<Uuid> = match current {
        Some((epoch, false)) => sqlx::query_scalar(
            "SELECT k.user_id FROM user_keys k
             WHERE k.user_id = ANY($1) AND NOT EXISTS(
                 SELECT 1 FROM conversation_keys ck WHERE ck.conv_kind='channel' AND ck.conv_id=$2
                   AND ck.epoch=$3 AND ck.member_id=k.user_id AND ck.member_fp=k.fingerprint)
             LIMIT $4",
        )
        .bind(members)
        .bind(channel)
        .bind(epoch)
        .bind(MISSING_PAGE)
        .fetch_all(db)
        .await?,
        _ => vec![],
    };
    out["missing"] = json!(missing);
    let key: Option<(Uuid, String, String)> = sqlx::query_as(
        "SELECT sk.server_id, sk.public_key, sk.fingerprint FROM server_keys sk
         JOIN channels c ON c.server_id = sk.server_id WHERE c.id=$1",
    )
    .bind(channel)
    .fetch_optional(db)
    .await?;
    let Some((server_id, public, fp)) = key else {
        out["server_key"] = Value::Null;
        out["server_missing"] = json!([]);
        return Ok(());
    };
    let server_missing: Vec<i32> = sqlx::query_scalar(
        "SELECT ck.epoch FROM conversation_keys ck
         WHERE ck.conv_kind='channel' AND ck.conv_id=$1 AND ck.member_id=$2 AND NOT EXISTS(
             SELECT 1 FROM server_epoch_keys s WHERE s.channel_id=$1 AND s.epoch=ck.epoch AND s.server_fp=$3)
         ORDER BY ck.epoch",
    )
    .bind(channel)
    .bind(me)
    .bind(&fp)
    .fetch_all(db)
    .await?;
    out["server_key"] = json!({ "server_id": server_id, "public": public, "fingerprint": fp });
    out["server_missing"] = json!(server_missing);
    Ok(())
}

/// Clé de récupération du serveur d'un salon : (empreinte) si elle existe.
async fn server_fp(db: &PgPool, channel: Uuid) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT sk.fingerprint FROM server_keys sk JOIN channels c ON c.server_id = sk.server_id WHERE c.id=$1",
    )
    .bind(channel)
    .fetch_optional(db)
    .await?)
}

/// Nouvelle époque d'un salon : enveloppe pour la clé du serveur exigée dès qu'elle existe.
pub async fn require_server_envelope(db: &PgPool, channel: Uuid, se: Option<&ServerEnvelope>) -> Result<()> {
    match (server_fp(db, channel).await?, se) {
        (None, _) => Ok(()),
        (Some(fp), Some(se)) if se.server_fp == fp => Ok(()),
        _ => Err(AppError::Conflict("SERVER_KEY_REQUIRED".into())),
    }
}

/// Range l'enveloppe d'une époque pour la clé du serveur (remplacée seulement si
/// elle visait une autre clé de serveur).
pub async fn store_server_envelope(
    tx: &mut Transaction<'_, Postgres>,
    channel: Uuid,
    epoch: i32,
    user: Uuid,
    my_pub: &str,
    se: &ServerEnvelope,
) -> Result<()> {
    se.wrapped.validate()?;
    let fp: Option<String> = sqlx::query_scalar(
        "SELECT sk.fingerprint FROM server_keys sk JOIN channels c ON c.server_id = sk.server_id WHERE c.id=$1",
    )
    .bind(channel)
    .fetch_optional(&mut **tx)
    .await?;
    match fp {
        Some(fp) if fp == se.server_fp => {}
        Some(_) => return Err(AppError::Conflict("SERVER_KEY_CHANGED".into())),
        None => return Err(AppError::BadRequest("NO_SERVER_KEY".into())),
    }
    sqlx::query(
        "INSERT INTO server_epoch_keys (channel_id, epoch, server_fp, wrapped, wrapped_by, wrapped_by_pub)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (channel_id, epoch) DO UPDATE
           SET server_fp=EXCLUDED.server_fp, wrapped=EXCLUDED.wrapped, wrapped_by=EXCLUDED.wrapped_by,
               wrapped_by_pub=EXCLUDED.wrapped_by_pub, created_at=NOW()
         WHERE server_epoch_keys.server_fp <> EXCLUDED.server_fp",
    )
    .bind(channel)
    .bind(epoch)
    .bind(&se.server_fp)
    .bind(se.wrapped.to_json())
    .bind(user)
    .bind(my_pub)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Quelques détenteurs connectés d'une clé du salon, qui le voient encore.
pub async fn key_holders_online(state: &AppState, channel: Uuid, me: Uuid) -> Result<Vec<Uuid>> {
    let connected: HashSet<Uuid> = state.clients.read().await.keys().copied().collect();
    let holders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT member_id FROM conversation_keys WHERE conv_kind='channel' AND conv_id=$1 AND member_id <> $2",
    )
    .bind(channel)
    .bind(me)
    .fetch_all(&state.db)
    .await?;
    let online: Vec<Uuid> = holders.into_iter().filter(|u| connected.contains(u)).collect();
    let mut asked = channel_audience_among(&state.db, channel, &online).await;
    asked.truncate(KEY_REQUEST_FANOUT);
    Ok(asked)
}

// ─── Rechiffrement de l'historique (§6) ─────────────────────────────────────

/// Éléments d'un salon rechiffrables par leur auteur.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Message,
    ThreadMessage,
    ForumReply,
    ForumPost,
}

impl Item {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "message" => Ok(Item::Message),
            "thread_message" => Ok(Item::ThreadMessage),
            "forum_reply" => Ok(Item::ForumReply),
            "forum_post" => Ok(Item::ForumPost),
            _ => Err(AppError::NotFound("Élément introuvable".into())),
        }
    }
}

/// Mes anciens textes en clair dans les salons que je vois encore. `scope_id` :
/// fil (`client_id`) ou publication (`client_msg_id`) qui entre dans l'AAD.
pub async fn legacy_items(db: &PgPool, user: Uuid, limit: i64) -> Result<Vec<Value>> {
    if !has_key(db, user).await? {
        return Ok(vec![]);
    }
    type Row = (String, Uuid, Uuid, Option<String>, Option<String>, Option<Uuid>);
    let rows: Vec<Row> = sqlx::query_as(
        "(SELECT 'message', m.channel_id, m.id, m.content, NULL::text, NULL::uuid FROM messages m
          WHERE m.user_id=$1 AND m.enc IS NULL AND m.content IS NOT NULL AND m.type='default'
            AND m.webhook_display_name IS NULL
          ORDER BY m.created_at LIMIT $2)
         UNION ALL
         (SELECT 'thread_message', t.channel_id, tm.id, tm.content, NULL, t.client_id FROM thread_messages tm
          JOIN threads t ON t.id = tm.thread_id
          WHERE tm.user_id=$1 AND tm.enc IS NULL AND tm.content IS NOT NULL AND tm.webhook_display_name IS NULL
          ORDER BY tm.created_at LIMIT $2)
         UNION ALL
         (SELECT 'forum_reply', p.channel_id, r.id, r.content, NULL, p.client_msg_id FROM forum_replies r
          JOIN forum_posts p ON p.id = r.post_id
          WHERE r.user_id=$1 AND r.enc IS NULL AND r.content IS NOT NULL AND r.webhook_display_name IS NULL
          ORDER BY r.created_at LIMIT $2)
         UNION ALL
         (SELECT 'forum_post', p.channel_id, p.id, p.content, p.title, p.client_msg_id FROM forum_posts p
          WHERE p.creator_id=$1 AND p.enc IS NULL AND (p.content IS NOT NULL OR p.title <> '')
            AND p.webhook_display_name IS NULL
          ORDER BY p.created_at LIMIT $2)
         LIMIT $2",
    )
    .bind(user)
    .bind(limit)
    .fetch_all(db)
    .await?;
    // Seulement les salons encore visibles (un ancien membre ne récupère rien).
    let mut visible: HashMap<Uuid, bool> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for (item, channel, id, content, title, scope) in rows {
        let ok = match visible.get(&channel) {
            Some(v) => *v,
            None => {
                let v = !channel_audience_among(db, channel, &[user]).await.is_empty();
                visible.insert(channel, v);
                v
            }
        };
        if ok {
            out.push(json!({
                "conv_kind": "channel", "conv_id": channel, "item": item, "id": id,
                "content": content.unwrap_or_default(), "title": title, "scope_id": scope,
            }));
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptItemBody {
    enc: Value,
    client_msg_id: Uuid,
}

/// Salon d'un ancien texte encore en clair dont `user` est l'auteur.
async fn legacy_channel(db: &PgPool, item: Item, id: Uuid, user: Uuid) -> Result<Option<Uuid>> {
    let sql = match item {
        Item::Message => "SELECT channel_id FROM messages WHERE id=$1 AND user_id=$2 AND enc IS NULL AND content IS NOT NULL",
        Item::ThreadMessage => {
            "SELECT t.channel_id FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
             WHERE tm.id=$1 AND tm.user_id=$2 AND tm.enc IS NULL AND tm.content IS NOT NULL"
        }
        Item::ForumReply => {
            "SELECT p.channel_id FROM forum_replies r JOIN forum_posts p ON p.id = r.post_id
             WHERE r.id=$1 AND r.user_id=$2 AND r.enc IS NULL AND r.content IS NOT NULL"
        }
        Item::ForumPost => {
            "SELECT channel_id FROM forum_posts
             WHERE id=$1 AND creator_id=$2 AND enc IS NULL AND (content IS NOT NULL OR title <> '')"
        }
    };
    Ok(sqlx::query_scalar(sql).bind(id).bind(user).fetch_optional(db).await?)
}

/// Rechiffre un ancien texte d'un salon par son AUTEUR : le clair est effacé.
pub async fn encrypt_item(db: &PgPool, user: Uuid, item: Item, id: Uuid, body: EncryptItemBody) -> Result<()> {
    let channel = legacy_channel(db, item, id, user).await?.ok_or_else(|| AppError::Conflict("NOT_LEGACY".into()))?;
    if channel_audience_among(db, channel, &[user]).await.is_empty() {
        return Err(AppError::Forbidden);
    }
    let enc = Enc::parse(&body.enc)?;
    check_epoch(channel_epoch(db, channel).await?, enc.epoch)?;
    // Une publication garde son `client_msg_id` : ses réponses y sont liées (AAD).
    let sql = match item {
        Item::Message => "UPDATE messages SET enc=$1, client_msg_id=$2, content=NULL WHERE id=$3 AND enc IS NULL",
        Item::ThreadMessage => "UPDATE thread_messages SET enc=$1, client_msg_id=$2, content=NULL WHERE id=$3 AND enc IS NULL",
        Item::ForumReply => "UPDATE forum_replies SET enc=$1, client_msg_id=$2, content=NULL WHERE id=$3 AND enc IS NULL",
        Item::ForumPost => "UPDATE forum_posts SET enc=$1, content=NULL, title='' WHERE id=$3 AND enc IS NULL AND client_msg_id=$2",
    };
    let done = sqlx::query(sql).bind(enc.to_json()).bind(body.client_msg_id).bind(id).execute(db).await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("NOT_LEGACY".into()));
    }
    if item == Item::Message {
        sqlx::query("DELETE FROM message_edits WHERE message_id=$1").bind(id).execute(db).await?;
        sqlx::query("UPDATE saved_messages SET content=NULL WHERE message_id=$1").bind(id).execute(db).await?;
    }
    Ok(())
}

/// PUT /e2e/legacy/channel/:item/:id {enc, client_msg_id}
pub async fn encrypt_legacy_item(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((item, id)): Path<(String, Uuid)>,
    Json(body): Json<EncryptItemBody>,
) -> Result<Json<Value>> {
    encrypt_item(&state.db, claims.sub, Item::parse(&item)?, id, body).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Purge horaire, 30 jours après le déploiement des salons chiffrés : le texte en
/// clair ANTÉRIEUR restant devient NULL. Webhooks, bots, flux, annonces suivies
/// et historique importé (non chiffrés par nature) sont gardés. Nombre seul journalisé.
pub async fn purge_legacy(db: &PgPool) {
    const DUE: &str = "r.channels_started_at < NOW() - INTERVAL '30 days'";
    const HUMAN: &str = "NOT EXISTS(SELECT 1 FROM users u WHERE u.id = {a} AND u.is_bot)";
    let sql = [
        format!(
            "UPDATE messages m SET content=NULL, purged=TRUE FROM e2e_rollout r
             WHERE {DUE} AND m.created_at < r.channels_started_at AND m.enc IS NULL AND m.content IS NOT NULL
               AND m.webhook_display_name IS NULL AND m.type NOT IN ('webhook', 'feed', 'crosspost') AND {}",
            HUMAN.replace("{a}", "m.user_id")
        ),
        format!(
            "UPDATE thread_messages m SET content=NULL, purged=TRUE FROM e2e_rollout r
             WHERE {DUE} AND m.created_at < r.channels_started_at AND m.enc IS NULL AND m.content IS NOT NULL
               AND m.webhook_display_name IS NULL AND {}",
            HUMAN.replace("{a}", "m.user_id")
        ),
        format!(
            "UPDATE forum_replies m SET content=NULL, purged=TRUE FROM e2e_rollout r
             WHERE {DUE} AND m.created_at < r.channels_started_at AND m.enc IS NULL AND m.content IS NOT NULL
               AND m.webhook_display_name IS NULL AND {}",
            HUMAN.replace("{a}", "m.user_id")
        ),
        format!(
            "UPDATE forum_posts p SET content=NULL, title='', purged=TRUE FROM e2e_rollout r
             WHERE {DUE} AND p.created_at < r.channels_started_at AND p.enc IS NULL
               AND (p.content IS NOT NULL OR p.title <> '') AND p.webhook_display_name IS NULL AND {}",
            HUMAN.replace("{a}", "p.creator_id")
        ),
        format!(
            "UPDATE threads t SET title='' FROM e2e_rollout r
             WHERE {DUE} AND t.created_at < r.channels_started_at AND t.title_enc IS NULL AND t.title <> ''
               AND t.webhook_display_name IS NULL AND {}",
            HUMAN.replace("{a}", "t.creator_id")
        ),
        format!(
            "UPDATE poll_options o SET text='' FROM polls p, e2e_rollout r
             WHERE o.poll_id = p.id AND {DUE} AND p.created_at < r.channels_started_at AND p.enc IS NULL AND o.text <> ''"
        ),
        format!(
            "UPDATE polls p SET question='' FROM e2e_rollout r
             WHERE {DUE} AND p.created_at < r.channels_started_at AND p.enc IS NULL AND p.question <> ''"
        ),
        "DELETE FROM message_edits e USING messages m WHERE e.message_id = m.id AND (m.purged OR m.enc IS NOT NULL)".into(),
        "UPDATE saved_messages s SET content=NULL FROM messages m
         WHERE s.message_id = m.id AND s.content IS NOT NULL AND (m.purged OR m.enc IS NOT NULL)"
            .into(),
    ];
    let mut n = 0;
    for q in &sql {
        match sqlx::query(q).execute(db).await {
            Ok(r) => n += r.rows_affected(),
            Err(e) => tracing::warn!("Purge du clair des salons : {e}"),
        }
    }
    if n > 0 {
        tracing::info!("Purge du clair des salons : {n} lignes effacées");
    }
}

#[derive(Deserialize)]
pub struct LegacyQuery {
    limit: Option<i64>,
}

/// GET /e2e/legacy/channels — mes anciens textes de salon à rechiffrer.
pub async fn my_legacy_items(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<LegacyQuery>,
) -> Result<Json<Value>> {
    Ok(Json(json!(legacy_items(&state.db, claims.sub, q.limit.unwrap_or(50).clamp(1, 100)).await?)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_when_a_holder_lost_access() {
        assert!(!needs_rotation(3, 3));
        assert!(needs_rotation(3, 2));
        assert!(!needs_rotation(0, 0));
    }

    #[test]
    fn items() {
        assert_eq!(Item::parse("forum_post").unwrap(), Item::ForumPost);
        assert_eq!(Item::parse("thread_message").unwrap(), Item::ThreadMessage);
        assert!(Item::parse("dm").is_err());
    }
}
