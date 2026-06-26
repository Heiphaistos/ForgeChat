use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, handlers::servers::{require_member, require_channel_in_server}, middleware::auth::Claims, state::AppState};

#[derive(Deserialize)]
pub struct SaveMessageBody {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
    pub content: Option<String>,
    pub author_username: Option<String>,
    pub author_avatar: Option<String>,
}

#[derive(Serialize)]
pub struct SavedMessage {
    pub id: Uuid,
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
    pub content: Option<String>,
    pub author_username: Option<String>,
    pub author_avatar: Option<String>,
    pub saved_at: DateTime<Utc>,
}

pub async fn save_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SaveMessageBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Vérifier que l'utilisateur a accès au canal/serveur référencé
    if let Some(sid) = body.server_id {
        require_member(&state, claims.sub, sid).await?;
        require_channel_in_server(&state, body.channel_id, sid).await?;
    }
    sqlx::query(
        "INSERT INTO saved_messages (user_id, message_id, channel_id, server_id, content, author_username, author_avatar)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, message_id) DO NOTHING"
    )
    .bind(claims.sub)
    .bind(body.message_id)
    .bind(body.channel_id)
    .bind(body.server_id)
    .bind(body.content)
    .bind(body.author_username)
    .bind(body.author_avatar)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_saved(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<SavedMessage>>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, message_id, channel_id, server_id, content, author_username, author_avatar, saved_at
         FROM saved_messages WHERE user_id=$1 ORDER BY saved_at DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let items = rows.iter().map(|r| SavedMessage {
        id: r.get("id"),
        message_id: r.get("message_id"),
        channel_id: r.get("channel_id"),
        server_id: r.get("server_id"),
        content: r.get("content"),
        author_username: r.get("author_username"),
        author_avatar: r.get("author_avatar"),
        saved_at: r.get("saved_at"),
    }).collect();

    Ok(Json(items))
}

pub async fn unsave_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query("DELETE FROM saved_messages WHERE user_id=$1 AND message_id=$2")
        .bind(claims.sub)
        .bind(message_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// Notes privées utilisateur
#[derive(Serialize)]
pub struct UserNote {
    pub content: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct SetNoteBody {
    pub content: String,
}

pub async fn get_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
) -> Result<Json<UserNote>, AppError> {
    use sqlx::Row;
    let row = sqlx::query("SELECT content, updated_at FROM user_notes WHERE user_id=$1 AND target_user_id=$2")
        .bind(claims.sub).bind(target_id)
        .fetch_optional(&state.db).await?;

    if let Some(r) = row {
        Ok(Json(UserNote { content: r.get("content"), updated_at: r.get("updated_at") }))
    } else {
        Ok(Json(UserNote { content: String::new(), updated_at: Utc::now() }))
    }
}

pub async fn set_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<SetNoteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.content.len() > 2000 {
        return Err(AppError::BadRequest("Note trop longue (max 2000 chars)".into()));
    }
    sqlx::query(
        "INSERT INTO user_notes (user_id, target_user_id, content, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (user_id, target_user_id) DO UPDATE SET content=$3, updated_at=NOW()"
    )
    .bind(claims.sub).bind(target_id).bind(&body.content)
    .execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
