use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

use super::servers::require_member_and_channel;
use super::uploads::{attachments_by_owner, remove_upload_files, AttachmentOwner};

#[derive(Debug, Serialize, FromRow)]
pub struct Thread {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub parent_message_id: Option<Uuid>,
    pub title: String,
    pub creator_id: Uuid,
    pub message_count: i32,
    pub last_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    pub archived: bool,
    pub locked: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ThreadMessage {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub reply_to: Option<Uuid>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateThreadReq {
    pub title: Option<String>,
    pub first_message: String,
    pub parent_message_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct SendThreadMessageReq {
    #[serde(default)]
    pub content: String,
    pub reply_to: Option<Uuid>,
    /// Le client joint des fichiers juste après : le texte peut alors être vide.
    #[serde(default)]
    pub has_attachments: bool,
}

/// Pagination par curseur : `before` = id du dernier élément déjà reçu.
/// Le curseur réel est le couple (horodatage, id), stable même si plusieurs
/// éléments partagent le même horodatage (import en masse).
#[derive(Debug, Deserialize)]
pub struct CursorQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

impl CursorQuery {
    pub fn limit(&self) -> i64 { self.limit.unwrap_or(50).clamp(1, 100) }
}

#[derive(Debug, Deserialize)]
pub struct ListThreadsQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
    /// Recherche du fil ouvert depuis un message du salon
    pub parent_message_id: Option<Uuid>,
    /// Recherche d'un fil précis (ouverture depuis la liste ou une notification)
    pub thread_id: Option<Uuid>,
}

pub async fn list_threads(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<ListThreadsQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);

    // unread_count : messages des autres postés après le dernier lu. Sans ligne
    // thread_reads (fil jamais suivi), la comparaison avec NULL ne compte rien.
    let threads = sqlx::query(
        "SELECT t.*, COALESCE(t.webhook_display_name, u.username) as creator_username, NULLIF(COALESCE(t.webhook_avatar_url, u.avatar), '') as creator_avatar,
                COALESCE(t.last_reply_at, t.created_at) AS last_activity,
                (SELECT COUNT(*) FROM thread_messages tm
                  WHERE tm.thread_id = t.id AND tm.user_id <> $2 AND tm.created_at > tr.last_read_at) AS unread_count
         FROM threads t
         JOIN users u ON u.id = t.creator_id
         LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = $2
         WHERE t.channel_id = $1
           AND ($3::uuid IS NULL OR t.parent_message_id = $3)
           AND ($4::uuid IS NULL OR t.id = $4)
           AND ($5::uuid IS NULL OR (COALESCE(t.last_reply_at, t.created_at), t.id) <
                (SELECT COALESCE(c.last_reply_at, c.created_at), c.id FROM threads c WHERE c.id = $5 AND c.channel_id = $1))
         ORDER BY COALESCE(t.last_reply_at, t.created_at) DESC, t.id DESC
         LIMIT $6"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(q.parent_message_id)
    .bind(q.thread_id)
    .bind(q.before)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = threads.iter().map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "channel_id": r.get::<Uuid, _>("channel_id"),
            "parent_message_id": r.get::<Option<Uuid>, _>("parent_message_id"),
            "title": r.get::<String, _>("title"),
            "creator_id": r.get::<Uuid, _>("creator_id"),
            "creator_username": r.get::<String, _>("creator_username"),
            "creator_avatar": r.get::<Option<String>, _>("creator_avatar"),
            "message_count": r.get::<i32, _>("message_count"),
            "unread_count": r.get::<i64, _>("unread_count"),
            "last_reply_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_reply_at"),
            "last_activity": r.get::<chrono::DateTime<chrono::Utc>, _>("last_activity"),
            "archived": r.get::<bool, _>("archived"),
            "locked": r.get::<bool, _>("locked"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        })
    }).collect();

    Ok(Json(result))
}

