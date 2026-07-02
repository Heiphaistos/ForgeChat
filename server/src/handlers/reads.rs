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

    // Paralléliser les 3 queries indépendantes (server channels, DMs, GroupDMs)
    let (rows_result, dm_rows, gdm_rows) = tokio::join!(
        sqlx::query(
            "WITH lr AS (
                 SELECT channel_id, read_at FROM last_read WHERE user_id = $1
             )
             SELECT m.channel_id, c.server_id, COUNT(*) as count
             FROM messages m
             JOIN channels c ON c.id = m.channel_id
             JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
             LEFT JOIN lr ON lr.channel_id = m.channel_id
             WHERE m.user_id != $1
               AND m.created_at > COALESCE(lr.read_at, NOW() - INTERVAL '30 days')
             GROUP BY m.channel_id, c.server_id"
        )
        .bind(claims.sub)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT dm.dm_channel_id as id, COUNT(*) as count
             FROM dm_messages dm
             WHERE dm.sender_id != $1
               AND EXISTS(
                   SELECT 1 FROM dm_channels dc
                   WHERE dc.id = dm.dm_channel_id AND (dc.user1_id=$1 OR dc.user2_id=$1)
               )
               AND dm.created_at > COALESCE(
                   (SELECT last_read_at FROM dm_read_receipts WHERE dm_id=dm.dm_channel_id AND user_id=$1),
                   NOW() - INTERVAL '30 days'
               )
             GROUP BY dm.dm_channel_id"
        )
        .bind(claims.sub)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT gdm.dm_id as id, COUNT(*) as count
             FROM group_dm_messages gdm
             JOIN group_dm_members mbr ON mbr.dm_id = gdm.dm_id AND mbr.user_id = $1
             WHERE gdm.sender_id != $1
               AND gdm.created_at > COALESCE(
                   (SELECT last_read_at FROM dm_read_receipts WHERE dm_id=gdm.dm_id AND user_id=$1),
                   NOW() - INTERVAL '30 days'
               )
             GROUP BY gdm.dm_id"
        )
        .bind(claims.sub)
        .fetch_all(&state.db),
    );

    let rows = rows_result?;
    let dm_rows = dm_rows.unwrap_or_default();
    let gdm_rows = gdm_rows.unwrap_or_default();

    let mut result: Vec<serde_json::Value> = rows.iter().map(|r| {
        let count: i64 = r.get("count");
        serde_json::json!({
            "channel_id": r.get::<Uuid, _>("channel_id"),
            "server_id": r.get::<Option<Uuid>, _>("server_id"),
            "count": count,
        })
    }).collect();

    for r in &dm_rows {
        let count: i64 = r.get("count");
        if count > 0 {
            result.push(serde_json::json!({
                "channel_id": r.get::<Uuid, _>("id"),
                "server_id": serde_json::Value::Null,
                "count": count,
            }));
        }
    }

    for r in &gdm_rows {
        let count: i64 = r.get("count");
        if count > 0 {
            result.push(serde_json::json!({
                "channel_id": r.get::<Uuid, _>("id"),
                "server_id": serde_json::Value::Null,
                "count": count,
            }));
        }
    }

    Ok(Json(result))
}

/// Marque un GroupDM comme lu pour l'utilisateur courant
pub async fn mark_group_dm_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if !is_member {
        return Err(AppError::Forbidden);
    }
    sqlx::query(
        "INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at = NOW()"
    )
    .bind(group_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Marque tous les canaux (serveurs + DMs + GroupDMs) comme lus pour l'utilisateur
pub async fn mark_all_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    tokio::join!(
        sqlx::query(
            "INSERT INTO last_read (user_id, channel_id, read_at)
             SELECT $1, c.id, NOW()
             FROM channels c
             JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
             ON CONFLICT (user_id, channel_id) DO UPDATE SET read_at = NOW()"
        )
        .bind(claims.sub)
        .execute(&state.db),
        sqlx::query(
            "INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at)
             SELECT id, $1, NOW()
             FROM (
                 SELECT id FROM dm_channels WHERE user1_id=$1 OR user2_id=$1
                 UNION ALL
                 SELECT dm_id AS id FROM group_dm_members WHERE user_id=$1
             ) t
             ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at = NOW()"
        )
        .bind(claims.sub)
        .execute(&state.db),
    );

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Retourne les @mentions récentes de l'utilisateur (7 derniers jours, max 50)
pub async fn get_user_mentions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<MentionItem>>> {
    use sqlx::Row;

    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;

    let uid_str = claims.sub.to_string();
    let pat_username = format!("%@{}%", username);
    let pat_uuid = format!("%<@{}>%", uid_str);

    let rows = sqlx::query(
        "WITH lr AS (
             SELECT channel_id, read_at FROM last_read WHERE user_id = $1
         )
         SELECT
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
         LEFT JOIN lr ON lr.channel_id = m.channel_id
         WHERE m.created_at > NOW() - INTERVAL '7 days'
           AND m.user_id != $1
           AND (
               m.content ILIKE $2
            OR m.content ILIKE $3
            OR m.content ILIKE '%@everyone%'
            OR m.content ILIKE '%@here%'
           )
           AND m.created_at > COALESCE(lr.read_at, NOW() - INTERVAL '7 days')
         ORDER BY m.created_at DESC
         LIMIT 50"
    )
    .bind(claims.sub)
    .bind(&pat_username)
    .bind(&pat_uuid)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<MentionItem> = rows.into_iter().map(|r| {
        let created_at: chrono::DateTime<chrono::Utc> = r.get("created_at");
        MentionItem {
            message_id: r.get::<Uuid, _>("message_id").to_string(),
            channel_id: r.get::<Uuid, _>("channel_id").to_string(),
            channel_name: r.get("channel_name"),
            server_id: r.get::<Uuid, _>("server_id").to_string(),
            server_name: r.get("server_name"),
            author_id: r.get::<Uuid, _>("author_id").to_string(),
            author_username: r.get("author_username"),
            author_avatar: r.get("author_avatar"),
            content: r.get("content"),
            created_at: created_at.to_rfc3339(),
        }
    }).collect();

    Ok(Json(result))
}
