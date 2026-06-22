use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::{
        channel::{Channel, CreateChannelRequest, UpdateChannelRequest, CreateCategoryRequest, Category},
        role::Permissions,
    },
    state::AppState,
};

pub async fn get_channels(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Channel>>> {
    require_member(&state, claims.sub, server_id).await?;
    let channels = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE server_id=$1 ORDER BY position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(channels))
}

pub async fn create_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<Channel>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    let channel_type = body.r#type.as_deref().unwrap_or("text");
    let channel = sqlx::query_as::<_, Channel>(
        "INSERT INTO channels (server_id, category_id, name, type, topic, is_nsfw)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(server_id)
    .bind(body.category_id)
    .bind(&body.name)
    .bind(channel_type)
    .bind(&body.topic)
    .bind(body.is_nsfw.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    let event = serde_json::json!({ "type": "CHANNEL_CREATE", "channel": channel });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(channel))
}

pub async fn update_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<Json<Channel>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    // Calculer le hash du mot de passe vocal si fourni
    let voice_password_hash: Option<Option<String>> = if body.remove_voice_password.unwrap_or(false) {
        // Suppression explicite du mot de passe
        Some(None)
    } else if let Some(ref pw) = body.voice_password {
        if pw.is_empty() {
            Some(None)
        } else {
            let hash = bcrypt::hash(pw, bcrypt::DEFAULT_COST)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {e}")))?;
            Some(Some(hash))
        }
    } else {
        None // pas de changement
    };

    let channel = if let Some(new_hash) = voice_password_hash {
        // Mise à jour avec changement de mot de passe vocal
        sqlx::query_as::<_, Channel>(
            "UPDATE channels SET
                name = COALESCE($2, name),
                topic = COALESCE($3, topic),
                position = COALESCE($4, position),
                slowmode_delay = COALESCE($5, slowmode_delay),
                is_nsfw = COALESCE($6, is_nsfw),
                user_limit = COALESCE($7, user_limit),
                voice_password_hash = $8,
                is_auto_create = COALESCE($9, is_auto_create),
                auto_create_name = COALESCE($10, auto_create_name)
             WHERE id=$1 RETURNING *"
        )
        .bind(channel_id)
        .bind(body.name)
        .bind(body.topic)
        .bind(body.position)
        .bind(body.slowmode_delay)
        .bind(body.is_nsfw)
        .bind(body.user_limit)
        .bind(new_hash)
        .bind(body.is_auto_create)
        .bind(body.auto_create_name)
        .fetch_one(&state.db)
        .await?
    } else {
        // Mise à jour sans toucher au mot de passe vocal
        sqlx::query_as::<_, Channel>(
            "UPDATE channels SET
                name = COALESCE($2, name),
                topic = COALESCE($3, topic),
                position = COALESCE($4, position),
                slowmode_delay = COALESCE($5, slowmode_delay),
                is_nsfw = COALESCE($6, is_nsfw),
                user_limit = COALESCE($7, user_limit),
                is_auto_create = COALESCE($8, is_auto_create),
                auto_create_name = COALESCE($9, auto_create_name)
             WHERE id=$1 RETURNING *"
        )
        .bind(channel_id)
        .bind(body.name)
        .bind(body.topic)
        .bind(body.position)
        .bind(body.slowmode_delay)
        .bind(body.is_nsfw)
        .bind(body.user_limit)
        .bind(body.is_auto_create)
        .bind(body.auto_create_name)
        .fetch_one(&state.db)
        .await?
    };

    // Broadcaster la mise à jour du canal aux membres du serveur
    let event = serde_json::json!({
        "type": "CHANNEL_UPDATE",
        "channel": {
            "id": channel.id,
            "name": channel.name,
            "topic": channel.topic,
            "slowmode_delay": channel.slowmode_delay,
            "user_limit": channel.user_limit,
            "is_nsfw": channel.is_nsfw,
            "has_voice_password": channel.voice_password_hash.is_some(),
        }
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(channel))
}

pub async fn delete_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    sqlx::query("DELETE FROM channels WHERE id=$1 AND server_id=$2")
        .bind(channel_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({ "type": "CHANNEL_DELETE", "channel_id": channel_id });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn create_category(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateCategoryRequest>,
) -> Result<Json<Category>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    let cat = sqlx::query_as::<_, Category>(
        "INSERT INTO categories (server_id, name) VALUES ($1, $2) RETURNING *"
    )
    .bind(server_id)
    .bind(&body.name)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(cat))
}

pub async fn get_categories(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Category>>> {
    require_member(&state, claims.sub, server_id).await?;
    let cats = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE server_id=$1 ORDER BY position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(cats))
}

pub async fn get_pinned(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let pinned = sqlx::query(
        "SELECT m.*, u.username, u.avatar FROM messages m
         JOIN pinned_messages pm ON pm.message_id = m.id
         JOIN users u ON u.id = m.user_id
         WHERE pm.channel_id=$1
         ORDER BY pm.pinned_at DESC"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = pinned.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "content": r.get::<Option<String>, _>("content"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author_username": r.get::<String, _>("username"),
            "author_avatar": r.get::<Option<String>, _>("avatar"),
        })
    }).collect();

    Ok(Json(result))
}

// ─── Channel Reorder ───────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct ReorderChannelsRequest {
    pub channel_ids: Vec<Uuid>,
}

pub async fn reorder_channels(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<ReorderChannelsRequest>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    for (idx, channel_id) in req.channel_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE channels SET position=$1 WHERE id=$2 AND server_id=$3"
        )
        .bind(idx as i32)
        .bind(channel_id)
        .bind(server_id)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    }

    let event = serde_json::json!({
        "type": "CHANNELS_REORDER",
        "server_id": server_id,
        "channel_ids": req.channel_ids,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Channel Permission Overrides ──────────────────────────────────────────────

pub async fn get_channel_permissions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    let rows = sqlx::query(
        "SELECT target_id, target_type, allow, deny FROM channel_permissions WHERE channel_id=$1"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;
    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "target_id": r.get::<Uuid, _>("target_id"),
            "target_type": r.get::<String, _>("target_type"),
            "allow": r.get::<i64, _>("allow"),
            "deny": r.get::<i64, _>("deny"),
        })
    }).collect();
    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct ChannelPermOverride {
    pub target_type: String,
    pub allow: i64,
    pub deny: i64,
}

pub async fn put_channel_permission(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, target_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<ChannelPermOverride>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, crate::models::role::Permissions::MANAGE_CHANNELS).await?;
    sqlx::query(
        "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, target_id) DO UPDATE
         SET allow=EXCLUDED.allow, deny=EXCLUDED.deny, target_type=EXCLUDED.target_type"
    )
    .bind(channel_id)
    .bind(target_id)
    .bind(&body.target_type)
    .bind(body.allow)
    .bind(body.deny)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_channel_permission(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, target_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, crate::models::role::Permissions::MANAGE_CHANNELS).await?;
    sqlx::query("DELETE FROM channel_permissions WHERE channel_id=$1 AND target_id=$2")
        .bind(channel_id)
        .bind(target_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
