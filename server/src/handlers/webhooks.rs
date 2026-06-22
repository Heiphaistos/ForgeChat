use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

#[derive(Serialize)]
pub struct WebhookRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub name: String,
    pub avatar: Option<String>,
    // Token masqué dans la liste — retourné uniquement à la création
    pub token_preview: String,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

pub async fn list_webhooks(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<WebhookRow>>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, server_id, channel_id, name, avatar, token, created_by, created_at
         FROM webhooks WHERE server_id=$1 ORDER BY created_at DESC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let webhooks = rows.iter().map(|r| {
        let token: String = r.get("token");
        // Masquer le token — afficher uniquement les 8 premiers chars + "..."
        let token_preview = format!("{}...", &token[..token.len().min(8)]);
        WebhookRow {
            id: r.get("id"),
            server_id: r.get("server_id"),
            channel_id: r.get("channel_id"),
            name: r.get("name"),
            avatar: r.get("avatar"),
            token_preview,
            created_by: r.get("created_by"),
            created_at: r.get("created_at"),
        }
    }).collect();

    Ok(Json(webhooks))
}

#[derive(Deserialize)]
pub struct CreateWebhookBody {
    pub name: String,
    pub channel_id: Uuid,
}

pub async fn create_webhook(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateWebhookBody>,
) -> Result<Json<WebhookRow>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    if body.name.trim().is_empty() || body.name.len() > 100 {
        return Err(AppError::BadRequest("Nom invalide".into()));
    }
    use sqlx::Row;
    let row = sqlx::query(
        "INSERT INTO webhooks (server_id, channel_id, name, created_by)
         VALUES ($1,$2,$3,$4)
         RETURNING id, server_id, channel_id, name, avatar, token, created_by, created_at"
    )
    .bind(server_id)
    .bind(body.channel_id)
    .bind(&body.name)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(WebhookRow {
        id: row.get("id"),
        server_id: row.get("server_id"),
        channel_id: row.get("channel_id"),
        name: row.get("name"),
        avatar: row.get("avatar"),
        token_preview: { let t: String = row.get("token"); format!("{}...", &t[..t.len().min(8)]) },
        created_by: row.get("created_by"),
        created_at: row.get("created_at"),
    }))
}

pub async fn delete_webhook(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, webhook_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    sqlx::query("DELETE FROM webhooks WHERE id=$1 AND server_id=$2")
        .bind(webhook_id).bind(server_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// Route publique — POST /api/webhook/:id/:token
#[derive(Deserialize)]
pub struct WebhookMessageBody {
    pub content: String,
    pub username: Option<String>,
}

pub async fn execute_webhook(
    State(state): State<AppState>,
    Path((webhook_id, token)): Path<(Uuid, String)>,
    Json(body): Json<WebhookMessageBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sqlx::Row;
    let row = sqlx::query("SELECT channel_id, name, server_id FROM webhooks WHERE id=$1 AND token=$2")
        .bind(webhook_id).bind(&token)
        .fetch_optional(&state.db).await?
        .ok_or(AppError::Unauthorized)?;

    let channel_id: Uuid = row.get("channel_id");
    let server_id: Uuid = row.get("server_id");
    let webhook_name: String = body.username.clone().unwrap_or_else(|| row.get("name"));
    let content = body.content.trim().to_string();
    if content.is_empty() || content.len() > 4000 {
        return Err(AppError::BadRequest("Contenu invalide".into()));
    }

    let msg_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type)
         SELECT $1, $2, owner_id, $3, 'webhook'
         FROM servers WHERE id=$4"
    )
    .bind(msg_id).bind(channel_id).bind(&content).bind(server_id)
    .execute(&state.db).await?;

    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "channel_id": channel_id,
        "message": {
            "id": msg_id,
            "channel_id": channel_id,
            "content": content,
            "author_username": webhook_name,
            "type": "webhook",
            "created_at": Utc::now(),
        }
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "id": msg_id })))
}

async fn _check_manage(user_id: Uuid, server_id: Uuid, state: &AppState) -> Result<(), AppError> {
    use crate::handlers::servers::require_permission;
    use crate::models::role::Permissions;
    require_permission(state, user_id, server_id, Permissions::MANAGE_SERVER).await
}
