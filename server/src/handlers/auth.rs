use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue, header::SET_COOKIE},
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
async fn check_login_rate_limit(state: &AppState, ip: &str) -> Result<()> {
    let key = format!("login_attempts:{}", ip);
    let mut redis = state.redis.lock().await;
    let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
    let count = count.unwrap_or(0);
    if count >= 10 {
        return Err(AppError::TooManyRequests);
    }
    let _: () = redis.incr(&key, 1).await.unwrap_or(());
    if count == 0 {
        let _: () = redis.expire(&key, 900).await.unwrap_or(());
    }
    Ok(())
}

async fn reset_login_rate_limit(state: &AppState, ip: &str) {
    let key = format!("login_attempts:{}", ip);
    let mut redis = state.redis.lock().await;
    let _: () = redis.del(&key).await.unwrap_or(());
}

/// Construit les headers Set-Cookie pour access_token et refresh_token.
/// Les tokens sont aussi retournés dans le corps JSON pour la compatibilité Tauri.
fn auth_cookie_headers(auth: &AuthResponse, secure: bool) -> HeaderMap {
    let flag = if secure { "; Secure" } else { "" };
    let access = format!(
        "access_token={}; HttpOnly{}; SameSite=Strict; Path=/; Max-Age=86400",
        auth.access_token, flag
    );
    let refresh = format!(
        "refresh_token={}; HttpOnly{}; SameSite=Strict; Path=/api/auth; Max-Age={}",
        auth.refresh_token, flag, 30 * 86400
    );
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&access) {
        headers.insert(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&refresh) {
        headers.append(SET_COOKIE, v);
    }
    headers
}

fn is_secure(state: &AppState) -> bool {
    state.config.frontend_url.starts_with("https")
}

