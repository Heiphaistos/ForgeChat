//! Sauvegarde JSON d'un salon ou d'une catégorie, proposée avant suppression.
//! Même garde que la lecture de l'historique (`get_messages`) : membre du
//! serveur et salon visible (overrides VIEW_CHANNEL compris).

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_member_and_channel},
    middleware::auth::Claims,
    models::channel::{Category, Channel},
    state::AppState,
};

/// ponytail: tout est chargé en mémoire ; au-delà de 50 000 messages seuls les
/// plus récents sont gardés (`truncated`). Passer à un flux si ça ne suffit plus.
const MAX_MESSAGES: i64 = 50_000;

async fn channel_backup(state: &AppState, channel_id: Uuid) -> Result<Value> {
    let channel = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id=$1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    let overrides: Vec<Value> = sqlx::query(
        "SELECT target_id, target_type, allow, deny FROM channel_permissions WHERE channel_id=$1",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|r| json!({
        "target_id": r.get::<Uuid, _>("target_id"),
        "target_type": r.get::<String, _>("target_type"),
        "allow": r.get::<i64, _>("allow"),
        "deny": r.get::<i64, _>("deny"),
    }))
    .collect();

    // Les N plus récents, rendus du plus ancien au plus récent.
    let rows = sqlx::query(
        "SELECT * FROM (
            SELECT m.id, m.user_id, COALESCE(m.webhook_display_name, u.username) AS author_username,
                   m.content, m.created_at, m.edited_at, m.reply_to
            FROM messages m LEFT JOIN users u ON u.id = m.user_id
            WHERE m.channel_id=$1 AND (m.expires_at IS NULL OR m.expires_at > NOW())
            ORDER BY m.created_at DESC, m.id DESC LIMIT $2
         ) t ORDER BY created_at ASC, id ASC",
    )
    .bind(channel_id)
    .bind(MAX_MESSAGES + 1)
    .fetch_all(&state.db)
    .await?;
    let truncated = rows.len() as i64 > MAX_MESSAGES;
    let rows = &rows[usize::from(truncated)..];

    let ids: Vec<Uuid> = rows.iter().map(|r| r.get("id")).collect();
    let mut files: HashMap<Uuid, Vec<Value>> = HashMap::new();
    for a in sqlx::query(
        "SELECT message_id, filename, content_type, size, url FROM attachments WHERE message_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await?
    {
        let Some(mid) = a.get::<Option<Uuid>, _>("message_id") else { continue };
        files.entry(mid).or_default().push(json!({
            "filename": a.get::<String, _>("filename"),
            "content_type": a.get::<String, _>("content_type"),
            "size": a.get::<i64, _>("size"),
            "url": a.get::<String, _>("url"),
        }));
    }

    let messages: Vec<Value> = rows.iter().map(|r| {
        let id: Uuid = r.get("id");
        json!({
            "id": id,
            "author_id": r.get::<Option<Uuid>, _>("user_id"),
            "author_username": r.get::<Option<String>, _>("author_username"),
            "content": r.get::<Option<String>, _>("content"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "edited_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("edited_at"),
            "reply_to": r.get::<Option<Uuid>, _>("reply_to"),
            "attachments": files.remove(&id).unwrap_or_default(),
        })
    }).collect();

    let pins: Vec<Value> = sqlx::query(
        "SELECT message_id, pinned_by, pinned_at FROM pinned_messages WHERE channel_id=$1 ORDER BY pinned_at",
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|r| json!({
        "message_id": r.get::<Uuid, _>("message_id"),
        "pinned_by": r.get::<Option<Uuid>, _>("pinned_by"),
        "pinned_at": r.get::<chrono::DateTime<chrono::Utc>, _>("pinned_at"),
    }))
    .collect();

    Ok(json!({
        "channel": channel,
        "permission_overrides": overrides,
        "message_count": messages.len(),
        "truncated": truncated,
        "messages": messages,
        "pins": pins,
    }))
}

/// GET /channels/:channel_id/backup
pub async fn backup_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let server_id: Uuid = sqlx::query_scalar::<_, Option<Uuid>>("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .flatten()
        .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let mut out = channel_backup(&state, channel_id).await?;
    out["format"] = json!("forgechat-channel-backup/1");
    out["server_id"] = json!(server_id);
    out["exported_at"] = json!(chrono::Utc::now());
    Ok(Json(out))
}

/// GET /servers/:server_id/categories/:category_id/backup — la catégorie et
/// la sauvegarde de chacun de ses salons visibles par l'utilisateur.
pub async fn backup_category(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let category = sqlx::query_as::<_, Category>("SELECT * FROM categories WHERE id=$1 AND server_id=$2")
        .bind(category_id)
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Catégorie introuvable".into()))?;

    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM channels WHERE category_id=$1 AND server_id=$2 ORDER BY position",
    )
    .bind(category_id)
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;
    let forbidden = state.hidden_channels(claims.sub, Some(server_id), None).await?;

    let mut channels = Vec::new();
    for id in ids.into_iter().filter(|id| !forbidden.contains(id)) {
        channels.push(channel_backup(&state, id).await?);
    }

    Ok(Json(json!({
        "format": "forgechat-category-backup/1",
        "server_id": server_id,
        "exported_at": chrono::Utc::now(),
        "category": category,
        "channels": channels,
    })))
}
