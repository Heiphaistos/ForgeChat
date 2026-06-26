use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

use super::servers::{require_member, require_channel_in_server};

#[derive(Debug, Serialize, FromRow)]
pub struct Thread {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub parent_message_id: Option<Uuid>,
    pub title: String,
    pub creator_id: Uuid,
    pub message_count: i32,
    pub last_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    pub archived: bool,
    pub locked: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ThreadMessage {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateThreadReq {
    pub title: Option<String>,
    pub first_message: String,
    pub parent_message_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct SendThreadMessageReq {
    pub content: String,
}

pub async fn list_threads(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let threads = sqlx::query(
        "SELECT t.*, u.username as creator_username, u.avatar as creator_avatar
         FROM threads t
         JOIN users u ON u.id = t.creator_id
         WHERE t.channel_id = $1
         ORDER BY COALESCE(t.last_reply_at, t.created_at) DESC
         LIMIT 50"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = threads.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "channel_id": r.get::<Uuid, _>("channel_id"),
            "parent_message_id": r.get::<Option<Uuid>, _>("parent_message_id"),
            "title": r.get::<String, _>("title"),
            "creator_id": r.get::<Uuid, _>("creator_id"),
            "creator_username": r.get::<String, _>("creator_username"),
            "creator_avatar": r.get::<Option<String>, _>("creator_avatar"),
            "message_count": r.get::<i32, _>("message_count"),
            "last_reply_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_reply_at"),
            "archived": r.get::<bool, _>("archived"),
            "locked": r.get::<bool, _>("locked"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        })
    }).collect();

    Ok(Json(result))
}

pub async fn create_thread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateThreadReq>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let first_msg = if body.first_message.len() > 4000 {
        body.first_message.chars().take(4000).collect::<String>()
    } else {
        body.first_message.clone()
    };
    if first_msg.trim().is_empty() {
        return Err(AppError::BadRequest("Message vide".into()));
    }

    let title = body.title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| first_msg.chars().take(50).collect::<String>());

    let thread = sqlx::query_as::<_, Thread>(
        "INSERT INTO threads (channel_id, parent_message_id, title, creator_id, last_reply_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *"
    )
    .bind(channel_id)
    .bind(body.parent_message_id)
    .bind(&title)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "INSERT INTO thread_messages (thread_id, user_id, content) VALUES ($1, $2, $3)"
    )
    .bind(thread.id)
    .bind(claims.sub)
    .bind(first_msg.trim())
    .execute(&state.db)
    .await?;

    sqlx::query(
        "UPDATE threads SET message_count = 1 WHERE id = $1"
    )
    .bind(thread.id)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "THREAD_CREATE",
        "channel_id": channel_id,
        "thread": thread,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "thread": thread })))
}

pub async fn get_thread_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;
    let thread_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM threads WHERE id=$1 AND channel_id=$2)"
    )
    .bind(thread_id).bind(channel_id)
    .fetch_one(&state.db).await?;
    if !thread_ok { return Err(AppError::NotFound("Thread introuvable".into())); }

    let rows = sqlx::query(
        "SELECT tm.*, u.username, u.avatar, u.discriminator
         FROM thread_messages tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.thread_id = $1
         ORDER BY tm.created_at ASC"
    )
    .bind(thread_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "thread_id": r.get::<Uuid, _>("thread_id"),
            "user_id": r.get::<Uuid, _>("user_id"),
            "content": r.get::<String, _>("content"),
            "edited_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("edited_at"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author": {
                "id": r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "discriminator": r.get::<String, _>("discriminator"),
            }
        })
    }).collect();

    Ok(Json(result))
}

pub async fn send_thread_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<SendThreadMessageReq>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;
    let thread_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM threads WHERE id=$1 AND channel_id=$2)"
    )
    .bind(thread_id).bind(channel_id)
    .fetch_one(&state.db).await?;
    if !thread_ok { return Err(AppError::NotFound("Thread introuvable".into())); }

    let content_trimmed = body.content.trim().to_string();
    if content_trimmed.is_empty() {
        return Err(AppError::BadRequest("Message vide".into()));
    }
    let content_trimmed: String = if content_trimmed.len() > 4000 {
        content_trimmed.chars().take(4000).collect()
    } else {
        content_trimmed
    };

    let thread_locked = sqlx::query_scalar::<_, bool>(
        "SELECT locked FROM threads WHERE id = $1"
    )
    .bind(thread_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or(false);

    if thread_locked {
        return Err(AppError::Forbidden);
    }

    let msg = sqlx::query_as::<_, ThreadMessage>(
        "INSERT INTO thread_messages (thread_id, user_id, content) VALUES ($1, $2, $3) RETURNING *"
    )
    .bind(thread_id)
    .bind(claims.sub)
    .bind(&content_trimmed)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "UPDATE threads SET message_count = message_count + 1, last_reply_at = NOW() WHERE id = $1"
    )
    .bind(thread_id)
    .execute(&state.db)
    .await?;

    // Broadcast en temps réel aux membres du serveur
    let event = serde_json::json!({
        "type": "THREAD_MESSAGE",
        "thread_id": thread_id,
        "channel_id": channel_id,
        "message": msg,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "message": msg })))
}

pub async fn archive_thread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Thread>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Vérifier que l'utilisateur est le créateur du thread OU a la permission MANAGE_MESSAGES
    let thread_row = sqlx::query(
        "SELECT creator_id FROM threads WHERE id = $1 AND channel_id = $2"
    )
    .bind(thread_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread introuvable".into()))?;

    use sqlx::Row;
    let creator_id: Uuid = thread_row.get("creator_id");
    if creator_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    let archived = body["archived"].as_bool().unwrap_or(true);
    let locked = body["locked"].as_bool();

    let thread = if let Some(locked) = locked {
        sqlx::query_as::<_, Thread>(
            "UPDATE threads SET archived = $2, locked = $3 WHERE id = $1 RETURNING *"
        )
        .bind(thread_id)
        .bind(archived)
        .bind(locked)
        .fetch_one(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, Thread>(
            "UPDATE threads SET archived = $2 WHERE id = $1 RETURNING *"
        )
        .bind(thread_id)
        .bind(archived)
        .fetch_one(&state.db)
        .await?
    };

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "THREAD_UPDATE",
        "thread_id": thread.id,
        "channel_id": channel_id,
        "server_id": server_id,
        "archived": thread.archived,
        "locked": thread.locked,
    }).to_string()).await;

    Ok(Json(thread))
}
