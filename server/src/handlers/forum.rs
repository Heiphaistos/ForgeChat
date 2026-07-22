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

use super::servers::{require_member, require_member_and_channel};

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
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

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
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let is_timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    ).bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    if is_timed_out { return Err(AppError::Forbidden); }

    let title = body.title.trim().to_string();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::BadRequest("Titre requis (max 200 chars)".into()));
    }

    let content_raw = body.content.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let content_str: Option<String> = content_raw.map(|s| {
        if s.chars().count() > 8000 { s.chars().take(8000).collect() } else { s.to_string() }
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

    let event = serde_json::json!({ "type": "FORUM_POST_CREATE", "channel_id": channel_id, "post": post });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "post": post })))
}

pub async fn get_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let post_row = sqlx::query(
        "SELECT fp.*, u.username as creator_username, u.avatar as creator_avatar
         FROM forum_posts fp
         JOIN users u ON u.id = fp.creator_id
         WHERE fp.id = $1 AND fp.channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
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

    // Reactions groupees par reponse
    let reply_ids: Vec<Uuid> = reply_rows.iter().map(|r| r.get::<Uuid, _>("id")).collect();
    let reaction_rows = if reply_ids.is_empty() { vec![] } else {
        sqlx::query(
            "SELECT r.forum_reply_id, r.emoji, COUNT(*) as count, bool_or(r.user_id=$2) as me,
                    array_agg(u.username ORDER BY r.created_at) as users
             FROM forum_reply_reactions r JOIN users u ON u.id = r.user_id
             WHERE r.forum_reply_id = ANY($1)
             GROUP BY r.forum_reply_id, r.emoji"
        )
        .bind(&reply_ids).bind(claims.sub)
        .fetch_all(&state.db).await.unwrap_or_default()
    };
    let mut react_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &reaction_rows {
        let mid = r.get::<Uuid, _>("forum_reply_id");
        react_map.entry(mid).or_default().push(serde_json::json!({
            "emoji": r.get::<String, _>("emoji"),
            "count": r.get::<i64, _>("count"),
            "me": r.get::<bool, _>("me"),
            "users": r.get::<Vec<String>, _>("users"),
        }));
    }

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
            },
            "reactions": react_map.get(&r.get::<Uuid, _>("id")).cloned().unwrap_or_default(),
        })
    }).collect();

    Ok(Json(serde_json::json!({ "post": post, "replies": replies })))
}

// Toggle d une reaction sur une reponse de forum (meme pattern que les threads)
pub async fn toggle_reply_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id, emoji)): Path<(Uuid, Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let reply_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM forum_replies fr JOIN forum_posts fp ON fp.id = fr.post_id
         WHERE fr.id=$1 AND fr.post_id=$2 AND fp.channel_id=$3)"
    ).bind(reply_id).bind(post_id).bind(channel_id).fetch_one(&state.db).await?;
    if !reply_ok { return Err(AppError::NotFound("Reponse introuvable".into())); }

    let emoji = emoji.trim().to_string();
    if emoji.is_empty() || emoji.chars().count() > 16 {
        return Err(AppError::BadRequest("Emoji invalide".into()));
    }

    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM forum_reply_reactions WHERE forum_reply_id=$1 AND user_id=$2 AND emoji=$3)"
    ).bind(reply_id).bind(claims.sub).bind(&emoji).fetch_one(&state.db).await?;

    let added = if existing {
        sqlx::query(
            "DELETE FROM forum_reply_reactions WHERE forum_reply_id=$1 AND user_id=$2 AND emoji=$3"
        ).bind(reply_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        false
    } else {
        sqlx::query(
            "INSERT INTO forum_reply_reactions (forum_reply_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
        ).bind(reply_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        true
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM forum_reply_reactions WHERE forum_reply_id=$1 AND emoji=$2"
    ).bind(reply_id).bind(&emoji).fetch_one(&state.db).await?;

    let event = serde_json::json!({
        "type": "FORUM_REPLY_REACTION",
        "post_id": post_id,
        "channel_id": channel_id,
        "reply_id": reply_id,
        "emoji": emoji,
        "added": added,
        "count": count,
        "user_id": claims.sub,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "added": added, "count": count })))
}

pub async fn reply_to_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<CreateReplyReq>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let is_timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    ).bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    if is_timed_out { return Err(AppError::Forbidden); }

    let content_raw = body.content.trim().to_string();
    if content_raw.is_empty() {
        return Err(AppError::BadRequest("Réponse vide".into()));
    }
    if content_raw.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }
    let content = content_raw;

    // Transaction avec SELECT FOR UPDATE pour éviter la race condition locked/INSERT
    let mut tx = state.db.begin().await?;

    let post_row = sqlx::query(
        "SELECT locked FROM forum_posts WHERE id = $1 AND channel_id = $2 FOR UPDATE"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    {
        use sqlx::Row;
        if post_row.get::<bool, _>("locked") {
            tx.rollback().await.ok();
            return Err(AppError::Forbidden);
        }
    }

    let reply = sqlx::query_as::<_, ForumReply>(
        "INSERT INTO forum_replies (post_id, user_id, content) VALUES ($1, $2, $3) RETURNING *"
    )
    .bind(post_id)
    .bind(claims.sub)
    .bind(&content)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE forum_posts SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = $1"
    )
    .bind(post_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let event = serde_json::json!({ "type": "FORUM_REPLY_CREATE", "channel_id": channel_id, "post_id": post_id, "reply": reply });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

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

    // pin/lock réservé aux modérateurs
    if pinned.is_some() || locked.is_some() {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }
    // content : réservé au créateur indépendamment des autres champs
    if content.is_some() && creator_id != claims.sub {
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

    let event = serde_json::json!({ "type": "FORUM_POST_UPDATE", "channel_id": channel_id, "post_id": post_id });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

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

    let event = serde_json::json!({ "type": "FORUM_POST_DELETE", "channel_id": channel_id, "post_id": post_id });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct EditReplyReq {
    pub content: String,
}

pub async fn edit_reply(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
    Json(body): Json<EditReplyReq>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let content = body.content.trim().to_string();
    if content.is_empty() || content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Contenu invalide (1-4000 caractères)".into()));
    }

    // Vérifier que la réponse appartient à ce post et à l'utilisateur
    let rows = sqlx::query(
        "UPDATE forum_replies SET content=$1, edited_at=NOW()
         WHERE id=$2 AND post_id=$3 AND user_id=$4
         RETURNING id"
    )
    .bind(&content)
    .bind(reply_id)
    .bind(post_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }

    let event = serde_json::json!({
        "type": "FORUM_REPLY_EDIT",
        "channel_id": channel_id,
        "post_id": post_id,
        "reply_id": reply_id,
        "content": content,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_reply(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    // Créateur ou modérateur MANAGE_MESSAGES peut supprimer
    use sqlx::Row;
    let reply_row = sqlx::query(
        "SELECT user_id FROM forum_replies WHERE id=$1 AND post_id=$2"
    )
    .bind(reply_id)
    .bind(post_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Réponse introuvable".into()))?;

    let author_id: Uuid = reply_row.get("user_id");
    if author_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    sqlx::query("DELETE FROM forum_replies WHERE id=$1 AND post_id=$2")
        .bind(reply_id)
        .bind(post_id)
        .execute(&state.db)
        .await?;

    // Décrémenter reply_count
    sqlx::query(
        "UPDATE forum_posts SET reply_count = GREATEST(0, reply_count - 1) WHERE id=$1"
    )
    .bind(post_id)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "FORUM_REPLY_DELETE",
        "channel_id": channel_id,
        "post_id": post_id,
        "reply_id": reply_id,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

