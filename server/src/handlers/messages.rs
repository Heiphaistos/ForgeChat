use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use uuid::Uuid;
use chrono::Utc;
use redis::AsyncCommands;

use crate::{
    error::{AppError, Result},
    handlers::audit::log_event,
    handlers::servers::{require_member, require_channel_in_server},
    middleware::auth::Claims,
    models::message::{EditMessageRequest, ForwardMessageRequest, GetMessagesQuery, MessageWithAuthor, SendMessageRequest},
    state::AppState,
};

pub async fn get_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Query(params): Query<GetMessagesQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let limit = params.limit.unwrap_or(50).min(100);

    let messages = if let Some(before) = params.before {
        // Vérifier que le curseur existe avant d'utiliser la subquery (évite le retour silencieux vide si UUID invalide)
        let cursor_ts: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT created_at FROM messages WHERE id=$1 AND channel_id=$2"
        )
        .bind(before).bind(channel_id)
        .fetch_optional(&state.db).await?;

        let ts = cursor_ts.ok_or_else(|| AppError::NotFound("Curseur invalide".into()))?;

        sqlx::query(
            "SELECT m.*, u.username, u.discriminator, u.avatar, u.is_bot, u.is_verified,
                    rm.content as reply_to_content, ru.username as reply_to_username
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN messages rm ON rm.id = m.reply_to
             LEFT JOIN users ru ON ru.id = rm.user_id
             WHERE m.channel_id=$1 AND m.created_at < $2
             AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC LIMIT $3"
        )
        .bind(channel_id).bind(ts).bind(limit)
        .fetch_all(&state.db).await?
    } else {
        sqlx::query(
            "SELECT m.*, u.username, u.discriminator, u.avatar, u.is_bot, u.is_verified,
                    rm.content as reply_to_content, ru.username as reply_to_username
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN messages rm ON rm.id = m.reply_to
             LEFT JOIN users ru ON ru.id = rm.user_id
             WHERE m.channel_id=$1 AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC LIMIT $2"
        )
        .bind(channel_id).bind(limit)
        .fetch_all(&state.db).await?
    };

    use sqlx::Row;
    let msg_ids: Vec<Uuid> = messages.iter().map(|r| r.get("id")).collect();

    // Batch attachments — 1 requête pour tous les messages
    let all_attachments = sqlx::query_as::<_, crate::models::message::Attachment>(
        "SELECT * FROM attachments WHERE message_id = ANY($1) AND (expires_at IS NULL OR expires_at > NOW())"
    )
    .bind(&msg_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Batch reactions — 1 requête pour tous les messages
    let all_reactions = sqlx::query(
        "SELECT r.message_id, r.emoji, COUNT(*) as count,
         bool_or(r.user_id = $2) as me
         FROM reactions r WHERE r.message_id = ANY($1) GROUP BY r.message_id, r.emoji"
    )
    .bind(&msg_ids)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut result = Vec::new();
    for row in &messages {
        let msg_id: Uuid = row.get("id");
        let attachments: Vec<_> = all_attachments.iter()
            .filter(|a| a.message_id == msg_id)
            .cloned()
            .collect();
        let reactions: Vec<crate::models::message::ReactionCount> = all_reactions.iter()
            .filter(|r| r.get::<Uuid, _>("message_id") == msg_id)
            .map(|r| crate::models::message::ReactionCount {
                emoji: r.get("emoji"),
                count: r.get("count"),
                me: r.get("me"),
            })
            .collect();

        result.push(MessageWithAuthor {
            id: msg_id,
            channel_id,
            content: row.get("content"),
            r#type: row.get("type"),
            reply_to: row.get("reply_to"),
            reply_to_content: row.try_get("reply_to_content").ok().flatten(),
            reply_to_username: row.try_get("reply_to_username").ok().flatten(),
            forward_from_id: row.try_get("forward_from_id").ok().flatten(),
            forward_from_username: row.try_get("forward_from_username").ok().flatten(),
            pinned: row.get("pinned"),
            edited_at: row.get("edited_at"),
            created_at: row.get("created_at"),
            author_id: row.get("user_id"),
            author_username: row.get("username"),
            author_discriminator: row.get("discriminator"),
            author_avatar: row.get("avatar"),
            author_is_bot: row.get("is_bot"),
            author_verified: row.try_get("is_verified").unwrap_or(false),
            attachments,
            reactions,
            expires_at: row.try_get("expires_at").ok().flatten(),
            poll_id: row.try_get("poll_id").ok().flatten(),
        });
    }

    result.reverse();
    Ok(Json(result))
}

