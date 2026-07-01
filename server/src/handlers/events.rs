use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServerEvent {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub event_type: String,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub creator_id: Uuid,
    pub image_url: Option<String>,
    pub max_attendees: Option<i32>,
    pub attendee_count: Option<i64>,
    pub user_rsvp: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    pub filter: Option<String>, // "upcoming" | "past" | "all"
}

async fn ensure_member(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub async fn list_events(
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(q): Query<EventsQuery>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ServerEvent>>> {
    ensure_member(&state, server_id, claims.sub).await?;

    let filter = q.filter.as_deref().unwrap_or("upcoming");
    let time_clause = match filter {
        "past" => "AND e.start_time < NOW()",
        "all" => "",
        _ => "AND e.start_time >= NOW()", // upcoming
    };

    let sql = format!(
        "SELECT e.id, e.server_id, e.channel_id, e.name, e.description,
                e.event_type, e.start_time, e.end_time, e.creator_id, e.image_url, e.max_attendees,
                COUNT(a.user_id) AS attendee_count,
                MAX(CASE WHEN a.user_id = $2 THEN a.status END) AS user_rsvp
         FROM server_events e
         LEFT JOIN event_attendees a ON a.event_id = e.id
         WHERE e.server_id = $1 {time_clause}
         GROUP BY e.id
         ORDER BY e.start_time"
    );

    let events = sqlx::query_as::<_, ServerEvent>(&sql)
        .bind(server_id)
        .bind(claims.sub)
        .fetch_all(&state.db)
        .await?;

    Ok(Json(events))
}

#[derive(Debug, Deserialize)]
pub struct CreateEvent {
    pub name: String,
    pub description: Option<String>,
    pub event_type: Option<String>,
    pub start_time: chrono::DateTime<chrono::Utc>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub channel_id: Option<Uuid>,
    pub image_url: Option<String>,
    pub max_attendees: Option<i32>,
}

pub async fn create_event(
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    Json(body): Json<CreateEvent>,
) -> Result<Json<ServerEvent>> {
    ensure_member(&state, server_id, claims.sub).await?;

    let is_timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    ).bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    if is_timed_out { return Err(AppError::Forbidden); }

    if body.name.trim().is_empty() {
        return Err(AppError::BadRequest("Nom requis".into()));
    }

    // Vérifier que le canal optionnel appartient bien à ce serveur
    if let Some(ch_id) = body.channel_id {
        let ok = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1 AND server_id=$2)"
        )
        .bind(ch_id)
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
        if !ok {
            return Err(AppError::Forbidden);
        }
    }
    if body.start_time < chrono::Utc::now() {
        return Err(AppError::BadRequest("La date de début doit être dans le futur".into()));
    }
    if let Some(end) = body.end_time {
        if end <= body.start_time {
            return Err(AppError::BadRequest("end_time doit être après start_time".into()));
        }
    }

    let event_type = body.event_type.as_deref().unwrap_or("event");
    if !["event", "meeting", "stream", "other"].contains(&event_type) {
        return Err(AppError::BadRequest("event_type invalide".into()));
    }

    let event = sqlx::query_as::<_, ServerEvent>(
        "INSERT INTO server_events (server_id, channel_id, name, description, event_type,
          start_time, end_time, creator_id, image_url, max_attendees)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, server_id, channel_id, name, description, event_type,
           start_time, end_time, creator_id, image_url, max_attendees,
           0::BIGINT AS attendee_count, NULL::TEXT AS user_rsvp"
    )
    .bind(server_id)
    .bind(body.channel_id)
    .bind(body.name.trim())
    .bind(body.description.as_deref())
    .bind(event_type)
    .bind(body.start_time)
    .bind(body.end_time)
    .bind(claims.sub)
    .bind(body.image_url.as_deref())
    .bind(body.max_attendees)
    .fetch_one(&state.db)
    .await?;

    let ws_event = serde_json::json!({ "type": "SERVER_EVENT_CREATE", "server_id": server_id, "event": event });
    state.broadcast_to_server_members(server_id, ws_event.to_string()).await;

    Ok(Json(event))
}

