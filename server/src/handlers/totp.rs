use axum::{extract::State, Extension, Json, response::IntoResponse};
use serde::{Deserialize, Serialize};
use totp_lite::{totp_custom, Sha1, DEFAULT_STEP};
use data_encoding::BASE32;
use rand::Rng;
use crate::{error::AppError, middleware::auth::Claims, state::AppState};

#[derive(Serialize)]
pub struct TotpSetupResponse {
    secret: String,
    qr_url: String,
    backup_codes: Vec<String>,
}

#[derive(Deserialize)]
pub struct TotpVerifyInput { pub code: String }

pub async fn setup_totp(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse, AppError> {
    use sqlx::Row;

    let secret_bytes: [u8; 20] = rand::thread_rng().gen();
    let secret = BASE32.encode(&secret_bytes);

    let user = sqlx::query("SELECT username FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db).await
        .map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;
    let username: String = user.get("username");

    let qr_url = format!(
        "otpauth://totp/ForgeChat:{}?secret={}&issuer=ForgeChat&algorithm=SHA1&digits=6&period=30",
        urlencoding::encode(&username), secret
    );

    let backup_codes: Vec<String> = (0..8)
        .map(|_| format!("{:04x}-{:04x}",
            rand::thread_rng().gen::<u16>(),
            rand::thread_rng().gen::<u16>()))
        .collect();

    sqlx::query("UPDATE users SET totp_secret = $1, totp_backup_codes = $2 WHERE id = $3")
        .bind(&secret)
        .bind(backup_codes.as_slice())
        .bind(claims.sub)
        .execute(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(TotpSetupResponse { secret, qr_url, backup_codes }))
}

pub async fn confirm_totp(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(input): Json<TotpVerifyInput>,
) -> Result<impl IntoResponse, AppError> {
    use sqlx::Row;
    use redis::AsyncCommands;

    // Rate limit : 5 tentatives / 15 minutes
    let rl_key = format!("totp_confirm:{}", claims.sub);
    {
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&rl_key, 1).await.unwrap_or(0);
        if count == 1 { let _: () = redis.expire(&rl_key, 900).await.unwrap_or(()); }
        if count > 5 { return Err(AppError::TooManyRequests); }
    }

    let user = sqlx::query("SELECT totp_secret FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db).await
        .map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;

    let secret: Option<String> = user.get("totp_secret");
    let secret = secret.ok_or_else(|| AppError::BadRequest("2FA non initialisé".into()))?;

    if !verify_totp(&secret, &input.code) {
        return Err(AppError::BadRequest("Code invalide".into()));
    }

    // Réinitialiser le compteur sur succès
    { let mut redis = state.redis.lock().await; let _: () = redis.del(&rl_key).await.unwrap_or(()); }

    sqlx::query("UPDATE users SET totp_enabled = TRUE WHERE id = $1")
        .bind(claims.sub)
        .execute(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(serde_json::json!({ "enabled": true })))
}

pub async fn disable_totp(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(input): Json<TotpVerifyInput>,
) -> Result<impl IntoResponse, AppError> {
    use sqlx::Row;
    use redis::AsyncCommands;

    // Rate limit : 5 tentatives / 15 minutes
    let rl_key = format!("totp_disable:{}", claims.sub);
    {
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&rl_key, 1).await.unwrap_or(0);
        if count == 1 { let _: () = redis.expire(&rl_key, 900).await.unwrap_or(()); }
        if count > 5 { return Err(AppError::TooManyRequests); }
    }

    let user = sqlx::query("SELECT totp_secret FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db).await
        .map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;

    let secret: Option<String> = user.get("totp_secret");
    let secret = secret.ok_or_else(|| AppError::BadRequest("2FA non activé".into()))?;

    if !verify_totp(&secret, &input.code) {
        return Err(AppError::BadRequest("Code invalide".into()));
    }

    sqlx::query("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1")
        .bind(claims.sub)
        .execute(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(serde_json::json!({ "enabled": false })))
}

/// Comparaison de chaînes en temps constant pour éviter les timing side-channels
fn ct_str_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() { return false; }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn verify_totp(secret: &str, code: &str) -> bool {
    let secret_bytes = match BASE32.decode(secret.as_bytes()) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    for delta in [-1i64, 0, 1] {
        let t = (now as i64 + delta * DEFAULT_STEP as i64) as u64;
        let expected = totp_custom::<Sha1>(DEFAULT_STEP, 6, &secret_bytes, t);
        if ct_str_eq(&expected, code) { return true; }
    }
    false
}
