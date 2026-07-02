use axum::{
    extract::{Multipart, Path, Query, State},
    Extension, Json,
};
use rand::Rng;
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::audit::log_event,
    middleware::auth::Claims,
    models::server::{CreateServerRequest, Server, UpdateServerRequest},
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

    // Limiter à 100 serveurs possédés par utilisateur (anti-spam)
    let owned_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM servers WHERE owner_id=$1"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if owned_count >= 100 {
        return Err(AppError::BadRequest("Limite de 100 serveurs atteinte".into()));
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

    use sqlx::Row;

    // Paralléliser les 5 queries indépendantes
    let (server_opt, channels, hidden_rows, roles, member_row, my_role_ids) = tokio::try_join!(
        sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id=$1")
            .bind(server_id)
            .fetch_optional(&state.db),
        sqlx::query_as::<_, crate::models::channel::Channel>(
            "SELECT * FROM channels WHERE server_id=$1 ORDER BY position"
        )
        .bind(server_id)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT channel_id FROM hidden_channels WHERE user_id=$1 \
             AND channel_id IN (SELECT id FROM channels WHERE server_id=$2)"
        )
        .bind(claims.sub)
        .bind(server_id)
        .fetch_all(&state.db),
        sqlx::query_as::<_, crate::models::role::Role>(
            "SELECT * FROM roles WHERE server_id=$1 ORDER BY position DESC"
        )
        .bind(server_id)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT verified_at FROM server_members WHERE user_id=$1 AND server_id=$2"
        )
        .bind(claims.sub)
        .bind(server_id)
        .fetch_optional(&state.db),
        sqlx::query_scalar::<_, Uuid>(
            "SELECT role_id FROM member_roles WHERE user_id=$1 AND server_id=$2"
        )
        .bind(claims.sub)
        .bind(server_id)
        .fetch_all(&state.db),
    )?;

    let server = server_opt.ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))?;

    let hidden_ids: std::collections::HashSet<Uuid> = hidden_rows
        .iter()
        .map(|r| r.get::<Uuid, _>("channel_id"))
        .collect();

    let channels_json: Vec<serde_json::Value> = channels.iter().map(|c| {
        let mut v = serde_json::to_value(c).unwrap_or_default();
        if let serde_json::Value::Object(ref mut m) = v {
            m.insert("hidden".to_string(), serde_json::json!(hidden_ids.contains(&c.id)));
        }
        v
    }).collect();

    let member = member_row.map(|r| {
        serde_json::json!({ "verified_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("verified_at") })
    });

    Ok(Json(serde_json::json!({
        "server": server,
        "channels": channels_json,
        "roles": roles,
        "member": member,
        "current_user_id": claims.sub,
        "my_role_ids": my_role_ids,
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
            banner = COALESCE($6, banner),
            system_channel_id = COALESCE($7, system_channel_id),
            afk_channel_id = COALESCE($8, afk_channel_id),
            afk_timeout_minutes = COALESCE($9, afk_timeout_minutes),
            rules_channel_id = COALESCE($10, rules_channel_id),
            vanity_url = COALESCE($11, vanity_url),
            content_filter = COALESCE($12, content_filter)
         WHERE id=$1 RETURNING *"
    )
    .bind(server_id)
    .bind(body.name)
    .bind(body.description)
    .bind(body.is_public)
    .bind(body.welcome_message)
    .bind(body.banner)
    .bind(body.system_channel_id)
    .bind(body.afk_channel_id)
    .bind(body.afk_timeout)
    .bind(body.rules_channel_id)
    .bind(body.vanity_url)
    .bind(body.content_filter)
    .fetch_one(&state.db)
    .await?;

    let event = serde_json::json!({ "type": "SERVER_UPDATE", "server_id": server_id, "server": server });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(server))
}

pub async fn delete_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;
    // Notifier tous les membres avant suppression
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "SERVER_DELETE",
        "server_id": server_id,
    }).to_string()).await;
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
    // Rate limit : 10 tentatives d'invitation / 10min par user (anti-énumération)
    {
        use redis::AsyncCommands;
        let key = format!("join_attempts:{}", claims.sub);
        let mut redis = state.redis.lock().await;
        let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
        let count = count.unwrap_or(0);
        if count >= 10 {
            return Err(AppError::TooManyRequests);
        }
        let _: () = redis.incr(&key, 1).await.unwrap_or(());
        if count == 0 {
            let _: () = redis.expire(&key, 600).await.unwrap_or(());
        }
    }
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

    // Informer les membres existants de l'arrivée du nouveau membre
    let user = sqlx::query_as::<_, crate::models::user::User>("SELECT * FROM users WHERE id=$1")
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?;
    if let Some(u) = user {
        state.broadcast_to_server_members(invite.server_id, serde_json::json!({
            "type": "MEMBER_JOIN",
            "server_id": invite.server_id,
            "user_id": claims.sub,
            "username": u.username,
            "avatar": u.avatar,
        }).to_string()).await;
    }

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

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_LEAVE",
        "server_id": server_id,
        "user_id": claims.sub,
    }).to_string()).await;

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

    let owner_id: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
    if user_id == owner_id {
        return Err(AppError::Forbidden);
    }

    let kick_result = sqlx::query(
        "DELETE FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if kick_result.rows_affected() > 0 {
        sqlx::query("UPDATE servers SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1")
            .bind(server_id)
            .execute(&state.db)
            .await?;
    }

    log_event(
        &state, server_id, "MEMBER_KICK",
        Some(claims.sub), None,
        Some(user_id), None, None,
    ).await;

    // Notifier l'utilisateur exclu + les membres du serveur
    state.broadcast_to_user(user_id, serde_json::json!({
        "type": "MEMBER_KICKED",
        "server_id": server_id,
    }).to_string()).await;
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_REMOVE",
        "server_id": server_id,
        "user_id": user_id,
    }).to_string()).await;

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

    if user_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de se bannir soi-même".into()));
    }

    let owner_id: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
    if user_id == owner_id {
        return Err(AppError::Forbidden);
    }

    let reason = body["reason"].as_str().map(String::from);
    let expires_at = body["duration_hours"].as_i64().map(|h| {
        chrono::Utc::now() + chrono::Duration::hours(h)
    });

    sqlx::query(
        "INSERT INTO bans (user_id, server_id, reason, expires_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, server_id) DO UPDATE SET reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at"
    )
    .bind(user_id)
    .bind(server_id)
    .bind(reason.clone())
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    let ban_del = sqlx::query(
        "DELETE FROM server_members WHERE user_id=$1 AND server_id=$2"
    )
    .bind(user_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if ban_del.rows_affected() > 0 {
        sqlx::query("UPDATE servers SET member_count = GREATEST(member_count - 1, 0) WHERE id=$1")
            .bind(server_id)
            .execute(&state.db)
            .await?;
    }

    log_event(
        &state, server_id, "MEMBER_BAN",
        Some(claims.sub), None,
        Some(user_id), None,
        Some(serde_json::json!({ "reason": reason })),
    ).await;

    state.broadcast_to_user(user_id, serde_json::json!({
        "type": "MEMBER_BANNED",
        "server_id": server_id,
    }).to_string()).await;
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_REMOVE",
        "server_id": server_id,
        "user_id": user_id,
    }).to_string()).await;

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
    // Admins (MANAGE_SERVER) peuvent voir les stats, pas seulement owner
    use crate::models::role::Permissions;
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    use sqlx::Row;

    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id=$1"
    ).bind(server_id).fetch_one(&state.db).await.unwrap_or(0);

    let online_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members sm
         JOIN users u ON u.id=sm.user_id
         WHERE sm.server_id=$1 AND u.last_seen > NOW() - INTERVAL '5 minutes'"
    ).bind(server_id).fetch_one(&state.db).await.unwrap_or(0);

    let message_count_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m
         JOIN channels c ON c.id=m.channel_id
         WHERE c.server_id=$1 AND m.created_at > NOW() - INTERVAL '1 day'"
    ).bind(server_id).fetch_one(&state.db).await.unwrap_or(0);

    let message_count_week: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m
         JOIN channels c ON c.id=m.channel_id
         WHERE c.server_id=$1 AND m.created_at > NOW() - INTERVAL '7 days'"
    ).bind(server_id).fetch_one(&state.db).await.unwrap_or(0);

    let new_members_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id=$1 AND joined_at > NOW() - INTERVAL '1 day'"
    ).bind(server_id).fetch_one(&state.db).await.unwrap_or(0);

    let new_members_week: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id=$1 AND joined_at > NOW() - INTERVAL '7 days'"
    ).bind(server_id).fetch_one(&state.db).await.unwrap_or(0);

    // Top 5 canaux par volume de messages (7 derniers jours)
    let top_rows = sqlx::query(
        "SELECT c.id, c.name, COUNT(m.id) AS messages
         FROM channels c
         LEFT JOIN messages m ON m.channel_id=c.id AND m.created_at > NOW() - INTERVAL '7 days'
         WHERE c.server_id=$1
         GROUP BY c.id, c.name
         ORDER BY messages DESC
         LIMIT 5"
    ).bind(server_id).fetch_all(&state.db).await.unwrap_or_default();

    let top_channels: Vec<serde_json::Value> = top_rows.iter().map(|r| serde_json::json!({
        "id":   r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "messages": r.get::<i64, _>("messages"),
    })).collect();

    // Activité par heure (aujourd'hui, 24 buckets)
    let hour_rows = sqlx::query(
        "SELECT EXTRACT(HOUR FROM m.created_at)::int AS hr, COUNT(*) AS cnt
         FROM messages m
         JOIN channels c ON c.id=m.channel_id
         WHERE c.server_id=$1 AND m.created_at > NOW() - INTERVAL '1 day'
         GROUP BY hr"
    ).bind(server_id).fetch_all(&state.db).await.unwrap_or_default();

    let mut active_hours = vec![0i64; 24];
    for r in &hour_rows {
        let hr: i32 = r.get("hr");
        let cnt: i64 = r.get("cnt");
        if (0..24).contains(&hr) { active_hours[hr as usize] = cnt; }
    }

    Ok(Json(serde_json::json!({
        "member_count": member_count,
        "online_count": online_count,
        "message_count_today": message_count_today,
        "message_count_week": message_count_week,
        "new_members_today": new_members_today,
        "new_members_week": new_members_week,
        "top_channels": top_channels,
        "active_hours": active_hours,
    })))
}

