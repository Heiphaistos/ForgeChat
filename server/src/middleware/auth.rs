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
}

pub fn create_token(user_id: Uuid, secret: &str, issuer: &str) -> anyhow::Result<String> {
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .ok_or_else(|| anyhow::anyhow!("Erreur calcul expiration token"))?
        .timestamp();
    let claims = Claims { sub: user_id, exp, iss: issuer.to_string() };
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

    // Vérifier le blocklist JWT (tokens révoqués après logout)
    let token_hash = hash_token(&token);
    let blocklist_key = format!("jwtblock:{}", token_hash);
    {
        let mut redis = state.redis.lock().await;
        let blocked: Option<String> = redis.get(&blocklist_key).await.unwrap_or(None);
        if blocked.is_some() {
            return Err(AppError::Unauthorized);
        }
    }

    let mut req = req;
    req.extensions_mut().insert(claims);
    req.extensions_mut().insert(RawToken(token));
    Ok(next.run(req).await)
}

/// Middleware optionnel : extrait les claims si présents (routes publiques qui bénéficient de l'auth)
#[allow(dead_code)]
pub async fn optional_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = token_from_cookie(&req).or_else(|| {
        req.headers()
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer ").map(|t| t.to_string()))
    });

    let mut req = req;
    if let Some(t) = token {
        if let Some(claims) = verify_token(&t, &state.config.jwt_secret, &state.config.jwt_issuer) {
            req.extensions_mut().insert(claims);
        }
    }
    Ok(next.run(req).await)
}