pub async fn create_thread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateThreadReq>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;

    if body.first_message.trim().is_empty() {
        return Err(AppError::BadRequest("Message vide".into()));
    }
    if body.first_message.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }
    let first_msg = body.first_message.clone();

    let title = body.title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| first_msg.chars().take(50).collect::<String>());

    // Jamais vérifié sur ce chemin de création de message (comme send_thread_message
    // plus bas, et comme bots.rs/webhooks.rs avant leur fix) -- un thread contournait
    // entièrement le filtre AutoMod du serveur.
    if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, first_msg.trim()).await {
        return Err(err);
    }

    let mut tx = state.db.begin().await?;

    let thread = sqlx::query_as::<_, Thread>(
        "INSERT INTO threads (channel_id, parent_message_id, title, creator_id, last_reply_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *"
    )
    .bind(channel_id)
    .bind(body.parent_message_id)
    .bind(&title)
    .bind(claims.sub)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO thread_messages (thread_id, user_id, content) VALUES ($1, $2, $3)"
    )
    .bind(thread.id)
    .bind(claims.sub)
    .bind(first_msg.trim())
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE threads SET message_count = 1 WHERE id = $1"
    )
    .bind(thread.id)
    .execute(&mut *tx)
    .await?;

    // Le créateur suit son fil : ses non-lus partent de maintenant.
    sqlx::query(
        "INSERT INTO thread_reads (user_id, thread_id, last_read_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, thread_id) DO NOTHING"
    )
    .bind(claims.sub)
    .bind(thread.id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let event = serde_json::json!({
        "type": "THREAD_CREATE",
        "channel_id": channel_id,
        "thread": thread,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "thread": thread })))
}

/// POST .../threads/:thread_id/ack : marque le fil lu jusqu'à son dernier message.
pub async fn ack_thread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    // GREATEST : un ack en retard ne fait jamais reculer la position de lecture.
    let done = sqlx::query(
        "INSERT INTO thread_reads (user_id, thread_id, last_read_at)
         SELECT $1, t.id, COALESCE((SELECT MAX(tm.created_at) FROM thread_messages tm WHERE tm.thread_id = t.id), NOW())
         FROM threads t WHERE t.id = $2 AND t.channel_id = $3
         ON CONFLICT (user_id, thread_id)
         DO UPDATE SET last_read_at = GREATEST(thread_reads.last_read_at, EXCLUDED.last_read_at)"
    )
    .bind(claims.sub)
    .bind(thread_id)
    .bind(channel_id)
    .execute(&state.db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("Thread introuvable".into()));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_thread_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
    Query(q): Query<CursorQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    let thread_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM threads WHERE id=$1 AND channel_id=$2)"
    )
    .bind(thread_id).bind(channel_id)
    .fetch_one(&state.db).await?;
    if !thread_ok { return Err(AppError::NotFound("Thread introuvable".into())); }

    // Page la plus récente (ou antérieure au curseur), renvoyée en ordre chronologique.
    let mut rows = sqlx::query(
        "SELECT tm.*, COALESCE(tm.webhook_display_name, u.username) AS username, NULLIF(COALESCE(tm.webhook_avatar_url, u.avatar), '') AS avatar, u.discriminator,
                rm.content AS reply_to_content, COALESCE(rm.webhook_display_name, ru.username) AS reply_to_username
         FROM thread_messages tm
         JOIN users u ON u.id = tm.user_id
         LEFT JOIN thread_messages rm ON rm.id = tm.reply_to AND rm.thread_id = tm.thread_id
         LEFT JOIN users ru ON ru.id = rm.user_id
         WHERE tm.thread_id = $1
           AND ($2::uuid IS NULL OR (tm.created_at, tm.id) <
                (SELECT c.created_at, c.id FROM thread_messages c WHERE c.id = $2 AND c.thread_id = $1))
         ORDER BY tm.created_at DESC, tm.id DESC
         LIMIT $3"
    )
    .bind(thread_id)
    .bind(q.before)
    .bind(q.limit())
    .fetch_all(&state.db)
    .await?;
    rows.reverse();

    // Reactions groupees par message
    let msg_ids: Vec<Uuid> = { use sqlx::Row; rows.iter().map(|r| r.get::<Uuid, _>("id")).collect() };
    let reaction_rows = if msg_ids.is_empty() { vec![] } else {
        sqlx::query(
            "SELECT r.thread_message_id, r.emoji, COUNT(*) as count, bool_or(r.user_id=$2) as me,
                    array_agg(u.username ORDER BY r.created_at) as users
             FROM thread_message_reactions r JOIN users u ON u.id = r.user_id
             WHERE r.thread_message_id = ANY($1)
             GROUP BY r.thread_message_id, r.emoji"
        )
        .bind(&msg_ids).bind(claims.sub)
        .fetch_all(&state.db).await.unwrap_or_default()
    };
    let mut react_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &reaction_rows {
        use sqlx::Row;
        let mid = r.get::<Uuid, _>("thread_message_id");
        react_map.entry(mid).or_default().push(serde_json::json!({
            "emoji": r.get::<String, _>("emoji"),
            "count": r.get::<i64, _>("count"),
            "me": r.get::<bool, _>("me"),
            "users": r.get::<Vec<String>, _>("users"),
        }));
    }
    let mut att_map = attachments_by_owner(&state, AttachmentOwner::ThreadMessage, &msg_ids).await;

    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        use sqlx::Row;
        let id = r.get::<Uuid, _>("id");
        serde_json::json!({
            "id": id,
            "thread_id": r.get::<Uuid, _>("thread_id"),
            "user_id": r.get::<Uuid, _>("user_id"),
            "content": r.get::<String, _>("content"),
            "reply_to": r.get::<Option<Uuid>, _>("reply_to"),
            "reply_to_content": r.get::<Option<String>, _>("reply_to_content"),
            "reply_to_username": r.get::<Option<String>, _>("reply_to_username"),
            "edited_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("edited_at"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author": {
                "id": r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "discriminator": r.get::<String, _>("discriminator"),
            },
            "reactions": react_map.get(&id).cloned().unwrap_or_default(),
            "attachments": att_map.remove(&id).unwrap_or_default(),
        })
    }).collect();

    Ok(Json(result))
}

