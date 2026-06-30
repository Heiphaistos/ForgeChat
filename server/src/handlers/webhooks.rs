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
    use crate::handlers::servers::require_channel_in_server;
    require_channel_in_server(&state, body.channel_id, server_id).await?;
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

// Route publique — POST /api/github-webhook/:channel_id?token=...
// Le token doit correspondre à channels.github_webhook_token (configuré par le propriétaire du serveur)
async fn verify_github_token_get(state: &AppState, channel_id: Uuid, token: &str) -> Result<String, AppError> {
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT github_webhook_token FROM channels WHERE id=$1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    match stored {
        Some(t) => {
            // Comparaison en temps constant pour éviter les timing attacks
            let valid = t.len() == token.len()
                && t.bytes().zip(token.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0;
            if valid { Ok(t) } else { Err(AppError::Unauthorized) }
        }
        None => Err(AppError::Forbidden),
    }
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
    // Rate limit : 10 messages / minute par webhook (fail-closed si Redis down)
    {
        use redis::AsyncCommands;
        let rl_key = format!("webhook_rl:{}", webhook_id);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&rl_key, 1).await
            .map_err(|_| AppError::Internal(anyhow::anyhow!("rate limit unavailable")))?;
        if count == 1 { let _: () = redis.expire(&rl_key, 60).await.unwrap_or(()); }
        if count > 10 { return Err(AppError::TooManyRequests); }
    }

    use sqlx::Row;
    let row = sqlx::query("SELECT channel_id, name, created_by FROM webhooks WHERE id=$1 AND token=$2")
        .bind(webhook_id).bind(&token)
        .fetch_optional(&state.db).await?
        .ok_or(AppError::Unauthorized)?;

    let channel_id: Uuid = row.get("channel_id");
    let created_by: Uuid = row.get("created_by");
    let raw_name: String = row.get("name");
    let webhook_name: String = match &body.username {
        Some(u) if !u.trim().is_empty() && u.len() <= 80 => u.trim().to_string(),
        Some(_) => return Err(AppError::BadRequest("username invalide (1-80 chars)".into())),
        None => raw_name,
    };
    let content = body.content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    if content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }

    let msg_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type)
         VALUES ($1, $2, $3, $4, 'webhook')"
    )
    .bind(msg_id).bind(channel_id).bind(created_by).bind(&content)
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

pub async fn receive_github_webhook(
    State(state): State<AppState>,
    axum::extract::Path(channel_id): axum::extract::Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    headers: axum::http::HeaderMap,
    body_bytes: axum::body::Bytes,
) -> Result<axum::response::Response, AppError> {
    use axum::response::IntoResponse;
    use sqlx::Row;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let token = params.get("token").map(|s| s.as_str()).unwrap_or("");
    let stored_token = verify_github_token_get(&state, channel_id, token).await?;

    // Rate limit : 30 événements / minute par canal (fail-closed si Redis down)
    {
        use redis::AsyncCommands;
        let rl_key = format!("gh_webhook_rl:{}", channel_id);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&rl_key, 1).await
            .map_err(|_| AppError::Internal(anyhow::anyhow!("rate limit unavailable")))?;
        if count == 1 { let _: () = redis.expire(&rl_key, 60).await.unwrap_or(()); }
        if count > 30 { return Err(AppError::TooManyRequests.into()); }
    }

    // Vérifier la signature HMAC-SHA256 GitHub (X-Hub-Signature-256) — obligatoire
    let sig_header = headers.get("X-Hub-Signature-256")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    let hex_sig = sig_header.trim_start_matches("sha256=");
    let expected = data_encoding::HEXLOWER.decode(hex_sig.as_bytes())
        .map_err(|_| AppError::Unauthorized)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(stored_token.as_bytes())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("hmac key")))?;
    mac.update(&body_bytes);
    mac.verify_slice(&expected).map_err(|_| AppError::Unauthorized)?;

    let payload: serde_json::Value = serde_json::from_slice(&body_bytes)
        .map_err(|_| AppError::BadRequest("JSON invalide".into()))?;

    let event_type = headers
        .get("X-GitHub-Event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    let message_content = match event_type {
        "push" => {
            let repo = payload["repository"]["full_name"].as_str().unwrap_or("?");
            let pusher = payload["pusher"]["name"].as_str().unwrap_or("?");
            let commits_count = payload["commits"].as_array().map(|a| a.len()).unwrap_or(0);
            let branch = payload["ref"].as_str().unwrap_or("?")
                .trim_start_matches("refs/heads/");
            format!("🔨 **{}** a pushé {} commit(s) sur `{}` — {}", pusher, commits_count, branch, repo)
        }
        "pull_request" => {
            let action = payload["action"].as_str().unwrap_or("?");
            let title = payload["pull_request"]["title"].as_str().unwrap_or("?");
            let user = payload["pull_request"]["user"]["login"].as_str().unwrap_or("?");
            let repo = payload["repository"]["full_name"].as_str().unwrap_or("?");
            let url = payload["pull_request"]["html_url"].as_str().unwrap_or("");
            format!("🔀 **PR {}** par {} — {} — {} {}", action, user, title, repo, url)
        }
        "issues" => {
            let action = payload["action"].as_str().unwrap_or("?");
            let title = payload["issue"]["title"].as_str().unwrap_or("?");
            let user = payload["issue"]["user"]["login"].as_str().unwrap_or("?");
            let repo = payload["repository"]["full_name"].as_str().unwrap_or("?");
            let url = payload["issue"]["html_url"].as_str().unwrap_or("");
            format!("🐛 **Issue {}** par {} — {} — {} {}", action, user, title, repo, url)
        }
        "ping" => {
            return Ok((axum::http::StatusCode::OK, "pong").into_response());
        }
        _ => {
            return Ok((axum::http::StatusCode::OK, "ignored").into_response());
        }
    };

    let row = sqlx::query(
        "SELECT s.owner_id FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = $1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    let owner_id: Uuid = row.get("owner_id");
    let msg_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type) VALUES ($1, $2, $3, $4, 'webhook')"
    )
    .bind(msg_id)
    .bind(channel_id)
    .bind(owner_id)
    .bind(&message_content)
    .execute(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "channel_id": channel_id,
        "message": {
            "id": msg_id,
            "channel_id": channel_id,
            "content": message_content,
            "author_username": "GitHub",
            "type": "webhook",
            "created_at": Utc::now(),
        }
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok((axum::http::StatusCode::OK, "ok").into_response())
}

async fn _check_manage(user_id: Uuid, server_id: Uuid, state: &AppState) -> Result<(), AppError> {
    use crate::handlers::servers::require_permission;
    use crate::models::role::Permissions;
    require_permission(state, user_id, server_id, Permissions::MANAGE_SERVER).await
}
