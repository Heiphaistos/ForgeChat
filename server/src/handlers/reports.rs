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
    .await?;
    let Some(msg) = msg else {
        // Pas un message de salon : peut-être un message privé.
        return report_dm_message(&state, claims.sub, message_id, &body).await;
    };

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
        Permissions::BAN_MEMBERS | Permissions::BAN_TEMP,
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

#[derive(serde::Deserialize)]
pub struct UpdateReportInput {
    pub status: String,
}

pub async fn update_report(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, report_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateReportInput>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_permission(
        &state,
        claims.sub,
        server_id,
        Permissions::BAN_MEMBERS | Permissions::BAN_TEMP,
    )
    .await?;

    if !["pending", "resolved", "dismissed"].contains(&body.status.as_str()) {
        return Err(AppError::BadRequest("Statut invalide (pending|resolved|dismissed)".into()));
    }

    let rows_affected = sqlx::query(
        "UPDATE message_reports SET status=$1 WHERE id=$2 AND server_id=$3"
    )
    .bind(&body.status)
    .bind(report_id)
    .bind(server_id)
    .execute(&state.db)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(AppError::NotFound("Signalement introuvable".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true, "status": body.status })))
}

/// Signalement d'un message privé 1-à-1 : seuls les deux participants peuvent le signaler ; il part
/// dans la file des administrateurs du site (pas de modérateurs de serveur en MP).
async fn report_dm_message(
    state: &AppState,
    reporter: Uuid,
    message_id: Uuid,
    body: &CreateReportInput,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT dm.sender_id, dm.content FROM dm_messages dm
         JOIN dm_channels dc ON dc.id = dm.dm_channel_id
         WHERE dm.id = $1 AND (dc.user1_id = $2 OR dc.user2_id = $2)",
    )
    .bind(message_id)
    .bind(reporter)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;
    let author_id: Uuid = row.get("sender_id");
    if author_id == reporter {
        return Err(AppError::BadRequest("Impossible de signaler son propre message".into()));
    }
    let recent: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM dm_reports WHERE reporter_id=$1 AND created_at > NOW() - INTERVAL '1 hour')
              + (SELECT COUNT(*) FROM message_reports WHERE reporter_id=$1 AND created_at > NOW() - INTERVAL '1 hour')",
    )
    .bind(reporter)
    .fetch_one(&state.db)
    .await?;
    if recent >= 10 {
        return Err(AppError::TooManyRequests);
    }
    let comment = body
        .comment
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= 500)
        .map(str::to_string);
    let content: Option<String> = row.get("content");
    sqlx::query(
        "INSERT INTO dm_reports (message_id, reporter_id, author_id, reason, comment, content)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (reporter_id, message_id) DO NOTHING",
    )
    .bind(message_id)
    .bind(reporter)
    .bind(author_id)
    .bind(&body.reason)
    .bind(comment)
    .bind(content.map(|c| c.chars().take(4000).collect::<String>()))
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct DmReportsQuery {
    pub status: Option<String>,
}

const DM_REPORT_STATUSES: &[&str] = &["open", "resolved", "dismissed"];

/// File des signalements de MP (administrateurs du site).
pub async fn list_dm_reports(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    axum::extract::Query(q): axum::extract::Query<DmReportsQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    crate::handlers::diagnostics::require_admin(&claims)?;
    let status = q
        .status
        .filter(|s| DM_REPORT_STATUSES.contains(&s.as_str()))
        .unwrap_or_else(|| "open".into());
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT r.id, r.reason, r.comment, r.content, r.status, r.created_at, r.message_id,
                r.reporter_id, ur.username AS reporter_username, r.author_id, ua.username AS author_username
         FROM dm_reports r
         LEFT JOIN users ur ON ur.id = r.reporter_id
         LEFT JOIN users ua ON ua.id = r.author_id
         WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200",
    )
    .bind(&status)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.iter()
            .map(|r| {
                serde_json::json!({
                    "id": r.get::<Uuid, _>("id"),
                    "reason": r.get::<String, _>("reason"),
                    "comment": r.get::<Option<String>, _>("comment"),
                    "content": r.get::<Option<String>, _>("content"),
                    "status": r.get::<String, _>("status"),
                    "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                    "message_id": r.get::<Option<Uuid>, _>("message_id"),
                    "reporter_id": r.get::<Uuid, _>("reporter_id"),
                    "reporter_username": r.get::<Option<String>, _>("reporter_username"),
                    "author_id": r.get::<Option<Uuid>, _>("author_id"),
                    "author_username": r.get::<Option<String>, _>("author_username"),
                })
            })
            .collect(),
    ))
}

#[derive(serde::Deserialize)]
pub struct DmReportUpdate {
    pub status: String,
}

pub async fn update_dm_report(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(body): Json<DmReportUpdate>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::diagnostics::require_admin(&claims)?;
    if !DM_REPORT_STATUSES.contains(&body.status.as_str()) {
        return Err(AppError::BadRequest("Statut invalide (open|resolved|dismissed)".into()));
    }
    let done = sqlx::query(
        "UPDATE dm_reports SET status = $2,
                resolved_by = CASE WHEN $2 = 'open' THEN NULL ELSE $3 END,
                resolved_at = CASE WHEN $2 = 'open' THEN NULL ELSE NOW() END
         WHERE id = $1",
    )
    .bind(id)
    .bind(&body.status)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("Signalement introuvable".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
