//! Protection du compte (audit 2026-10-12, améliorations n° 4 et 25).
//!
//! - **Nouvel appareil** : chaque appareil garde un identifiant aléatoire de 256 bits (cookie
//!   HttpOnly `__Host-fc_device` sur le web, en-tête `X-ForgeChat-Device` depuis le trousseau des
//!   applis). Le serveur n'en garde que l'empreinte SHA-256. Une connexion depuis un appareil
//!   inconnu envoie un e-mail au titulaire, avec un lien de verrouillage d'urgence. Le tout
//!   premier appareil suivi d'un compte ne déclenche rien (pas de vague d'e-mails au déploiement).
//! - **Verrouillage d'urgence** (« ce n'est pas moi ») : lien de l'e-mail (7 jours, usage unique)
//!   ou bouton dans les paramètres. Toutes les sessions sont fermées, les jetons révoqués, les
//!   appareils oubliés, et la connexion est refusée jusqu'à la réinitialisation du mot de passe,
//!   qui scelle aussi la clé de chiffrement sous un nouveau secret.
use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue},
    Extension, Json,
};
use rand::RngCore;
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::auth_v2::hit,
    middleware::auth::Claims,
    state::AppState,
};

const DEVICE_HEADER: &str = "x-forgechat-device";
const COOKIE_SECURE: &str = "__Host-fc_device";
const COOKIE_DEV: &str = "fc_device";
const PANIC_TTL_SECS: u64 = 7 * 86400;

fn random_b64(n: usize) -> String {
    use base64::Engine;
    let mut b = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Identifiant d'appareil bien formé : 43 caractères base64url (256 bits).
pub fn valid_device_id(s: &str) -> bool {
    s.len() == 43 && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Identifiant présenté par l'appareil : en-tête des applis, sinon cookie du web.
pub fn presented_device(headers: &HeaderMap, secure: bool) -> Option<String> {
    let from_header = headers.get(DEVICE_HEADER).and_then(|v| v.to_str().ok()).map(str::trim).map(str::to_string);
    let name = if secure { COOKIE_SECURE } else { COOKIE_DEV };
    let from_cookie = || crate::cookies::parse(headers).into_iter().find(|(k, _)| k == name).map(|(_, v)| v);
    from_header.or_else(from_cookie).filter(|d| valid_device_id(d))
}

/// Cookie HttpOnly d'appareil (1 an), jamais lisible par le JavaScript.
pub fn device_cookie(id: &str, secure: bool) -> Option<HeaderValue> {
    let (name, flag) = if secure { (COOKIE_SECURE, "; Secure") } else { (COOKIE_DEV, "") };
    HeaderValue::from_str(&format!("{name}={id}; HttpOnly{flag}; SameSite=Strict; Path=/; Max-Age=31536000")).ok()
}

/// Résultat pour la réponse de connexion.
pub struct DeviceOutcome {
    /// Identifiant neuf à garder par l'appli (applis sans cookie seulement).
    pub new_id: Option<String>,
    /// Cookie à poser (web).
    pub cookie: Option<HeaderValue>,
}

/// Note l'appareil d'une connexion réussie et alerte le titulaire s'il est inconnu.
/// `alert = false` : création du compte (premier appareil, rien à signaler).
pub async fn note_login_device(
    state: &AppState,
    user_id: Uuid,
    headers: &HeaderMap,
    cookie_mode: bool,
    alert: bool,
) -> DeviceOutcome {
    let secure = crate::handlers::auth::is_secure(state);
    let presented = presented_device(headers, secure);
    let id = presented.clone().unwrap_or_else(|| random_b64(32));
    let label = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|ua| crate::privacy::device_label(ua, false));
    let had_any: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM known_devices WHERE user_id=$1)")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(true);
    let inserted = sqlx::query(
        "INSERT INTO known_devices (user_id, device_hash, label) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, device_hash) DO UPDATE SET last_seen = NOW(), label = EXCLUDED.label
         RETURNING (xmax = 0) AS fresh",
    )
    .bind(user_id)
    .bind(sha256_hex(&id))
    .bind(&label)
    .fetch_one(&state.db)
    .await
    .map(|r| sqlx::Row::get::<bool, _>(&r, "fresh"))
    .unwrap_or(false);
    if inserted && had_any && alert {
        crate::security_events::record(state, "new_device").await;
        let state = state.clone();
        let label = label.unwrap_or_else(|| "appareil inconnu".into());
        tokio::spawn(async move { send_new_device_mail(&state, user_id, &label).await });
    }
    DeviceOutcome {
        new_id: (presented.is_none() && !cookie_mode).then(|| id.clone()),
        cookie: (presented.is_none() && cookie_mode).then(|| device_cookie(&id, secure)).flatten(),
    }
}

/// Jeton de verrouillage d'urgence (7 jours, usage unique), haché dans Redis.
pub(crate) async fn new_panic_token(state: &AppState, user_id: Uuid) -> Option<String> {
    let token = random_b64(32);
    let mut redis = state.redis.lock().await;
    redis
        .set_ex::<_, _, ()>(format!("panic:{}", sha256_hex(&token)), user_id.to_string(), PANIC_TTL_SECS)
        .await
        .ok()?;
    Some(token)
}

