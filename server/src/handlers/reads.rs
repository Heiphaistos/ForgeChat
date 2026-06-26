use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;
use serde::Serialize;

use crate::{error::{AppError, Result}, middleware::auth::Claims, state::AppState};

#[derive(Serialize)]
pub struct MentionItem {
    pub message_id: String,
    pub channel_id: String,
    pub channel_name: String,
    pub server_id: String,
    pub server_name: String,
    pub author_id: String,
    pub author_username: String,
    pub author_avatar: Option<String>,
    pub content: String,
    pub created_at: String,
}

pub async fn mark_channel_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    // Vérifier que l'utilisateur est membre du serveur propriétaire du canal
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM channels c
            JOIN server_members sm ON sm.server_id = c.server_id
            WHERE c.id = $1 AND sm.user_id = $2
        )"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !is_member {
        return Err(AppError::Forbidden);
    }

    sqlx::query(
        "INSERT INTO last_read (user_id, channel_id, read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, channel_id) DO UPDATE SET read_at=NOW()"
    )
    .bind(claims.sub)
    .bind(channel_id)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_unread_counts(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT m.channel_id, COUNT(*) as count
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
         WHERE m.user_id != $1
           AND m.created_at > COALESCE(
               (SELECT read_at FROM last_read WHERE user_id=$1 AND channel_id=m.channel_id),
               NOW() - INTERVAL '30 days'
           )
         GROUP BY m.channel_id"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        let count: i64 = r.get("count");
        serde_json::json!({
            "channel_id": r.get::<Uuid, _>("channel_id"),
            "count": count,
        })
    }).collect();

    Ok(Json(result))
}

/// Retourne les @mentions récentes de l'utilisateur (7 derniers jours, max 50)
pub async fn get_user_mentions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<MentionItem>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT
            m.id as message_id,
            m.channel_id,
            c.name as channel_name,
            c.server_id,
            s.name as server_name,
            u.id as author_id,
            u.username as author_username,
            u.avatar as author_avatar,
            m.content,
            m.created_at
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         JOIN servers s ON s.id = c.server_id
         JOIN users u ON u.id = m.user_id
         JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
         WHERE m.created_at > NOW() - INTERVAL '7 days'
           AND m.user_id != $1
           AND m.content ILIKE $2
           AND m.created_at > COALESCE(
               (SELECT read_at FROM last_read WHERE user_id=$1 AND channel_id=m.channel_id),
               NOW() - INTERVAL '7 days'
           )
         ORDER BY m.created_at DESC
         LIMIT 50"
    )
    .bind(claims.sub)
    .bind(format!("%@%"))
    .fetch_all(&state.db)
    .await?;

    // Fetch the current user's username for pattern matching
    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;

    let uid_str = claims.sub.to_string();
    let result: Vec<MentionItem> = rows.into_iter().filter_map(|r| {
        let content: String = r.get("content");
        let is_mention = content.contains(&format!("@{}", username))
            || content.contains(&format!("<@{}>", uid_str))
            || content.contains("@everyone")
            || content.contains("@here");
        if !is_mention {
            return None;
        }
        let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
        Some(MentionItem {
            message_id: r.get::<Uuid, _>("message_id").to_string(),
            channel_id: r.get::<Uuid, _>("channel_id").to_string(),
            channel_name: r.get("channel_name"),
            server_id: r.get::<Uuid, _>("server_id").to_string(),
            server_name: r.get("server_name"),
            author_id: r.get::<Uuid, _>("author_id").to_string(),
            author_username: r.get("author_username"),
            author_avatar: r.get("author_avatar"),
            content,
            created_at: created_at.to_rfc3339(),
        })
    }).collect();

    Ok(Json(result))
}
