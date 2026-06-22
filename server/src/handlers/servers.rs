use axum::{
    extract::{Multipart, Path, Query, State},
    Extension, Json,
};
use rand::Rng;
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    models::server::{CreateServerRequest, Server, ServerMember, UpdateServerRequest},
    state::AppState,
};

pub async fn create_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateServerRequest>,
) -> Result<Json<Server>> {
    if body.name.len() < 2 || body.name.len() > 100 {
        return Err(AppError::BadRequest("Nom serveur 2-100 chars".into()));
    }

    let invite_code = generate_invite_code();

    let server = sqlx::query_as::<_, Server>(
        "INSERT INTO servers (name, description, owner_id, invite_code, is_public)
         VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(&body.name)
    .bind(&body.description)
    .bind(claims.sub)
    .bind(&invite_code)
    .bind(body.is_public.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    // Créer le rôle @everyone
    sqlx::query(
        "INSERT INTO roles (server_id, name, permissions, position, is_everyone)
         VALUES ($1, '@everyone', $2, 0, true)"
    )
    .bind(server.id)
    .bind(
        crate::models::role::Permissions::VIEW_CHANNEL
            | crate::models::role::Permissions::SEND_MESSAGES
            | crate::models::role::Permissions::READ_HISTORY
            | crate::models::role::Permissions::ADD_REACTIONS
            | crate::models::role::Permissions::ATTACH_FILES,
    )
    .execute(&state.db)
    .await?;

    // Ajouter le créateur comme membre owner
    sqlx::query(
        "INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, true)"
    )
    .bind(claims.sub)
    .bind(server.id)
    .execute(&state.db)
    .await?;

    // Canal général par défaut
    sqlx::query(
        "INSERT INTO channels (server_id, name, type, position) VALUES ($1, 'général', 'text', 0)"
    )
    .bind(server.id)
    .execute(&state.db)
    .await?;

    Ok(Json(server))
}

pub async fn get_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))?;

    let channels = sqlx::query_as::<_, crate::models::channel::Channel>(
        "SELECT * FROM channels WHERE server_id=$1 ORDER BY position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let roles = sqlx::query_as::<_, crate::models::role::Role>(
        "SELECT * FROM roles WHERE server_id=$1 ORDER BY position DESC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    // Statut de vérification du membre courant
    let member = sqlx::query(
        "SELECT verified_at FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(claims.sub)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .map(|r| {
        use sqlx::Row;
        serde_json::json!({ "verified_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("verified_at") })
    });

    Ok(Json(serde_json::json!({
        "server": server,
        "channels": channels,
        "roles": roles,
        "member": member,
    })))
}

pub async fn update_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<UpdateServerRequest>,
) -> Result<Json<Server>> {
    require_owner(&state, claims.sub, server_id).await?;

    let server = sqlx::query_as::<_, Server>(
        "UPDATE servers SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            is_public = COALESCE($4, is_public),
            welcome_message = COALESCE($5, welcome_message),
            banner = COALESCE($6, banner)
         WHERE id=$1 RETURNING *"
    )
    .bind(server_id)
    .bind(body.name)
    .bind(body.description)
    .bind(body.is_public)
    .bind(body.welcome_message)
    .bind(body.banner)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(server))
}

pub async fn delete_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;
    sqlx::query("DELETE FROM servers WHERE id=$1")
        .bind(server_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_my_servers(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<Server>>> {
    let servers = sqlx::query_as::<_, Server>(
        "SELECT s.* FROM servers s
         JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = $1
         ORDER BY sm.joined_at ASC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(servers))
}

pub async fn join_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(code): Path<String>,
) -> Result<Json<Server>> {
    let invite = sqlx::query_as::<_, crate::models::server::Invite>(
        "SELECT * FROM invites WHERE code=$1"
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invitation invalide".into()))?;

    if let Some(exp) = invite.expires_at {
        if exp < chrono::Utc::now() {
            return Err(AppError::BadRequest("Invitation expirée".into()));
        }
    }
    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(AppError::BadRequest("Invitation épuisée".into()));
        }
    }

    // Vérifier que l'utilisateur n'est pas banni du serveur
    let is_banned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM bans WHERE user_id=$1 AND server_id=$2)"
    )
    .bind(claims.sub)
    .bind(invite.server_id)
    .fetch_one(&state.db)
    .await?;

    if is_banned {
        return Err(AppError::Forbidden);
    }

    let already = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE user_id=$1 AND server_id=$2)"
    )
    .bind(claims.sub)
    .bind(invite.server_id)
    .fetch_one(&state.db)
    .await?;

    if already {
        return Err(AppError::Conflict("Déjà membre".into()));
    }

    sqlx::query(
        "INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)"
    )
    .bind(claims.sub)
    .bind(invite.server_id)
    .execute(&state.db)
    .await?;

    sqlx::query("UPDATE servers SET member_count = member_count + 1 WHERE id=$1")
        .bind(invite.server_id)
        .execute(&state.db)
        .await?;

    sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code=$1")
        .bind(&code)
        .execute(&state.db)
        .await?;

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id=$1")
        .bind(invite.server_id)
        .fetch_one(&state.db)
        .await?;

    Ok(Json(server))
}

