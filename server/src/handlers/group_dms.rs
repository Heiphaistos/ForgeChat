use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct CreateGroupDmInput {
    pub user_ids: Vec<Uuid>,
    pub name: Option<String>,
}

pub async fn create_group_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateGroupDmInput>,
) -> Result<Json<serde_json::Value>> {
    if body.user_ids.len() < 2 || body.user_ids.len() > 9 {
        return Err(AppError::BadRequest("Entre 2 et 9 membres requis".into()));
    }
    // Déduplique et retire le créateur s'il est dans la liste
    let mut members: Vec<Uuid> = body.user_ids.clone();
    members.sort();
    members.dedup();
    members.retain(|id| *id != claims.sub);
    if members.len() < 1 {
        return Err(AppError::BadRequest("Au moins 1 autre membre requis".into()));
    }

    use sqlx::Row;
    let name = body.name.as_deref().unwrap_or("Groupe").trim().chars().take(64).collect::<String>();
    let name = if name.is_empty() { "Groupe".to_string() } else { name };

    let group = sqlx::query(
        "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id"
    )
    .bind(&name)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let group_id: Uuid = group.get("id");

    // Ajouter le créateur comme membre
    sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)")
        .bind(group_id).bind(claims.sub).execute(&state.db).await?;

    // Ajouter les autres membres
    for uid in &members {
        let _ = sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(group_id).bind(uid).execute(&state.db).await;
    }

    // Notifier tous les membres de la création du groupe
    let all_members: Vec<Uuid> = std::iter::once(claims.sub).chain(members.iter().copied()).collect();
    let event = serde_json::json!({ "type": "GROUP_DM_CREATE", "group": { "id": group_id, "name": name } });
    let event_str = event.to_string();
    for uid in &all_members {
        state.broadcast_to_user(*uid, event_str.clone()).await;
    }

    Ok(Json(serde_json::json!({ "id": group_id, "name": name })))
}

pub async fn list_group_dms(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "WITH last_msg AS (
           SELECT dm_id, MAX(created_at) AS last_message_at
           FROM group_dm_messages
           GROUP BY dm_id
         ),
         member_counts AS (
           SELECT dm_id, COUNT(*) AS cnt
           FROM group_dm_members
           GROUP BY dm_id
         )
         SELECT g.id, g.name, g.created_at,
                mc.cnt AS member_count,
                lm.last_message_at
         FROM group_dm_channels g
         JOIN group_dm_members gm ON gm.dm_id = g.id
         LEFT JOIN last_msg lm ON lm.dm_id = g.id
         LEFT JOIN member_counts mc ON mc.dm_id = g.id
         WHERE gm.user_id = $1
         ORDER BY COALESCE(lm.last_message_at, g.created_at) DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "member_count": r.get::<i64, _>("member_count"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "last_message_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_message_at"),
    })).collect();
    Ok(Json(result))
}

pub async fn get_group_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    // Vérifier membership
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let group = sqlx::query(
        "SELECT id, name, owner_id, created_at FROM group_dm_channels WHERE id=$1"
    )
    .bind(group_id).fetch_one(&state.db).await
    .map_err(|_| AppError::NotFound("Groupe introuvable".into()))?;

    let members = sqlx::query(
        "SELECT u.id, u.username, u.discriminator, u.avatar, u.status
         FROM group_dm_members gm JOIN users u ON u.id = gm.user_id WHERE gm.dm_id = $1"
    )
    .bind(group_id).fetch_all(&state.db).await?;

    let members_json: Vec<serde_json::Value> = members.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
    })).collect();

    Ok(Json(serde_json::json!({
        "id": group.get::<Uuid, _>("id"),
        "name": group.get::<String, _>("name"),
        "owner_id": group.get::<Uuid, _>("owner_id"),
        "created_at": group.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "members": members_json,
    })))
}

