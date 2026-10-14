//! Tickets de support. Avec les tickets natifs activés (092), ouvrir un ticket crée
//! un SALON PRIVÉ (le membre + les rôles d'équipe) : la conversation y est chiffrée
//! de bout en bout comme dans tout salon, la transcription est l'historique chiffré
//! du salon (exportée et déchiffrée par l'appli). Le serveur ne garde aucun texte
//! saisi : le titre stocké est « Ticket #N », le sujet est le premier message.

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

use super::servers::{require_member, require_permission};
use crate::models::role::Permissions;

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
    pub channel_id: Option<Uuid>,
    pub number: Option<i32>,
    pub closed_at: Option<DateTime<Utc>>,
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
    /// Ignoré (jamais stocké en clair) : gardé pour les anciennes applis.
    #[allow(dead_code)]
    pub title: Option<String>,
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

#[derive(Deserialize)]
pub struct TicketSettingsInput {
    pub enabled: bool,
    pub category_id: Option<Uuid>,
    pub staff_role_ids: Vec<Uuid>,
}

/// Droits d'un participant au salon d'un ticket.
const TALK: i64 = Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES | Permissions::READ_HISTORY
    | Permissions::ATTACH_FILES | Permissions::ADD_REACTIONS;
const READ: i64 = Permissions::VIEW_CHANNEL | Permissions::READ_HISTORY;

async fn settings(state: &AppState, server_id: Uuid) -> Result<(bool, Option<Uuid>, Vec<Uuid>)> {
    Ok(sqlx::query_as("SELECT enabled, category_id, staff_role_ids FROM ticket_settings WHERE server_id=$1")
        .bind(server_id).fetch_optional(&state.db).await?
        .unwrap_or((false, None, Vec::new())))
}

/// Gestionnaire (MANAGE_SERVER) ou membre d'un rôle d'équipe des tickets.
async fn is_ticket_staff(state: &AppState, user_id: Uuid, server_id: Uuid) -> Result<bool> {
    if require_permission(state, user_id, server_id, Permissions::MANAGE_SERVER).await.is_ok() {
        return Ok(true);
    }
    let (_, _, roles) = settings(state, server_id).await?;
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM member_roles WHERE user_id=$1 AND server_id=$2 AND role_id = ANY($3))")
        .bind(user_id).bind(server_id).bind(&roles).fetch_one(&state.db).await?)
}

/// GET /servers/:id/tickets/settings
pub async fn get_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let (enabled, category_id, staff_role_ids) = settings(&state, server_id).await?;
    let staff = is_ticket_staff(&state, claims.sub, server_id).await?;
    Ok(Json(serde_json::json!({
        "enabled": enabled, "category_id": category_id, "staff_role_ids": staff_role_ids, "is_staff": staff,
    })))
}