pub async fn send_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<MessageWithAuthor>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Autoriser contenu vide si des fichiers seront joints (has_attachments flag)
    if body.content.as_ref().map(|c| c.trim().is_empty()).unwrap_or(false) {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }

    // Valider la longueur avant les vérifications coûteuses (spam/slowmode)
    if let Some(c) = &body.content {
        if c.chars().count() > 4000 {
            return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
        }
    }

    // Vérifier si l'utilisateur est en timeout dans ce serveur (server_id déjà validé par require_*)
    let is_timed_out = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    )
    .bind(server_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if is_timed_out {
        return Err(AppError::Forbidden);
    }

    // Enforcement du slowmode
    let slowmode: i32 = sqlx::query_scalar(
        "SELECT slowmode_delay FROM channels WHERE id=$1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .unwrap_or(0);

    if slowmode > 0 {
        let key = format!("slowmode:{}:{}", channel_id, claims.sub);
        let mut redis = state.redis.lock().await;
        let last: Option<i64> = redis.get(&key).await.unwrap_or(None);
        let now = Utc::now().timestamp();
        if let Some(ts) = last {
            let remaining = slowmode as i64 - (now - ts);
            if remaining > 0 {
                return Err(AppError::TooManyRequests);
            }
        }
        let _: () = redis.set_ex(&key, now, (slowmode as u64).saturating_add(5)).await.unwrap_or(());
        drop(redis);
    }

    // Anti-spam atomique : max 5 messages par 3 secondes (UPSERT évite la race condition)
    {
        let new_count: i32 = sqlx::query_scalar(
            "INSERT INTO message_spam_track (user_id, channel_id, count, window_start)
             VALUES ($1, $2, 1, NOW())
             ON CONFLICT (user_id, channel_id) DO UPDATE
             SET count = CASE
                     WHEN NOW() - message_spam_track.window_start >= INTERVAL '3 seconds' THEN 1
                     ELSE message_spam_track.count + 1
                 END,
                 window_start = CASE
                     WHEN NOW() - message_spam_track.window_start >= INTERVAL '3 seconds' THEN NOW()
                     ELSE message_spam_track.window_start
                 END
             RETURNING count"
        )
        .bind(claims.sub)
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;

        if new_count > 5 {
            return Err(AppError::TooManyRequests);
        }
    }

    let content_str: Option<String> = body.content.clone();

    let mention_everyone = content_str.as_deref().map(|c| c.contains("@everyone") || c.contains("@here")).unwrap_or(false);

    // Vérifier permission MENTION_EVERYONE si @everyone ou @here
    if mention_everyone {
        use crate::handlers::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MENTION_EVERYONE)
            .await
            .map_err(|_| AppError::Forbidden)?;
    }

    let expires_at = body.expires_at_seconds.map(|s| Utc::now() + chrono::Duration::seconds(s));

    let msg = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content, reply_to, mention_everyone, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(content_str)
    .bind(body.reply_to)
    .bind(mention_everyone)
    .bind(expires_at)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
        .bind(msg.get::<Uuid, _>("id"))
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    let user = sqlx::query(
        "SELECT username, discriminator, avatar, is_bot, is_verified FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let reply_to_id: Option<Uuid> = msg.get("reply_to");
    let (reply_to_content, reply_to_username) = if let Some(rid) = reply_to_id {
        let row = sqlx::query(
            "SELECT m.content, u.username FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id=$1"
        )
        .bind(rid)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);
        if let Some(r) = row {
            (r.get::<Option<String>, _>("content"), Some(r.get::<String, _>("username")))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let full_msg = MessageWithAuthor {
        id: msg.get("id"),
        channel_id,
        content: msg.get("content"),
        r#type: msg.get("type"),
        reply_to: reply_to_id,
        reply_to_content,
        reply_to_username,
        forward_from_id: None,
        forward_from_username: None,
        pinned: msg.get("pinned"),
        edited_at: msg.get("edited_at"),
        created_at: msg.get("created_at"),
        author_id: claims.sub,
        author_username: user.get("username"),
        author_discriminator: user.get("discriminator"),
        author_avatar: user.get("avatar"),
        author_is_bot: user.try_get("is_bot").unwrap_or(false),
        author_verified: user.try_get("is_verified").unwrap_or(false),
        attachments: vec![],
        reactions: vec![],
        expires_at: msg.try_get("expires_at").ok().flatten(),
        poll_id: None,
    };

    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "server_id": server_id,
        "message": full_msg
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(full_msg))
}

pub async fn edit_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let owner = sqlx::query_scalar::<_, bool>(
        "SELECT user_id=$2 FROM messages WHERE id=$1 AND channel_id=$3"
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if !owner {
        return Err(AppError::Forbidden);
    }

    if body.content.trim().is_empty() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    if body.content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }

    // Sauvegarder l'ancienne version dans l'historique
    sqlx::query(
        "INSERT INTO message_edits (message_id, content)
         SELECT $1, content FROM messages WHERE id=$1 AND content IS NOT NULL"
    )
    .bind(message_id)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "UPDATE messages SET content=$2, edited_at=NOW() WHERE id=$1"
    )
    .bind(message_id)
    .bind(&body.content)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "MESSAGE_UPDATE",
        "message_id": message_id,
        "channel_id": channel_id,
        "content": body.content,
        "edited_at": chrono::Utc::now(),
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let msg_user = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM messages WHERE id=$1 AND channel_id=$2"
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if msg_user != claims.sub {
        // Vérifier permission MANAGE_MESSAGES
        use crate::handlers::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    // Récupérer les fichiers attachés avant la suppression pour nettoyage disque
    let attachment_urls: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM attachments WHERE message_id=$1"
    )
    .bind(message_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    sqlx::query("DELETE FROM messages WHERE id=$1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    // Supprimer les fichiers du disque (fail silencieux — DB est la source de vérité)
    let upload_dir = state.config.upload_dir.clone();
    tokio::spawn(async move {
        for url in attachment_urls {
            if let Some(rel) = url.strip_prefix("/uploads/") {
                let path = std::path::Path::new(&upload_dir).join(rel);
                let _ = tokio::fs::remove_file(&path).await;
            }
        }
    });

    let event = serde_json::json!({
        "type": "MESSAGE_DELETE",
        "message_id": message_id,
        "channel_id": channel_id,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    if msg_user != claims.sub {
        log_event(
            &state, server_id, "MESSAGE_DELETE",
            Some(claims.sub), None,
            Some(message_id), None,
            Some(serde_json::json!({ "channel_id": channel_id, "author_id": msg_user })),
        ).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn add_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    if emoji.is_empty() || emoji.chars().count() > 64 {
        return Err(AppError::BadRequest("Emoji invalide (1-64 chars)".into()));
    }
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Vérifier que le message appartient bien au canal
    let msg_in_channel: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
    ).bind(message_id).bind(channel_id).fetch_one(&state.db).await?;
    if !msg_in_channel { return Err(AppError::NotFound("Message introuvable".into())); }

    sqlx::query(
        "INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING"
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "REACTION_ADD",
        "message_id": message_id,
        "channel_id": channel_id,
        "user_id": claims.sub,
        "emoji": emoji,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    if emoji.is_empty() || emoji.chars().count() > 64 {
        return Err(AppError::BadRequest("Emoji invalide (1-64 chars)".into()));
    }
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Vérifier que le message appartient bien au canal
    let msg_in_channel: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
    ).bind(message_id).bind(channel_id).fetch_one(&state.db).await?;
    if !msg_in_channel { return Err(AppError::NotFound("Message introuvable".into())); }

    sqlx::query(
        "DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3"
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "REACTION_REMOVE",
        "message_id": message_id,
        "channel_id": channel_id,
        "user_id": claims.sub,
        "emoji": emoji,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn pin_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    use crate::handlers::servers::{require_permission, require_channel_in_server};
    use crate::models::role::Permissions;
    require_channel_in_server(&state, channel_id, server_id).await?;
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;

    sqlx::query(
        "INSERT INTO pinned_messages (channel_id, message_id, pinned_by) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING"
    )
    .bind(channel_id)
    .bind(message_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    sqlx::query("UPDATE messages SET pinned=true WHERE id=$1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({
        "type": "MESSAGE_PIN_UPDATE",
        "channel_id": channel_id,
        "message_id": message_id,
        "pinned": true,
        "pinned_by": claims.sub,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;
    log_event(&state, server_id, "MESSAGE_PIN", Some(claims.sub), None, Some(message_id), None,
        Some(serde_json::json!({ "channel_id": channel_id }))).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unpin_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    use crate::handlers::servers::{require_permission, require_channel_in_server};
    use crate::models::role::Permissions;
    require_channel_in_server(&state, channel_id, server_id).await?;
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;

    sqlx::query("DELETE FROM pinned_messages WHERE channel_id=$1 AND message_id=$2")
        .bind(channel_id)
        .bind(message_id)
        .execute(&state.db)
        .await?;

    sqlx::query("UPDATE messages SET pinned=false WHERE id=$1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({
        "type": "MESSAGE_PIN_UPDATE",
        "channel_id": channel_id,
        "message_id": message_id,
        "pinned": false,
    });
    state.broadcast_to_server_members(server_id, event.to_string()).await;
    log_event(&state, server_id, "MESSAGE_UNPIN", Some(claims.sub), None, Some(message_id), None,
        Some(serde_json::json!({ "channel_id": channel_id }))).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn search_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<MessageWithAuthor>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    let q = params.get("q").cloned().unwrap_or_default();
    if q.trim().len() < 2 {
        return Ok(Json(vec![]));
    }

    let q_esc = q.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{}%", q_esc);
    let rows = sqlx::query(
        "SELECT m.*, u.username, u.discriminator, u.avatar, u.is_bot, u.is_verified,
                rm.content as reply_to_content, ru.username as reply_to_username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN messages rm ON rm.id = m.reply_to
         LEFT JOIN users ru ON ru.id = rm.user_id
         WHERE m.channel_id=$1 AND LOWER(m.content) LIKE $2
         ORDER BY m.created_at DESC LIMIT 50"
    )
    .bind(channel_id)
    .bind(&pattern)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = rows.iter().map(|r| MessageWithAuthor {
        id: r.get("id"),
        channel_id,
        content: r.get("content"),
        r#type: r.get("type"),
        reply_to: r.get("reply_to"),
        reply_to_content: r.try_get("reply_to_content").ok().flatten(),
        reply_to_username: r.try_get("reply_to_username").ok().flatten(),
        forward_from_id: r.try_get("forward_from_id").ok().flatten(),
        forward_from_username: r.try_get("forward_from_username").ok().flatten(),
        pinned: r.get("pinned"),
        edited_at: r.get("edited_at"),
        created_at: r.get("created_at"),
        author_id: r.get("user_id"),
        author_username: r.get("username"),
        author_discriminator: r.get("discriminator"),
        author_avatar: r.get("avatar"),
        author_is_bot: r.try_get("is_bot").unwrap_or(false),
        author_verified: r.try_get("is_verified").unwrap_or(false),
        attachments: vec![],
        reactions: vec![],
        expires_at: r.try_get("expires_at").ok().flatten(),
        poll_id: r.try_get("poll_id").ok().flatten(),
    }).collect();

    Ok(Json(result))
}

pub async fn get_message_edits(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Vérifier que le message appartient au canal
    let msg_in_channel: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
    ).bind(message_id).bind(channel_id).fetch_one(&state.db).await?;
    if !msg_in_channel { return Err(AppError::NotFound("Message introuvable".into())); }

    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT content, edited_at FROM message_edits WHERE message_id=$1 ORDER BY edited_at DESC"
    )
    .bind(message_id)
    .fetch_all(&state.db)
    .await?;

    let edits: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "content": r.get::<Option<String>, _>("content"),
        "edited_at": r.get::<chrono::DateTime<Utc>, _>("edited_at"),
    })).collect();

    Ok(Json(edits))
}