pub async fn register(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>)> {
    {
        let client_ip = headers
            .get("x-real-ip")
            .or_else(|| headers.get("x-forwarded-for"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
            .unwrap_or_else(|| addr.ip().to_string());
        let key = format!("register_attempts:{}", client_ip);
        let mut redis = state.redis.lock().await;
        let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
        let count = count.unwrap_or(0);
        if count >= 5 {
            return Err(AppError::TooManyRequests);
        }
        let _: () = redis.incr(&key, 1).await.unwrap_or(());
        if count == 0 {
            let _: () = redis.expire(&key, 900).await.unwrap_or(());
        }
    }
    if body.username.len() < 2 || body.username.len() > 32 {
        return Err(AppError::BadRequest("Nom d'utilisateur 2-32 chars".into()));
    }
    if !body.username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::BadRequest("Nom : lettres, chiffres, _ ou - uniquement".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest("Mot de passe min 8 chars".into()));
    }
    if body.password.len() > 128 {
        return Err(AppError::BadRequest("Mot de passe max 128 chars".into()));
    }

    let email_lower = body.email.to_lowercase();
    if !email_lower.contains('@') || !email_lower.contains('.') {
        return Err(AppError::BadRequest("Email invalide".into()));
    }

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

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "INSERT INTO users (username, discriminator, email, password_hash, is_verified)
         VALUES ($1, $2, $3, $4, true) RETURNING *",
    )
    .bind(&body.username)
    .bind(&discriminator)
    .bind(&email_lower)
    .bind(&password_hash)
    .fetch_one(&state.db)
    .await?;

    let access_token = create_token(user.id, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(|e| AppError::Internal(e))?;
    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    let auth = AuthResponse { access_token, refresh_token, user: user.into() };
    let headers = auth_cookie_headers(&auth, is_secure(&state));
    Ok((headers, Json(auth)))
}

pub async fn verify_email(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<AuthResponse>)> {
    let email = body["email"]
        .as_str()
        .map(|s| s.to_lowercase())
        .ok_or_else(|| AppError::BadRequest("email requis".into()))?;

    let code = body["code"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("code requis".into()))?;

    {
        let key = format!("verify_attempts:{}", email);
        let mut redis = state.redis.lock().await;
        let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
        let count = count.unwrap_or(0);
        if count >= 5 {
            return Err(AppError::TooManyRequests);
        }
        let _: () = redis.incr(&key, 1).await.unwrap_or(());
        if count == 0 {
            let _: () = redis.expire(&key, 900).await.unwrap_or(());
        }
    }

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
        return Err(AppError::BadRequest("Code expiré, recommence l'inscription".into()));
    }

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

    {
        let key = format!("verify_attempts:{}", email);
        let mut redis = state.redis.lock().await;
        let _: () = redis.del(&key).await.unwrap_or(());
    }

    let access_token = create_token(user.id, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(|e| AppError::Internal(e))?;
    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    let auth = AuthResponse { access_token, refresh_token, user: user.into() };
    let headers = auth_cookie_headers(&auth, is_secure(&state));
    Ok((headers, Json(auth)))
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>)> {
    let client_ip = headers
        .get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| addr.ip().to_string());

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

    // Vérification 2FA si activée
    if user.totp_enabled {
        let totp_secret: Option<String> = sqlx::query_scalar(
            "SELECT totp_secret FROM users WHERE id=$1",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;

        match (body.totp_code.as_deref(), totp_secret.as_deref()) {
            (None, _) => return Err(AppError::TotpRequired),
            (Some(code), Some(secret)) => {
                if !crate::handlers::totp::verify_totp(secret, code) {
                    return Err(AppError::Unauthorized);
                }
            }
            (Some(_), None) => return Err(AppError::TotpRequired),
        }
    }

    reset_login_rate_limit(&state, &client_ip).await;

    sqlx::query("UPDATE users SET status='online', updated_at=NOW() WHERE id=$1")
        .bind(user.id)
        .execute(&state.db)
        .await?;

    let access_token = create_token(user.id, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(|e| AppError::Internal(e))?;
    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    // Enregistrer la session
    {
        use sha2::{Sha256, Digest};
        let token_hash: String = Sha256::digest(refresh_token.as_bytes())
            .iter().map(|b| format!("{:02x}", b)).collect();
        let device = headers.get("user-agent")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("Unknown")
            .chars().take(200).collect::<String>();
        let ip = headers.get("x-real-ip")
            .or_else(|| headers.get("x-forwarded-for"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
            .unwrap_or_else(|| addr.ip().to_string());
        let _ = sqlx::query(
            "INSERT INTO user_sessions (user_id, refresh_token_hash, device_info, ip_address) VALUES ($1, $2, $3, $4)"
        )
        .bind(user.id)
        .bind(&token_hash)
        .bind(&device)
        .bind(&ip)
        .execute(&state.db)
        .await;
    }

    let auth = AuthResponse { access_token, refresh_token, user: user.into() };
    let resp_headers = auth_cookie_headers(&auth, is_secure(&state));
    Ok((resp_headers, Json(auth)))
}

pub async fn refresh(
    State(state): State<AppState>,
    req_headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    // Accepter le refresh_token depuis le cookie OU le corps JSON (compatibilité Tauri)
    let token = req_headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';').find_map(|p| {
                p.trim().strip_prefix("refresh_token=").map(|t| t.to_string())
            })
        })
        .or_else(|| body["refresh_token"].as_str().map(|s| s.to_string()))
        .ok_or_else(|| AppError::BadRequest("refresh_token requis".into()))?;

    let token_hash = hash_token(&token);
    // RTR atomique : DELETE RETURNING garantit qu'un seul thread invalide le token
    let row = sqlx::query_as::<_, (Uuid, chrono::DateTime<Utc>)>(
        "DELETE FROM refresh_tokens WHERE token_hash=$1 RETURNING user_id, expires_at",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::Unauthorized)?;

    if row.1 < Utc::now() {
        return Err(AppError::Unauthorized);
    }

    // Token supprimé atomiquement ci-dessus — émettre un nouveau

    let new_refresh_token = generate_refresh_token();
    store_refresh_token(&state, row.0, &new_refresh_token).await?;

    let access_token = create_token(row.0, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(|e| AppError::Internal(e))?;

    let secure = is_secure(&state);
    let flag = if secure { "; Secure" } else { "" };
    let access_cookie = format!(
        "access_token={}; HttpOnly{}; SameSite=Strict; Path=/; Max-Age=86400",
        access_token, flag
    );
    let refresh_cookie = format!(
        "refresh_token={}; HttpOnly{}; SameSite=Strict; Path=/api/auth; Max-Age={}",
        new_refresh_token, flag, 30 * 86400
    );
    let mut resp_headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&access_cookie) {
        resp_headers.insert(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&refresh_cookie) {
        resp_headers.append(SET_COOKIE, v);
    }

    Ok((resp_headers, Json(serde_json::json!({
        "access_token": access_token,
        "refresh_token": new_refresh_token,
    }))))
}

pub async fn change_password(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    // Rate limit : 5 tentatives / 15min par IP
    let ip = headers
        .get("X-Forwarded-For")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| addr.ip().to_string());
    {
        let key = format!("chgpw_attempts:{}", ip);
        let mut redis = state.redis.lock().await;
        let count: Option<i64> = redis.get(&key).await.unwrap_or(None);
        let count = count.unwrap_or(0);
        if count >= 5 {
            return Err(AppError::TooManyRequests);
        }
        let _: () = redis.incr(&key, 1).await.unwrap_or(());
        if count == 0 {
            let _: () = redis.expire(&key, 900).await.unwrap_or(());
        }
    }

    let old_pw = body["old_password"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("old_password requis".into()))?;
    let new_pw = body["new_password"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("new_password requis".into()))?;

    if new_pw.len() < 8 {
        return Err(AppError::BadRequest("Mot de passe min 8 chars".into()));
    }
    if new_pw.len() > 128 {
        return Err(AppError::BadRequest("Mot de passe max 128 chars".into()));
    }

    let pw_hash = sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id=$1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;

    if !verify(old_pw, &pw_hash).unwrap_or(false) {
        return Err(AppError::BadRequest("Mot de passe actuel incorrect".into()));
    }

    let new_hash = hash(new_pw, DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))?;

    sqlx::query("DELETE FROM refresh_tokens WHERE user_id=$1")
        .bind(claims.sub)
        .execute(&state.db)
        .await?;

    sqlx::query("UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1")
        .bind(claims.sub)
        .bind(&new_hash)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn ws_ticket(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<Json<serde_json::Value>> {
    use redis::AsyncCommands;
    let ticket: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let key = format!("ws_ticket:{}", ticket);
    let user_id_str = claims.sub.to_string();
    let mut redis = state.redis.lock().await;
    redis.set_ex::<_, _, ()>(&key, &user_id_str, 30)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Redis error: {e}")))?;
    Ok(Json(serde_json::json!({ "ticket": ticket })))
}

pub async fn logout(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::Extension(raw_token): axum::Extension<crate::middleware::auth::RawToken>,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    // Blocklist l'access token courant pour sa durée de vie restante
    let remaining_secs = (claims.exp - Utc::now().timestamp()).max(0) as u64;
    if remaining_secs > 0 {
        let access_hash = crate::middleware::auth::hash_token(&raw_token.0);
        let blocklist_key = format!("jwtblock:{}", access_hash);
        let mut redis = state.redis.lock().await;
        let _: () = redis.set_ex(&blocklist_key, "1", remaining_secs).await.unwrap_or(());
    }

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

    // Effacer les cookies côté client
    let clear = "access_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    let clear_refresh = "refresh_token=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0";
    let mut resp_headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(clear) {
        resp_headers.insert(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(clear_refresh) {
        resp_headers.append(SET_COOKIE, v);
    }

    Ok((resp_headers, Json(serde_json::json!({ "ok": true }))))
}

fn generate_refresh_token() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}

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

pub async fn list_sessions(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<axum::Json<serde_json::Value>> {
    let sessions = sqlx::query(
        "SELECT id, device_info, ip_address, last_seen, created_at FROM user_sessions WHERE user_id = $1 ORDER BY last_seen DESC LIMIT 20",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = sessions.iter().map(|s| {
        use sqlx::Row;
        serde_json::json!({
            "id": s.get::<uuid::Uuid, _>("id").to_string(),
            "device": s.get::<Option<String>, _>("device_info"),
            "ip": s.get::<Option<String>, _>("ip_address"),
            "last_seen": s.get::<chrono::DateTime<chrono::Utc>, _>("last_seen").to_rfc3339(),
            "created_at": s.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })
    }).collect();

    Ok(axum::Json(serde_json::json!(result)))
}

pub async fn revoke_session(
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<axum::http::StatusCode> {
    sqlx::query(
        "DELETE FROM user_sessions WHERE id = $1 AND user_id = $2",
    )
    .bind(session_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
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
