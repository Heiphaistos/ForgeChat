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
    pub token_preview: String,
    // Token complet — présent uniquement dans la réponse de create_webhook
    // (revu jamais nulle part ailleurs, même pattern que bots.rs create_bot)
    pub token: Option<String>,
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
        "SELECT id, server_id, channel_id, name, avatar, COALESCE(token_preview, '') AS token_preview, created_by, created_at
         FROM webhooks WHERE server_id=$1 ORDER BY created_at DESC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let webhooks = rows.iter().map(|r| {
        // Jeton jamais stocké en clair : aperçu masqué seulement (« ••••abcd »).
        let token_preview: String = r.get("token_preview");
        WebhookRow {
            id: r.get("id"),
            server_id: r.get("server_id"),
            channel_id: r.get("channel_id"),
            name: r.get("name"),
            avatar: r.get("avatar"),
            token_preview,
            token: None,
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
    let raw_token = data_encoding::HEXLOWER.encode(&rand::random::<[u8; 32]>());
    let preview = token_preview(&raw_token);
    let row = sqlx::query(
        "INSERT INTO webhooks (server_id, channel_id, name, created_by, token_hash, token_preview)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, server_id, channel_id, name, avatar, created_by, created_at"
    )
    .bind(server_id)
    .bind(body.channel_id)
    .bind(&body.name)
    .bind(claims.sub)
    .bind(hash_webhook_token(&raw_token))
    .bind(&preview)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(WebhookRow {
        id: row.get("id"),
        server_id: row.get("server_id"),
        channel_id: row.get("channel_id"),
        name: row.get("name"),
        avatar: row.get("avatar"),
        token_preview: preview,
        // Seule fois où le jeton est montré.
        token: Some(raw_token),
        created_by: row.get("created_by"),
        created_at: row.get("created_at"),
    }))
}

/// SHA-256 hex du jeton (même calcul que la migration 110).
pub fn hash_webhook_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    data_encoding::HEXLOWER.encode(&Sha256::digest(token.as_bytes()))
}