pub async fn get_group_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let limit: i64 = params.get("limit").and_then(|l| l.parse().ok()).unwrap_or(50).min(100).max(1);
    let before: Option<Uuid> = params.get("before").and_then(|s| s.parse().ok());

    let rows = if let Some(before_id) = before {
        sqlx::query(
            "SELECT m.id, m.content, m.created_at, m.edited_at, m.sender_id,
                    u.username as sender_username, u.avatar as sender_avatar
             FROM group_dm_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.dm_id = $1
               AND m.created_at < (SELECT created_at FROM group_dm_messages WHERE id=$3 AND dm_id=$1)
             ORDER BY m.created_at DESC LIMIT $2"
        )
        .bind(group_id).bind(limit).bind(before_id)
        .fetch_all(&state.db).await?
    } else {
        sqlx::query(
            "SELECT m.id, m.content, m.created_at, m.edited_at, m.sender_id,
                    u.username as sender_username, u.avatar as sender_avatar
             FROM group_dm_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.dm_id = $1
             ORDER BY m.created_at DESC LIMIT $2"
        )
        .bind(group_id).bind(limit)
        .fetch_all(&state.db).await?
    };

    let msg_ids: Vec<Uuid> = rows.iter().map(|r| r.get::<Uuid, _>("id")).collect();

    let reaction_rows = if msg_ids.is_empty() {
        vec![]
    } else {
        sqlx::query(
            "SELECT group_dm_message_id, emoji, user_id FROM group_dm_reactions WHERE group_dm_message_id = ANY($1)"
        )
        .bind(&msg_ids)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    let attachment_rows = if msg_ids.is_empty() {
        vec![]
    } else {
        sqlx::query(
            "SELECT group_dm_message_id, id, url, filename, content_type, size, expires_at
             FROM attachments WHERE group_dm_message_id = ANY($1)"
        )
        .bind(&msg_ids)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    let mut react_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &reaction_rows {
        let mid = r.get::<Uuid, _>("group_dm_message_id");
        react_map.entry(mid).or_default().push(serde_json::json!({
            "emoji": r.get::<String, _>("emoji"),
            "user_id": r.get::<Uuid, _>("user_id"),
        }));
    }

    let mut att_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &attachment_rows {
        let mid = r.get::<Option<Uuid>, _>("group_dm_message_id").unwrap_or_default();
        att_map.entry(mid).or_default().push(serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "url": r.get::<String, _>("url"),
            "filename": r.get::<String, _>("filename"),
            "content_type": r.get::<String, _>("content_type"),
            "size": r.get::<i64, _>("size"),
            "expires_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at"),
        }));
    }

    let mut result: Vec<serde_json::Value> = rows.iter().map(|r| {
        let id = r.get::<Uuid, _>("id");
        serde_json::json!({
            "id": id,
            "content": r.get::<Option<String>, _>("content"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "edited_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("edited_at"),
            "sender_id": r.get::<Uuid, _>("sender_id"),
            "sender_username": r.get::<String, _>("sender_username"),
            "sender_avatar": r.get::<Option<String>, _>("sender_avatar"),
            "reactions": react_map.get(&id).cloned().unwrap_or_default(),
            "attachments": att_map.get(&id).cloned().unwrap_or_default(),
        })
    }).collect();
    result.reverse();
    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct SendGroupDmInput {
    pub content: Option<String>,
    pub has_attachments: Option<bool>,
}

pub async fn send_group_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<SendGroupDmInput>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    // Anti-spam GroupDM : max 5 messages / 3 secondes via Redis
    {
        use redis::AsyncCommands;
        let key = format!("gdm_spam:{}:{}", claims.sub, group_id);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&key, 1).await.unwrap_or(0);
        if count == 1 { let _: () = redis.expire(&key, 3).await.unwrap_or(()); }
        if count > 5 { return Err(AppError::TooManyRequests); }
    }

    let has_attachments = body.has_attachments.unwrap_or(false);
    let content = body.content.as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if content.is_none() && !has_attachments {
        return Err(AppError::BadRequest("Message vide".into()));
    }
    if let Some(ref c) = content {
        if c.chars().count() > 4000 {
            return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
        }
    }

    let msg = sqlx::query(
        "INSERT INTO group_dm_messages (dm_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, created_at"
    )
    .bind(group_id).bind(claims.sub).bind(&content)
    .fetch_one(&state.db).await?;

    let user = sqlx::query("SELECT username, avatar FROM users WHERE id=$1")
        .bind(claims.sub).fetch_one(&state.db).await?;

    let msg_json = serde_json::json!({
        "id": msg.get::<Uuid, _>("id"),
        "dm_id": group_id,
        "content": content.as_deref(),
        "created_at": msg.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "sender_id": claims.sub,
        "sender_username": user.get::<String, _>("username"),
        "sender_avatar": user.get::<Option<String>, _>("avatar"),
        "attachments": serde_json::json!([]),
    });

    let event = serde_json::json!({
        "type": "GROUP_DM_MESSAGE",
        "group_id": group_id,
        "message": msg_json,
    });
    let event_str = event.to_string();

    // Notifier tous les membres
    let members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    )
    .bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    for uid in members {
        state.broadcast_to_user(uid, event_str.clone()).await;
    }

    Ok(Json(msg_json))
}

