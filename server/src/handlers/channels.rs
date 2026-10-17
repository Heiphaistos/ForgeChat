use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::audit::log_event,
    handlers::channel_access::{check_deletion, deletion_context, require_channel_manage, CAN_CREATE, CAN_EDIT},
    handlers::servers::{require_member, require_permission, require_member_and_channel},
    middleware::auth::Claims,
    models::{
        channel::{check_channel_fields, clean_name, Channel, CreateChannelRequest, UpdateChannelRequest, CreateCategoryRequest, Category, VOICE_PASSWORD_MAX_BYTES},
        role::Permissions,
    },
    state::AppState,
};

pub async fn get_channels(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    let rows = sqlx::query(
        "SELECT c.*,
               EXISTS(SELECT 1 FROM hidden_channels hc WHERE hc.channel_id = c.id AND hc.user_id = $2) as is_hidden
        FROM channels c WHERE c.server_id = $1 ORDER BY c.position"
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let forbidden = state.hidden_channels(claims.sub, Some(server_id), None).await?;
    let result = rows.iter().filter(|r| {
        use sqlx::Row;
        !forbidden.contains(&r.get::<Uuid, _>("id"))
    }).map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "server_id": r.get::<Option<Uuid>, _>("server_id"),
            "category_id": r.get::<Option<Uuid>, _>("category_id"),
            "name": r.get::<String, _>("name"),
            "type": r.get::<String, _>("type"),
            "topic": r.get::<Option<String>, _>("topic"),
            "position": r.get::<i32, _>("position"),
            "is_nsfw": r.get::<bool, _>("is_nsfw"),
            "slowmode_delay": r.get::<i32, _>("slowmode_delay"),
            "bitrate": r.get::<Option<i32>, _>("bitrate"),
            "user_limit": r.get::<Option<i32>, _>("user_limit"),
            "last_message_id": r.get::<Option<Uuid>, _>("last_message_id"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "has_voice_password": r.get::<Option<String>, _>("voice_password_hash").is_some(),
            "is_auto_create": r.get::<bool, _>("is_auto_create"),
            "auto_create_name": r.get::<Option<String>, _>("auto_create_name"),
            "is_temporary": r.get::<bool, _>("is_temporary"),
            "created_by_auto": r.get::<Option<Uuid>, _>("created_by_auto"),
            "archived": r.get::<bool, _>("archived"),
            "hidden": r.get::<bool, _>("is_hidden"),
            "default_sort": r.get::<String, _>("default_sort"),
            "require_tag": r.get::<bool, _>("require_tag"),
            "created_by": r.get::<Option<Uuid>, _>("created_by"),
            "waiting_room": r.try_get::<bool, _>("waiting_room").unwrap_or(false),
            "disappear_seconds": r.get::<Option<i32>, _>("disappear_seconds"),
            "auto_threads": r.get::<bool, _>("auto_threads"),
            "voice_status": r.get::<Option<String>, _>("voice_status"),
            "default_reaction_emoji": r.get::<Option<String>, _>("default_reaction_emoji"),
            "post_guidelines": r.get::<Option<String>, _>("post_guidelines"),
        })
    }).collect();

    Ok(Json(result))
}

/// Salons par serveur (Discord : 500).
const MAX_CHANNELS_PER_SERVER: i64 = 500;

