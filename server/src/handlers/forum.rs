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
pub struct ForumPost {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub title: String,
    pub content: Option<String>,
    pub creator_id: Uuid,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub locked: bool,
    pub reply_count: i32,
    pub last_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ForumReply {
    pub id: Uuid,
    pub post_id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePostReq {
    pub title: String,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateReplyReq {
    pub content: String,
}

pub async fn list_posts(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let rows = sqlx::query(
        "SELECT fp.*, u.username as creator_username, u.avatar as creator_avatar
         FROM forum_posts fp
         JOIN users u ON u.id = fp.creator_id
         WHERE fp.channel_id = $1
         ORDER BY fp.pinned DESC, COALESCE(fp.last_reply_at, fp.created_at) DESC
         LIMIT 50"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "channel_id": r.get::<Uuid, _>("channel_id"),
            "title": r.get::<String, _>("title"),
            "content": r.get::<Option<String>, _>("content"),
            "creator_id": r.get::<Uuid, _>("creator_id"),
            "creator_username": r.get::<String, _>("creator_username"),
            "creator_avatar": r.get::<Option<String>, _>("creator_avatar"),
            "tags": r.get::<Vec<String>, _>("tags"),
            "pinned": r.get::<bool, _>("pinned"),
            "locked": r.get::<bool, _>("locked"),
            "reply_count": r.get::<i32, _>("reply_count"),
            "last_reply_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_reply_at"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        })
    }).collect();

    Ok(Json(result))
}

pub async fn create_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreatePostReq>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let title = body.title.trim().to_string();
    if title.is_empty() || title.len() > 200 {
        return Err(AppError::BadRequest("Titre requis (max 200 chars)".into()));
    }

    let content_raw = body.content.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let content_str: Option<String> = content_raw.map(|s| {
        if s.len() > 8000 { s.chars().take(8000).collect() } else { s.to_string() }
    });

    let tags = body.tags.unwrap_or_default();

    let post = sqlx::query_as::<_, ForumPost>(
        "INSERT INTO forum_posts (channel_id, title, content, creator_id, tags)
         VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(channel_id)
    .bind(&title)
    .bind(content_str.as_deref())
    .bind(claims.sub)
    .bind(&tags)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "post": post })))
}

pub async fn get_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, _channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let post_row = sqlx::query(
        "SELECT fp.*, u.username as creator_username, u.avatar as creator_avatar
         FROM forum_posts fp
         JOIN users u ON u.id = fp.creator_id
         WHERE fp.id = $1"
    )
    .bind(post_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    let reply_rows = sqlx::query(
        "SELECT fr.*, u.username, u.avatar, u.discriminator
         FROM forum_replies fr
         JOIN users u ON u.id = fr.user_id
         WHERE fr.post_id = $1
         ORDER BY fr.created_at ASC"
    )
    .bind(post_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let post = serde_json::json!({
        "id": post_row.get::<Uuid, _>("id"),
        "channel_id": post_row.get::<Uuid, _>("channel_id"),
        "title": post_row.get::<String, _>("title"),
        "content": post_row.get::<Option<String>, _>("content"),
        "creator_id": post_row.get::<Uuid, _>("creator_id"),
        "creator_username": post_row.get::<String, _>("creator_username"),
        "creator_avatar": post_row.get::<Option<String>, _>("creator_avatar"),
        "tags": post_row.get::<Vec<String>, _>("tags"),
        "pinned": post_row.get::<bool, _>("pinned"),
        "locked": post_row.get::<bool, _>("locked"),
        "reply_count": post_row.get::<i32, _>("reply_count"),
        "created_at": post_row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    });

    let replies: Vec<serde_json::Value> = reply_rows.iter().map(|r| {
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "post_id": r.get::<Uuid, _>("post_id"),
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

    Ok(Json(serde_json::json!({ "post": post, "replies": replies })))
}

pub async fn reply_to_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<CreateReplyReq>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let content_raw = body.content.trim().to_string();
    if content_raw.is_empty() {
        return Err(AppError::BadRequest("Réponse vide".into()));
    }
    let content: String = if content_raw.len() > 4000 {
        content_raw.chars().take(4000).collect()
    } else {
        content_raw
    };

    let locked = sqlx::query_scalar::<_, bool>(
        "SELECT locked FROM forum_posts WHERE id = $1 AND channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or(false);

    if locked {
        return Err(AppError::Forbidden);
    }

    let reply = sqlx::query_as::<_, ForumReply>(
        "INSERT INTO forum_replies (post_id, user_id, content) VALUES ($1, $2, $3) RETURNING *"
    )
    .bind(post_id)
    .bind(claims.sub)
    .bind(&content)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "UPDATE forum_posts SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = $1"
    )
    .bind(post_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "reply": reply })))
}

pub async fn update_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let post = sqlx::query(
        "SELECT creator_id FROM forum_posts WHERE id = $1 AND channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    use sqlx::Row;
    let creator_id = post.get::<Uuid, _>("creator_id");

    let content = body["content"].as_str();
    let pinned = body["pinned"].as_bool();
    let locked = body["locked"].as_bool();

    // pin/lock réservé aux modérateurs — creator n'en a pas besoin
    if pinned.is_some() || locked.is_some() {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    } else if creator_id != claims.sub {
        // modification du contenu : réservée au créateur
        return Err(AppError::Forbidden);
    }

    sqlx::query(
        "UPDATE forum_posts SET
            pinned = COALESCE($2, pinned),
            locked = COALESCE($3, locked),
            content = COALESCE($4, content)
         WHERE id = $1 AND channel_id = $5"
    )
    .bind(post_id)
    .bind(pinned)
    .bind(locked)
    .bind(content)
    .bind(channel_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let row = sqlx::query(
        "SELECT creator_id FROM forum_posts WHERE id = $1 AND channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    use sqlx::Row;
    let creator_id = row.get::<Uuid, _>("creator_id");

    // Créateur ou modérateur MANAGE_MESSAGES peut supprimer
    if creator_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    sqlx::query("DELETE FROM forum_posts WHERE id = $1 AND channel_id = $2")
        .bind(post_id)
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