// Toggle d une reaction sur un message de thread (meme pattern que les groupes)
pub async fn toggle_thread_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id, msg_id, emoji)): Path<(Uuid, Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    crate::handlers::servers::require_not_timed_out(&state, claims.sub, server_id).await?;

    let msg_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
         WHERE tm.id=$1 AND tm.thread_id=$2 AND t.channel_id=$3)"
    ).bind(msg_id).bind(thread_id).bind(channel_id).fetch_one(&state.db).await?;
    if !msg_ok { return Err(AppError::NotFound("Message introuvable".into())); }

    let emoji = emoji.trim().to_string();
    if emoji.is_empty() || emoji.chars().count() > 16 {
        return Err(AppError::BadRequest("Emoji invalide".into()));
    }

    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM thread_message_reactions WHERE thread_message_id=$1 AND user_id=$2 AND emoji=$3)"
    ).bind(msg_id).bind(claims.sub).bind(&emoji).fetch_one(&state.db).await?;

    let added = if existing {
        sqlx::query(
            "DELETE FROM thread_message_reactions WHERE thread_message_id=$1 AND user_id=$2 AND emoji=$3"
        ).bind(msg_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        false
    } else {
        sqlx::query(
            "INSERT INTO thread_message_reactions (thread_message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
        ).bind(msg_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        true
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM thread_message_reactions WHERE thread_message_id=$1 AND emoji=$2"
    ).bind(msg_id).bind(&emoji).fetch_one(&state.db).await?;

    let event = serde_json::json!({
        "type": "THREAD_REACTION_TOGGLE",
        "thread_id": thread_id,
        "channel_id": channel_id,
        "message_id": msg_id,
        "emoji": emoji,
        "added": added,
        "count": count,
        "user_id": claims.sub,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "added": added, "count": count })))
}

