use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_member,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

const VALID_REASONS: &[&str] = &["spam", "harassment", "nsfw", "other"];

#[derive(serde::Deserialize)]
pub struct CreateReportInput {
    pub reason: String,
    pub comment: Option<String>,
}

pub async fn create_report(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<CreateReportInput>,
) -> Result<Json<serde_json::Value>> {
    if !VALID_REASONS.contains(&body.reason.as_str()) {
        return Err(AppError::BadRequest(
            "Raison invalide (spam|harassment|nsfw|other)".into(),
        ));
    }

    use sqlx::Row;
    let msg = sqlx::query(
        "SELECT m.user_id as author_id, c.server_id
         FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    let server_id: Uuid = msg.get("server_id");
    let author_id: Uuid = msg.get("author_id");

    require_member(&state, claims.sub, server_id).await?;

    // Rate limit : max 10 reports par heure
    let recent_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM message_reports
         WHERE reporter_id=$1 AND created_at > NOW() - INTERVAL '1 hour'"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if recent_count >= 10 {
        return Err(AppError::TooManyRequests);
    }

    if author_id == claims.sub {
        return Err(AppError::BadRequest(
            "Impossible de signaler son propre message".into(),
        ));
    }

    let comment = body
        .comment
        .as_deref()
        .filter(|s| !s.trim().is_empty() && s.trim().len() <= 500)
        .map(|s| s.trim().to_string());

    sqlx::query(
        "INSERT INTO message_reports (reporter_id, message_id, server_id, reason, comment)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (reporter_id, message_id) DO NOTHING",
    )
    .bind(claims.sub)
    .bind(message_id)
    .bind(server_id)
    .bind(&body.reason)
    .bind(comment)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_reports(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    crate::handlers::servers::require_permission(
        &state,
        claims.sub,
        server_id,
        Permissions::BAN_MEMBERS,
    )
    .await?;

    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT r.id, r.reason, r.comment, r.status, r.created_at,
                r.message_id, m.content as message_content,
                u.username as reporter_username, u.id as reporter_id
         FROM message_reports r
         LEFT JOIN messages m ON m.id = r.message_id
         JOIN users u ON u.id = r.reporter_id
         WHERE r.server_id = $1
         ORDER BY r.created_at DESC
         LIMIT 100",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let result = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<Uuid, _>("id"),
                "reason": r.get::<String, _>("reason"),
                "comment": r.get::<Option<String>, _>("comment"),
                "status": r.get::<String, _>("status"),
                "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                "message_id": r.get::<Uuid, _>("message_id"),
                "message_content": r.get::<Option<String>, _>("message_content"),
                "reporter_username": r.get::<String, _>("reporter_username"),
                "reporter_id": r.get::<Uuid, _>("reporter_id"),
            })
        })
        .collect();

    Ok(Json(result))
}