pub async fn leave_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let is_owner = sqlx::query_scalar::<_, bool>(
        "SELECT is_owner FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(claims.sub)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Membre introuvable".into()))?;

    if is_owner {
        return Err(AppError::BadRequest(
            "Le propriétaire ne peut pas quitter son serveur".into()
        ));
    }

    sqlx::query(
        "DELETE FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(claims.sub)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    sqlx::query("UPDATE servers SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1")
        .bind(server_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_members(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let members = sqlx::query(
        "SELECT sm.*, u.username, u.discriminator, u.avatar, u.status, u.custom_status
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id=$1
         ORDER BY u.username ASC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = members
        .iter()
        .map(|r| {
            use sqlx::Row;
            serde_json::json!({
                "user_id": r.get::<Uuid, _>("user_id"),
                "nickname": r.get::<Option<String>, _>("nickname"),
                "joined_at": r.get::<chrono::DateTime<chrono::Utc>, _>("joined_at"),
                "is_owner": r.get::<bool, _>("is_owner"),
                "username": r.get::<String, _>("username"),
                "discriminator": r.get::<String, _>("discriminator"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "status": r.get::<String, _>("status"),
                "custom_status": r.get::<Option<String>, _>("custom_status"),
            })
        })
        .collect();

    Ok(Json(result))
}

pub async fn kick_member(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(
        &state, claims.sub, server_id,
        crate::models::role::Permissions::KICK_MEMBERS,
    ).await?;

    if user_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de s'auto-kick".into()));
    }

    sqlx::query(
        "DELETE FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    sqlx::query("UPDATE servers SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1")
        .bind(server_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn ban_member(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    require_permission(
        &state, claims.sub, server_id,
        crate::models::role::Permissions::BAN_MEMBERS,
    ).await?;

    let reason = body["reason"].as_str().map(String::from);

    sqlx::query(
        "INSERT INTO bans (user_id, server_id, reason) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING"
    )
    .bind(user_id)
    .bind(server_id)
    .bind(reason)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "DELETE FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn upload_server_icon(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        let ct = field.content_type().unwrap_or("image/jpeg").to_string();
        if !ct.starts_with("image/") {
            return Err(AppError::BadRequest("Type de fichier non supporté".into()));
        }
        let ext = match ct.as_str() {
            "image/png" => "png", "image/gif" => "gif", "image/webp" => "webp", _ => "jpg",
        };
        let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
        if data.len() > 8 * 1024 * 1024 {
            return Err(AppError::BadRequest("Fichier trop grand (max 8 MB)".into()));
        }
        let filename = format!("server-icons/{}.{}", Uuid::new_v4(), ext);
        let path = std::path::Path::new(&state.config.upload_dir).join(&filename);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| AppError::Internal(e.into()))?;
        }
        tokio::fs::write(&path, &data).await.map_err(|e| AppError::Internal(e.into()))?;
        let icon_url = format!("/uploads/{}", filename);
        sqlx::query("UPDATE servers SET icon=$2 WHERE id=$1")
            .bind(server_id)
            .bind(&icon_url)
            .execute(&state.db)
            .await?;
        return Ok(Json(serde_json::json!({ "icon": icon_url })));
    }

    Err(AppError::BadRequest("Champ image manquant".into()))
}

pub async fn get_server_stats(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;

    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id=$1"
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    let online_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members sm
         JOIN users u ON u.id=sm.user_id
         WHERE sm.server_id=$1 AND u.last_seen > NOW() - INTERVAL '5 minutes'"
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    let message_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m
         JOIN channels c ON c.id=m.channel_id
         WHERE c.server_id=$1"
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    let channel_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM channels WHERE server_id=$1"
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "member_count": member_count,
        "online_count": online_count,
        "message_count": message_count,
        "channel_count": channel_count,
    })))
}

