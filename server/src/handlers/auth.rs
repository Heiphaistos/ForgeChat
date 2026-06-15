use axum::{extract::State, Json};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use rand::Rng;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::create_token,
    models::user::{AuthResponse, LoginRequest, RegisterRequest, UserPublic},
    state::AppState,
};

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>> {
    if body.username.len() < 2 || body.username.len() > 32 {
        return Err(AppError::BadRequest("Nom d'utilisateur 2-32 chars".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest("Mot de passe min 8 chars".into()));
    }

    let email_lower = body.email.to_lowercase();
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)"
    )
    .bind(&email_lower)
    .fetch_one(&state.db)
    .await?;

    if exists {
        return Err(AppError::Conflict("Email déjà utilisé".into()));
    }

    let discriminator = format!("{:04}", rand::thread_rng().gen_range(1..=9999));
    let password_hash = hash(&body.password, DEFAULT_COST)
        .map_err(|e| AppError::Internal(e.into()))?;

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "INSERT INTO users (username, discriminator, email, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING *"
    )
    .bind(&body.username)
    .bind(&discriminator)
    .bind(&email_lower)
    .bind(&password_hash)
    .fetch_one(&state.db)
    .await?;

    let access_token = create_token(user.id, &state.config.jwt_secret)
        .map_err(|e| AppError::Internal(e))?;
    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: user.into(),
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE email=$1"
    )
    .bind(body.email.to_lowercase())
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let valid = verify(&body.password, &user.password_hash)
        .map_err(|e| AppError::Internal(e.into()))?;
    if !valid {
        return Err(AppError::Unauthorized);
    }

    // Mettre à jour le statut online
    sqlx::query("UPDATE users SET status='online', updated_at=NOW() WHERE id=$1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    let access_token = create_token(user.id, &state.config.jwt_secret)
        .map_err(|e| AppError::Internal(e))?;
    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: user.into(),
    }))
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let token = body["refresh_token"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("refresh_token requis".into()))?;

    let token_hash = hash_token(token);
    let row = sqlx::query_as::<_, (Uuid, chrono::DateTime<Utc>)>(
        "SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash=$1"
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    if row.1 < Utc::now() {
        return Err(AppError::Unauthorized);
    }

    let access_token = create_token(row.0, &state.config.jwt_secret)
        .map_err(|e| AppError::Internal(e))?;

    Ok(Json(serde_json::json!({ "access_token": access_token })))
}

pub async fn logout(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    if let Some(token) = body["refresh_token"].as_str() {
        let token_hash = hash_token(token);
        sqlx::query("DELETE FROM refresh_tokens WHERE token_hash=$1")
            .bind(&token_hash)
            .execute(&state.db)
            .await?;
    }
    sqlx::query("UPDATE users SET status='offline', updated_at=NOW() WHERE id=$1")
        .bind(claims.sub)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

fn generate_refresh_token() -> String {
    use rand::Rng;
    let bytes: Vec<u8> = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .collect();
    String::from_utf8(bytes).unwrap()
}

fn hash_token(token: &str) -> String {
    use base64::Engine;
    let digest = ring_or_simple_hash(token.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

fn ring_or_simple_hash(data: &[u8]) -> Vec<u8> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish().to_le_bytes().to_vec()
}

async fn store_refresh_token(
    state: &AppState,
    user_id: Uuid,
    token: &str,
) -> Result<()> {
    let token_hash = hash_token(token);
    let expires_at = Utc::now() + chrono::Duration::days(30);
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)"
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;
    Ok(())
}
