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

/// Liste les membres ayant ce rôle. Route jamais enregistrée dans main.rs à l'origine --
/// le frontend (RoleMembersTab) l'appelait déjà et absorbait silencieusement le 404 avec
/// un `.catch(() => [])`, affichant en permanence "Aucun membre avec ce rôle." même quand
/// des membres l'avaient réellement.
pub async fn get_role_members(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use crate::handlers::servers::require_member;
    require_member(&state, claims.sub, server_id).await?;

    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT u.id, u.username, u.discriminator, u.avatar, sm.nickname
         FROM member_roles mr
         JOIN server_members sm ON sm.user_id = mr.user_id AND sm.server_id = mr.server_id
         JOIN users u ON u.id = mr.user_id
         WHERE mr.server_id = $1 AND mr.role_id = $2
         ORDER BY u.username"
    )
    .bind(server_id)
    .bind(role_id)
    .fetch_all(&state.db)
    .await?;

    let members = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "nick": r.get::<Option<String>, _>("nickname"),
    })).collect();

    Ok(Json(members))
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

    // Élévation de privilège : MANAGE_ROLES seul permettait de créer un rôle avec
    // N'IMPORTE QUELLE permission du masque (BAN_MEMBERS, MANAGE_SERVER, KICK_MEMBERS...)
    // puis de se l'auto-assigner (assign_role, même garde à ajouter) -- un modérateur
    // n'ayant reçu QUE "Gérer les rôles" pouvait ainsi s'octroyer n'importe quel autre
    // pouvoir du serveur. Un rôle ne peut désormais accorder que des permissions que son
    // créateur possède déjà lui-même (owner/ADMINISTRATOR non concernés, cf. effective_permissions).
    let actor_perms = crate::handlers::servers::effective_permissions(&state, claims.sub, server_id).await?;
    if perms & !actor_perms != 0 {
        return Err(AppError::Forbidden);
    }

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

    // Même garde anti-élévation que create_role, mais relative aux bits DÉJÀ présents sur
    // le rôle (pas à zéro) : le client renvoie le masque complet à chaque édition (ex.
    // renommer un rôle réenvoie ses permissions inchangées), donc comparer au total
    // bloquerait toute édition mineure d'un rôle déjà élevé par quelqu'un qui n'a que
    // MANAGE_ROLES. Seuls les bits NOUVELLEMENT ajoutés doivent être dans les droits de
    // l'éditeur -- un rôle peut être rétréci librement, jamais élargi au-delà de ses
    // propres droits.
    if let Some(p) = perms {
        let old_perms: i64 = sqlx::query_scalar(
            "SELECT permissions FROM roles WHERE id=$1 AND server_id=$2"
        ).bind(role_id).bind(server_id).fetch_optional(&state.db).await?
            .ok_or_else(|| AppError::NotFound("Rôle introuvable".into()))?;
        let newly_added = p & !old_perms;
        let actor_perms = crate::handlers::servers::effective_permissions(&state, claims.sub, server_id).await?;
        if newly_added & !actor_perms != 0 {
            return Err(AppError::Forbidden);
        }
    }

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

    // Vérifier que le rôle appartient bien à ce serveur, et récupérer ses permissions
    let role_perms: Option<i64> = sqlx::query_scalar(
        "SELECT permissions FROM roles WHERE id=$1 AND server_id=$2"
    ).bind(role_id).bind(server_id).fetch_optional(&state.db).await?;
    let Some(role_perms) = role_perms else {
        return Err(AppError::NotFound("Rôle introuvable".into()));
    };

    // Élévation de privilège : create_role/update_role empêchent désormais qu'un rôle
    // dépasse les droits de son créateur, mais un rôle PLUS PUISSANT que l'acteur courant
    // peut déjà exister (créé par le owner, ex. "Modérateur" avec BAN_MEMBERS) --
    // n'importe quel détenteur de MANAGE_ROLES pouvait se l'auto-assigner (ou l'assigner
    // à un complice) sans jamais avoir été vetté pour ces droits. Même garde : on ne peut
    // assigner que des rôles qui n'accordent rien au-delà de ses propres permissions.
    let actor_perms = crate::handlers::servers::effective_permissions(&state, claims.sub, server_id).await?;
    if role_perms & !actor_perms != 0 {
        return Err(AppError::Forbidden);
    }

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
