use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_member_and_channel,
    middleware::auth::Claims,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateScheduledRequest {
    #[serde(default)]
    pub content: String,
    pub send_at: DateTime<Utc>,
    /// Chiffré à la création (même format qu'un message du salon), recopié tel quel à l'envoi.
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ScheduledMessage {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub content: Option<String>,
    pub send_at: DateTime<Utc>,
    pub sent: bool,
    pub created_at: DateTime<Utc>,
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

pub async fn create_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateScheduledRequest>,
) -> Result<Json<ScheduledMessage>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;

    let has_text = !body.content.trim().is_empty();
    let enc = crate::handlers::e2e_channel::check_content(
        &state.db, channel_id, has_text, body.enc.as_ref(), body.client_msg_id, false,
    ).await?;
    if !has_text && enc.is_none() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    if body.content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }
    check_send_at(body.send_at)?;
    // Plafond : sans lui, 5 000 messages programmés pour la même minute partaient
    // d'un bloc, en contournant l'anti-spam (5 messages / 3 s) et le slowmode.
    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM scheduled_messages WHERE user_id=$1 AND sent = FALSE"
    ).bind(claims.sub).fetch_one(&state.db).await?;
    if pending >= 25 {
        return Err(AppError::BadRequest("Limite de 25 messages programmés en attente atteinte".into()));
    }

    // Même enforcement timeout que messages.rs/forum.rs/threads.rs/polls.rs/tickets.rs :
    // sans ce check, un membre en timeout pouvait quand même programmer un message
    // pour publication automatique, contournant totalement la sanction.
    let is_timed_out = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if is_timed_out {
        return Err(AppError::Forbidden);
    }

    // Même check que messages.rs/threads.rs/forum.rs/bots.rs/webhooks.rs :
    // sans lui, un message programmé contournait entièrement le filtre AutoMod
    // du serveur (mots interdits, liens, mentions, spam, majuscules).
    // Chiffré : appliqué par l'appli avant chiffrement.
    if enc.is_none() {
        if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, body.content.trim()).await {
            return Err(err);
        }
    }

    let msg = sqlx::query_as::<_, ScheduledMessage>(
        "INSERT INTO scheduled_messages (channel_id, user_id, content, send_at, enc, client_msg_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(Some(body.content.trim()).filter(|_| enc.is_none()))
    .bind(body.send_at)
    .bind(&enc)
    .bind(enc.as_ref().and(body.client_msg_id))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(msg))
}

pub async fn list_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ScheduledMessage>>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let msgs = sqlx::query_as::<_, ScheduledMessage>(
        "SELECT * FROM scheduled_messages
         WHERE channel_id=$1 AND user_id=$2 AND sent=FALSE
         ORDER BY send_at ASC"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(msgs))
}

/// GET /api/scheduled : tous mes messages « À envoyer » (contenu chiffré), avec salon et serveur.
pub async fn list_all_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT sm.id, sm.channel_id, sm.content, sm.send_at, sm.created_at, sm.enc, sm.client_msg_id,
                c.name AS channel_name, c.server_id, s.name AS server_name
         FROM scheduled_messages sm
         JOIN channels c ON c.id = sm.channel_id
         JOIN servers s ON s.id = c.server_id
         WHERE sm.user_id=$1 AND sm.sent=FALSE
         ORDER BY sm.send_at ASC LIMIT 100"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "channel_id": r.get::<Uuid, _>("channel_id"),
        "user_id": claims.sub,
        "content": r.get::<Option<String>, _>("content"),
        "send_at": r.get::<DateTime<Utc>, _>("send_at"),
        "created_at": r.get::<DateTime<Utc>, _>("created_at"),
        "enc": r.get::<Option<serde_json::Value>, _>("enc"),
        "client_msg_id": r.get::<Option<Uuid>, _>("client_msg_id"),
        "channel_name": r.get::<String, _>("channel_name"),
        "server_id": r.get::<Option<Uuid>, _>("server_id"),
        "server_name": r.get::<String, _>("server_name"),
    })).collect()))
}