pub async fn create_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<Channel>> {
    require_permission(&state, claims.sub, server_id, CAN_CREATE).await?;

    let bad = |e: &'static str| AppError::BadRequest(e.into());
    let name = clean_name(&body.name).map_err(bad)?;
    check_channel_fields(body.topic.as_deref(), body.slowmode_delay, body.user_limit)
        .map_err(bad)?;

    // IDOR : category_id n'était jamais vérifié comme appartenant à ce serveur --
    // reproduit en direct (compte+2 serveurs jetables) : un canal du serveur A
    // pouvait référencer une catégorie du serveur B, cross-tenant.
    if let Some(cat_id) = body.category_id {
        let cat_ok: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1 AND server_id=$2)"
        ).bind(cat_id).bind(server_id).fetch_one(&state.db).await?;
        if !cat_ok {
            return Err(AppError::BadRequest("Catégorie invalide pour ce serveur".into()));
        }
    }

    let channel_type = body.r#type.as_deref().unwrap_or("text");
    // Type connu seulement (avant : n'importe quelle chaîne, ou 500 au-delà de 16 caractères) ; plafond de salons.
    if !crate::handlers::templates::CHANNEL_TYPES.contains(&channel_type) {
        return Err(AppError::BadRequest("Type de salon invalide".into()));
    }
    let channels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id=$1")
        .bind(server_id).fetch_one(&state.db).await?;
    if channels >= MAX_CHANNELS_PER_SERVER {
        return Err(AppError::BadRequest(format!("Limite de {MAX_CHANNELS_PER_SERVER} salons par serveur atteinte")));
    }
    let staff_only: bool = match body.category_id {
        Some(cat) => sqlx::query_scalar("SELECT staff_only FROM categories WHERE id=$1")
            .bind(cat).fetch_one(&state.db).await?,
        None => false,
    };
    let channel = sqlx::query_as::<_, Channel>(
        "INSERT INTO channels (server_id, category_id, name, type, topic, is_nsfw, slowmode_delay, user_limit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *"
    )
    .bind(server_id)
    .bind(body.category_id)
    .bind(name)
    .bind(channel_type)
    .bind(&body.topic)
    .bind(body.is_nsfw.unwrap_or(false))
    .bind(body.slowmode_delay.unwrap_or(0))
    .bind(body.user_limit)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    // Catégorie réservée au staff : le salon naît invisible pour @everyone.
    if staff_only {
        sqlx::query(
            "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
             SELECT $1, id, 'role', 0, $2 FROM roles WHERE server_id=$3 AND is_everyone
             ON CONFLICT (channel_id, target_id) DO NOTHING"
        ).bind(channel.id).bind(Permissions::VIEW_CHANNEL).bind(server_id).execute(&state.db).await?;
    }
    // Salon créé dans une catégorie : hérite de ses surcharges (comme Discord).
    if let Some(cat) = body.category_id {
        crate::handlers::categories::inherit_category_overwrites(&state.db, channel.id, cat).await?;
    }

    let event = serde_json::json!({ "type": "CHANNEL_CREATE", "server_id": server_id, "channel": &channel });
    state.broadcast_to_channel_members(channel.id, event.to_string()).await;

    log_event(
        &state, server_id, "CHANNEL_CREATE",
        Some(claims.sub),
        Some(channel.id), Some(channel.name.as_str()), None,
    ).await;

    Ok(Json(channel))
}