/// PUT /servers/:id/tickets/settings — MANAGE_SERVER.
pub async fn put_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(b): Json<TicketSettingsInput>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    if b.staff_role_ids.len() > 10 {
        return Err(AppError::BadRequest("10 rôles d'équipe au plus".into()));
    }
    let known: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE server_id=$1 AND NOT is_everyone AND id = ANY($2)")
        .bind(server_id).bind(&b.staff_role_ids).fetch_one(&state.db).await?;
    if known as usize != b.staff_role_ids.len() {
        return Err(AppError::BadRequest("Rôle d'équipe inconnu".into()));
    }
    if let Some(cat) = b.category_id {
        let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1 AND server_id=$2)")
            .bind(cat).bind(server_id).fetch_one(&state.db).await?;
        if !ok {
            return Err(AppError::BadRequest("Catégorie invalide pour ce serveur".into()));
        }
    }
    sqlx::query(
        "INSERT INTO ticket_settings (server_id, enabled, category_id, staff_role_ids) VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_id) DO UPDATE SET enabled=$2, category_id=$3, staff_role_ids=$4"
    ).bind(server_id).bind(b.enabled).bind(b.category_id).bind(&b.staff_role_ids).execute(&state.db).await?;
    crate::handlers::audit::log_event(&state, server_id, "TICKETS_UPDATE", Some(claims.sub), None, None, None).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list_tickets(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Ticket>>> {
    require_member(&state, claims.sub, server_id).await?;

    // Les tickets des AUTRES membres : gestionnaires et équipe des tickets seulement.
    let can_see_all = is_ticket_staff(&state, claims.sub, server_id).await?;
    let tickets = sqlx::query_as::<_, Ticket>(
        "SELECT * FROM tickets WHERE server_id = $1 AND ($2 OR creator_id = $3) ORDER BY created_at DESC LIMIT 100"
    )
    .bind(server_id)
    .bind(can_see_all)
    .bind(claims.sub)
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
    super::servers::require_not_timed_out(&state, claims.sub, server_id).await?;

    let priority = input.priority.as_deref().unwrap_or("medium");
    if !["low", "medium", "high", "urgent"].contains(&priority) {
        return Err(AppError::BadRequest("Priorité invalide".into()));
    }
    if let Some(cat_id) = input.category_id {
        let valid = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM ticket_categories WHERE id=$1 AND server_id=$2)"
        )
        .bind(cat_id)
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
        if !valid {
            return Err(AppError::BadRequest("Catégorie invalide".into()));
        }
    }
    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tickets WHERE server_id=$1 AND creator_id=$2 AND status NOT IN ('resolved', 'closed')"
    ).bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    if open >= 3 {
        return Err(AppError::BadRequest("3 tickets ouverts au plus : ferme un ticket d'abord".into()));
    }

    let (native, category, staff_roles) = settings(&state, server_id).await?;
    let mut tx = state.db.begin().await?;
    // Numéro séquentiel par serveur (verrou du serveur : deux ouvertures simultanées
    // n'obtiennent pas le même numéro).
    sqlx::query("SELECT id FROM servers WHERE id=$1 FOR UPDATE").bind(server_id).execute(&mut *tx).await?;
    let number: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(number), 0) + 1 FROM tickets WHERE server_id=$1")
        .bind(server_id).fetch_one(&mut *tx).await?;
    let channel_id: Option<Uuid> = if native {
        let ch: Uuid = sqlx::query_scalar(
            "INSERT INTO channels (server_id, category_id, name, type, topic, created_by)
             VALUES ($1, $2, $3, 'text', $4, $5) RETURNING id"
        ).bind(server_id).bind(category).bind(format!("ticket-{number:04}"))
        .bind(format!("Ticket #{number}")).bind(claims.sub).fetch_one(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
             SELECT $1, id, 'role', 0, $2 FROM roles WHERE server_id=$3 AND is_everyone"
        ).bind(ch).bind(Permissions::VIEW_CHANNEL).bind(server_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'member', $3, 0)")
            .bind(ch).bind(claims.sub).bind(TALK).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
             SELECT $1, unnest($2::uuid[]), 'role', $3, 0 ON CONFLICT DO NOTHING"
        ).bind(ch).bind(&staff_roles).bind(TALK).execute(&mut *tx).await?;
        Some(ch)
    } else {
        None
    };
    let ticket = sqlx::query_as::<_, Ticket>(
        "INSERT INTO tickets (server_id, category_id, creator_id, title, priority, number, channel_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *"
    )
    .bind(server_id)
    .bind(input.category_id)
    .bind(claims.sub)
    .bind(format!("Ticket #{number}"))
    .bind(priority)
    .bind(number)
    .bind(channel_id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    if let Some(ch) = channel_id {
        if let Ok(channel) = sqlx::query_as::<_, crate::models::channel::Channel>("SELECT * FROM channels WHERE id=$1")
            .bind(ch).fetch_one(&state.db).await
        {
            let ev = serde_json::json!({ "type": "CHANNEL_CREATE", "server_id": server_id, "channel": channel });
            state.broadcast_to_channel_members(ch, ev.to_string()).await;
        }
    }
    crate::handlers::audit::log_event(&state, server_id, "TICKET_OPEN", Some(claims.sub), Some(ticket.id), Some(&ticket.title), None).await;
    let event = serde_json::json!({ "type": "TICKET_CREATE", "server_id": server_id, "ticket": ticket });
    broadcast_ticket(&state, server_id, &event).await;

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

    // Seul le créateur ou l'équipe peut modifier un ticket ; assignation et priorité
    // sont du triage (équipe seulement), le créateur ne change que le statut du sien.
    let (creator_id, channel_id, old_status): (Uuid, Option<Uuid>, String) = sqlx::query_as(
        "SELECT creator_id, channel_id, status FROM tickets WHERE id=$1 AND server_id=$2"
    )
    .bind(ticket_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Ticket introuvable".into()))?;
    let staff = is_ticket_staff(&state, claims.sub, server_id).await?;
    if creator_id != claims.sub && !staff {
        return Err(AppError::Forbidden);
    }
    if !staff && (input.assigned_to.is_some() || input.priority.is_some()) {
        return Err(AppError::Forbidden);
    }

    if let Some(assignee) = input.assigned_to {
        let is_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)"
        )
        .bind(server_id)
        .bind(assignee)
        .fetch_one(&state.db)
        .await?;
        if !is_member {
            return Err(AppError::BadRequest("Assigné non membre du serveur".into()));
        }
    }

    let ticket = sqlx::query_as::<_, Ticket>(
        "UPDATE tickets SET
            status = COALESCE($3, status),
            priority = COALESCE($4, priority),
            assigned_to = COALESCE($5, assigned_to),
            closed_at = CASE WHEN COALESCE($3, status) IN ('resolved', 'closed') THEN COALESCE(closed_at, NOW()) ELSE NULL END,
            updated_at = NOW()
         WHERE id = $1 AND server_id = $2
         RETURNING *"
    )
    .bind(ticket_id)
    .bind(server_id)
    .bind(input.status.as_deref())
    .bind(input.priority)
    .bind(input.assigned_to)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Ticket introuvable".into()))?;

    // Fermeture : le salon reste lisible par le membre (transcription) mais il n'y
    // écrit plus ; réouverture : il y écrit de nouveau. L'assigné y est ajouté.
    if let Some(ch) = channel_id {
        let closed = |s: &str| s == "resolved" || s == "closed";
        let mut touched = false;
        if closed(&old_status) != closed(&ticket.status) {
            let (allow, deny) = if closed(&ticket.status) { (READ, TALK & !READ) } else { (TALK, 0) };
            sqlx::query(
                "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'member', $3, $4)
                 ON CONFLICT (channel_id, target_id) DO UPDATE SET allow=$3, deny=$4"
            ).bind(ch).bind(creator_id).bind(allow).bind(deny).execute(&state.db).await?;
            touched = true;
        }
        if let Some(assignee) = input.assigned_to.filter(|a| *a != creator_id) {
            sqlx::query(
                "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'member', $3, 0)
                 ON CONFLICT (channel_id, target_id) DO NOTHING"
            ).bind(ch).bind(assignee).bind(TALK).execute(&state.db).await?;
            touched = true;
        }
        if touched {
            crate::handlers::channels::notify_permission_change(&state, ch, server_id, vec![creator_id]).await;
        }
    }
    if input.status.as_deref().is_some_and(|s| s != old_status) {
        crate::handlers::audit::log_event(&state, server_id, "TICKET_STATUS", Some(claims.sub),
            Some(ticket.id), Some(&ticket.title), Some(serde_json::json!({ "status": ticket.status }))).await;
    }

    let event = serde_json::json!({ "type": "TICKET_UPDATE", "server_id": server_id, "ticket": ticket });
    broadcast_ticket(&state, server_id, &event).await;

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
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    if input.name.trim().is_empty() || input.name.len() > 100 {
        return Err(AppError::BadRequest("Nom invalide".into()));
    }
    if let Some(ref d) = input.description {
        if d.len() > 500 { return Err(AppError::BadRequest("Description trop longue (max 500)".into())); }
    }
    if let Some(ref e) = input.emoji {
        if e.chars().count() > 8 { return Err(AppError::BadRequest("Emoji invalide".into())); }
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
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "TICKET_CATEGORY_CREATE", "server_id": server_id, "category": cat
    }).to_string()).await;
    Ok((StatusCode::CREATED, Json(cat)))
}

