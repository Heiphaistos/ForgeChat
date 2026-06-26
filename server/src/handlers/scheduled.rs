use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_channel_in_server},
    middleware::auth::Claims,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateScheduledRequest {
    pub content: String,
    pub send_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ScheduledMessage {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub send_at: DateTime<Utc>,
    pub sent: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn create_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateScheduledRequest>,
) -> Result<Json<ScheduledMessage>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    if body.content.trim().is_empty() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    if body.content.len() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 chars)".into()));
    }
    if body.send_at <= Utc::now() {
        return Err(AppError::BadRequest("La date doit être dans le futur".into()));
    }

    let msg = sqlx::query_as::<_, ScheduledMessage>(
        "INSERT INTO scheduled_messages (channel_id, user_id, content, send_at)
         VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(body.content.trim())
    .bind(body.send_at)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(msg))
}

pub async fn list_scheduled(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ScheduledMessage>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

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
        "SELECT sm.*, u.username, u.discriminator, u.avatar, u.is_bot
         FROM scheduled_messages sm
         JOIN users u ON u.id = sm.user_id
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
        let content: String = row.get("content");

        // Insérer dans messages
        let insert = sqlx::query(
            "INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, $3) RETURNING *"
        )
        .bind(channel_id)
        .bind(user_id)
        .bind(&content)
        .fetch_one(&state.db)
        .await;

        match insert {
            Ok(msg_row) => {
                let msg_id: Uuid = msg_row.get("id");

                // Marquer le scheduled comme envoyé
                let _ = sqlx::query("UPDATE scheduled_messages SET sent=TRUE WHERE id=$1")
                    .bind(sched_id)
                    .execute(&state.db)
                    .await;

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
                    content: Some(content),
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
                    author_is_bot: row.try_get("is_bot").unwrap_or(false),
                    author_verified: row.try_get("is_verified").unwrap_or(false),
                    attachments: vec![],
                    reactions: vec![],
                    expires_at: None,
                };

                let event = serde_json::json!({
                    "type": "MESSAGE_CREATE",
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
