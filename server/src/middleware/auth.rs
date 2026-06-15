use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use axum_extra::{headers::{Authorization, authorization::Bearer}, TypedHeader};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, state::AppState};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: i64,
}

pub fn create_token(user_id: Uuid, secret: &str) -> anyhow::Result<String> {
    use jsonwebtoken::{encode, EncodingKey, Header};
    let exp = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .unwrap()
        .timestamp();
    let claims = Claims { sub: user_id, exp };
    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_token(token: &str, secret: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|d| d.claims)
}

pub async fn require_auth(
    State(state): State<AppState>,
    TypedHeader(auth): TypedHeader<Authorization<Bearer>>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let claims = verify_token(auth.token(), &state.config.jwt_secret)
        .ok_or(AppError::Unauthorized)?;
    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}