/// Un ticket n'est visible que de son créateur, de la personne assignée, des
/// gestionnaires du serveur et de l'équipe des tickets.
async fn broadcast_ticket(state: &AppState, server_id: Uuid, event: &serde_json::Value) {
    let mut targets: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    for key in ["creator_id", "assigned_to"] {
        if let Some(id) = event["ticket"][key].as_str().and_then(|v| v.parse::<Uuid>().ok()) {
            targets.insert(id);
        }
    }
    let staff_roles = settings(state, server_id).await.map(|s| s.2).unwrap_or_default();
    let managers: Vec<Uuid> = sqlx::query_scalar(
        "SELECT sm.user_id FROM server_members sm
         LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
         LEFT JOIN roles r ON r.id = mr.role_id
         WHERE sm.server_id = $1
         GROUP BY sm.user_id, sm.is_owner
         HAVING sm.is_owner
             OR (COALESCE(BIT_OR(r.permissions), 0)
                 | COALESCE((SELECT permissions FROM roles WHERE server_id=$1 AND is_everyone), 0)) & $2 <> 0
             OR COALESCE(bool_or(mr.role_id = ANY($3)), FALSE)"
    )
    .bind(server_id)
    .bind(Permissions::MANAGE_SERVER | Permissions::ADMINISTRATOR)
    .bind(&staff_roles)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    targets.extend(managers);
    let text = event.to_string();
    for uid in targets {
        state.broadcast_to_user(uid, text.clone()).await;
    }
}