pub async fn update_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<Json<Channel>> {
    // P3-3 — le créateur d'un salon temporaire (« rejoindre pour créer ») peut
    // le renommer, fixer sa limite de places et le verrouiller par mot de
    // passe, comme un salon temporaire TeamSpeak. Rien d'autre sans droit de modification.
    let mut temp_owner_only = false;
    if let Err(e) = require_permission(&state, claims.sub, server_id, CAN_EDIT).await {
        let owner_fields_only = body.topic.is_none() && body.position.is_none()
            && body.slowmode_delay.is_none() && body.is_nsfw.is_none()
            && body.is_auto_create.is_none() && body.auto_create_name.is_none()
            && body.bitrate.is_none() && body.default_sort.is_none() && body.require_tag.is_none();
        let temp_owner: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM channels
             WHERE id=$1 AND server_id=$2 AND is_temporary AND created_by_auto=$3)"
        )
        .bind(channel_id)
        .bind(server_id)
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
        if !(temp_owner && owner_fields_only) {
            return Err(e);
        }
        temp_owner_only = true;
    }

    let bad = |e: &'static str| AppError::BadRequest(e.into());
    let limit = body.user_limit.flatten();
    check_channel_fields(body.topic.as_deref(), body.slowmode_delay, limit).map_err(bad)?;
    let name = body.name.as_deref().map(clean_name).transpose().map_err(bad)?;
    let name = name.map(str::to_string);
    let password = body.voice_password.as_deref().unwrap_or_default();
    if password.len() > VOICE_PASSWORD_MAX_BYTES {
        return Err(bad("Mot de passe vocal : 72 octets au plus"));
    }
    // Surcharges du salon : masqué pour ce membre, ou droit de modification retiré
    // sur CE salon = refus, même avec le droit au niveau du serveur (avant : ignorées).
    let hidden = state.hidden_channels(claims.sub, Some(server_id), Some(channel_id));
    if hidden.await?.contains(&channel_id) {
        return Err(AppError::Forbidden);
    }
    if !temp_owner_only {
        let perms = state.effective_channel_permissions(claims.sub, channel_id);
        let edit_here = perms
            .await
            .is_some_and(|(sid, p)| sid == server_id && p & CAN_EDIT != 0);
        if !edit_here {
            return Err(AppError::Forbidden);
        }
    }

    // Calculer le hash du mot de passe vocal si fourni
    let voice_password_hash: Option<Option<String>> = if body.remove_voice_password.unwrap_or(false) {
        // Suppression explicite du mot de passe
        Some(None)
    } else if let Some(ref pw) = body.voice_password {
        if pw.is_empty() {
            Some(None)
        } else {
            let hash = bcrypt::hash(pw, bcrypt::DEFAULT_COST)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {e}")))?;
            Some(Some(hash))
        }
    } else {
        None // pas de changement
    };

    let channel = if let Some(new_hash) = voice_password_hash {
        // Mise à jour avec changement de mot de passe vocal
        sqlx::query_as::<_, Channel>(
            "UPDATE channels SET
                name = COALESCE($2, name),
                topic = COALESCE($3, topic),
                position = COALESCE($4, position),
                slowmode_delay = COALESCE($5, slowmode_delay),
                is_nsfw = COALESCE($6, is_nsfw),
                user_limit = CASE WHEN $15 THEN NULLIF($7, 0) ELSE user_limit END,
                voice_password_hash = $8,
                is_auto_create = COALESCE($9, is_auto_create),
                auto_create_name = CASE WHEN $16 THEN $10 ELSE auto_create_name END,
                bitrate = COALESCE($11, bitrate),
                default_sort = COALESCE($12, default_sort),
                require_tag = COALESCE($13, require_tag)
             WHERE id=$1 AND server_id=$14 RETURNING *"
        )
        .bind(channel_id)
        .bind(&name)
        .bind(body.topic)
        .bind(body.position)
        .bind(body.slowmode_delay)
        .bind(body.is_nsfw)
        .bind(body.user_limit.flatten())
        .bind(new_hash)
        .bind(body.is_auto_create)
        .bind(body.auto_create_name.clone().flatten())
        .bind(body.bitrate)
        .bind(&body.default_sort)
        .bind(body.require_tag)
        .bind(server_id)
        .bind(body.user_limit.is_some())
        .bind(body.auto_create_name.is_some())
        .fetch_one(&state.db)
        .await?
    } else {
        // Mise à jour sans toucher au mot de passe vocal
        sqlx::query_as::<_, Channel>(
            "UPDATE channels SET
                name = COALESCE($2, name),
                topic = COALESCE($3, topic),
                position = COALESCE($4, position),
                slowmode_delay = COALESCE($5, slowmode_delay),
                is_nsfw = COALESCE($6, is_nsfw),
                user_limit = CASE WHEN $14 THEN NULLIF($7, 0) ELSE user_limit END,
                is_auto_create = COALESCE($8, is_auto_create),
                auto_create_name = CASE WHEN $15 THEN $9 ELSE auto_create_name END,
                bitrate = COALESCE($10, bitrate),
                default_sort = COALESCE($11, default_sort),
                require_tag = COALESCE($12, require_tag)
             WHERE id=$1 AND server_id=$13 RETURNING *"
        )
        .bind(channel_id)
        .bind(&name)
        .bind(body.topic)
        .bind(body.position)
        .bind(body.slowmode_delay)
        .bind(body.is_nsfw)
        .bind(body.user_limit.flatten())
        .bind(body.is_auto_create)
        .bind(body.auto_create_name.clone().flatten())
        .bind(body.bitrate)
        .bind(&body.default_sort)
        .bind(body.require_tag)
        .bind(server_id)
        .bind(body.user_limit.is_some())
        .bind(body.auto_create_name.is_some())
        .fetch_one(&state.db)
        .await?
    };

    // Broadcaster la mise à jour du canal aux membres du serveur
    let event = serde_json::json!({
        "type": "CHANNEL_UPDATE",
        "server_id": server_id,
        "channel": {
            "id": channel.id,
            "server_id": server_id,
            "name": channel.name,
            "topic": channel.topic,
            "slowmode_delay": channel.slowmode_delay,
            "user_limit": channel.user_limit,
            "is_nsfw": channel.is_nsfw,
            "position": channel.position,
            "is_auto_create": channel.is_auto_create,
            "auto_create_name": channel.auto_create_name,
            "has_voice_password": channel.voice_password_hash.is_some(),
        }
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(channel))
}

