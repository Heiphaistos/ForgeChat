//! Mot de passe oublié : jeton opaque aléatoire envoyé par e-mail, stocké haché
//! dans Redis (30 min, usage unique). Pas de table : un jeton perdu au
//! redémarrage de Redis se redemande simplement.

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    Json,
};
use bcrypt::{hash, DEFAULT_COST};
use rand::Rng;
use redis::AsyncCommands;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::{hash_token, revoke_all_tokens},
    state::AppState,
};

const TOKEN_TTL_SECS: u64 = 30 * 60;
/// Compte fantôme « Utilisateur supprimé » (migration 063) : jamais réinitialisable.
const DELETED_USER: &str = "00000000-0000-0000-0000-00000000dead";

fn client_ip(headers: &HeaderMap, addr: &SocketAddr) -> String {
    headers
        .get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| addr.ip().to_string())
}

/// Incrémente un compteur Redis ; `true` si la limite est dépassée.
async fn over_limit(state: &AppState, key: &str, max: i64, window_secs: i64) -> bool {
    let mut redis = state.redis.lock().await;
    let count: i64 = redis.incr(key, 1).await.unwrap_or(0);
    if count == 1 {
        let _: () = redis.expire(key, window_secs).await.unwrap_or(());
    }
    count > max
}

fn token_key(token_hash: &str) -> String {
    format!("pwreset:{token_hash}")
}
fn user_key(user_id: Uuid) -> String {
    format!("pwreset_user:{user_id}")
}

/// POST /api/auth/forgot-password { email }
/// Réponse identique que le compte existe ou non (pas d'énumération d'e-mails).
pub async fn forgot_password(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let email = body["email"].as_str().unwrap_or("").trim().to_lowercase();
    if email.is_empty() || email.len() > 254 || !email.contains('@') {
        return Err(AppError::BadRequest("Email invalide".into()));
    }
    let ip = client_ip(&headers, &addr);
    if over_limit(&state, &format!("pwreset_ip:{ip}"), 5, 900).await {
        return Err(AppError::TooManyRequests);
    }
    let ok = Json(serde_json::json!({ "ok": true }));
    // Par e-mail : 3 demandes / heure. Au-delà on répond pareil sans rien envoyer,
    // pour ne pas révéler l'existence du compte ni permettre d'inonder une boîte.
    if over_limit(&state, &format!("pwreset_mail:{email}"), 3, 3600).await {
        return Ok(ok);
    }

    let user: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, username FROM users WHERE email=$1 AND is_bot=false AND id <> $2::uuid",
    )
    .bind(&email)
    .bind(DELETED_USER)
    .fetch_optional(&state.db)
    .await?;
    let Some((user_id, username)) = user else { return Ok(ok) };

    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let token_hash = hash_token(&token);
    {
        let mut redis = state.redis.lock().await;
        // Un seul lien valide à la fois : la nouvelle demande annule la précédente.
        let old: Option<String> = redis.get(user_key(user_id)).await.unwrap_or(None);
        if let Some(old) = old {
            let _: () = redis.del(token_key(&old)).await.unwrap_or(());
        }
        let _: () = redis
            .set_ex(token_key(&token_hash), user_id.to_string(), TOKEN_TTL_SECS)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        let _: () = redis.set_ex(user_key(user_id), &token_hash, TOKEN_TTL_SECS).await.unwrap_or(());
    }

    // Jeton dans le fragment (#) : jamais envoyé au serveur ni dans un Referer.
    let link = format!(
        "{}/reset-password#token={}",
        state.config.frontend_url.trim_end_matches('/'),
        token
    );
    let html = format!(
        r#"<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1e1f22;color:#dbdee1;padding:32px">
<div style="max-width:480px;margin:auto;background:#313338;border-radius:12px;padding:32px">
  <h2 style="color:#5865f2;margin-top:0">Réinitialiser ton mot de passe</h2>
  <p>Bonjour {name}, une réinitialisation du mot de passe de ton compte ForgeChat a été demandée.</p>
  <p style="text-align:center;margin:28px 0"><a href="{link}" style="background:#5865f2;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Choisir un nouveau mot de passe</a></p>
  <p style="color:#949ba4;font-size:13px">Ce lien expire dans 30 minutes et ne sert qu'une fois. Si tu n'es pas à l'origine de cette demande, ignore cet e-mail.</p>
</div></body></html>"#,
        name = html_escape(&username),
        link = link,
    );
    // Envoi en tâche de fond : le temps de réponse ne dépend pas de l'existence du compte.
    let config = state.config.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::email::send_email(&config, &email, "Réinitialisation du mot de passe — ForgeChat", html).await {
            tracing::warn!("envoi e-mail de réinitialisation échoué : {e}");
        }
    });
    Ok(ok)
}

/// POST /api/auth/reset-password { token, new_password }
pub async fn reset_password(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let ip = client_ip(&headers, &addr);
    if over_limit(&state, &format!("pwreset_try:{ip}"), 10, 900).await {
        return Err(AppError::TooManyRequests);
    }
    let token = body["token"].as_str().unwrap_or("");
    let new_pw = body["new_password"].as_str().unwrap_or("");
    if new_pw.len() < 8 || new_pw.len() > 128 {
        return Err(AppError::BadRequest("Le mot de passe doit faire 8 à 128 caractères".into()));
    }
    let invalid = || AppError::BadRequest("Lien invalide ou expiré".into());
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(invalid());
    }
    let key = token_key(&hash_token(token));
    // Lecture + suppression atomiques : un jeton ne sert qu'une fois, même en course.
    let user_id: Option<String> = {
        let mut redis = state.redis.lock().await;
        let (v, _): (Option<String>, i64) = redis::pipe()
            .atomic()
            .get(&key)
            .del(&key)
            .query_async(&mut *redis)
            .await
            .map_err(|e| AppError::Internal(e.into()))?;
        v
    };
    let user_id = user_id
        .and_then(|s| Uuid::parse_str(&s).ok())
        .ok_or_else(invalid)?;

    let new_hash = hash(new_pw, DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))?;
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1")
        .bind(user_id)
        .bind(&new_hash)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM user_sessions WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    {
        let mut redis = state.redis.lock().await;
        let _: () = redis.del(user_key(user_id)).await.unwrap_or(());
    }
    // Les jetons d'accès déjà émis (appareil volé) deviennent invalides.
    revoke_all_tokens(&state, user_id).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
