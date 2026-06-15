use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{
    error::Result,
    handlers::servers::{require_permission},
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

    let role = sqlx::query_as::<_, Role>(
        "INSERT INTO roles (server_id, name, color, permissions, mentionable, hoisted)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(server_id)
    .bind(&body.name)
    .bind(body.color.unwrap_or(0))
    .bind(body.permissions.unwrap_or(0))
    .bind(body.mentionable.unwrap_or(false))
    .bind(body.hoisted.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(role))
}

pub async fn update_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateRoleRequest>,
) -> Result<Json<Role>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

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
    .bind(body.name)
    .bind(body.color)
    .bind(body.permissions)
    .bind(body.mentionable)
    .bind(body.hoisted)
    .bind(body.position)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

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

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn assign_role(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    sqlx::query(
        "INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING"
    )
    .bind(user_id)
    .bind(server_id)
    .bind(role_id)
    .execute(&state.db)
    .await?;

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

    Ok(Json(serde_json::json!({ "ok": true })))
}