pub async fn delete_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    let ctx = deletion_context(&state, claims.sub, server_id).await?;
    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT created_by FROM channels WHERE id=$1 AND server_id=$2"
    )
    .bind(channel_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;
    check_deletion(ctx, claims.sub, created_by)?;

    sqlx::query("DELETE FROM channels WHERE id=$1 AND server_id=$2")
        .bind(channel_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;
    // Salon chiffré : ses enveloppes de clés n'ont plus d'usage.
    crate::handlers::e2e_conv::forget_conversation(&state.db, crate::handlers::e2e_conv::Conv::Channel(channel_id)).await;

    let event = serde_json::json!({ "type": "CHANNEL_DELETE", "server_id": server_id, "channel_id": channel_id });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    log_event(
        &state, server_id, "CHANNEL_DELETE",
        Some(claims.sub),
        Some(channel_id), None, None,
    ).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn create_category(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateCategoryRequest>,
) -> Result<Json<Category>> {
    require_permission(&state, claims.sub, server_id, CAN_CREATE).await?;
    let name = clean_name(&body.name).map_err(|e| AppError::BadRequest(e.into()))?;

    let cat = sqlx::query_as::<_, Category>(
        "INSERT INTO categories (server_id, name, created_by) VALUES ($1, $2, $3) RETURNING *"
    )
    .bind(server_id)
    .bind(name)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "CATEGORY_CREATE",
        "server_id": server_id,
        "category": { "id": cat.id, "name": cat.name, "position": cat.position, "created_by": cat.created_by },
    }).to_string()).await;

    Ok(Json(cat))
}

pub async fn get_categories(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Category>>> {
    require_member(&state, claims.sub, server_id).await?;
    let admin = require_permission(&state, claims.sub, server_id, Permissions::ADMINISTRATOR).await.is_ok();
    let cats = sqlx::query_as::<_, Category>(
        "SELECT * FROM categories WHERE server_id=$1 AND ($2 OR NOT staff_only) ORDER BY position"
    )
    .bind(server_id)
    .bind(admin)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(cats))
}

pub async fn delete_category(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    let ctx = deletion_context(&state, claims.sub, server_id).await?;
    let created_by: Option<Uuid> = sqlx::query_scalar(
        "SELECT created_by FROM categories WHERE id=$1 AND server_id=$2"
    )
    .bind(category_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Catégorie introuvable".into()))?;
    check_deletion(ctx, claims.sub, created_by)?;

    // Règle la plus sûre : les salons d'une catégorie supprimée sont détachés
    // (ON DELETE SET NULL), ce qui les modifie. Il faut donc pouvoir supprimer
    // CHACUN d'eux ; sinon refus complet et rien n'est touché.
    let inner: Vec<(String, Option<Uuid>)> = sqlx::query_as(
        "SELECT name, created_by FROM channels WHERE category_id=$1 AND server_id=$2"
    )
    .bind(category_id)
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    let blocked: Vec<&str> = inner.iter()
        .filter(|(_, by)| check_deletion(ctx, claims.sub, *by).is_err())
        .map(|(n, _)| n.as_str())
        .collect();
    if !blocked.is_empty() {
        return Err(AppError::ForbiddenMsg(format!(
            "Suppression refusée : cette catégorie contient {} salon(s) que vous ne pouvez pas supprimer (#{}). Déplacez-les hors de la catégorie ou demandez au propriétaire du serveur.",
            blocked.len(), blocked.join(", #"),
        )));
    }

    sqlx::query("DELETE FROM categories WHERE id=$1 AND server_id=$2")
        .bind(category_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({
        "type": "CATEGORY_DELETE",
        "server_id": server_id,
        "category_id": category_id,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_pinned(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    crate::handlers::servers::require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    crate::handlers::channel_access::require_read_history(&state, claims.sub, channel_id).await?;

    let pinned = sqlx::query(
        "SELECT m.*, u.username, NULLIF(COALESCE(m.webhook_avatar_url, u.avatar), '') AS avatar FROM messages m
         JOIN pinned_messages pm ON pm.message_id = m.id
         JOIN users u ON u.id = m.user_id
         WHERE pm.channel_id=$1 AND m.channel_id=$1
           AND EXISTS (SELECT 1 FROM channels WHERE id=$1 AND server_id=$2)
         ORDER BY pm.pinned_at DESC"
    )
    .bind(channel_id)
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = pinned.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "content": r.get::<Option<String>, _>("content"),
            "enc": r.get::<Option<serde_json::Value>, _>("enc"),
            "client_msg_id": r.get::<Option<Uuid>, _>("client_msg_id"),
            "author_id": r.get::<Uuid, _>("user_id"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author_username": r.try_get::<Option<String>, _>("webhook_display_name").ok().flatten().unwrap_or_else(|| r.get::<String, _>("username")),
            "author_avatar": r.get::<Option<String>, _>("avatar"),
        })
    }).collect();

    Ok(Json(result))
}

// ─── Channel Reorder ───────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct ReorderChannelsRequest {
    pub channel_ids: Vec<Uuid>,
}

pub async fn reorder_channels(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<ReorderChannelsRequest>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, CAN_EDIT).await?;

    let positions: Vec<i32> = (0..req.channel_ids.len() as i32).collect();
    sqlx::query(
        "UPDATE channels SET position = v.pos
         FROM (SELECT UNNEST($1::uuid[]) AS id, UNNEST($2::int[]) AS pos) AS v
         WHERE channels.id = v.id AND channels.server_id = $3"
    )
    .bind(&req.channel_ids)
    .bind(&positions)
    .bind(server_id)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;

    let event = serde_json::json!({
        "type": "CHANNELS_REORDER",
        "server_id": server_id,
        "channel_ids": req.channel_ids,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Channel Permission Overrides ──────────────────────────────────────────────

pub async fn get_channel_permissions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let server_id = channel_server_id(&state, channel_id).await?;
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    let rows = sqlx::query(
        "SELECT target_id, target_type, allow, deny FROM channel_permissions WHERE channel_id=$1"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;
    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "target_id": r.get::<Uuid, _>("target_id"),
            "target_type": r.get::<String, _>("target_type"),
            "allow": r.get::<i64, _>("allow"),
            "deny": r.get::<i64, _>("deny"),
        })
    }).collect();
    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct ChannelPermOverride {
    pub target_type: String,
    pub allow: i64,
    pub deny: i64,
}

