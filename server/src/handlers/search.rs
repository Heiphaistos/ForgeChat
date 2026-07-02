use axum::{
    extract::{Query, State},
    Extension, Json,
};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub async fn global_search(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let q = params.get("q").map(|s| s.trim()).filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("Paramètre q requis".into()))?;

    if q.len() < 2 {
        return Err(AppError::BadRequest("Requête trop courte (min 2 caractères)".into()));
    }

    let q_esc = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{}%", q_esc);
    let uid: Uuid = claims.sub;

    // Paralléliser les 3 recherches indépendantes
    let (messages, users, channels) = tokio::try_join!(
        sqlx::query(
            "SELECT m.id, m.content, m.created_at,
                    u.username as author_username, u.avatar as author_avatar,
                    c.name as channel_name, c.id as channel_id, c.server_id
             FROM messages m
             JOIN users u ON u.id = m.user_id
             JOIN channels c ON c.id = m.channel_id
             JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
             WHERE m.content ILIKE $2
               AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC
             LIMIT 10"
        )
        .bind(uid)
        .bind(&pattern)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT DISTINCT u.id, u.username, u.avatar, u.status
             FROM users u
             WHERE u.username ILIKE $2
               AND (
                 EXISTS(SELECT 1 FROM friendships f
                        WHERE f.status='accepted'
                          AND ((f.user_id=$1 AND f.friend_id=u.id) OR (f.friend_id=$1 AND f.user_id=u.id)))
                 OR EXISTS(SELECT 1 FROM server_members sm1
                           JOIN server_members sm2 ON sm1.server_id=sm2.server_id
                           WHERE sm1.user_id=$1 AND sm2.user_id=u.id)
               )
             LIMIT 8"
        )
        .bind(uid)
        .bind(&pattern)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT c.id, c.name, c.type as channel_type, c.server_id, s.name as server_name
             FROM channels c
             JOIN servers s ON s.id = c.server_id
             JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
             WHERE c.name ILIKE $2
             ORDER BY c.name ASC
             LIMIT 8"
        )
        .bind(uid)
        .bind(&pattern)
        .fetch_all(&state.db),
    )?;

    let messages_json: Vec<serde_json::Value> = messages.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "content": r.get::<Option<String>, _>("content"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "author_username": r.get::<String, _>("author_username"),
        "author_avatar": r.get::<Option<String>, _>("author_avatar"),
        "channel_name": r.get::<String, _>("channel_name"),
        "channel_id": r.get::<Uuid, _>("channel_id"),
        "server_id": r.get::<Uuid, _>("server_id"),
    })).collect();

    let users_json: Vec<serde_json::Value> = users.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
    })).collect();

    let channels_json: Vec<serde_json::Value> = channels.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "type": r.get::<String, _>("channel_type"),
        "server_id": r.get::<Uuid, _>("server_id"),
        "server_name": r.get::<String, _>("server_name"),
    })).collect();

    Ok(Json(serde_json::json!({
        "messages": messages_json,
        "users": users_json,
        "channels": channels_json,
    })))
}