pub async fn get_event(
    Extension(claims): Extension<Claims>,
    Path((server_id, event_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<ServerEvent>> {
    ensure_member(&state, server_id, claims.sub).await?;

    let event = sqlx::query_as::<_, ServerEvent>(
        "SELECT e.id, e.server_id, e.channel_id, e.name, e.description,
                e.event_type, e.start_time, e.end_time, e.creator_id, e.image_url, e.max_attendees,
                COUNT(a.user_id) AS attendee_count,
                MAX(CASE WHEN a.user_id = $3 THEN a.status END) AS user_rsvp
         FROM server_events e
         LEFT JOIN event_attendees a ON a.event_id = e.id
         WHERE e.id = $1 AND e.server_id = $2
         GROUP BY e.id"
    )
    .bind(event_id)
    .bind(server_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Événement introuvable".into()))?;

    Ok(Json(event))
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateEvent {
    pub name: Option<String>,
    pub description: Option<serde_json::Value>,
    pub event_type: Option<String>,
    pub start_time: Option<chrono::DateTime<chrono::Utc>>,
    pub end_time: Option<serde_json::Value>,
    #[allow(dead_code)]
    pub channel_id: Option<serde_json::Value>,
    pub image_url: Option<serde_json::Value>,
    pub max_attendees: Option<serde_json::Value>,
}

pub async fn update_event(
    Extension(claims): Extension<Claims>,
    Path((server_id, event_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    Json(body): Json<UpdateEvent>,
) -> Result<Json<ServerEvent>> {
    ensure_member(&state, server_id, claims.sub).await?;

    // Empêcher le backdating de la date de début
    if let Some(new_start) = body.start_time {
        if new_start < chrono::Utc::now() {
            return Err(AppError::BadRequest("La date de début doit être dans le futur".into()));
        }
    }

    let affected = sqlx::query(
        "UPDATE server_events SET
           name = COALESCE($3, name),
           description = CASE WHEN $4::TEXT IS NOT NULL THEN $4::TEXT ELSE description END,
           event_type = COALESCE($5, event_type),
           start_time = COALESCE($6, start_time),
           end_time = CASE WHEN $7::TIMESTAMPTZ IS NOT NULL THEN $7::TIMESTAMPTZ ELSE end_time END,
           image_url = CASE WHEN $8::TEXT IS NOT NULL THEN $8::TEXT ELSE image_url END,
           max_attendees = CASE WHEN $9::INTEGER IS NOT NULL THEN $9::INTEGER ELSE max_attendees END
         WHERE id = $1 AND server_id = $2 AND creator_id = $10"
    )
    .bind(event_id)
    .bind(server_id)
    .bind(body.name.as_deref())
    .bind(body.description.as_ref().and_then(|v| v.as_str()))
    .bind(body.event_type.as_deref())
    .bind(body.start_time)
    .bind(
        body.end_time.as_ref()
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok())
    )
    .bind(body.image_url.as_ref().and_then(|v| v.as_str()))
    .bind(body.max_attendees.as_ref().and_then(|v| v.as_i64()).map(|n| n as i32))
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    if affected.rows_affected() == 0 {
        return Err(AppError::NotFound("Événement introuvable ou non autorisé".into()));
    }

    let ws_event = serde_json::json!({ "type": "SERVER_EVENT_UPDATE", "server_id": server_id, "event_id": event_id });
    state.broadcast_to_server_members(server_id, ws_event.to_string()).await;

    get_event(Extension(claims), Path((server_id, event_id)), State(state)).await
}

pub async fn delete_event(
    Extension(claims): Extension<Claims>,
    Path((server_id, event_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    ensure_member(&state, server_id, claims.sub).await?;

    let is_admin = crate::handlers::servers::require_permission(
        &state, claims.sub, server_id, Permissions::MANAGE_SERVER,
    ).await.is_ok();

    let deleted = if is_admin {
        sqlx::query(
            "DELETE FROM server_events WHERE id = $1 AND server_id = $2"
        )
        .bind(event_id)
        .bind(server_id)
        .execute(&state.db)
        .await?
    } else {
        sqlx::query(
            "DELETE FROM server_events WHERE id = $1 AND server_id = $2 AND creator_id = $3"
        )
        .bind(event_id)
        .bind(server_id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?
    };

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Événement introuvable ou non autorisé".into()));
    }

    let ws_event = serde_json::json!({ "type": "SERVER_EVENT_DELETE", "server_id": server_id, "event_id": event_id });
    state.broadcast_to_server_members(server_id, ws_event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct AttendEvent {
    pub status: String,
}

pub async fn attend_event(
    Extension(claims): Extension<Claims>,
    Path(event_id): Path<Uuid>,
    State(state): State<AppState>,
    Json(body): Json<AttendEvent>,
) -> Result<Json<serde_json::Value>> {
    if !["interested", "going", "not_going"].contains(&body.status.as_str()) {
        return Err(AppError::BadRequest("status invalide".into()));
    }

    // Vérifier que l'event existe et que l'user est membre du serveur
    let server_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT server_id FROM server_events WHERE id = $1"
    )
    .bind(event_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Événement introuvable".into()))?;

    ensure_member(&state, server_id, claims.sub).await?;

    // Vérifier la limite max_attendees pour le statut "going"
    if body.status == "going" {
        let at_limit: bool = sqlx::query_scalar(
            "SELECT COALESCE(max_attendees, 2147483647) <= (
               SELECT COUNT(*) FROM event_attendees
               WHERE event_id=$1 AND status='going'
               AND user_id != $2
             )
             FROM server_events WHERE id=$1"
        )
        .bind(event_id)
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

        if at_limit {
            return Err(AppError::BadRequest("Événement complet".into()));
        }
    }

    sqlx::query(
        "INSERT INTO event_attendees (event_id, user_id, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status"
    )
    .bind(event_id)
    .bind(claims.sub)
    .bind(&body.status)
    .execute(&state.db)
    .await?;

    let ws_event = serde_json::json!({ "type": "EVENT_RSVP_UPDATE", "event_id": event_id, "user_id": claims.sub, "status": body.status });
    state.broadcast_to_server_members(server_id, ws_event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true, "status": body.status })))
}