pub async fn put_channel_permission(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, target_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ChannelPermOverride>,
) -> Result<Json<serde_json::Value>> {
    let server_id = channel_server_id(&state, channel_id).await?;
    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;
    if !["role", "member"].contains(&body.target_type.as_str()) {
        return Err(AppError::BadRequest("target_type invalide (role|member)".into()));
    }
    let actor = actor_channel_perms(&state, claims.sub, channel_id).await?;
    let (allow, deny) = check_override_bits(actor, body.allow, body.deny)?;
    require_override_target(&state, claims.sub, server_id, target_id, &body.target_type).await?;
    let before = state.channel_audience(channel_id).await;
    sqlx::query(
        "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, target_id) DO UPDATE
         SET allow=EXCLUDED.allow, deny=EXCLUDED.deny, target_type=EXCLUDED.target_type"
    )
    .bind(channel_id)
    .bind(target_id)
    .bind(&body.target_type)
    .bind(allow)
    .bind(deny)
    .execute(&state.db)
    .await?;
    notify_permission_change(&state, channel_id, server_id, before).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Permissions effectives de l'acteur SUR CE SALON (surcharges comprises) : un
/// détenteur d'EDIT_CHANNELS à qui le salon est masqué n'a pas VIEW_CHANNEL ici,
/// il ne peut donc pas se l'accorder.
async fn actor_channel_perms(state: &AppState, actor: Uuid, channel_id: Uuid) -> Result<i64> {
    state
        .effective_channel_permissions(actor, channel_id)
        .await
        .map(|(_, p)| p)
        .ok_or(AppError::Forbidden)
}

/// Une surcharge ne peut accorder ni refuser qu'un bit que l'acteur possède lui-même
/// sur le salon (même règle que create_role/assign_role), jamais ADMINISTRATOR.
pub(crate) fn check_override_bits(actor_perms: i64, allow: i64, deny: i64) -> Result<(i64, i64)> {
    // Bit retiré : une ancienne appli qui le renvoie ne doit pas voir sa surcharge refusée.
    let (allow, deny) = (allow & !Permissions::RETIRED_PRIORITY_SPEAKER, deny & !Permissions::RETIRED_PRIORITY_SPEAKER);
    if allow < 0 || deny < 0 || (allow | deny) & !Permissions::ALL != 0 {
        return Err(AppError::BadRequest("Permissions inconnues".into()));
    }
    if (allow | deny) & Permissions::ADMINISTRATOR != 0 {
        return Err(AppError::BadRequest("ADMINISTRATOR interdit dans une surcharge de salon".into()));
    }
    if (allow | deny) & !actor_perms != 0 {
        return Err(AppError::Forbidden);
    }
    Ok((allow, deny))
}

/// La cible doit appartenir au serveur et être strictement sous l'acteur.
pub(crate) async fn require_override_target(state: &AppState, actor: Uuid, server_id: Uuid, target_id: Uuid, target_type: &str) -> Result<()> {
    if target_type == "role" {
        // require_role_below vérifie aussi que le rôle est bien de ce serveur.
        return crate::handlers::servers::require_role_below(state, actor, target_id, server_id).await;
    }
    let member: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)")
        .bind(server_id)
        .bind(target_id)
        .fetch_one(&state.db)
        .await?;
    if !member {
        return Err(AppError::NotFound("Membre introuvable".into()));
    }
    if target_id != actor {
        crate::handlers::servers::require_outranks(state, actor, target_id, server_id).await?;
    }
    Ok(())
}