pub async fn delete_group_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, msg_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if !is_member { return Err(AppError::Forbidden); }

    let deleted = sqlx::query_scalar::<_, i64>(
        "WITH del AS (DELETE FROM group_dm_messages WHERE id=$1 AND sender_id=$2 AND dm_id=$3 RETURNING 1)
         SELECT COUNT(*) FROM del"
    )
    .bind(msg_id)
    .bind(claims.sub)
    .bind(group_id)
    .fetch_one(&state.db)
    .await?;

    if deleted == 0 {
        return Err(AppError::Forbidden);
    }

    let members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let event = serde_json::json!({
        "type": "GROUP_DM_MESSAGE_DELETE",
        "group_id": group_id,
        "message_id": msg_id,
    }).to_string();

    for uid in members {
        state.broadcast_to_user(uid, event.clone()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct EditGroupMessageBody {
    pub content: String,
}

pub async fn edit_group_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, msg_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<EditGroupMessageBody>,
) -> Result<Json<serde_json::Value>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if !is_member { return Err(AppError::Forbidden); }

    let content = body.content.trim().to_string();
    if content.is_empty() || content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Contenu invalide (1-4000 caractères)".into()));
    }

    let rows = sqlx::query(
        "UPDATE group_dm_messages SET content=$1, edited_at=NOW()
         WHERE id=$2 AND sender_id=$3 AND dm_id=$4"
    )
    .bind(&content)
    .bind(msg_id)
    .bind(claims.sub)
    .bind(group_id)
    .execute(&state.db)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }

    let members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    )
    .bind(group_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let event = serde_json::json!({
        "type": "GROUP_DM_MESSAGE_EDIT",
        "group_id": group_id,
        "message_id": msg_id,
        "content": content,
    }).to_string();

    for uid in members {
        state.broadcast_to_user(uid, event.clone()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── Réactions sur messages GroupDM ───────────────────────────────────────────

pub async fn toggle_group_dm_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, msg_id, emoji)): Path<(Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let msg_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_messages WHERE id=$1 AND dm_id=$2)"
    ).bind(msg_id).bind(group_id).fetch_one(&state.db).await?;
    if !msg_ok { return Err(AppError::NotFound("Message introuvable".into())); }

    let emoji = emoji.trim().to_string();
    if emoji.is_empty() || emoji.chars().count() > 16 {
        return Err(AppError::BadRequest("Emoji invalide".into()));
    }

    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_reactions WHERE group_dm_message_id=$1 AND user_id=$2 AND emoji=$3)"
    ).bind(msg_id).bind(claims.sub).bind(&emoji).fetch_one(&state.db).await?;

    let added = if existing {
        sqlx::query(
            "DELETE FROM group_dm_reactions WHERE group_dm_message_id=$1 AND user_id=$2 AND emoji=$3"
        ).bind(msg_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        false
    } else {
        sqlx::query(
            "INSERT INTO group_dm_reactions (group_dm_message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
        ).bind(msg_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        true
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM group_dm_reactions WHERE group_dm_message_id=$1 AND emoji=$2"
    ).bind(msg_id).bind(&emoji).fetch_one(&state.db).await?;

    let members_all: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    ).bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    let react_event = serde_json::json!({
        "type": "GROUP_DM_REACTION_TOGGLE",
        "group_id": group_id,
        "message_id": msg_id,
        "emoji": emoji,
        "added": added,
        "count": count,
        "user_id": claims.sub,
    }).to_string();

    for uid in members_all {
        state.broadcast_to_user(uid, react_event.clone()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true, "added": added, "count": count })))
}