pub async fn get_leaderboard(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let period = params.get("period").map(|s| s.as_str()).unwrap_or("month");
    let since = match period {
        "week" => "NOW() - INTERVAL '7 days'",
        "month" => "NOW() - INTERVAL '30 days'",
        _ => "'1970-01-01'",
    };

    let rows = sqlx::query(&format!(
        "SELECT u.id, u.username, u.avatar, \
         COUNT(m.id) as message_count, \
         COUNT(DISTINCT DATE(m.created_at)) as active_days \
         FROM messages m \
         JOIN users u ON u.id = m.user_id \
         JOIN channels c ON c.id = m.channel_id \
         WHERE c.server_id = $1 AND m.created_at > {} \
         GROUP BY u.id, u.username, u.avatar \
         ORDER BY message_count DESC LIMIT 20",
        since
    ))
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    Ok(Json(rows.iter().map(|r| serde_json::json!({
        "user_id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "messages": r.get::<i64, _>("message_count"),
        "active_days": r.get::<i64, _>("active_days"),
    })).collect::<Vec<_>>()))
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

/// Vérifie qu'un canal appartient bien au serveur (protection IDOR).
pub async fn require_channel_in_server(
    state: &AppState, channel_id: Uuid, server_id: Uuid,
) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1 AND server_id=$2)"
    )
    .bind(channel_id)
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
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT sm.is_owner,
                COALESCE(BIT_OR(r.permissions), 0)
                | COALESCE((SELECT permissions FROM roles WHERE server_id=$2 AND is_everyone=true), 0)
                AS combined_perms
         FROM server_members sm
         LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
         LEFT JOIN roles r ON r.id = mr.role_id
         WHERE sm.user_id = $1 AND sm.server_id = $2
         GROUP BY sm.is_owner"
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;

    match row {
        None => Err(AppError::Forbidden),
        Some(r) => {
            if r.get::<bool, _>("is_owner") { return Ok(()); }
            let perms: i64 = r.get("combined_perms");
            if perms & crate::models::role::Permissions::ADMINISTRATOR != 0 || perms & perm != 0 {
                Ok(())
            } else {
                Err(AppError::Forbidden)
            }
        }
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

pub async fn get_admin_stats(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    // Seuls les owners d'au moins un serveur ont accès
    let is_owner = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM servers WHERE owner_id=$1)"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !is_owner {
        return Err(AppError::Forbidden);
    }

    // Stats restreintes aux serveurs du propriétaire
    let total_members: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(member_count), 0) FROM servers WHERE owner_id=$1"
    ).bind(claims.sub).fetch_one(&state.db).await?;

    let total_messages: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m
         JOIN channels c ON c.id = m.channel_id
         JOIN servers s ON s.id = c.server_id
         WHERE s.owner_id=$1"
    ).bind(claims.sub).fetch_one(&state.db).await?;

    let messages_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM messages m
         JOIN channels c ON c.id = m.channel_id
         JOIN servers s ON s.id = c.server_id
         WHERE s.owner_id=$1 AND m.created_at > CURRENT_DATE"
    ).bind(claims.sub).fetch_one(&state.db).await?;

    let total_servers: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM servers WHERE owner_id=$1"
    ).bind(claims.sub).fetch_one(&state.db).await?;

    let total_channels: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM channels c JOIN servers s ON s.id = c.server_id WHERE s.owner_id=$1"
    ).bind(claims.sub).fetch_one(&state.db).await?;

    let top_servers = sqlx::query(
        "SELECT s.name, COUNT(m.id) as msg_count
         FROM servers s
         JOIN channels c ON c.server_id = s.id
         JOIN messages m ON m.channel_id = c.id
         WHERE s.owner_id=$1 AND m.created_at > NOW() - INTERVAL '7 days'
         GROUP BY s.id, s.name ORDER BY msg_count DESC LIMIT 10"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let messages_per_day = sqlx::query(
        "SELECT DATE(m.created_at) as day, COUNT(*) as count
         FROM messages m
         JOIN channels c ON c.id = m.channel_id
         JOIN servers s ON s.id = c.server_id
         WHERE s.owner_id=$1 AND m.created_at > NOW() - INTERVAL '7 days'
         GROUP BY DATE(m.created_at) ORDER BY day ASC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "total_members": total_members,
        "total_messages": total_messages,
        "messages_today": messages_today,
        "total_servers": total_servers,
        "total_channels": total_channels,
        "top_servers": top_servers.iter().map(|r| serde_json::json!({
            "name": r.get::<String, _>("name"),
            "messages": r.get::<i64, _>("msg_count"),
        })).collect::<Vec<_>>(),
        "messages_per_day": messages_per_day.iter().map(|r| serde_json::json!({
            "day": r.get::<chrono::NaiveDate, _>("day").to_string(),
            "count": r.get::<i64, _>("count"),
        })).collect::<Vec<_>>(),
    })))
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
    #[allow(dead_code)]
    pub category: Option<String>,
    pub sort: Option<String>, // "popular" | "recent" | "active"
    pub page: Option<i64>,
}