pub async fn delete_channel_permission(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    let server_id = channel_server_id(&state, channel_id).await?;
    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;
    let existing: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT target_type, allow, deny FROM channel_permissions WHERE channel_id=$1 AND target_id=$2",
    )
    .bind(channel_id)
    .bind(target_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((target_type, allow, deny)) = existing else {
        return Ok(Json(serde_json::json!({ "ok": true })));
    };
    // Supprimer un refus revient à accorder : mêmes règles que pour la poser.
    let actor = actor_channel_perms(&state, claims.sub, channel_id).await?;
    check_override_bits(actor, allow & Permissions::ALL & !Permissions::ADMINISTRATOR, deny & Permissions::ALL & !Permissions::ADMINISTRATOR)?;
    require_override_target(&state, claims.sub, server_id, target_id, &target_type).await?;
    let before = state.channel_audience(channel_id).await;
    sqlx::query("DELETE FROM channel_permissions WHERE channel_id=$1 AND target_id=$2")
        .bind(channel_id)
        .bind(target_id)
        .execute(&state.db)
        .await?;
    notify_permission_change(&state, channel_id, server_id, before).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn archive_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;

    use sqlx::Row;
    let row = sqlx::query(
        "UPDATE channels SET archived = NOT archived WHERE id=$1 AND server_id=$2 RETURNING archived"
    )
    .bind(channel_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| AppError::NotFound("Canal introuvable".into()))?;

    let archived: bool = row.get("archived");
    state.broadcast_to_channel_members(channel_id, serde_json::json!({
        "type": "CHANNEL_ARCHIVE_UPDATE",
        "channel_id": channel_id,
        "server_id": server_id,
        "archived": archived,
    }).to_string()).await;
    Ok(Json(serde_json::json!({ "archived": archived })))
}

pub async fn hide_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let row = sqlx::query("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;
    let server_id: Uuid = row.get("server_id");
    require_member(&state, claims.sub, server_id).await?;

    sqlx::query(
        "INSERT INTO hidden_channels (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.sub)
    .bind(channel_id)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(serde_json::json!({ "hidden": true })))
}

pub async fn unhide_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let row = sqlx::query("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;
    let server_id: Uuid = row.get("server_id");
    require_member(&state, claims.sub, server_id).await?;

    sqlx::query(
        "DELETE FROM hidden_channels WHERE user_id=$1 AND channel_id=$2"
    )
    .bind(claims.sub)
    .bind(channel_id)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(serde_json::json!({ "hidden": false })))
}

pub async fn move_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let new_category_id: Option<Uuid> = body.get("category_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    let row = sqlx::query("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::NotFound("Canal introuvable".into()))?;
    let server_id: Uuid = row.get("server_id");

    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;

    // Même IDOR que create_channel : vérifier que la catégorie cible appartient
    // bien à ce serveur avant de déplacer le canal dedans.
    if let Some(cat_id) = new_category_id {
        let cat_ok: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE id=$1 AND server_id=$2)"
        ).bind(cat_id).bind(server_id).fetch_one(&state.db).await?;
        if !cat_ok {
            return Err(AppError::BadRequest("Catégorie invalide pour ce serveur".into()));
        }
    }

    sqlx::query("UPDATE channels SET category_id=$1 WHERE id=$2 AND server_id=$3")
        .bind(new_category_id)
        .bind(channel_id)
        .bind(server_id)
        .execute(&state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    state.broadcast_to_channel_members(channel_id, serde_json::json!({
        "type": "CHANNEL_UPDATE",
        "channel_id": channel_id,
        "server_id": server_id,
        "category_id": new_category_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "moved": true, "category_id": new_category_id })))
}