/// POST /servers/:server_id/channels/:channel_id/messages/:msg_id/forward
/// Transfère un message vers un autre canal.
pub async fn forward_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<ForwardMessageRequest>,
) -> Result<Json<MessageWithAuthor>> {
    use sqlx::Row;
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Vérifier que le message source existe dans le canal source
    let src = sqlx::query(
        "SELECT m.content, m.type, u.username as author_username
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.id=$1 AND m.channel_id=$2"
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message source introuvable".into()))?;

    let src_content: Option<String> = src.try_get("content").ok().flatten();
    let src_author: String = src.get("author_username");

    // Vérifier que le canal de destination appartient bien à un serveur dont l'user est membre
    let dest_server_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT server_id FROM channels WHERE id=$1"
    )
    .bind(body.channel_id)
    .fetch_optional(&state.db)
    .await?;

    let dest_server_id = dest_server_id
        .ok_or_else(|| AppError::NotFound("Canal de destination introuvable".into()))?;

    // L'user doit être membre du serveur de destination
    require_member(&state, claims.sub, dest_server_id).await?;

    // Insérer le message forwardé dans le canal cible
    let new_msg = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content, forward_from_id, forward_from_username)
         VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(body.channel_id)
    .bind(claims.sub)
    .bind(&src_content)
    .bind(message_id)
    .bind(&src_author)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
        .bind(new_msg.get::<Uuid, _>("id"))
        .bind(body.channel_id)
        .execute(&state.db)
        .await?;

    let user = sqlx::query(
        "SELECT username, discriminator, avatar, is_bot, is_verified FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let full_msg = MessageWithAuthor {
        id: new_msg.get("id"),
        channel_id: body.channel_id,
        content: new_msg.get("content"),
        r#type: new_msg.get("type"),
        reply_to: None,
        reply_to_content: None,
        reply_to_username: None,
        forward_from_id: Some(message_id),
        forward_from_username: Some(src_author),
        pinned: false,
        edited_at: None,
        created_at: new_msg.get("created_at"),
        author_id: claims.sub,
        author_username: user.get("username"),
        author_discriminator: user.get("discriminator"),
        author_avatar: user.get("avatar"),
        author_is_bot: user.try_get("is_bot").unwrap_or(false),
        author_verified: user.try_get("is_verified").unwrap_or(false),
        attachments: vec![],
        reactions: vec![],
        expires_at: None,
        poll_id: None,
    };

    // Broadcast to destination channel's server members
    let dest_server_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT server_id FROM channels WHERE id=$1"
    )
    .bind(body.channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    if let Some(dst_server) = dest_server_id {
        let event = serde_json::json!({
            "type": "MESSAGE_CREATE",
            "server_id": dst_server,
            "message": full_msg
        });
        state.broadcast_to_server_members(dst_server, event.to_string()).await;
    }

    Ok(Json(full_msg))
}

