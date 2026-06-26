use axum::{
    extract::{Path, State},
    Extension, Json,
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

use super::servers::require_member;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Ticket {
    pub id: Uuid,
    pub server_id: Uuid,
    pub category_id: Option<Uuid>,
    pub creator_id: Uuid,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub assigned_to: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct TicketCategory {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub emoji: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct CreateTicketInput {
    pub title: String,
    pub priority: Option<String>,
    pub category_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct UpdateTicketInput {
    pub status: Option<String>,
    pub priority: Option<String>,
    pub assigned_to: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct CreateCategoryInput {
    pub name: String,
    pub description: Option<String>,
    pub emoji: Option<String>,
}

pub async fn list_tickets(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Ticket>>> {
    require_member(&state, claims.sub, server_id).await?;
    let tickets = sqlx::query_as::<_, Ticket>(
        "SELECT * FROM tickets WHERE server_id = $1 ORDER BY created_at DESC LIMIT 100"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(tickets))
}

pub async fn create_ticket(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(input): Json<CreateTicketInput>,
) -> Result<Json<Ticket>> {
    require_member(&state, claims.sub, server_id).await?;

    if input.title.trim().is_empty() || input.title.len() > 200 {
        return Err(AppError::BadRequest("Titre invalide (1-200 caractères)".into()));
    }
    let priority = input.priority.as_deref().unwrap_or("medium");
    if !["low", "medium", "high", "urgent"].contains(&priority) {
        return Err(AppError::BadRequest("Priorité invalide".into()));
    }

    let ticket = sqlx::query_as::<_, Ticket>(
        "INSERT INTO tickets (server_id, category_id, creator_id, title, priority)
         VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(server_id)
    .bind(input.category_id)
    .bind(claims.sub)
    .bind(input.title.trim())
    .bind(priority)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(ticket))
}

pub async fn update_ticket(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, ticket_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<UpdateTicketInput>,
) -> Result<Json<Ticket>> {
    require_member(&state, claims.sub, server_id).await?;

    if let Some(ref s) = input.status {
        if !["open", "in_progress", "resolved", "closed"].contains(&s.as_str()) {
            return Err(AppError::BadRequest("Statut invalide".into()));
        }
    }
    if let Some(ref p) = input.priority {
        if !["low", "medium", "high", "urgent"].contains(&p.as_str()) {
            return Err(AppError::BadRequest("Priorité invalide".into()));
        }
    }

    let ticket = sqlx::query_as::<_, Ticket>(
        "UPDATE tickets SET
            status = COALESCE($3, status),
            priority = COALESCE($4, priority),
            assigned_to = COALESCE($5, assigned_to),
            updated_at = NOW()
         WHERE id = $1 AND server_id = $2
         RETURNING *"
    )
    .bind(ticket_id)
    .bind(server_id)
    .bind(input.status)
    .bind(input.priority)
    .bind(input.assigned_to)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Ticket introuvable".into()))?;
    Ok(Json(ticket))
}

pub async fn list_categories(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<TicketCategory>>> {
    require_member(&state, claims.sub, server_id).await?;
    let cats = sqlx::query_as::<_, TicketCategory>(
        "SELECT * FROM ticket_categories WHERE server_id = $1 ORDER BY name"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(cats))
}

pub async fn create_category(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(input): Json<CreateCategoryInput>,
) -> Result<(StatusCode, Json<TicketCategory>)> {
    require_member(&state, claims.sub, server_id).await?;
    if input.name.trim().is_empty() || input.name.len() > 100 {
        return Err(AppError::BadRequest("Nom invalide".into()));
    }
    let cat = sqlx::query_as::<_, TicketCategory>(
        "INSERT INTO ticket_categories (server_id, name, description, emoji)
         VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(server_id)
    .bind(input.name.trim())
    .bind(input.description)
    .bind(input.emoji.as_deref().unwrap_or("🎫"))
    .fetch_one(&state.db)
    .await?;
    Ok((StatusCode::CREATED, Json(cat)))
}
