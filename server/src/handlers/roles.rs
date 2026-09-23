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

    let perms = body.permissions.unwrap_or(0) & Permissions::ALL;

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

    // Comme Discord : un nouveau rôle arrive tout en bas, juste au-dessus de
    // @everyone (position 1) ; les autres montent d'un cran. Avant, tous les rôles
    // restaient en position 0 et aucune hiérarchie n'était possible.
    sqlx::query("UPDATE roles SET position = position + 1 WHERE server_id=$1 AND NOT is_everyone")
        .bind(server_id)
        .execute(&state.db)
        .await?;
    let role = sqlx::query_as::<_, Role>(
        "INSERT INTO roles (server_id, name, color, permissions, mentionable, hoisted, position)
         VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING *"
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

    // Hiérarchie : on ne touche qu'à un rôle situé sous son propre rôle le plus
    // haut, et on ne peut pas le hisser à son niveau ou au-dessus.
    crate::handlers::servers::require_role_below(&state, claims.sub, role_id, server_id).await?;
    if let Some(pos) = body.position {
        let is_owner: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id=$1 AND owner_id=$2)")
            .bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
        let top = crate::handlers::servers::top_role_position(&state, claims.sub, server_id).await?;
        if pos < 1 || (!is_owner && pos >= top) {
            return Err(AppError::BadRequest("Position de rôle hors de votre hiérarchie".into()));
        }
    }

    let perms = body.permissions.map(|p| p & Permissions::ALL);

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
    crate::handlers::servers::require_role_below(&state, claims.sub, role_id, server_id).await?;

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
    crate::handlers::servers::require_role_below(&state, claims.sub, role_id, server_id).await?;
    if user_id != claims.sub {
        crate::handlers::servers::require_outranks(&state, claims.sub, user_id, server_id).await?;
    }

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
    crate::handlers::servers::require_role_below(&state, claims.sub, role_id, server_id).await?;
    if user_id != claims.sub {
        crate::handlers::servers::require_outranks(&state, claims.sub, user_id, server_id).await?;
    }

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

/// PATCH /servers/:server_id/roles/order { role_ids: [haut → bas] }
/// Liste complète des rôles hors @everyone. Hors propriétaire, les rôles au niveau
/// du rôle le plus haut de l'acteur ou au-dessus doivent rester en tête : il ne
/// réordonne que ceux qui sont sous lui (ils gardent leur ordre relatif, même à égalité).
/// Positions renumérotées de façon contiguë, @everyone toujours en 0.
pub async fn reorder_roles(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;
    let ids: Vec<Uuid> = body["role_ids"]
        .as_array()
        .ok_or_else(|| AppError::BadRequest("role_ids requis".into()))?
        .iter()
        .filter_map(|v| v.as_str().and_then(|s| Uuid::parse_str(s).ok()))
        .collect();

    let current: Vec<(Uuid, i32)> = sqlx::query_as(
        "SELECT id, position FROM roles WHERE server_id=$1 AND NOT is_everyone",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    let mut sorted_ids = ids.clone();
    sorted_ids.sort();
    sorted_ids.dedup();
    let mut current_ids: Vec<Uuid> = current.iter().map(|(id, _)| *id).collect();
    current_ids.sort();
    if sorted_ids.len() != ids.len() || sorted_ids != current_ids {
        return Err(AppError::BadRequest("La liste doit contenir chaque rôle du serveur une fois".into()));
    }

    let is_owner: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id=$1 AND owner_id=$2)")
        .bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    let top = if is_owner { i32::MAX } else {
        crate::handlers::servers::top_role_position(&state, claims.sub, server_id).await?
    };
    // Rôles intouchables (>= rôle le plus haut de l'acteur) : ils doivent occuper la tête de liste.
    let locked: std::collections::HashMap<Uuid, i32> =
        current.iter().filter(|(_, p)| *p >= top).cloned().collect();
    if ids[..locked.len()].iter().any(|id| !locked.contains_key(id)) {
        return Err(AppError::BadRequest("Vous ne pouvez déplacer que des rôles sous votre rôle le plus haut".into()));
    }
    let movable = &ids[locked.len()..];
    let n = movable.len() as i32;
    // Rôles libres : n..1 dans l'ordre demandé. Rôles verrouillés : décalés en bloc
    // au-dessus, ce qui conserve exactement leur ordre et leurs égalités.
    let shift = locked.values().min().map(|m| n + 1 - m).unwrap_or(0);

    let mut tx = state.db.begin().await?;
    for (i, id) in movable.iter().enumerate() {
        sqlx::query("UPDATE roles SET position=$1 WHERE id=$2 AND server_id=$3")
            .bind(n - i as i32).bind(id).bind(server_id)
            .execute(&mut *tx).await?;
    }
    if shift != 0 {
        for (id, _) in &locked {
            sqlx::query("UPDATE roles SET position = position + $1 WHERE id=$2 AND server_id=$3")
                .bind(shift).bind(id).bind(server_id)
                .execute(&mut *tx).await?;
        }
    }
    sqlx::query("UPDATE roles SET position=0 WHERE server_id=$1 AND is_everyone")
        .bind(server_id).execute(&mut *tx).await?;
    tx.commit().await?;

    log_event(&state, server_id, "ROLE_UPDATE", Some(claims.sub), None, None, None,
        Some(serde_json::json!({ "reordered": true }))).await;
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "ROLE_UPDATE", "server_id": server_id, "reordered": true,
    }).to_string()).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /servers/:server_id/transfer { user_id, password }