pub async fn send_thread_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<SendThreadMessageReq>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;

    let content_trimmed = body.content.trim().to_string();
    if content_trimmed.is_empty() && !body.has_attachments {
        return Err(AppError::BadRequest("Message vide".into()));
    }
    if content_trimmed.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }

    // Vérifier le timeout (sourdine)
    let is_timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if is_timed_out { return Err(AppError::Forbidden); }

    use sqlx::Row;
    let thread_row = sqlx::query(
        "SELECT locked, archived, title, creator_id FROM threads WHERE id=$1 AND channel_id=$2"
    )
    .bind(thread_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread introuvable".into()))?;

    if thread_row.get::<bool, _>("locked") || thread_row.get::<bool, _>("archived") {
        return Err(AppError::Forbidden);
    }

    // Réponse : le message cité doit appartenir au même fil.
    let reply_ctx = match body.reply_to {
        None => None,
        Some(rid) => Some(sqlx::query(
            "SELECT tm.content, COALESCE(tm.webhook_display_name, u.username) AS username
             FROM thread_messages tm JOIN users u ON u.id = tm.user_id
             WHERE tm.id = $1 AND tm.thread_id = $2"
        )
        .bind(rid)
        .bind(thread_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::BadRequest("Message cité introuvable dans ce fil".into()))?),
    };

    if !content_trimmed.is_empty() {
        if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, &content_trimmed).await {
            return Err(err);
        }
    }

    let msg = sqlx::query_as::<_, ThreadMessage>(
        "INSERT INTO thread_messages (thread_id, user_id, content, reply_to) VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(thread_id)
    .bind(claims.sub)
    .bind(&content_trimmed)
    .bind(body.reply_to)
    .fetch_one(&state.db)
    .await?;

    sqlx::query(
        "UPDATE threads SET message_count = message_count + 1, last_reply_at = NOW() WHERE id = $1"
    )
    .bind(thread_id)
    .execute(&state.db)
    .await?;

    // L'auteur a lu son propre message : il suit désormais le fil.
    sqlx::query(
        "INSERT INTO thread_reads (user_id, thread_id, last_read_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, thread_id)
         DO UPDATE SET last_read_at = GREATEST(thread_reads.last_read_at, EXCLUDED.last_read_at)"
    )
    .bind(claims.sub)
    .bind(thread_id)
    .bind(msg.created_at)
    .execute(&state.db)
    .await?;

    // Destinataires d'une notification : auteur du fil + tous ceux qui y ont écrit.
    // Le client filtre (pas soi-même, pas si le fil est déjà ouvert).
    let creator_id: Uuid = thread_row.get("creator_id");
    let notify_user_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT user_id FROM thread_messages WHERE thread_id = $1
         UNION SELECT $2::uuid"
    )
    .bind(thread_id)
    .bind(creator_id)
    .fetch_all(&state.db)
    .await?;

    let author_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;

    let mut msg_json = serde_json::to_value(&msg).map_err(|e| AppError::Internal(e.into()))?;
    msg_json["author_username"] = serde_json::json!(author_username);
    msg_json["reply_to_content"] = serde_json::json!(reply_ctx.as_ref().map(|r| r.get::<String, _>("content")));
    msg_json["reply_to_username"] = serde_json::json!(reply_ctx.as_ref().map(|r| r.get::<String, _>("username")));

    // Broadcast en temps réel aux membres qui voient le salon
    let event = serde_json::json!({
        "type": "THREAD_MESSAGE",
        "thread_id": thread_id,
        "thread_title": thread_row.get::<String, _>("title"),
        "channel_id": channel_id,
        "server_id": server_id,
        "message": msg_json,
        "notify_user_ids": notify_user_ids,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "message": msg_json })))
}

