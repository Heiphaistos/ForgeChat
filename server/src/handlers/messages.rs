use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_member,
    middleware::auth::Claims,
    models::message::{EditMessageRequest, GetMessagesQuery, MessageWithAuthor, SendMessageRequest},
    state::AppState,
};

pub async fn get_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Query(params): Query<GetMessagesQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>> {
    require_member(&state, claims.sub, server_id).await?;

    let limit = params.limit.unwrap_or(50).min(100);

    let messages = if let Some(before) = params.before {
        sqlx::query(
            "SELECT m.*, u.username, u.discriminator, u.avatar
             FROM messages m JOIN users u ON u.id = m.user_id
             WHERE m.channel_id=$1 AND m.created_at < (SELECT created_at FROM messages WHERE id=$2)
             ORDER BY m.created_at DESC LIMIT $3"
        )
        .bind(channel_id).bind(before).bind(limit)
        .fetch_all(&state.db).await?
    } else {
        sqlx::query(
            "SELECT m.*, u.username, u.discriminator, u.avatar
             FROM messages m JOIN users u ON u.id = m.user_id
             WHERE m.channel_id=$1
             ORDER BY m.created_at DESC LIMIT $2"
        )
        .bind(channel_id).bind(limit)
        .fetch_all(&state.db).await?
    };

    let mut result = Vec::new();
    for row in &messages {
        use sqlx::Row;
        let msg_id: Uuid = row.get("id");

        let attachments = sqlx::query_as::<_, crate::models::message::Attachment>(
            "SELECT * FROM attachments WHERE message_id=$1"
        )
        .bind(msg_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let reactions: Vec<crate::models::message::ReactionCount> = sqlx::query(
            "SELECT emoji, COUNT(*) as count,
             EXISTS(SELECT 1 FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=r.emoji) as me
             FROM reactions r WHERE message_id=$1 GROUP BY emoji"
        )
        .bind(msg_id)
        .bind(claims.sub)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
        .iter()
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
            pinned: row.get("pinned"),
            edited_at: row.get("edited_at"),
            created_at: row.get("created_at"),
            author_id: row.get("user_id"),
            author_username: row.get("username"),
            author_discriminator: row.get("discriminator"),
            author_avatar: row.get("avatar"),
            attachments,
            reactions,
        });
    }

    // Retourner dans l'ordre chronologique
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

    if body.content.as_ref().map(|c| c.trim().is_empty()).unwrap_or(true) {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }

    let content = body.content.as_ref().map(|c| {
        if c.len() > 4000 { &c[..4000] } else { c }
    });

    let msg = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content, reply_to)
         VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(content)
    .bind(body.reply_to)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
        .bind(msg.get::<Uuid, _>("id"))
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    let user = sqlx::query(
        "SELECT username, discriminator, avatar FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let full_msg = MessageWithAuthor {
        id: msg.get("id"),
        channel_id,
        content: msg.get("content"),
        r#type: msg.get("type"),
        reply_to: msg.get("reply_to"),
        pinned: msg.get("pinned"),
        edited_at: msg.get("edited_at"),
        created_at: msg.get("created_at"),
        author_id: claims.sub,
        author_username: user.get("username"),
        author_discriminator: user.get("discriminator"),
        author_avatar: user.get("avatar"),
        attachments: vec![],
        reactions: vec![],
    };

    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "message": full_msg
    });
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(full_msg))
}

pub async fn edit_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let owner = sqlx::query_scalar::<_, bool>(
        "SELECT user_id=$2 FROM messages WHERE id=$1"
    )
    .bind(message_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if !owner {
        return Err(AppError::Forbidden);
    }

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
        "content": body.content,
        "edited_at": chrono::Utc::now(),
    });
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let msg_user = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM messages WHERE id=$1"
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if msg_user != claims.sub {
        // Vérifier permission MANAGE_MESSAGES
        use crate::handlers::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    sqlx::query("DELETE FROM messages WHERE id=$1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({
        "type": "MESSAGE_DELETE",
        "message_id": message_id,
        "channel_id": channel_id,
    });
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn add_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

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
        "user_id": claims.sub,
        "emoji": emoji,
    });
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

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
        "user_id": claims.sub,
        "emoji": emoji,
    });
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn pin_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

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
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unpin_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

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
    state.broadcast_to_channel(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn search_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<MessageWithAuthor>>> {
    require_member(&state, claims.sub, server_id).await?;

    let q = params.get("q").cloned().unwrap_or_default();
    if q.trim().len() < 2 {
        return Ok(Json(vec![]));
    }

    let pattern = format!("%{}%", q.to_lowercase());
    let rows = sqlx::query(
        "SELECT m.*, u.username, u.discriminator, u.avatar
         FROM messages m JOIN users u ON u.id = m.user_id
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
        pinned: r.get("pinned"),
        edited_at: r.get("edited_at"),
        created_at: r.get("created_at"),
        author_id: r.get("user_id"),
        author_username: r.get("username"),
        author_discriminator: r.get("discriminator"),
        author_avatar: r.get("avatar"),
        attachments: vec![],
        reactions: vec![],
    }).collect();

    Ok(Json(result))
}