// --- Helpers ---

pub async fn require_member(
    state: &AppState, user_id: Uuid, server_id: Uuid,
) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE user_id=$1 AND server_id=$2)"
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    if !ok { Err(AppError::Forbidden) } else { Ok(()) }
}

pub async fn require_owner(
    state: &AppState, user_id: Uuid, server_id: Uuid,
) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE user_id=$1 AND server_id=$2 AND is_owner=true)"
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    if !ok { Err(AppError::Forbidden) } else { Ok(()) }
}

pub async fn require_permission(
    state: &AppState, user_id: Uuid, server_id: Uuid, perm: i64,
) -> Result<()> {
    // Owner a toutes les permissions
    let is_owner = sqlx::query_scalar::<_, bool>(
        "SELECT is_owner FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or(false);

    if is_owner { return Ok(()); }

    let perms = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT BIT_OR(r.permissions) FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
         WHERE mr.user_id=$1 AND mr.server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    // Check ADMINISTRATOR ou la permission spécifique
    if perms & crate::models::role::Permissions::ADMINISTRATOR != 0 || perms & perm != 0 {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

// ─── Verification Gate ──────────────────────────────────────

pub async fn verify_member(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    // Vérifie que le serveur a bien la vérification activée
    let verification_enabled = sqlx::query_scalar::<_, bool>(
        "SELECT verification_enabled FROM servers WHERE id=$1"
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or(false);

    if !verification_enabled {
        return Err(AppError::BadRequest("La vérification n'est pas activée sur ce serveur".into()));
    }

    sqlx::query(
        "UPDATE server_members SET verified_at=NOW() WHERE user_id=$1 AND server_id=$2"
    )
    .bind(claims.sub)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn update_server_verification(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Server>> {
    require_owner(&state, claims.sub, server_id).await?;

    let verification_enabled = body["verification_enabled"].as_bool();
    let verification_rules = body["verification_rules"].as_str();

    let server = sqlx::query_as::<_, Server>(
        "UPDATE servers SET
            verification_enabled = COALESCE($2, verification_enabled),
            verification_rules = COALESCE($3, verification_rules)
         WHERE id=$1 RETURNING *"
    )
    .bind(server_id)
    .bind(verification_enabled)
    .bind(verification_rules)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(server))
}

fn generate_invite_code() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(8)
        .map(char::from)
        .collect()
}

// ─── Server Discovery ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct DiscoverQuery {
    pub q: Option<String>,
    pub category: Option<String>,
    pub sort: Option<String>, // "popular" | "recent" | "active"
    pub page: Option<i64>,
}

/// GET /api/servers/discover — liste publique, pas d'auth requise
pub async fn discover_servers(
    State(state): State<AppState>,
    Query(params): Query<DiscoverQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * 20;
    let q = params.q.unwrap_or_default();
    let search = format!("%{}%", q);
    let sort = params.sort.as_deref().unwrap_or("popular");

    let order_clause = if sort == "recent" {
        "EXTRACT(EPOCH FROM created_at) DESC"
    } else {
        "member_count DESC"
    };

    let sql = format!(
        "SELECT id, name, description, icon, banner, member_count, is_public,
                invite_code, created_at
         FROM servers
         WHERE is_public = true
           AND ($1 = '' OR name ILIKE $2 OR description ILIKE $2)
         ORDER BY {order_clause}
         LIMIT 20 OFFSET $3"
    );

    let rows = sqlx::query(&sql)
        .bind(&q)
        .bind(&search)
        .bind(offset)
        .fetch_all(&state.db)
        .await
        .map_err(|e| AppError::Database(e))?;

    let result: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "id":           r.get::<uuid::Uuid, _>("id"),
        "name":         r.get::<String, _>("name"),
        "description":  r.get::<Option<String>, _>("description"),
        "icon":         r.get::<Option<String>, _>("icon"),
        "banner":       r.get::<Option<String>, _>("banner"),
        "member_count": r.get::<i32, _>("member_count"),
        "is_public":    r.get::<bool, _>("is_public"),
        "invite_code":  r.get::<Option<String>, _>("invite_code"),
        "online_count": 0,
        "tags":         [],
        "is_verified":  false,
    })).collect();

    Ok(Json(result))
}
