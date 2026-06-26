use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::audit::log_event,
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::{CreateRoleRequest, Permissions, Role, UpdateRoleRequest},
    state::AppState,
};

pub async fn get_roles(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Role>>> {
    use crate::handlers::servers::require_member;
    require_member(&state, claims.sub, server_id).await?;
    let roles = sqlx::query_as::<_, Role>(
        "SELECT * FROM roles WHERE server_id=$1 ORDER BY position DESC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(roles))
}

pub async fn create_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateRoleRequest>,
) -> Result<Json<Role>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    let name = body.name.trim().chars().take(100).collect::<String>();
    if name.is_empty() { return Err(AppError::BadRequest("Nom de rôle requis".into())); }

    const VALID_PERMS: i64 = 0x3FFFF; // bits 0-17 définis
    let perms = body.permissions.unwrap_or(0) & VALID_PERMS;

    let role = sqlx::query_as::<_, Role>(
        "INSERT INTO roles (server_id, name, color, permissions, mentionable, hoisted)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(server_id)
    .bind(&name)
    .bind(body.color.unwrap_or(0))
    .bind(perms)
    .bind(body.mentionable.unwrap_or(false))
    .bind(body.hoisted.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    log_event(
        &state, server_id, "ROLE_CREATE",
        Some(claims.sub), None,
        Some(role.id), Some(role.name.as_str()), None,
    ).await;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "ROLE_CREATE",
        "server_id": server_id,
        "role": { "id": role.id, "name": role.name, "color": role.color, "permissions": role.permissions, "hoisted": role.hoisted, "mentionable": role.mentionable }
    }).to_string()).await;

    Ok(Json(role))
}

pub async fn update_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRoleRequest>,
) -> Result<Json<Role>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    let name = body.name.as_deref().map(|n| n.trim().chars().take(100).collect::<String>());
    if let Some(ref n) = name {
        if n.is_empty() { return Err(AppError::BadRequest("Nom de rôle invalide".into())); }
    }

    const VALID_PERMS: i64 = 0x3FFFF;
    let perms = body.permissions.map(|p| p & VALID_PERMS);

    let role = sqlx::query_as::<_, Role>(
        "UPDATE roles SET
            name = COALESCE($2, name),
            color = COALESCE($3, color),
            permissions = COALESCE($4, permissions),
            mentionable = COALESCE($5, mentionable),
            hoisted = COALESCE($6, hoisted),
            position = COALESCE($7, position)
         WHERE id=$1 AND server_id=$8 RETURNING *"
    )
    .bind(role_id)
    .bind(name)
    .bind(body.color)
    .bind(perms)
    .bind(body.mentionable)
    .bind(body.hoisted)
    .bind(body.position)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    log_event(
        &state, server_id, "ROLE_UPDATE",
        Some(claims.sub), None,
        Some(role.id), Some(role.name.as_str()), None,
    ).await;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "ROLE_UPDATE",
        "server_id": server_id,
        "role": { "id": role.id, "name": role.name, "color": role.color, "permissions": role.permissions, "hoisted": role.hoisted, "mentionable": role.mentionable, "position": role.position }
    }).to_string()).await;

    Ok(Json(role))
}

pub async fn delete_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    sqlx::query("DELETE FROM roles WHERE id=$1 AND server_id=$2 AND is_everyone=false")
        .bind(role_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;

    log_event(
        &state, server_id, "ROLE_DELETE",
        Some(claims.sub), None,
        Some(role_id), None, None,
    ).await;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "ROLE_DELETE",
        "server_id": server_id,
        "role_id": role_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn assign_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    // Vérifier que la cible est membre du serveur (IDOR fix)
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_member {
        return Err(AppError::NotFound("Membre introuvable".into()));
    }

    // Vérifier que le rôle appartient bien à ce serveur
    let role_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM roles WHERE id=$1 AND server_id=$2)"
    ).bind(role_id).bind(server_id).fetch_one(&state.db).await?;
    if !role_ok { return Err(AppError::NotFound("Rôle introuvable".into())); }

    // Limiter à 20 rôles par membre
    let role_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM member_roles WHERE user_id=$1 AND server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;
    if role_count >= 20 {
        return Err(AppError::BadRequest("Maximum 20 rôles par membre".into()));
    }

    sqlx::query(
        "INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING"
    )
    .bind(user_id)
    .bind(server_id)
    .bind(role_id)
    .execute(&state.db)
    .await?;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_ROLE_UPDATE",
        "server_id": server_id,
        "user_id": user_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    sqlx::query(
        "DELETE FROM member_roles WHERE user_id=$1 AND server_id=$2 AND role_id=$3"
    )
    .bind(user_id)
    .bind(server_id)
    .bind(role_id)
    .execute(&state.db)
    .await?;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_ROLE_UPDATE",
        "server_id": server_id,
        "user_id": user_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}