#[derive(Debug, Deserialize)]
pub struct UpdateScheduledRequest {
    pub send_at: Option<DateTime<Utc>>,
    /// Nouveau contenu chiffré (même format qu'à la création).
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

/// Bornes communes de la date d'envoi (création et modification).
fn check_send_at(at: DateTime<Utc>) -> Result<()> {
    if at <= Utc::now() {
        return Err(AppError::BadRequest("La date doit être dans le futur".into()));
    }
    if at > Utc::now() + chrono::Duration::days(30) {
        return Err(AppError::BadRequest("Planification max 30 jours dans le futur".into()));
    }
    Ok(())
}

/// Mon message programmé encore en attente : son salon (sinon 404, jamais celui d'un autre).
async fn my_pending(state: &AppState, id: Uuid, user: Uuid) -> Result<(Uuid, Uuid)> {
    let row: Option<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "SELECT sm.channel_id, c.server_id FROM scheduled_messages sm JOIN channels c ON c.id = sm.channel_id
         WHERE sm.id=$1 AND sm.user_id=$2 AND sm.sent=FALSE"
    )
    .bind(id)
    .bind(user)
    .fetch_optional(&state.db)
    .await?;
    match row {
        Some((channel_id, Some(server_id))) => Ok((server_id, channel_id)),
        _ => Err(AppError::NotFound("Message programmé introuvable".into())),
    }
}

/// PATCH /api/scheduled/:id { send_at?, enc?, client_msg_id? } : modifier la date ou le texte (rechiffré).
pub async fn update_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(scheduled_id): Path<Uuid>,
    Json(body): Json<UpdateScheduledRequest>,
) -> Result<Json<ScheduledMessage>> {
    let (server_id, channel_id) = my_pending(&state, scheduled_id, claims.sub).await?;
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;
    if let Some(at) = body.send_at {
        check_send_at(at)?;
    }
    let enc = match body.enc.as_ref().filter(|v| !v.is_null()) {
        Some(e) => crate::handlers::e2e_channel::check_content(
            &state.db, channel_id, false, Some(e), body.client_msg_id, false,
        ).await?,
        None => None,
    };
    let msg = sqlx::query_as::<_, ScheduledMessage>(
        "UPDATE scheduled_messages SET
            send_at = COALESCE($3, send_at),
            enc = COALESCE($4, enc),
            client_msg_id = CASE WHEN $4 IS NULL THEN client_msg_id ELSE $5 END,
            content = CASE WHEN $4 IS NULL THEN content ELSE NULL END
         WHERE id=$1 AND user_id=$2 AND sent=FALSE RETURNING *"
    )
    .bind(scheduled_id)
    .bind(claims.sub)
    .bind(body.send_at)
    .bind(&enc)
    .bind(enc.as_ref().and(body.client_msg_id))
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message programmé introuvable".into()))?;
    Ok(Json(msg))
}

