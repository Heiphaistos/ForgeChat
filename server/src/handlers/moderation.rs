use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async fn ensure_moderator(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<()> {
    let is_mod = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
           SELECT 1 FROM server_members sm
           LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
           LEFT JOIN roles r ON r.id = mr.role_id
           WHERE sm.server_id = $1 AND sm.user_id = $2
           AND (sm.user_id = (SELECT owner_id FROM servers WHERE id = $1)
                OR (r.permissions & 8) <> 0
                OR (r.permissions & 2147483648) <> 0)
         )"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    if !is_mod {
        return Err(AppError::Forbidden);
    }
    Ok(())
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

// ─── Mod Notes ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ModNote {
    pub id: Uuid,
    pub server_id: Uuid,
    pub target_user_id: Uuid,
    pub moderator_id: Uuid,
    pub note: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn get_mod_notes(
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ModNote>>> {
    ensure_moderator(&state, server_id, claims.sub).await?;

    let notes = sqlx::query_as::<_, ModNote>(
        "SELECT id, server_id, target_user_id, moderator_id, note, created_at
         FROM mod_notes WHERE server_id = $1 AND target_user_id = $2
         ORDER BY created_at DESC"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(notes))
}

#[derive(Debug, Deserialize)]
pub struct CreateModNote {
    pub note: String,
}

pub async fn create_mod_note(
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    Json(body): Json<CreateModNote>,
) -> Result<Json<ModNote>> {
    ensure_moderator(&state, server_id, claims.sub).await?;

    if body.note.trim().is_empty() {
        return Err(AppError::BadRequest("Note vide".into()));
    }
    if body.note.len() > 2000 {
        return Err(AppError::BadRequest("Note trop longue (max 2000 caractères)".into()));
    }

    let note = sqlx::query_as::<_, ModNote>(
        "INSERT INTO mod_notes (server_id, target_user_id, moderator_id, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id, server_id, target_user_id, moderator_id, note, created_at"
    )
    .bind(server_id)
    .bind(user_id)
    .bind(claims.sub)
    .bind(body.note.trim())
    .fetch_one(&state.db)
    .await?;

    Ok(Json(note))
}

pub async fn delete_mod_note(
    Extension(claims): Extension<Claims>,
    Path((server_id, note_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    ensure_moderator(&state, server_id, claims.sub).await?;

    let deleted = sqlx::query(
        "DELETE FROM mod_notes WHERE id = $1 AND server_id = $2"
    )
    .bind(note_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Note introuvable".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Timeouts ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserTimeout {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub moderator_id: Uuid,
    pub reason: Option<String>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTimeout {
    pub duration_minutes: i32,
    pub reason: Option<String>,
}

pub async fn create_timeout(
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    Json(body): Json<CreateTimeout>,
) -> Result<Json<UserTimeout>> {
    ensure_moderator(&state, server_id, claims.sub).await?;

    if body.duration_minutes < 1 {
        return Err(AppError::BadRequest("Durée minimale : 1 minute".into()));
    }
    if body.duration_minutes > 10080 {
        return Err(AppError::BadRequest("Durée maximale : 7 jours (10080 minutes)".into()));
    }

    // Vérifier qu'on ne timeout pas le propriétaire du serveur
    let is_owner = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    if is_owner {
        return Err(AppError::Forbidden);
    }

    let timeout = sqlx::query_as::<_, UserTimeout>(
        "INSERT INTO user_timeouts (server_id, user_id, moderator_id, reason, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + $5::INTERVAL)
         ON CONFLICT (server_id, user_id) DO UPDATE SET
           moderator_id = EXCLUDED.moderator_id,
           reason = EXCLUDED.reason,
           expires_at = EXCLUDED.expires_at,
           created_at = NOW()
         RETURNING id, server_id, user_id, moderator_id, reason, expires_at, created_at"
    )
    .bind(server_id)
    .bind(user_id)
    .bind(claims.sub)
    .bind(body.reason.as_deref())
    .bind(format!("{} minutes", body.duration_minutes))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(timeout))
}

pub async fn remove_timeout(
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    ensure_moderator(&state, server_id, claims.sub).await?;

    sqlx::query(
        "DELETE FROM user_timeouts WHERE server_id = $1 AND user_id = $2"
    )
    .bind(server_id)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Channel Tasks ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ChannelTask {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub completed: bool,
    pub assignee_id: Option<Uuid>,
    pub due_date: Option<chrono::DateTime<chrono::Utc>>,
    pub priority: String,
    pub creator_id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_channel_tasks(
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<Vec<ChannelTask>>> {
    // Vérifier que l'user est membre du serveur auquel appartient ce canal
    let server_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT server_id FROM channels WHERE id = $1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    ensure_member(&state, server_id, claims.sub).await?;

    let tasks = sqlx::query_as::<_, ChannelTask>(
        "SELECT id, channel_id, title, description, completed, assignee_id,
                due_date, priority, creator_id, created_at, updated_at
         FROM channel_tasks WHERE channel_id = $1
         ORDER BY priority DESC, due_date NULLS LAST, created_at"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tasks))
}

#[derive(Debug, Deserialize)]
pub struct CreateTask {
    pub title: String,
    pub description: Option<String>,
    pub assignee_id: Option<Uuid>,
    pub due_date: Option<chrono::DateTime<chrono::Utc>>,
    pub priority: Option<String>,
}

pub async fn create_task(
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    State(state): State<AppState>,
    Json(body): Json<CreateTask>,
) -> Result<Json<ChannelTask>> {
    if body.title.trim().is_empty() {
        return Err(AppError::BadRequest("Titre requis".into()));
    }

    let server_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT server_id FROM channels WHERE id = $1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    ensure_member(&state, server_id, claims.sub).await?;

    let priority = body.priority.as_deref().unwrap_or("normal");
    if !["low", "normal", "high", "urgent"].contains(&priority) {
        return Err(AppError::BadRequest("priority invalide".into()));
    }

    let task = sqlx::query_as::<_, ChannelTask>(
        "INSERT INTO channel_tasks (channel_id, title, description, assignee_id, due_date, priority, creator_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, channel_id, title, description, completed, assignee_id,
                   due_date, priority, creator_id, created_at, updated_at"
    )
    .bind(channel_id)
    .bind(body.title.trim())
    .bind(body.description.as_deref())
    .bind(body.assignee_id)
    .bind(body.due_date)
    .bind(priority)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(task))
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<serde_json::Value>,
    pub completed: Option<bool>,
    pub assignee_id: Option<serde_json::Value>,
    pub due_date: Option<serde_json::Value>,
    pub priority: Option<String>,
}

pub async fn update_task(
    Extension(claims): Extension<Claims>,
    Path((channel_id, task_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    Json(body): Json<UpdateTask>,
) -> Result<Json<ChannelTask>> {
    let server_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT server_id FROM channels WHERE id = $1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    ensure_member(&state, server_id, claims.sub).await?;

    if let Some(ref p) = body.priority {
        if !["low", "normal", "high", "urgent"].contains(&p.as_str()) {
            return Err(AppError::BadRequest("priority invalide".into()));
        }
    }

    let task = sqlx::query_as::<_, ChannelTask>(
        "UPDATE channel_tasks SET
           title = COALESCE($3, title),
           description = CASE WHEN $4::TEXT IS NOT NULL THEN $4::TEXT ELSE description END,
           completed = COALESCE($5, completed),
           assignee_id = CASE WHEN $6::UUID IS NOT NULL THEN $6::UUID ELSE assignee_id END,
           due_date = CASE WHEN $7::TIMESTAMPTZ IS NOT NULL THEN $7::TIMESTAMPTZ ELSE due_date END,
           priority = COALESCE($8, priority),
           updated_at = NOW()
         WHERE id = $1 AND channel_id = $2
         RETURNING id, channel_id, title, description, completed, assignee_id,
                   due_date, priority, creator_id, created_at, updated_at"
    )
    .bind(task_id)
    .bind(channel_id)
    .bind(body.title.as_deref())
    .bind(body.description.as_ref().and_then(|v| v.as_str()))
    .bind(body.completed)
    .bind(
        body.assignee_id.as_ref()
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<Uuid>().ok())
    )
    .bind(
        body.due_date.as_ref()
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok())
    )
    .bind(body.priority.as_deref())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Tâche introuvable".into()))?;

    Ok(Json(task))
}

pub async fn delete_task(
    Extension(claims): Extension<Claims>,
    Path((channel_id, task_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    let server_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT server_id FROM channels WHERE id = $1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    ensure_member(&state, server_id, claims.sub).await?;

    // Créateur ou modérateur peut supprimer
    let deleted = sqlx::query(
        "DELETE FROM channel_tasks WHERE id = $1 AND channel_id = $2
         AND (creator_id = $3
              OR $3 IN (SELECT owner_id FROM servers WHERE id = $4))"
    )
    .bind(task_id)
    .bind(channel_id)
    .bind(claims.sub)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound("Tâche introuvable ou non autorisé".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
