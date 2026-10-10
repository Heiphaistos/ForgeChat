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
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_token(token: &str, secret: &str, issuer: &str) -> Option<Claims> {
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

/// Extrait le token depuis le cookie `access_token`
fn token_from_cookie(req: &Request) -> Option<String> {
    req.headers()
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';').find_map(|part| {
                part.trim().strip_prefix("access_token=").map(|t| t.to_string())
            })
        })
}

pub async fn require_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    // Priorité : Cookie > Authorization: Bearer
    let token = token_from_cookie(&req).or_else(|| {
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
    match token_state(&state, claims.sub, claims.iat, Some(&token)).await {
        TokenState::Valid => {}
        TokenState::Revoked => return Err(AppError::Unauthorized),
        TokenState::Unknown => return Err(AppError::Unavailable),
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

pub async fn revoke_all_tokens(state: &AppState, user_id: Uuid) {
    revoke_tokens_before(state, user_id, chrono::Utc::now().timestamp()).await
}

/// Révocation stricte (bannissement, déconnexion forcée par un administrateur) : un jeton émis dans la
/// seconde même de la décision est coupé aussi.
pub async fn revoke_all_tokens_strict(state: &AppState, user_id: Uuid) {
    revoke_tokens_before(state, user_id, chrono::Utc::now().timestamp() + 1).await
}

async fn revoke_tokens_before(state: &AppState, user_id: Uuid, ts: i64) {
    use redis::AsyncCommands;
    let mut redis = state.redis.lock().await;
    let _: () = redis
        .set_ex(revoke_key(user_id), ts, 2 * 3600)
        .await
        .unwrap_or(());
    drop(redis);
    // Téléphones déconnectés : ils ne doivent plus recevoir de notifications.
    crate::mobile_push::forget_devices(state, user_id).await;
}

#[derive(Debug, PartialEq, Eq)]
pub enum TokenState {
    Valid,
    Revoked,
    /// Redis injoignable : impossible de savoir, l'appelant refuse (fail-closed).
    Unknown,
}

/// État d'un jeton émis à `iat` pour `user` (`raw` : jeton brut, pour la blocklist
/// de déconnexion). Une WebSocket ouverte par ticket passe son heure d'ouverture.
pub async fn token_state(state: &AppState, user: Uuid, iat: i64, raw: Option<&str>) -> TokenState {
    let check = async {
        let mut redis = state.redis.lock().await;
        let blocked: Option<String> = match raw {
            Some(t) => redis.get(format!("jwtblock:{}", hash_token(t))).await?,
            None => None,
        };
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
    fn revocation_rules() {
        assert_eq!(decide(false, None, false, 100), TokenState::Valid);
        assert_eq!(decide(true, None, false, 100), TokenState::Revoked);
        assert_eq!(decide(false, None, true, 100), TokenState::Revoked);
        assert_eq!(decide(false, Some(101), false, 100), TokenState::Revoked);
        assert_eq!(decide(false, Some(100), false, 100), TokenState::Valid);
    }
}
