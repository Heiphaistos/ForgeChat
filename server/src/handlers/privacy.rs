use axum::{
    extract::State,
    Extension,
    http::header,
    response::IntoResponse,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub async fn export_user_data(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse> {
    use sqlx::Row;

    let uid: Uuid = claims.sub;

    // Profil utilisateur
    let user = sqlx::query(
        "SELECT username, email, bio, pronouns, created_at FROM users WHERE id=$1"
    )
    .bind(uid)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;

    // 100 derniers messages
    let messages = sqlx::query(
        "SELECT m.content, m.created_at, c.name as channel_name
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         WHERE m.author_id = $1
         ORDER BY m.created_at DESC
         LIMIT 100"
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Serveurs membres
    let servers = sqlx::query(
        "SELECT s.name FROM servers s
         JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = $1 ORDER BY s.name"
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Amis
    let friends = sqlx::query(
        "SELECT u.username FROM users u
         JOIN friends f ON (f.user_id = u.id AND f.friend_id = $1) OR (f.friend_id = u.id AND f.user_id = $1)
         WHERE f.status = 'accepted'
         ORDER BY u.username"
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let export = serde_json::json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "profile": {
            "username": user.get::<String, _>("username"),
            "email": user.get::<String, _>("email"),
            "bio": user.get::<Option<String>, _>("bio"),
            "pronouns": user.get::<Option<String>, _>("pronouns"),
            "created_at": user.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        },
        "messages": messages.iter().map(|m| serde_json::json!({
            "content": m.get::<Option<String>, _>("content"),
            "channel": m.get::<String, _>("channel_name"),
            "date": m.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })).collect::<Vec<_>>(),
        "servers": servers.iter().map(|s| s.get::<String, _>("name")).collect::<Vec<String>>(),
        "friends": friends.iter().map(|f| f.get::<String, _>("username")).collect::<Vec<String>>(),
    });

    let json_str = serde_json::to_string_pretty(&export)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Sérialisation: {}", e)))?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"forgechat-mes-donnees.json\""),
        ],
        json_str,
    ))
}