/// Réservé au propriétaire, mot de passe exigé (comme Discord exige la 2FA) ;
/// la cible doit être un membre humain du serveur.
pub async fn transfer_ownership(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_owner(&state, claims.sub, server_id).await?;
    let target = body["user_id"].as_str().and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| AppError::BadRequest("user_id requis".into()))?;
    if target == claims.sub {
        return Err(AppError::BadRequest("Vous êtes déjà propriétaire".into()));
    }
    let password = body["password"].as_str().unwrap_or("");
    let pw_hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(claims.sub).fetch_one(&state.db).await?;
    if !bcrypt::verify(password, &pw_hash).unwrap_or(false) {
        return Err(AppError::BadRequest("Mot de passe incorrect".into()));
    }
    let target_name: Option<String> = sqlx::query_scalar(
        "SELECT u.username FROM server_members sm JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id=$1 AND sm.user_id=$2 AND NOT u.is_bot",
    )
    .bind(server_id).bind(target).fetch_optional(&state.db).await?;
    let target_name = target_name.ok_or_else(|| AppError::BadRequest("Ce membre ne peut pas recevoir le serveur".into()))?;

    let mut tx = state.db.begin().await?;
    // Garde sur owner_id : deux transferts concurrents ne peuvent pas réussir tous les deux.
    let moved = sqlx::query("UPDATE servers SET owner_id=$1 WHERE id=$2 AND owner_id=$3")
        .bind(target).bind(server_id).bind(claims.sub)
        .execute(&mut *tx).await?;
    if moved.rows_affected() != 1 {
        return Err(AppError::Forbidden);
    }
    sqlx::query("UPDATE server_members SET is_owner = (user_id = $1) WHERE server_id=$2 AND user_id IN ($1, $3)")
        .bind(target).bind(server_id).bind(claims.sub)
        .execute(&mut *tx).await?;
    tx.commit().await?;

    log_event(&state, server_id, "OWNER_TRANSFER", Some(claims.sub), None,
        Some(target), Some(target_name.as_str()), None).await;
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "SERVER_UPDATE", "server_id": server_id, "owner_id": target,
    }).to_string()).await;
    Ok(Json(serde_json::json!({ "ok": true, "owner_id": target })))
}