pub async fn search_group_dm_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let q = params.get("q").cloned().unwrap_or_default();
    if q.trim().len() < 2 { return Ok(Json(serde_json::json!([]))); }

    let q_esc = q.to_lowercase()
        .replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{}%", q_esc);

    let rows = sqlx::query(
        "SELECT gdm.id, gdm.content, gdm.created_at,
                u.username as author_username, u.avatar as author_avatar
         FROM group_dm_messages gdm
         JOIN users u ON u.id = gdm.sender_id
         WHERE gdm.dm_id = $1 AND LOWER(gdm.content) LIKE $2
         ORDER BY gdm.created_at DESC LIMIT 50"
    )
    .bind(group_id).bind(&pattern)
    .fetch_all(&state.db).await?;

    let results: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "content": r.get::<Option<String>, _>("content"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "author_username": r.get::<String, _>("author_username"),
        "author_avatar": r.get::<Option<String>, _>("author_avatar"),
    })).collect();

    Ok(Json(serde_json::json!(results)))
}

pub async fn upload_group_dm_attachment(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, message_id)): Path<(Uuid, Uuid)>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let msg_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_messages WHERE id=$1 AND dm_id=$2 AND sender_id=$3)"
    )
    .bind(message_id).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !msg_ok { return Err(AppError::Forbidden); }

    let upload_dir = std::path::PathBuf::from(&state.config.upload_dir);
    tokio::fs::create_dir_all(&upload_dir).await.map_err(|e| AppError::Internal(e.into()))?;

    let mut uploaded: Vec<serde_json::Value> = Vec::new();
    let mut ttl_hours: Option<i64> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "ttl_hours" {
            let val = field.text().await.unwrap_or_default();
            ttl_hours = val.parse::<i64>().ok();
            continue;
        }

        let original_name = field.file_name().unwrap_or("fichier").to_string();
        let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() as u64 > state.config.max_upload_size {
            return Err(AppError::BadRequest("Fichier trop volumineux (max 50MB)".into()));
        }

        let ext = std::path::Path::new(&original_name)
            .extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();

        const ALLOWED: &[&str] = &[
            "jpg","jpeg","png","gif","webp","mp4","webm","mov","mkv",
            "mp3","ogg","wav","flac","pdf","txt","md","zip","tar","gz","7z",
            "rar","doc","docx","xls","xlsx","ppt","pptx","bin",
        ];
        if !ALLOWED.contains(&ext.as_str()) {
            return Err(AppError::BadRequest(format!("Extension .{} non autorisée", ext)));
        }

        let content_type = mime_guess::from_ext(&ext)
            .first_raw().unwrap_or("application/octet-stream").to_string();

        let safe_name = std::path::Path::new(&original_name)
            .file_name().and_then(|n| n.to_str()).unwrap_or("fichier")
            .replace(['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'], "_");

        let file_id = Uuid::new_v4();
        let filename = format!("{}.{}", file_id, ext);
        tokio::fs::write(upload_dir.join(&filename), &data).await.map_err(|e| AppError::Internal(e.into()))?;

        let url = format!("/uploads/{}", filename);
        let size = data.len() as i64;
        let expires_at = ttl_hours.map(|h| Utc::now() + chrono::Duration::hours(h));

        let att = sqlx::query(
            "INSERT INTO attachments (group_dm_message_id, filename, content_type, size, url, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING id, url, filename, content_type, size, expires_at"
        )
        .bind(message_id).bind(&safe_name).bind(&content_type).bind(size).bind(&url).bind(expires_at)
        .fetch_one(&state.db).await?;

        use sqlx::Row;
        uploaded.push(serde_json::json!({
            "id": att.get::<Uuid, _>("id"),
            "url": att.get::<String, _>("url"),
            "filename": att.get::<String, _>("filename"),
            "content_type": att.get::<String, _>("content_type"),
            "size": att.get::<i64, _>("size"),
            "expires_at": att.get::<Option<chrono::DateTime<Utc>>, _>("expires_at"),
        }));
    }

    if !uploaded.is_empty() {
        let members: Vec<Uuid> = sqlx::query_scalar(
            "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
        ).bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

        let event = serde_json::json!({
            "type": "GROUP_DM_ATTACHMENT_ADDED",
            "group_id": group_id,
            "message_id": message_id,
            "attachments": uploaded,
        }).to_string();

        for uid in members {
            state.broadcast_to_user(uid, event.clone()).await;
        }
    }

    Ok(Json(uploaded))
}