/// POST /api/scheduled/:id/send : envoyer maintenant (échéance ramenée à maintenant, envoi immédiat).
pub async fn send_scheduled_now(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(scheduled_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let (server_id, channel_id) = my_pending(&state, scheduled_id, claims.sub).await?;
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;
    sqlx::query("UPDATE scheduled_messages SET send_at = NOW() WHERE id=$1 AND user_id=$2 AND sent=FALSE")
        .bind(scheduled_id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    dispatch_scheduled_messages(state.clone()).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(scheduled_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let deleted = sqlx::query_scalar::<_, bool>(
        "DELETE FROM scheduled_messages WHERE id=$1 AND user_id=$2 AND sent=FALSE RETURNING TRUE"
    )
    .bind(scheduled_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;

    if deleted.is_none() {
        return Err(AppError::NotFound("Message programmé introuvable".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Tâche tokio : envoie les messages programmés dont send_at <= NOW()
pub async fn dispatch_scheduled_messages(state: AppState) {
    use sqlx::Row;

    let pending = sqlx::query(
        "SELECT sm.*, u.username, u.discriminator, u.avatar, u.avatar_decoration, u.is_bot, c.server_id
         FROM scheduled_messages sm
         JOIN users u ON u.id = sm.user_id
         JOIN channels c ON c.id = sm.channel_id
         WHERE sm.send_at <= NOW() AND sm.sent = FALSE
         LIMIT 100"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for row in &pending {
        let sched_id: Uuid = row.get("id");
        let channel_id: Uuid = row.get("channel_id");
        let user_id: Uuid = row.get("user_id");
        let content: Option<String> = row.get("content");
        let enc: Option<serde_json::Value> = row.get("enc");
        let cmid: Option<Uuid> = row.get("client_msg_id");
        let server_id: Uuid = row.get("server_id");

        // Revalider au moment de l'envoi (pas seulement à la programmation) : jusqu'à
        // 30 jours peuvent s'écouler entre les deux, pendant lesquels l'auteur peut être
        // expulsé/banni (retiré de server_members par kick_member/ban_member) ou mis en
        // timeout -- sans cette revérification, un message programmé avant la sanction
        // la contournait entièrement en partant quand même à l'heure prévue.
        let still_eligible = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)
             AND NOT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

        if !still_eligible {
            let _ = sqlx::query("UPDATE scheduled_messages SET sent=TRUE WHERE id=$1")
                .bind(sched_id)
                .execute(&state.db)
                .await;
            tracing::info!(
                "Message programmé {} annulé silencieusement (auteur expulsé/banni ou en timeout depuis la programmation)",
                sched_id
            );
            continue;
        }

        // Messages éphémères du salon : appliqués à l'heure de l'envoi.
        let expires_at = crate::handlers::disappearing::setting(&state.db, crate::handlers::e2e_conv::Conv::Channel(channel_id))
            .await
            .ok()
            .and_then(|ttl| crate::handlers::disappearing::expiry(ttl, Utc::now()).0);

        // Insérer dans messages + marquer envoyé dans une transaction atomique. Le message est
        // d'abord réservé (`sent` FALSE → TRUE) : « Envoyer maintenant » et la tâche de fond
        // peuvent tourner en même temps, un seul des deux l'envoie.
        let insert = async {
            let mut tx = state.db.begin().await?;
            let claimed = sqlx::query("UPDATE scheduled_messages SET sent=TRUE WHERE id=$1 AND sent=FALSE")
                .bind(sched_id)
                .execute(&mut *tx)
                .await?;
            if claimed.rows_affected() == 0 {
                return Ok(None);
            }
            let msg_row = sqlx::query(
                "INSERT INTO messages (channel_id, user_id, content, enc, client_msg_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
            )
            .bind(channel_id)
            .bind(user_id)
            .bind(&content)
            .bind(&enc)
            .bind(cmid)
            .bind(expires_at)
            .fetch_one(&mut *tx)
            .await?;
            tx.commit().await?;
            Ok::<_, sqlx::Error>(Some(msg_row))
        }.await;

        match insert {
            Ok(None) => {}
            Ok(Some(msg_row)) => {
                let msg_id: Uuid = msg_row.get("id");

                // Mettre à jour last_message_id du canal
                let _ = sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
                    .bind(msg_id)
                    .bind(channel_id)
                    .execute(&state.db)
                    .await;

                // Broadcast MESSAGE_CREATE
                use crate::models::message::MessageWithAuthor;
                let full_msg = MessageWithAuthor {
                    id: msg_id,
                    channel_id,
                    content,
                    r#type: msg_row.get("type"),
                    reply_to: None,
                    reply_to_content: None,
                    reply_to_username: None,
                    forward_from_id: None,
                    forward_from_username: None,
                    pinned: false,
                    edited_at: None,
                    created_at: msg_row.get("created_at"),
                    author_id: user_id,
                    author_username: row.get("username"),
                    author_discriminator: row.get("discriminator"),
                    author_avatar: row.get("avatar"),
                    author_avatar_decoration: row.get("avatar_decoration"),
                    author_is_bot: row.try_get("is_bot").unwrap_or(false),
                    author_verified: row.try_get("is_verified").unwrap_or(false),
                    attachments: vec![],
                    reactions: vec![],
                    expires_at,
                    poll_id: None,
                    e2e: crate::models::message::MsgE2e::from_row(&msg_row),
                };

                let event = serde_json::json!({
                    "type": "MESSAGE_CREATE",
                    "server_id": server_id,
                    "message": full_msg
                });
                state.broadcast_to_channel_members(channel_id, event.to_string()).await;

                tracing::info!("Message programmé {} envoyé dans canal {}", sched_id, channel_id);
            }
            Err(e) => {
                tracing::error!("Erreur envoi message programmé {}: {}", sched_id, e);
            }
        }
    }
}