#[derive(serde::Deserialize)]
pub struct ReminderInput {
    pub remind_at: chrono::DateTime<chrono::Utc>,
}

pub async fn set_reminder(
    axum::extract::Path(message_id): axum::extract::Path<uuid::Uuid>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    Json(input): Json<ReminderInput>,
) -> Result<Json<serde_json::Value>> {
    // Vérifier que le message existe ET que l'user est membre du serveur contenant ce canal
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM messages m
            JOIN channels c ON c.id = m.channel_id
            JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $2
            WHERE m.id = $1
         )"
    ).bind(message_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !exists {
        return Err(AppError::NotFound("Message introuvable".into()));
    }

    sqlx::query(
        "INSERT INTO message_reminders (user_id, message_id, remind_at) VALUES ($1, $2, $3)"
    )
    .bind(claims.sub)
    .bind(message_id)
    .bind(input.remind_at)
    .execute(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
pub struct TranslateInput {
    pub target_lang: String,
}

pub async fn translate_message(
    axum::extract::Path(message_id): axum::extract::Path<uuid::Uuid>,
    State(state): State<AppState>,
    axum::Extension(_claims): axum::Extension<crate::middleware::auth::Claims>,
    Json(input): Json<TranslateInput>,
) -> Result<Json<serde_json::Value>> {
    // Valider la langue cible (ISO 639-1, 2-3 chars)
    if input.target_lang.len() > 5 || input.target_lang.is_empty() {
        return Err(AppError::BadRequest("Langue invalide".into()));
    }

    // Vérifier membership via messages→channels→server_members
    let has_access: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM messages m
            JOIN channels c ON c.id = m.channel_id
            JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $2
            WHERE m.id = $1
         )"
    ).bind(message_id).bind(_claims.sub).fetch_one(&state.db).await?;
    if !has_access { return Err(AppError::Forbidden); }

    let msg = sqlx::query_scalar::<_, Option<String>>(
        "SELECT content FROM messages WHERE id = $1"
    ).bind(message_id).fetch_one(&state.db).await?;

    let content = msg.ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if content.trim().is_empty() {
        return Ok(Json(serde_json::json!({ "translated": content })));
    }

    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair=autodetect|{}",
        urlencoding::encode(&content),
        urlencoding::encode(&input.target_lang)
    );

    let resp = state.http_client
        .get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|_| AppError::BadRequest("Service de traduction indisponible".into()))?;

    let json: serde_json::Value = resp.json().await
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Réponse traduction invalide")))?;

    let translated = json["responseData"]["translatedText"]
        .as_str()
        .unwrap_or(&content)
        .to_string();

    Ok(Json(serde_json::json!({
        "translated": translated,
        "lang": input.target_lang,
    })))
}
