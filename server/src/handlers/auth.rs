use axum::{
    extract::{ConnectInfo, State},
    Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use rand::Rng;
use redis::AsyncCommands;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::create_token,
    models::user::{AuthResponse, LoginRequest, PendingRegistration, RegisterRequest, UserPublic},
    state::AppState,
};

/// Vérifie et incrémente le compteur de tentatives de login par IP.
/// Retourne Err(AppError::TooManyRequests) si la limite est atteinte.
async fn check_login_rate_limit(state: &AppState, ip: &str) -> Result<()> {
    let key = format!("login_attempts:{}", ip);
    let mut redis = state.redis.lock().await;

    // Récupérer le compteur actuel
    let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
    let count = count.unwrap_or(0);

    if count >= 10 {
        return Err(AppError::TooManyRequests);
    }

    // Incrémenter et définir TTL de 15 minutes
    let _: () = redis.incr(&key, 1).await.unwrap_or(());
    // Définir TTL seulement si c'est la première tentative
    if count == 0 {
        let _: () = redis.expire(&key, 900).await.unwrap_or(());
    }

    Ok(())
}

/// Réinitialise le compteur après un login réussi
async fn reset_login_rate_limit(state: &AppState, ip: &str) {
    let key = format!("login_attempts:{}", ip);
    let mut redis = state.redis.lock().await;
    let _: () = redis.del(&key).await.unwrap_or(());
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>> {
    if body.username.len() < 2 || body.username.len() > 32 {
        return Err(AppError::BadRequest("Nom d'utilisateur 2-32 chars".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest("Mot de passe min 8 chars".into()));
    }

    let email_lower = body.email.to_lowercase();

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)",
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

    let code: String = format!("{:04}", rand::thread_rng().gen_range(0..=9999));
    let expires_at = Utc::now() + chrono::Duration::minutes(15);

    sqlx::query(
        "INSERT INTO pending_registrations (email, username, password_hash, discriminator, code, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE
           SET username=$2, password_hash=$3, discriminator=$4, code=$5, expires_at=$6, created_at=NOW()",
    )
    .bind(&email_lower)
    .bind(&body.username)
    .bind(&password_hash)
    .bind(&discriminator)
    .bind(&code)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    if let Err(e) = crate::email::send_verification_email(&state.config, &email_lower, &code).await
    {
        tracing::error!("Erreur envoi email vérification : {}", e);
    }

    Ok(Json(serde_json::json!({ "pending": true, "email": email_lower })))
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<AuthResponse>> {
    let email = body["email"]
        .as_str()
        .map(|s| s.to_lowercase())
        .ok_or_else(|| AppError::BadRequest("email requis".into()))?;

    let code = body["code"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("code requis".into()))?;

    let pending = sqlx::query_as::<_, PendingRegistration>(
        "SELECT * FROM pending_registrations WHERE email=$1",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Aucune inscription en attente pour cet email".into()))?;

    if pending.expires_at < Utc::now() {
        sqlx::query("DELETE FROM pending_registrations WHERE email=$1")
            .bind(&email)
            .execute(&state.db)
            .await?;
        return Err(AppError::BadRequest(
            "Code expiré, recommence l'inscription".into(),
        ));
    }

    // Comparaison constant-time pour éviter les timing attacks
    if !constant_time_eq(pending.code.as_bytes(), code.as_bytes()) {
        return Err(AppError::BadRequest("Code incorrect".into()));
    }

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "INSERT INTO users (username, discriminator, email, password_hash, is_verified)
         VALUES ($1, $2, $3, $4, true) RETURNING *",
    )
    .bind(&pending.username)
    .bind(&pending.discriminator)
    .bind(&pending.email)
    .bind(&pending.password_hash)
    .fetch_one(&state.db)
    .await?;

    sqlx::query("DELETE FROM pending_registrations WHERE email=$1")
        .bind(&email)
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

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>> {
    // Extraire l'IP réelle (derrière reverse proxy nginx)
    // X-Forwarded-For est injecté par nginx avec proxy_set_header
    let client_ip = headers
        .get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| addr.ip().to_string());

    // Rate limiting : 10 tentatives max / 15 min par IP
    check_login_rate_limit(&state, &client_ip).await?;

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE email=$1",
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

    // Login réussi — réinitialiser le compteur
    reset_login_rate_limit(&state, &client_ip).await;

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
        "SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash=$1",
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

pub async fn change_password(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let old_pw = body["old_password"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("old_password requis".into()))?;
    let new_pw = body["new_password"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("new_password requis".into()))?;

    if new_pw.len() < 8 {
        return Err(AppError::BadRequest("Mot de passe min 8 chars".into()));
    }

    let pw_hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM users WHERE id=$1",
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !verify(old_pw, &pw_hash).unwrap_or(false) {
        return Err(AppError::BadRequest(
            "Mot de passe actuel incorrect".into(),
        ));
    }

    let new_hash =
        hash(new_pw, DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))?;

    sqlx::query("UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1")
        .bind(claims.sub)
        .bind(&new_hash)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
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
    let bytes: Vec<u8> = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .collect();
    String::from_utf8(bytes).unwrap()
}

/// Comparaison constant-time pour éviter les timing attacks
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn hash_token(token: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::STANDARD.encode(digest)
}

async fn store_refresh_token(state: &AppState, user_id: Uuid, token: &str) -> Result<()> {
    let token_hash = hash_token(token);
    let expires_at = Utc::now() + chrono::Duration::days(30);
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;
    Ok(())
}