pub async fn archive_thread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Thread>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    // Vérifier que l'utilisateur est le créateur du thread OU a la permission MANAGE_MESSAGES
    let thread_row = sqlx::query(
        "SELECT creator_id FROM threads WHERE id = $1 AND channel_id = $2"
    )
    .bind(thread_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Thread introuvable".into()))?;

    use sqlx::Row;
    let creator_id: Uuid = thread_row.get("creator_id");
    let archived = body["archived"].as_bool().unwrap_or(true);
    let locked = body["locked"].as_bool();

    // Locker un thread nécessite toujours MANAGE_MESSAGES (pas juste être créateur)
    // Archiver : créateur OU modérateur
    if locked.is_some() {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    } else if creator_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    let thread = if let Some(locked) = locked {
        sqlx::query_as::<_, Thread>(
            "UPDATE threads SET archived = $2, locked = $3 WHERE id = $1 RETURNING *"
        )
        .bind(thread_id)
        .bind(archived)
        .bind(locked)
        .fetch_one(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, Thread>(
            "UPDATE threads SET archived = $2 WHERE id = $1 RETURNING *"
        )
        .bind(thread_id)
        .bind(archived)
        .fetch_one(&state.db)
        .await?
    };

    state.broadcast_to_channel_members(channel_id, serde_json::json!({
        "type": "THREAD_UPDATE",
        "thread_id": thread.id,
        "channel_id": channel_id,
        "server_id": server_id,
        "archived": thread.archived,
        "locked": thread.locked,
    }).to_string()).await;

    Ok(Json(thread))
}

#[derive(Deserialize)]
pub struct EditThreadMessageBody {
    pub content: String,
}

pub async fn edit_thread_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id, msg_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
    Json(body): Json<EditThreadMessageBody>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let content = body.content.trim().to_string();
    if content.is_empty() || content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Contenu invalide (1-4000 caractères)".into()));
    }

    let rows = sqlx::query(
        "UPDATE thread_messages SET content=$1, edited_at=NOW()
         WHERE id=$2 AND thread_id=$3 AND user_id=$4
           AND thread_id IN (SELECT id FROM threads WHERE channel_id=$5)"
    )
    .bind(&content)
    .bind(msg_id)
    .bind(thread_id)
    .bind(claims.sub)
    .bind(channel_id)
    .execute(&state.db)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }

    state.broadcast_to_channel_members(channel_id, serde_json::json!({
        "type": "THREAD_MESSAGE_EDIT",
        "thread_id": thread_id,
        "channel_id": channel_id,
        "message_id": msg_id,
        "content": content,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_thread_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id, msg_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    use sqlx::Row;
    let row = sqlx::query(
        // Le fil doit appartenir au salon passé dans l'URL : sinon un modérateur de
        // SON serveur supprimait les messages de fil d'un autre serveur.
        "SELECT tm.user_id FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
         WHERE tm.id=$1 AND tm.thread_id=$2 AND t.channel_id=$3"
    )
    .bind(msg_id)
    .bind(thread_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    let author_id: Uuid = row.get("user_id");
    if author_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    // Fichiers joints : récupérés avant la cascade pour les supprimer du disque.
    let attachment_urls: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM attachments WHERE thread_message_id=$1"
    )
    .bind(msg_id)
    .fetch_all(&state.db)
    .await?;

    sqlx::query("DELETE FROM thread_messages WHERE id=$1 AND thread_id=$2")
        .bind(msg_id)
        .bind(thread_id)
        .execute(&state.db)
        .await?;
    // Le compteur affiché dans la liste des fils ne baissait jamais.
    sqlx::query("UPDATE threads SET message_count = GREATEST(message_count - 1, 0) WHERE id=$1")
        .bind(thread_id)
        .execute(&state.db)
        .await?;
    remove_upload_files(&state, attachment_urls);

    state.broadcast_to_channel_members(channel_id, serde_json::json!({
        "type": "THREAD_MESSAGE_DELETE",
        "thread_id": thread_id,
        "channel_id": channel_id,
        "message_id": msg_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