// ── Gestion des membres du GroupDM ───────────────────────────────────────────

pub async fn leave_group_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    sqlx::query("DELETE FROM group_dm_members WHERE dm_id=$1 AND user_id=$2")
        .bind(group_id).bind(claims.sub).execute(&state.db).await?;

    // Notifier les membres restants
    let remaining: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    ).bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    if remaining.is_empty() {
        // Plus personne — supprimer le groupe
        sqlx::query("DELETE FROM group_dm_channels WHERE id=$1")
            .bind(group_id).execute(&state.db).await.ok();
    } else {
        let event = serde_json::json!({
            "type": "GROUP_DM_MEMBER_LEAVE",
            "group_id": group_id,
            "user_id": claims.sub,
        }).to_string();
        for uid in remaining {
            state.broadcast_to_user(uid, event.clone()).await;
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct AddGroupDmMemberInput {
    pub user_id: Uuid,
}

pub async fn add_group_dm_member(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<AddGroupDmMemberInput>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let member_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM group_dm_members WHERE dm_id=$1"
    ).bind(group_id).fetch_one(&state.db).await.unwrap_or(0);
    if member_count >= 10 {
        return Err(AppError::BadRequest("Maximum 10 membres par groupe".into()));
    }

    sqlx::query(
        "INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    ).bind(group_id).bind(body.user_id).execute(&state.db).await?;

    let new_user = sqlx::query(
        "SELECT username, avatar FROM users WHERE id=$1"
    ).bind(body.user_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    let all_members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    ).bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    let event = serde_json::json!({
        "type": "GROUP_DM_MEMBER_ADD",
        "group_id": group_id,
        "user": {
            "id": body.user_id,
            "username": new_user.get::<String, _>("username"),
            "avatar": new_user.get::<Option<String>, _>("avatar"),
        },
    }).to_string();
    for uid in all_members {
        state.broadcast_to_user(uid, event.clone()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_group_dm_member(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, target_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    // Seul le propriétaire peut exclure un membre
    let is_owner: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_channels WHERE id=$1 AND owner_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_owner { return Err(AppError::Forbidden); }
    if target_id == claims.sub { return Err(AppError::BadRequest("Utilisez /leave pour quitter".into())); }

    sqlx::query("DELETE FROM group_dm_members WHERE dm_id=$1 AND user_id=$2")
        .bind(group_id).bind(target_id).execute(&state.db).await?;

    let remaining: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    ).bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    let event = serde_json::json!({
        "type": "GROUP_DM_MEMBER_REMOVE",
        "group_id": group_id,
        "user_id": target_id,
    }).to_string();
    // Notifier les membres restants ET l'exclu
    for uid in remaining.iter().chain(std::iter::once(&target_id)) {
        state.broadcast_to_user(*uid, event.clone()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct RenameGroupDmInput {
    pub name: String,
}

pub async fn rename_group_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<RenameGroupDmInput>,
) -> Result<Json<serde_json::Value>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let name = body.name.trim().chars().take(64).collect::<String>();
    if name.is_empty() { return Err(AppError::BadRequest("Nom invalide".into())); }

    let affected = sqlx::query(
        "UPDATE group_dm_channels SET name=$1 WHERE id=$2"
    ).bind(&name).bind(group_id).execute(&state.db).await?.rows_affected();
    if affected == 0 { return Err(AppError::NotFound("Groupe introuvable".into())); }

    let members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    ).bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    let event = serde_json::json!({
        "type": "GROUP_DM_RENAME",
        "group_id": group_id,
        "name": name,
    }).to_string();
    for uid in members {
        state.broadcast_to_user(uid, event.clone()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true, "name": name })))
}
