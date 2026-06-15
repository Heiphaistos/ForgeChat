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
    state.broadcast_to_channel(server_id, event.to_string()).await;

    Ok(Json(channel))
}

pub async fn update_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<Json<Channel>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    let channel = sqlx::query_as::<_, Channel>(
        "UPDATE channels SET
            name = COALESCE($2, name),
            topic = COALESCE($3, topic),
            position = COALESCE($4, position),
            slowmode_delay = COALESCE($5, slowmode_delay),
            is_nsfw = COALESCE($6, is_nsfw)
         WHERE id=$1 RETURNING *"
    )
    .bind(channel_id)
    .bind(body.name)
    .bind(body.topic)
    .bind(body.position)
    .bind(body.slowmode_delay)
    .bind(body.is_nsfw)
    .fetch_one(&state.db)
    .await?;

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
    state.broadcast_to_channel(server_id, event.to_string()).await;

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