pub async fn purge_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let row = sqlx::query("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel_id)
        .fetch_one(&state.db)
        .await
        .map_err(|_| AppError::NotFound("Canal introuvable".into()))?;
    let server_id: Uuid = row.get("server_id");

    require_channel_manage(&state, claims.sub, server_id, channel_id, Permissions::MANAGE_CHANNELS).await?;

    let before: Option<String> = body.get("before").and_then(|v| v.as_str()).map(|s| s.to_string());
    let author_id: Option<Uuid> = body.get("author_id")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());
    let limit: i64 = body.get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(100)
        .min(1000);

    // PostgreSQL n'accepte pas `LIMIT` directement sur un DELETE (contrairement à
    // MySQL) -- "syntax error at or near LIMIT", confirmé en direct. Chaque appel à
    // cette purge a toujours échoué en erreur SQL depuis l'écriture de ce handler.
    // Fix : pré-sélectionner les IDs à supprimer via un CTE, puis DELETE ... WHERE id IN.
    let deleted = if let Some(before_date) = before {
        if let Some(aid) = author_id {
            sqlx::query(
                "WITH victims AS (SELECT id FROM messages WHERE channel_id=$1 AND created_at < $2::timestamptz AND user_id=$3 ORDER BY created_at DESC LIMIT $4),
                      deleted AS (DELETE FROM messages WHERE id IN (SELECT id FROM victims) RETURNING id)
                 SELECT (SELECT COUNT(*) FROM deleted) AS n,
                        ARRAY(SELECT url FROM attachments WHERE message_id IN (SELECT id FROM victims)) AS urls"
            )
            .bind(channel_id).bind(&before_date).bind(aid).bind(limit)
            .fetch_one(&state.db).await
        } else {
            sqlx::query(
                "WITH victims AS (SELECT id FROM messages WHERE channel_id=$1 AND created_at < $2::timestamptz ORDER BY created_at DESC LIMIT $3),
                      deleted AS (DELETE FROM messages WHERE id IN (SELECT id FROM victims) RETURNING id)
                 SELECT (SELECT COUNT(*) FROM deleted) AS n,
                        ARRAY(SELECT url FROM attachments WHERE message_id IN (SELECT id FROM victims)) AS urls"
            )
            .bind(channel_id).bind(&before_date).bind(limit)
            .fetch_one(&state.db).await
        }
    } else if let Some(aid) = author_id {
        sqlx::query(
            "WITH victims AS (SELECT id FROM messages WHERE channel_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT $3),
                  deleted AS (DELETE FROM messages WHERE id IN (SELECT id FROM victims) RETURNING id)
             SELECT (SELECT COUNT(*) FROM deleted) AS n,
                    ARRAY(SELECT url FROM attachments WHERE message_id IN (SELECT id FROM victims)) AS urls"
        )
        .bind(channel_id).bind(aid).bind(limit)
        .fetch_one(&state.db).await
    } else {
        sqlx::query(
            "WITH victims AS (SELECT id FROM messages WHERE channel_id=$1 ORDER BY created_at DESC LIMIT $2),
                  deleted AS (DELETE FROM messages WHERE id IN (SELECT id FROM victims) RETURNING id)
             SELECT (SELECT COUNT(*) FROM deleted) AS n,
                    ARRAY(SELECT url FROM attachments WHERE message_id IN (SELECT id FROM victims)) AS urls"
        )
        .bind(channel_id).bind(limit)
        .fetch_one(&state.db).await
    };

    let row = deleted.map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    let count: i64 = row.get("n");
    // Les fichiers joints des messages purgés quittent aussi le disque (le CTE lit les adresses
    // avant la suppression en cascade des lignes `attachments`).
    crate::handlers::uploads::remove_upload_files(&state, row.get::<Vec<String>, _>("urls"));

    // PURGE_MESSAGES est une action destructive (suppression en masse) -- une perte
    // silencieuse de son entrée d'audit est un vrai trou de traçabilité, comme pour
    // log_event() (audit.rs, déjà corrigé) que cet insert inline contourne.
    if let Err(e) = sqlx::query(
        "INSERT INTO audit_log (server_id, action, user_id, target_id, details) VALUES ($1,'PURGE_MESSAGES',$2,$3,$4)"
    )
    .bind(server_id)
    .bind(claims.sub)
    .bind(channel_id)
    .bind(serde_json::json!({ "deleted": count, "channel_id": channel_id }))
    .execute(&state.db)
    .await
    {
        tracing::error!("Échec écriture audit_log PURGE_MESSAGES (channel={}): {}", channel_id, e);
    }

    let event = serde_json::json!({
        "type": "CHANNEL_PURGE",
        "channel_id": channel_id.to_string(),
        "deleted": count,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "deleted": count })))
}

#[derive(serde::Deserialize)]
pub struct SetGithubTokenBody {
    pub token: Option<String>, // None = désactiver le webhook GitHub
}