async fn user_mail(state: &AppState, user_id: Uuid) -> Option<(String, String)> {
    let (username, enc): (String, Option<String>) =
        sqlx::query_as("SELECT username, email_enc FROM users WHERE id=$1").bind(user_id).fetch_optional(&state.db).await.ok()??;
    let email = crate::email_crypto::open(user_id, &enc?)?;
    Some((username, email))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

async fn send_new_device_mail(state: &AppState, user_id: Uuid, label: &str) {
    let Some((username, email)) = user_mail(state, user_id).await else { return };
    let Some(token) = new_panic_token(state, user_id).await else { return };
    let base = state.config.frontend_url.trim_end_matches('/');
    // Jeton dans le fragment (#) : jamais envoyé au serveur ni dans un Referer.
    let lock = format!("{base}/verrouiller#token={token}");
    let when = chrono::Utc::now().format("%d/%m/%Y à %H:%M UTC");
    let html = format!(
        r#"<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1e1f22;color:#dbdee1;padding:32px">
<div style="max-width:480px;margin:auto;background:#313338;border-radius:12px;padding:32px">
  <h2 style="color:#5865f2;margin-top:0">Nouvelle connexion à ton compte</h2>
  <p>Bonjour {name}, ton compte ForgeChat vient d'être ouvert sur un nouvel appareil :</p>
  <p style="background:#2b2d31;border-radius:8px;padding:12px"><strong>{label}</strong><br>{when}</p>
  <p>Si c'est toi, il n'y a rien à faire.</p>
  <p><strong>Si ce n'est pas toi</strong>, verrouille ton compte tout de suite : toutes les sessions sont fermées et il faudra choisir un nouveau mot de passe.</p>
  <p style="text-align:center;margin:28px 0"><a href="{lock}" style="background:#da373c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Ce n'est pas moi : verrouiller mon compte</a></p>
  <p style="color:#949ba4;font-size:13px">Ce lien reste valable 7 jours et ne sert qu'une fois. Liste de tes appareils : Paramètres &gt; Sessions.</p>
</div></body></html>"#,
        name = html_escape(&username),
        label = html_escape(label),
    );
    if let Err(e) = crate::email::send_email(&state.config, &email, "Nouvelle connexion à ton compte — ForgeChat", html).await {
        tracing::warn!("e-mail de nouvel appareil non envoyé : {}", crate::privacy::redact_emails(&e.to_string()));
    }
}

/// Verrouille le compte : sessions fermées, jetons révoqués, appareils oubliés, connexion refusée
/// jusqu'à la réinitialisation du mot de passe.
pub async fn lock_account(state: &AppState, user_id: Uuid) -> Result<()> {
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET locked_at = NOW() WHERE id=$1").bind(user_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id=$1").bind(user_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM user_sessions WHERE user_id=$1").bind(user_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM known_devices WHERE user_id=$1").bind(user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    crate::middleware::auth::revoke_all_tokens_strict(state, user_id).await;
    state.disconnect_user_sockets(user_id).await;
    crate::security_events::record(state, "panic").await;
    Ok(())
}

/// Message de refus de connexion d'un compte verrouillé.
pub const LOCKED_MSG: &str =
    "Compte verrouillé par mesure de sécurité. Choisis un nouveau mot de passe avec « Mot de passe oublié » pour le rouvrir.";

/// POST /api/auth/panic { token } : lien « ce n'est pas moi » de l'e-mail (sans session).
pub async fn panic_with_token(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    hit(&state, &format!("panic_ip:{}", crate::privacy::client_key(&headers, &addr)), 10, 900).await?;
    let token = body["token"].as_str().unwrap_or("");
    let invalid = || AppError::BadRequest("Lien invalide ou expiré".into());
    if !valid_device_id(token) {
        return Err(invalid());
    }
    let key = format!("panic:{}", sha256_hex(token));
    let user: Option<String> = {
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
    let user_id = user.and_then(|s| Uuid::parse_str(&s).ok()).ok_or_else(invalid)?;
    lock_account(&state, user_id).await?;
    Ok(Json(serde_json::json!({ "locked": true })))
}

/// POST /api/users/me/panic : même verrouillage depuis une session ouverte (Paramètres).
pub async fn panic_self(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<serde_json::Value>> {
    lock_account(&state, claims.sub).await?;
    Ok(Json(serde_json::json!({ "locked": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_ids() {
        let id = random_b64(32);
        assert!(valid_device_id(&id));
        assert!(!valid_device_id("court"));
        assert!(!valid_device_id(&format!("{}=", &id[..42])));
        let mut h = HeaderMap::new();
        h.insert("cookie", HeaderValue::from_str(&format!("fc_device={id}; __Host-fc_device=x")).unwrap());
        assert_eq!(presented_device(&h, false).as_deref(), Some(id.as_str()));
        assert_eq!(presented_device(&h, true), None, "cookie préfixé invalide ignoré");
        h.insert(DEVICE_HEADER, HeaderValue::from_str(&id).unwrap());
        assert_eq!(presented_device(&h, true).as_deref(), Some(id.as_str()), "en-tête des applis");
        let c = device_cookie(&id, true).unwrap();
        let c = c.to_str().unwrap();
        assert!(c.starts_with("__Host-fc_device=") && c.contains("HttpOnly") && c.contains("Secure") && c.contains("Path=/;"));
    }
}
