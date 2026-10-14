//! Mot de passe oublié : jeton opaque aléatoire envoyé par e-mail, stocké haché
//! dans Redis (30 min, usage unique). Pas de table : un jeton perdu au
//! redémarrage de Redis se redemande simplement.

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    Json,
};
use rand::Rng;
use redis::AsyncCommands;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::auth_v2::{account_key, check_salt, hash_auth, hit, NO_PASSWORD, UPGRADE_MSG},
    middleware::auth::{hash_token, revoke_all_tokens},
    privacy::client_key,
    state::AppState,
};

const TOKEN_TTL_SECS: u64 = 30 * 60;
/// Compte fantôme « Utilisateur supprimé » (migration 063) : jamais réinitialisable.
const DELETED_USER: &str = "00000000-0000-0000-0000-00000000dead";

/// Incrémente un compteur Redis ; `true` si la limite est dépassée. Fail-closed : Redis
/// injoignable ou TTL impossible à poser = limite atteinte (jamais un passage libre).
pub(crate) async fn over_limit(state: &AppState, key: &str, max: i64, window_secs: i64) -> bool {
    let mut redis = state.redis.lock().await;
    let Ok(count) = redis.incr::<_, _, i64>(key, 1).await else { return true };
    if count == 1 && redis.expire::<_, bool>(key, window_secs).await.is_err() {
        // Sans TTL le compteur bloquerait la clé à vie : on la retire.
        let _: std::result::Result<i64, _> = redis.del(key).await;
        return true;
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
    hit(&state, &format!("pwreset_ip:{}", client_key(&headers, &addr)), 5, 900).await?;
    let ok = Json(serde_json::json!({ "ok": true }));
    // Par e-mail : 3 demandes / heure. Au-delà on répond pareil sans rien envoyer,
    // pour ne pas révéler l'existence du compte ni permettre d'inonder une boîte.
    if hit(&state, &account_key("pwreset_mail", &email), 3, 3600).await.is_err() {
        return Ok(ok);
    }

    let user: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, username FROM users WHERE email_hmac=$1 AND is_bot=false AND id <> $2::uuid",
    )
    .bind(crate::email_crypto::hmac(&email))
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
            tracing::warn!("envoi e-mail de réinitialisation échoué : {}", crate::privacy::redact_emails(&e.to_string()));
        }
    });
    Ok(ok)
}

/// POST /api/auth/reset-password { token, new_auth, new_kdf_salt }
/// Connexion v2 : le nouveau mot de passe ne quitte pas l'appareil. L'enveloppe E2E (scellée par
/// l'ancienne wrapKey) devient illisible : l'appli propose le code de récupération, sinon une
/// nouvelle clé.
pub async fn reset_password(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    hit(&state, &format!("pwreset_try:{}", client_key(&headers, &addr)), 10, 900).await?;
    let token = body["token"].as_str().unwrap_or("");
    let (Some(new_auth), Some(new_salt)) = (body["new_auth"].as_str(), body["new_kdf_salt"].as_str()) else {
        if body.get("new_password").is_some() {
            return Err(AppError::UpgradeRequired(UPGRADE_MSG.into()));
        }
        return Err(AppError::BadRequest("new_auth et new_kdf_salt requis".into()));
    };
    check_salt(new_salt)?;
    let new_kdf = crate::handlers::auth_v2::check_kdf(body["new_kdf"].as_str())?;
    let new_hash = hash_auth(new_auth)?;
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

    let mut tx = state.db.begin().await?;
    // Le nouveau mot de passe rouvre aussi un compte verrouillé en urgence.
    sqlx::query("UPDATE users SET auth_hash=$2, kdf_salt=$3, password_hash=$4, kdf=$5, locked_at=NULL, updated_at=NOW() WHERE id=$1")
        .bind(user_id)
        .bind(&new_hash)
        .bind(new_salt)
        .bind(NO_PASSWORD)
        .bind(new_kdf)
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
    state.disconnect_user_sockets(user_id).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}