pub async fn set_github_webhook_token(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SetGithubTokenBody>,
) -> Result<Json<serde_json::Value>> {
    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;

    let token = body.token.as_deref().map(|t| t.trim()).filter(|t| !t.is_empty());
    if let Some(t) = token {
        if t.len() < 16 {
            return Err(AppError::BadRequest("Le token doit faire au moins 16 caractères".into()));
        }
    }

    // Chiffré au repos (webhooks::seal_github_token) ; jamais relu par l'API.
    sqlx::query("UPDATE channels SET github_webhook_token_enc=$1, github_webhook_token=NULL WHERE id=$2")
        .bind(token.map(|t| crate::handlers::webhooks::seal_github_token(channel_id, t)))
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true, "active": token.is_some() })))
}

// ─── Tags de forum ──────────────────────────────────────────────────────────────
// ChannelSettingsModal.tsx appelait déjà ces 3 routes -- jamais enregistrées ni
// implémentées côté backend. Les tags "ajoutés" ne vivaient qu'en state React
// local et disparaissaient à chaque réouverture de la modale.

async fn channel_server_id(state: &AppState, channel_id: Uuid) -> Result<Uuid> {
    use sqlx::Row;
    sqlx::query("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?
        .get::<Option<Uuid>, _>("server_id")
        .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))
}

pub async fn get_channel_tags(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Vec<String>>> {
    let server_id = channel_server_id(&state, channel_id).await?;
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let tags: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM forum_tags WHERE channel_id=$1 ORDER BY name"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(tags))
}

#[derive(serde::Deserialize)]
pub struct CreateChannelTagBody {
    pub name: String,
}

pub async fn create_channel_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateChannelTagBody>,
) -> Result<Json<serde_json::Value>> {
    let server_id = channel_server_id(&state, channel_id).await?;
    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;

    let name = body.name.trim();
    if name.is_empty() || name.len() > 32 {
        return Err(AppError::BadRequest("Le nom du tag doit faire entre 1 et 32 caractères".into()));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM forum_tags WHERE channel_id=$1")
        .bind(channel_id).fetch_one(&state.db).await?;
    if count >= 20 {
        return Err(AppError::BadRequest("Maximum 20 tags par forum".into()));
    }

    sqlx::query(
        "INSERT INTO forum_tags (channel_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(channel_id)
    .bind(name)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_channel_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((channel_id, tag_name)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    let server_id = channel_server_id(&state, channel_id).await?;
    require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;

    sqlx::query("DELETE FROM forum_tags WHERE channel_id=$1 AND name=$2")
        .bind(channel_id)
        .bind(&tag_name)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Surcharges de salon modifiées : seuls ceux qui voyaient le salon avant OU le
/// voient après sont prévenus (les premiers doivent le retirer de leur liste).
/// Avant : tout le serveur recevait l'id des salons privés.
pub(crate) async fn notify_permission_change(state: &AppState, channel_id: Uuid, server_id: Uuid, mut users: Vec<Uuid>) {
    for u in state.channel_audience(channel_id).await {
        if !users.contains(&u) { users.push(u); }
    }
    state.send_to_users(&users, serde_json::json!({
        "type": "CHANNEL_PERMISSION_UPDATE",
        "channel_id": channel_id,
        "server_id": server_id,
    }).to_string()).await;
    crate::handlers::voice_moderation::evict_unauthorized_voice(state, server_id).await;
}

#[cfg(test)]
mod override_tests {
    use super::*;

    #[test]
    fn override_bits_limited_to_actor() {
        let editor = Permissions::EDIT_CHANNELS | Permissions::SEND_MESSAGES;
        // Salon masqué : l'éditeur n'a pas VIEW_CHANNEL ici, il ne peut pas se l'accorder.
        assert!(check_override_bits(editor, Permissions::VIEW_CHANNEL, 0).is_err());
        assert!(check_override_bits(editor, 0, Permissions::BAN_MEMBERS).is_err());
        assert!(check_override_bits(i64::MAX, Permissions::ADMINISTRATOR, 0).is_err());
        assert!(check_override_bits(i64::MAX, -1, 0).is_err());
        assert_eq!(check_override_bits(editor, Permissions::SEND_MESSAGES, 0).ok(), Some((Permissions::SEND_MESSAGES, 0)));
        assert!(check_override_bits(i64::MAX, Permissions::VIEW_CHANNEL, Permissions::SEND_MESSAGES).is_ok());
        // Orateur prioritaire retiré : ignoré, jamais refusé ni conservé.
        assert_eq!(check_override_bits(editor, Permissions::SEND_MESSAGES | Permissions::RETIRED_PRIORITY_SPEAKER, Permissions::RETIRED_PRIORITY_SPEAKER).ok(), Some((Permissions::SEND_MESSAGES, 0)));
        assert_eq!(Permissions::ALL & Permissions::RETIRED_PRIORITY_SPEAKER, 0);
    }
}
