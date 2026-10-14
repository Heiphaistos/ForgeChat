use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{decode, DecodingKey, Validation, encode, EncodingKey, Header};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

/// Raw access token passé aux handlers via extension (pour le blocklist logout)
#[derive(Clone)]
pub struct RawToken(pub String);

pub fn hash_token(token: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::STANDARD.encode(digest)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: i64,
    pub iss: String,
    /// Date d'émission. Absente des jetons émis avant son ajout (0 par défaut) :
    /// ils sont alors traités comme antérieurs à toute révocation.
    #[serde(default)]
    pub iat: i64,
    /// Session (ligne user_sessions) qui a émis ce jeton : permet à la page
    /// « Sessions » de marquer l'appareil courant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sid: Option<Uuid>,
}

pub fn create_token(user_id: Uuid, sid: Option<Uuid>, secret: &str, issuer: &str) -> anyhow::Result<String> {
    // 1 h (règle projet : 15 min à 1 h) : le client se renouvelle seul sur un 401
    // grâce au jeton de rafraîchissement. À 24 h, une session révoquée ou un jeton
    // volé restait utilisable une journée entière.
    let now = chrono::Utc::now();
    let exp = now
        .checked_add_signed(chrono::Duration::hours(1))
        .ok_or_else(|| anyhow::anyhow!("Erreur calcul expiration token"))?
        .timestamp();
    let claims = Claims { sub: user_id, exp, iss: issuer.to_string(), iat: now.timestamp(), sid };
    crate::jwt::ready();
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_token(token: &str, secret: &str, issuer: &str) -> Option<Claims> {
    crate::jwt::ready();
    let mut validation = Validation::default();
    validation.set_issuer(&[issuer]);
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|d| d.claims)
}

/// Origines de l'appli (web et bureau Tauri), les seules autorisées à écrire avec les cookies.
const TAURI_ORIGINS: &[&str] = &["tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"];

/// Anti-CSRF des requêtes authentifiées par cookie. `SameSite=Strict` laisse passer tout
/// sous-domaine de heiphaistos.org (même « site ») ; un envoi `multipart/form-data` n'a pas de
/// pré-vol CORS. Une écriture (hors GET/HEAD/OPTIONS) doit donc venir de l'appli : `Origin`
/// présent = l'une des nôtres ; absent, `Sec-Fetch-Site` ne doit pas dire « autre site ».
fn same_origin_write(req: &Request, frontend_url: &str) -> bool {
    use axum::http::Method;
    if matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS) {
        return true;
    }
    same_origin_headers(req.headers(), frontend_url)
}

/// Même règle, sur les en-têtes seuls (routes publiques qui lisent les cookies : comptes mis de côté).
pub(crate) fn same_origin_headers(h: &axum::http::HeaderMap, frontend_url: &str) -> bool {
    if let Some(origin) = h.get("origin").and_then(|v| v.to_str().ok()) {
        let ours = frontend_url.trim_end_matches('/');
        return origin.eq_ignore_ascii_case(ours) || TAURI_ORIGINS.iter().any(|o| origin.eq_ignore_ascii_case(o));
    }
    !matches!(
        h.get("sec-fetch-site").and_then(|v| v.to_str().ok()),
        Some("cross-site") | Some("same-site")
    )
}

pub async fn require_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    // Priorité : Cookie > Authorization: Bearer
    // HTTPS : seulement `__Host-access_token` (crate::cookies), jamais posable par un autre sous-domaine.
    let from_cookie = crate::cookies::access_token(req.headers(), state.config.frontend_url.starts_with("https"));
    if from_cookie.is_some() && !same_origin_write(&req, &state.config.frontend_url) {
        return Err(AppError::Forbidden);
    }
    let token = from_cookie.or_else(|| {
        req.headers()
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer ").map(|t| t.to_string()))
    });

    let token = token.ok_or(AppError::Unauthorized)?;
    let claims = verify_token(&token, &state.config.jwt_secret, &state.config.jwt_issuer)
        .ok_or(AppError::Unauthorized)?;

    // Blocklist (déconnexion), révocation globale, bannissement. Redis injoignable :
    // 503 (avant : tout jeton révoqué redevenait valide pendant la panne).
    match token_state(&state, claims.sub, claims.iat, claims.sid, Some(&token)).await {
        TokenState::Valid => {}
        TokenState::Revoked => return Err(AppError::Unauthorized),
        TokenState::Unknown => return Err(AppError::Unavailable("Service momentanément indisponible".into())),
    }

    let mut req = req;
    req.extensions_mut().insert(claims);
    req.extensions_mut().insert(RawToken(token));
    Ok(next.run(req).await)
}

/// Clé Redis : tous les jetons d'un compte émis AVANT cet instant sont révoqués
/// (changement de mot de passe, « déconnecter partout »). Gardée 2 h, soit plus
/// que la durée de vie d'un jeton d'accès.
fn revoke_key(user_id: Uuid) -> String {
    format!("jwtrevoke:{user_id}")
}

pub async fn revoke_all_tokens(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    revoke_tokens_before(state, user_id, chrono::Utc::now().timestamp()).await
}

/// Révocation stricte (bannissement, déconnexion forcée par un administrateur) : un jeton émis dans la
/// seconde même de la décision est coupé aussi.
pub async fn revoke_all_tokens_strict(state: &AppState, user_id: Uuid) -> Result<(), AppError> {
    revoke_tokens_before(state, user_id, chrono::Utc::now().timestamp() + 1).await
}