/// GET /api/servers/discover — liste publique, pas d'auth requise
/// POST /api/servers/:id/boost — boost cosmétique par membre (une fois par serveur)
pub async fn boost_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    // INSERT ON CONFLICT DO NOTHING — un boost par user×serveur
    sqlx::query(
        "INSERT INTO server_boosts (user_id, server_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING"
    )
    .bind(claims.sub)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    // Mise à jour atomique boost_count pour éviter la race condition COUNT → UPDATE
    use sqlx::Row as _;
    let boost_row = sqlx::query(
        "UPDATE servers
         SET boost_count = (SELECT COUNT(*) FROM server_boosts WHERE server_id=$1),
             boost_level = CASE
               WHEN (SELECT COUNT(*) FROM server_boosts WHERE server_id=$1) <= 1 THEN 0
               WHEN (SELECT COUNT(*) FROM server_boosts WHERE server_id=$1) <= 6 THEN 1
               WHEN (SELECT COUNT(*) FROM server_boosts WHERE server_id=$1) <= 13 THEN 2
               ELSE 3
             END
         WHERE id=$1
         RETURNING boost_count, boost_level"
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    let boost_count: i32 = boost_row.get("boost_count");
    let boost_level: i32 = boost_row.get("boost_level");

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "SERVER_BOOST",
        "server_id": server_id,
        "user_id": claims.sub,
        "boost_count": boost_count as i64,
        "boost_level": boost_level,
    }).to_string()).await;

    Ok(Json(serde_json::json!({
        "boost_count": boost_count,
        "boost_level": boost_level,
    })))
}

pub async fn discover_servers(
    State(state): State<AppState>,
    Query(params): Query<DiscoverQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * 20;
    let q = params.q.unwrap_or_default();
    let q_esc = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let search = format!("%{}%", q_esc);
    let sort = params.sort.as_deref().unwrap_or("popular");

    let order_clause = if sort == "recent" {
        "EXTRACT(EPOCH FROM created_at) DESC"
    } else {
        "member_count DESC"
    };

    let sql = format!(
        "SELECT s.id, s.name, s.description, s.icon, s.banner, s.member_count, s.is_public,
                s.created_at, s.invite_code
         FROM servers s
         WHERE s.is_public = true
           AND ($1 = '' OR s.name ILIKE $2 OR s.description ILIKE $2)
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
        "tags":         serde_json::Value::Array(vec![]),
        "online_count": 0,
        "is_verified":  false,
    })).collect();

    Ok(Json(result))
}
