use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{error::{AppError, Result}, middleware::auth::Claims, state::AppState};

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