fn token_preview(token: &str) -> String {
    format!("••••{}", &token[token.len().saturating_sub(4)..])
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

// Route publique — POST /api/github-webhook/:channel_id
// Authentifiée par la signature X-Hub-Signature-256 (HMAC du corps avec
// channels.github_webhook_token, le « Secret » saisi dans GitHub). L'ancien
// `?token=` (le secret en clair dans l'URL, donc dans les journaux) reste toléré
// pour les webhooks déjà configurés, mais n'est plus nécessaire.
async fn github_secret(state: &AppState, channel_id: Uuid, token: Option<&str>) -> Result<String, AppError> {
    let stored: Option<String> = sqlx::query_scalar(
        "SELECT github_webhook_token_enc FROM channels WHERE id=$1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .flatten();

    let t = stored.and_then(|s| open_github_token(channel_id, &s)).ok_or(AppError::Forbidden)?;
    if let Some(token) = token {
        // Comparaison en temps constant pour éviter les timing attacks
        let valid = t.len() == token.len()
            && t.bytes().zip(token.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0;
        if !valid {
            return Err(AppError::Unauthorized);
        }
    }
    Ok(t)
}

/// Secret GitHub d'un salon chiffré au repos (migration 115) : le serveur le relit pour vérifier
/// X-Hub-Signature-256, il n'est jamais renvoyé par l'API.
const GITHUB_TOKEN_INFO: &str = "forgechat github token v1";

pub fn seal_github_token(channel_id: Uuid, token: &str) -> String {
    crate::email_crypto::seal_with(GITHUB_TOKEN_INFO, &channel_id.to_string(), token)
}

fn open_github_token(channel_id: Uuid, stored: &str) -> Option<String> {
    crate::email_crypto::open_with(GITHUB_TOKEN_INFO, &channel_id.to_string(), stored)
}

/// Au démarrage : chiffre les secrets GitHub encore en clair puis les efface. Idempotent.
pub async fn migrate_github_tokens(db: &sqlx::PgPool) -> anyhow::Result<u64> {
    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT id, github_webhook_token FROM channels WHERE github_webhook_token IS NOT NULL")
            .fetch_all(db)
            .await?;
    for (id, token) in &rows {
        sqlx::query("UPDATE channels SET github_webhook_token_enc=$2, github_webhook_token=NULL WHERE id=$1")
            .bind(id)
            .bind(seal_github_token(*id, token))
            .execute(db)
            .await?;
    }
    Ok(rows.len() as u64)
}

/// Signature GitHub `sha256=<hex>` du corps avec le secret du salon.
fn github_signature_ok(secret: &str, sig_header: &str, body: &[u8]) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let Some(hex_sig) = sig_header.strip_prefix("sha256=") else { return false };
    let Ok(expected) = data_encoding::HEXLOWER_PERMISSIVE.decode(hex_sig.as_bytes()) else { return false };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else { return false };
    mac.update(body);
    mac.verify_slice(&expected).is_ok()
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
    // Comparaison du token en temps constant, comme verify_github_token_get plus bas
    // dans ce même fichier -- filtrer par `WHERE token=$2` en SQL laisse Postgres
    // faire une comparaison memcmp classique (short-circuit au 1er octet différent),
    // un canal auxiliaire théorique. Fetch par id seul, comparaison XOR-fold en Rust.
    let row = sqlx::query(
        "SELECT w.channel_id, w.name, w.created_by, COALESCE(w.token_hash, '') AS token_hash, c.server_id
         FROM webhooks w JOIN channels c ON c.id = w.channel_id WHERE w.id=$1"
    )
        .bind(webhook_id)
        .fetch_optional(&state.db).await?
        .ok_or(AppError::Unauthorized)?;

    // Haché, comparé en temps constant.
    let stored: String = row.get("token_hash");
    let given = hash_webhook_token(&token);
    let valid = stored.len() == given.len()
        && stored.bytes().zip(given.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0;
    if !valid {
        return Err(AppError::Unauthorized);
    }

    // Rate limit : 10 messages / minute par webhook (fail-closed si Redis down), compté
    // APRÈS le jeton : avant, n'importe qui connaissant l'id épuisait le quota du webhook.
    {
        use redis::AsyncCommands;
        let rl_key = format!("webhook_rl:{}", webhook_id);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&rl_key, 1).await
            .map_err(|_| AppError::Internal(anyhow::anyhow!("rate limit unavailable")))?;
        if count == 1 { let _: () = redis.expire(&rl_key, 60).await.unwrap_or(()); }
        if count > 10 { return Err(AppError::TooManyRequests); }
    }

    let channel_id: Uuid = row.get("channel_id");
    let server_id: Uuid = row.get("server_id");
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

    // Même gap qu'ailleurs sur ce chemin d'écriture séparé de send_message : AutoMod
    // n'était jamais consulté, un webhook pouvait poster le contenu que le filtre du
    // serveur est censé bloquer. `created_by` (créateur du webhook) sert d'identité
    // pour le compteur anti-spam, comme bot_id côté bots.rs.
    if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, created_by, &content).await {
        return Err(err);
    }

    let msg_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type, webhook_display_name)
         VALUES ($1, $2, $3, $4, 'webhook', $5)"
    )
    .bind(msg_id).bind(channel_id).bind(created_by).bind(&content).bind(&webhook_name)
    .execute(&state.db).await?;

    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "channel_id": channel_id,
        "server_id": server_id,
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

    let stored_token = github_secret(&state, channel_id, params.get("token").map(|s| s.as_str())).await?;
    // Signature HMAC-SHA256 GitHub (X-Hub-Signature-256) — obligatoire, vérifiée AVANT
    // le compteur (un tiers ne peut pas épuiser le quota du salon).
    let sig_header = headers.get("X-Hub-Signature-256")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    if !github_signature_ok(&stored_token, sig_header, &body_bytes) {
        return Err(AppError::Unauthorized);
    }

    // Rate limit : 30 événements / minute par canal (fail-closed si Redis down)
    {
        use redis::AsyncCommands;
        let rl_key = format!("gh_webhook_rl:{}", channel_id);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&rl_key, 1).await
            .map_err(|_| AppError::Internal(anyhow::anyhow!("rate limit unavailable")))?;
        if count == 1 { let _: () = redis.expire(&rl_key, 60).await.unwrap_or(()); }
        if count > 30 { return Err(AppError::TooManyRequests); }
    }

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
        "SELECT s.owner_id, c.server_id FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = $1"
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?
    .ok_or_else(|| AppError::NotFound("Canal introuvable".into()))?;

    let owner_id: Uuid = row.get("owner_id");
    let server_id: Uuid = row.get("server_id");
    let msg_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type, webhook_display_name) VALUES ($1, $2, $3, $4, 'webhook', 'GitHub')"
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
        "server_id": server_id,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_token_hash_and_preview() {
        // printf abc | sha256sum
        assert_eq!(hash_webhook_token("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(token_preview("0123456789abcdef"), "••••cdef");
    }

    /// Migration 110 sur une ligne encore en clair : même hachage qu'en Rust, clair effacé,
    /// rejouable sans effet.
    #[tokio::test]
    #[ignore]
    async fn webhook_token_migration_db() {
        let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
        let db = sqlx::PgPool::connect(&url).await.unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let tag = Uuid::new_v4().simple().to_string();
        let u: Uuid = sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
            .bind(&tag[..20]).bind(format!("{tag}@test.local")).fetch_one(&db).await.unwrap();
        let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('w', $1) RETURNING id").bind(u).fetch_one(&db).await.unwrap();
        let c: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'c') RETURNING id").bind(s).fetch_one(&db).await.unwrap();
        let token = format!("{tag}{tag}");
        let w: Uuid = sqlx::query_scalar("INSERT INTO webhooks (server_id, channel_id, name, created_by, token) VALUES ($1, $2, 'w', $3, $4) RETURNING id")
            .bind(s).bind(c).bind(u).bind(&token).fetch_one(&db).await.unwrap();
        for _ in 0..2 {
            sqlx::raw_sql(include_str!("../../migrations/110_webhook_token_hash.sql")).execute(&db).await.unwrap();
        }
        let (clear, hash, preview): (Option<String>, String, String) =
            sqlx::query_as("SELECT token, token_hash, token_preview FROM webhooks WHERE id=$1").bind(w).fetch_one(&db).await.unwrap();
        assert_eq!(clear, None);
        assert_eq!(hash, hash_webhook_token(&token));
        assert_eq!(preview, token_preview(&token));
    }

    #[test]
    fn github_signature() {
        use hmac::{Hmac, Mac};
        let mut mac = Hmac::<sha2::Sha256>::new_from_slice(b"secret-du-salon-1234").unwrap();
        mac.update(b"{}");
        let sig = format!("sha256={}", data_encoding::HEXLOWER.encode(&mac.finalize().into_bytes()));
        assert!(github_signature_ok("secret-du-salon-1234", &sig, b"{}"));
        assert!(!github_signature_ok("autre-secret-du-salon", &sig, b"{}"));
        assert!(!github_signature_ok("secret-du-salon-1234", &sig, b"{ }"));
        assert!(!github_signature_ok("secret-du-salon-1234", "abc", b"{}"));
    }
}