async fn revoke_tokens_before(state: &AppState, user_id: Uuid, ts: i64) -> Result<(), AppError> {
    redis_set_ex_strict(state, revoke_key(user_id), ts, 2 * 3600).await?;
    // Téléphones déconnectés : ils ne doivent plus recevoir de notifications.
    crate::mobile_push::forget_devices(state, user_id).await;
    Ok(())
}

/// Écriture Redis qui sert à révoquer/bannir : 3 essais puis 503. Une révocation perdue en silence
/// laisserait un jeton volé valide ; l'appelant renvoie l'erreur et le client peut rejouer (les
/// opérations de base déjà validées sont idempotentes).
pub async fn redis_set_ex_strict<V>(state: &AppState, key: String, val: V, ttl: u64) -> Result<(), AppError>
where
    V: redis::ToRedisArgs + Send + Sync + Copy,
{
    let mut last = String::new();
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(100 * attempt)).await;
        }
        let r: redis::RedisResult<()> = state.redis.lock().await.set_ex(&key, val, ttl).await;
        match r {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
    }
    tracing::error!("révocation Redis impossible ({key}) : {last}");
    Err(AppError::Unavailable("Service momentanément indisponible, réessayez".into()))
}

fn revoke_sid_key(sid: Uuid) -> String {
    format!("jwtrevoke_sid:{sid}")
}

/// Révoque tout de suite les jetons d'accès d'UNE session (déconnexion de cet appareil,
/// session révoquée depuis la page « Sessions ») : gardé un peu plus que la durée de vie
/// d'un jeton d'accès (1 h).
pub async fn revoke_session_tokens(state: &AppState, sid: Uuid) -> Result<(), AppError> {
    redis_set_ex_strict(state, revoke_sid_key(sid), "1", 3600 + 300).await
}

#[derive(Debug, PartialEq, Eq)]
pub enum TokenState {
    Valid,
    Revoked,
    /// Redis injoignable : impossible de savoir, l'appelant refuse (fail-closed).
    Unknown,
}

/// État d'un jeton émis à `iat` pour `user` (`raw` : jeton brut, pour la blocklist
/// de déconnexion, `sid` : session émettrice). Une WebSocket ouverte par ticket passe son
/// heure d'ouverture et la session du jeton qui a demandé le ticket.
pub async fn token_state(state: &AppState, user: Uuid, iat: i64, sid: Option<Uuid>, raw: Option<&str>) -> TokenState {
    let check = async {
        let mut redis = state.redis.lock().await;
        let mut blocked: Option<String> = match raw {
            Some(t) => redis.get(format!("jwtblock:{}", hash_token(t))).await?,
            None => None,
        };
        if blocked.is_none() {
            if let Some(sid) = sid {
                blocked = redis.get(revoke_sid_key(sid)).await?;
            }
        }
        let since: Option<i64> = redis.get(revoke_key(user)).await?;
        let banned: bool = redis.sismember(crate::handlers::site_admin::BANNED_SET, user.to_string()).await?;
        Ok::<_, redis::RedisError>(decide(blocked.is_some(), since, banned, iat))
    };
    match tokio::time::timeout(std::time::Duration::from_secs(3), check).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            tracing::error!("Redis injoignable pour la révocation des jetons : {e}");
            TokenState::Unknown
        }
        Err(_) => {
            tracing::error!("Redis trop lent pour la révocation des jetons");
            TokenState::Unknown
        }
    }
}

fn decide(blocked: bool, revoked_since: Option<i64>, banned: bool, iat: i64) -> TokenState {
    if blocked || banned || revoked_since.is_some_and(|ts| iat < ts) {
        TokenState::Revoked
    } else {
        TokenState::Valid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csrf_origin_rules() {
        let req = |m: &str, origin: Option<&str>, site: Option<&str>| {
            let mut b = axum::http::Request::builder().method(m).uri("/api/x");
            if let Some(o) = origin { b = b.header("origin", o) }
            if let Some(s) = site { b = b.header("sec-fetch-site", s) }
            b.body(axum::body::Body::empty()).unwrap()
        };
        let front = "https://forgechat.example";
        assert!(same_origin_write(&req("GET", Some("https://evil.example"), None), front));
        assert!(same_origin_write(&req("POST", Some("https://forgechat.example"), None), front));
        assert!(same_origin_write(&req("POST", Some("tauri://localhost"), None), front));
        assert!(!same_origin_write(&req("POST", Some("https://ghd.example"), None), front));
        assert!(!same_origin_write(&req("DELETE", Some("null"), None), front));
        assert!(same_origin_write(&req("POST", None, None), front), "client natif sans Origin");
        assert!(same_origin_write(&req("POST", None, Some("same-origin")), front));
        assert!(!same_origin_write(&req("POST", None, Some("same-site")), front));
        assert!(!same_origin_write(&req("PATCH", None, Some("cross-site")), front));
    }

    #[test]
    fn revocation_rules() {
        assert_eq!(decide(false, None, false, 100), TokenState::Valid);
        assert_eq!(decide(true, None, false, 100), TokenState::Revoked);
        assert_eq!(decide(false, None, true, 100), TokenState::Revoked);
        assert_eq!(decide(false, Some(101), false, 100), TokenState::Revoked);
        assert_eq!(decide(false, Some(100), false, 100), TokenState::Valid);
    }
}
