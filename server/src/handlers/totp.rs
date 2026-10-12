use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use axum::{extract::State, Extension, Json, response::IntoResponse};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use data_encoding::BASE32;
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::sync::OnceLock;
use totp_lite::{totp_custom, Sha1, DEFAULT_STEP};
use uuid::Uuid;

use crate::{error::AppError, handlers::auth_v2::hit, middleware::auth::Claims, state::AppState};

#[derive(Serialize)]
pub struct TotpSetupResponse {
    secret: String,
    qr_url: String,
    backup_codes: Vec<String>,
}

#[derive(Deserialize)]
pub struct TotpVerifyInput { pub code: String }

// ─── Secret chiffré au repos, codes de secours hachés ───────────────────────

/// Préfixe d'un secret TOTP chiffré (AES-256-GCM, clé TOTP_ENC_KEY, AAD liée au compte).
const SEALED: &str = "v1:";
/// Préfixe d'un code de secours haché (SHA-256 du code normalisé).
const HASHED: &str = "sha256:";
const BACKUP_CODES: usize = 10;

static ENC_KEY: OnceLock<[u8; 32]> = OnceLock::new();

/// Lit TOTP_ENC_KEY (32 octets en base64) au démarrage ; absente ou invalide = le serveur ne démarre pas.
pub fn init_enc_key() -> anyhow::Result<()> {
    let raw = std::env::var("TOTP_ENC_KEY")
        .map_err(|_| anyhow::anyhow!("TOTP_ENC_KEY manquante : 32 octets en base64 (openssl rand -base64 32)"))?;
    let raw = raw.trim();
    let key = STANDARD.decode(raw).or_else(|_| URL_SAFE_NO_PAD.decode(raw))
        .map_err(|_| anyhow::anyhow!("TOTP_ENC_KEY invalide : base64 attendu"))?;
    let key: [u8; 32] = key.try_into().map_err(|_| anyhow::anyhow!("TOTP_ENC_KEY invalide : 32 octets attendus"))?;
    let _ = ENC_KEY.set(key);
    Ok(())
}

fn cipher() -> Result<Aes256Gcm, AppError> {
    let key = ENC_KEY.get().ok_or_else(|| AppError::Internal(anyhow::anyhow!("TOTP_ENC_KEY non chargée")))?;
    Ok(Aes256Gcm::new(key.into()))
}

fn aad(user_id: Uuid) -> String {
    format!("forgechat totp v1|{user_id}")
}

pub fn seal_secret(user_id: Uuid, secret: &str) -> Result<String, AppError> {
    let iv: [u8; 12] = rand::thread_rng().gen();
    let ct = cipher()?
        .encrypt(Nonce::from_slice(&iv), Payload { msg: secret.as_bytes(), aad: aad(user_id).as_bytes() })
        .map_err(|_| AppError::Internal(anyhow::anyhow!("chiffrement TOTP")))?;
    Ok(format!("{SEALED}{}", URL_SAFE_NO_PAD.encode([&iv[..], &ct].concat())))
}

pub fn open_secret(user_id: Uuid, stored: &str) -> Option<String> {
    let raw = URL_SAFE_NO_PAD.decode(stored.strip_prefix(SEALED)?).ok()?;
    if raw.len() < 12 + 16 {
        return None;
    }
    let (iv, ct) = raw.split_at(12);
    let pt = cipher().ok()?.decrypt(Nonce::from_slice(iv), Payload { msg: ct, aad: aad(user_id).as_bytes() }).ok()?;
    String::from_utf8(pt).ok()
}

/// Forme canonique d'un code de secours : chiffres hexadécimaux en minuscules, sans tirets ni espaces.
fn normalize_backup(code: &str) -> String {
    code.chars().filter(char::is_ascii_hexdigit).map(|c| c.to_ascii_lowercase()).collect()
}

pub fn hash_backup(code: &str) -> String {
    let digest = Sha256::digest(normalize_backup(code).as_bytes());
    format!("{HASHED}{}", digest.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// 10 codes de 64 bits, `xxxx-xxxx-xxxx-xxxx`.
fn new_backup_codes() -> Vec<String> {
    (0..BACKUP_CODES)
        .map(|_| {
            let v: u64 = rand::thread_rng().gen();
            let h = format!("{v:016x}");
            format!("{}-{}-{}-{}", &h[0..4], &h[4..8], &h[8..12], &h[12..16])
        })
        .collect()
}

/// Au démarrage : chiffre les secrets encore en clair et hache les codes de secours en clair.
/// Idempotent (préfixes `v1:` et `sha256:`).
pub async fn migrate_at_rest(db: &PgPool) -> anyhow::Result<u64> {
    let rows: Vec<(Uuid, Option<String>, Option<Vec<String>>)> = sqlx::query_as(
        "SELECT id, totp_secret, totp_backup_codes FROM users
         WHERE (totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1:%')
            OR EXISTS (SELECT 1 FROM unnest(totp_backup_codes) c WHERE c NOT LIKE 'sha256:%')",
    )
    .fetch_all(db)
    .await?;
    let mut n = 0;
    for (id, secret, codes) in rows {
        let secret = match secret {
            Some(s) if !s.starts_with(SEALED) => Some(seal_secret(id, &s).map_err(|e| anyhow::anyhow!("{e}"))?),
            other => other,
        };
        let codes = codes.map(|cs| {
            cs.into_iter().map(|c| if c.starts_with(HASHED) { c } else { hash_backup(&c) }).collect::<Vec<_>>()
        });
        sqlx::query("UPDATE users SET totp_secret=$2, totp_backup_codes=$3 WHERE id=$1")
            .bind(id)
            .bind(secret)
            .bind(codes)
            .execute(db)
            .await?;
        n += 1;
    }
    Ok(n)
}

// ─── Routes ──────────────────────────────────────────────────────────────────

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

    let backup_codes = new_backup_codes();
    let hashed: Vec<String> = backup_codes.iter().map(|c| hash_backup(c)).collect();

    // Le WHERE totp_enabled=FALSE protège contre l'écrasement silencieux d'un secret
    // déjà actif : un second appel (double-clic, 2e appareil) doit échouer, pas renvoyer
    // un secret que le serveur n'aurait jamais enregistré.
    let result = sqlx::query(
        "UPDATE users SET totp_secret = $1, totp_backup_codes = $2
         WHERE id = $3 AND totp_enabled = FALSE"
    )
    .bind(seal_secret(claims.sub, &secret)?)
    .bind(hashed.as_slice())
    .bind(claims.sub)
    .execute(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    if result.rows_affected() == 0 {
        return Err(AppError::BadRequest("2FA déjà activé -- désactivez-le d'abord pour le reconfigurer".into()));
    }

    Ok(Json(TotpSetupResponse { secret, qr_url, backup_codes }))
}

async fn load_secret(state: &AppState, user_id: Uuid) -> Result<Option<String>, AppError> {
    let stored: Option<String> = sqlx::query_scalar("SELECT totp_secret FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    Ok(stored.and_then(|s| open_secret(user_id, &s)))
}

/// Anti-rejeu : un code TOTP ne sert qu'une fois par compte (90 s = 3 fenêtres). Redis coupé : refus.
async fn first_use(state: &AppState, user_id: Uuid, code: &str) -> Result<bool, AppError> {
    let key = format!("totp_used:{user_id}:{}", code.trim());
    let mut redis = state.redis.lock().await;
    let fresh: bool = redis.set_nx(&key, 1i64).await
        .map_err(|_| AppError::Unavailable("Service momentanément indisponible".into()))?;
    if fresh {
        let _: () = redis.expire(&key, 90i64).await.unwrap_or(());
    }
    Ok(fresh)
}

/// Code TOTP (anti-rejeu) ou code de secours (consommé) du compte, 5 échecs / 15 min par compte
/// (connexion, ré-authentification, désactivation partagent le compteur).
pub async fn check_code(state: &AppState, user_id: Uuid, code: &str) -> Result<bool, AppError> {
    let key = format!("totp_fail:{user_id}");
    hit(state, &key, 5, 900).await?;
    let code = code.trim();
    let ok = match load_secret(state, user_id).await? {
        Some(secret) if verify_totp(&secret, code) => first_use(state, user_id, code).await?,
        _ => verify_and_consume_backup_code(state, user_id, code).await?,
    };
    if ok {
        // Seuls les échecs restent comptés ; un attaquant ne réussit jamais sur ce compte.
        let mut redis = state.redis.lock().await;
        let _: () = redis.decr(&key, 1).await.unwrap_or(());
    }
    Ok(ok)
}

pub async fn confirm_totp(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(input): Json<TotpVerifyInput>,
) -> Result<impl IntoResponse, AppError> {
    hit(&state, &format!("totp_confirm:{}", claims.sub), 5, 900).await?;
    let secret = load_secret(&state, claims.sub).await?
        .ok_or_else(|| AppError::BadRequest("2FA non initialisé".into()))?;
    if !verify_totp(&secret, input.code.trim()) {
        return Err(AppError::BadRequest("Code invalide".into()));
    }
    if !first_use(&state, claims.sub, &input.code).await? {
        return Err(AppError::BadRequest("Code TOTP déjà utilisé".into()));
    }

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
    if load_secret(&state, claims.sub).await?.is_none() {
        return Err(AppError::BadRequest("2FA non activé".into()));
    }
    if !check_code(&state, claims.sub, &input.code).await? {
        return Err(AppError::BadRequest("Code invalide".into()));
    }

    sqlx::query("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1")
        .bind(claims.sub)
        .execute(&state.db).await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;
    // Les clés d'accès complètent le code et ne vivent pas sans lui (handlers/passkeys.rs).
    sqlx::query("DELETE FROM webauthn_credentials WHERE user_id = $1")
        .bind(claims.sub)
        .execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "enabled": false })))
}

/// POST /auth/2fa/backup-codes { code } : nouveaux codes de secours (amélioration n° 4). Exige un
/// code valide (TOTP ou un code de secours restant) ; les anciens codes sont tous invalidés. Les
/// nouveaux ne sont affichés qu'ici, une seule fois, et stockés hachés.
pub async fn regenerate_backup_codes(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(input): Json<TotpVerifyInput>,
) -> Result<impl IntoResponse, AppError> {
    let enabled: bool = sqlx::query_scalar("SELECT totp_enabled FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
    if !enabled {
        return Err(AppError::BadRequest("2FA non activé".into()));
    }
    if !check_code(&state, claims.sub, &input.code).await? {
        crate::security_events::record(&state, "totp_failed").await;
        return Err(AppError::BadRequest("Code invalide".into()));
    }
    let codes = new_backup_codes();
    let hashed: Vec<String> = codes.iter().map(|c| hash_backup(c)).collect();
    sqlx::query("UPDATE users SET totp_backup_codes = $1 WHERE id = $2 AND totp_enabled = TRUE")
        .bind(hashed.as_slice())
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "backup_codes": codes })))
}

/// GET /auth/2fa/status : activé ? combien de codes de secours restent ? (jamais les codes).
pub async fn totp_status(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse, AppError> {
    let (enabled, left): (bool, Option<i32>) = sqlx::query_as(
        "SELECT totp_enabled, cardinality(totp_backup_codes) FROM users WHERE id = $1",
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "enabled": enabled, "backup_codes_left": if enabled { left.unwrap_or(0) } else { 0 } })))
}

/// Comparaison de chaînes en temps constant pour éviter les timing side-channels
fn ct_str_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() { return false; }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Vérifie un code de secours (comparaison en temps constant des hachés) et le consomme :
/// le retrait conditionnel en base garantit l'usage unique même en course.
pub async fn verify_and_consume_backup_code(
    state: &AppState,
    user_id: Uuid,
    code: &str,
) -> Result<bool, AppError> {
    if normalize_backup(code).len() < 8 {
        return Ok(false);
    }
    let codes: Option<Vec<String>> = sqlx::query_scalar("SELECT totp_backup_codes FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    let wanted = hash_backup(code);
    let mut found = None;
    for c in codes.unwrap_or_default() {
        // Toutes les entrées sont comparées : le temps ne dépend pas de la position du code.
        if ct_str_eq(&c, &wanted) {
            found = Some(c);
        }
    }
    let Some(found) = found else { return Ok(false) };
    let done = sqlx::query(
        "UPDATE users SET totp_backup_codes = array_remove(totp_backup_codes, $1)
         WHERE id = $2 AND $1 = ANY(totp_backup_codes)",
    )
    .bind(&found)
    .bind(user_id)
    .execute(&state.db)
    .await?;
    Ok(done.rows_affected() == 1)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn key() {
        let _ = ENC_KEY.set([7u8; 32]);
    }

    #[test]
    fn secret_sealed_and_bound_to_account() {
        key();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let sealed = seal_secret(a, "JBSWY3DPEHPK3PXP").unwrap();
        assert!(sealed.starts_with(SEALED));
        assert!(!sealed.contains("JBSWY3DPEHPK3PXP"));
        assert_eq!(open_secret(a, &sealed).as_deref(), Some("JBSWY3DPEHPK3PXP"));
        assert_eq!(open_secret(b, &sealed), None); // copié sur un autre compte : illisible
        assert_eq!(open_secret(a, "JBSWY3DPEHPK3PXP"), None); // clair : refusé
    }

    #[test]
    fn backup_codes_are_64_bits_and_hashed() {
        let codes = new_backup_codes();
        assert_eq!(codes.len(), 10);
        for c in &codes {
            assert_eq!(normalize_backup(c).len(), 16);
        }
        assert_eq!(hash_backup("ABCD-ef01 2345-6789"), hash_backup("abcdef0123456789"));
        assert!(hash_backup("abcd").starts_with(HASHED));
        assert_ne!(hash_backup(&codes[0]), hash_backup(&codes[1]));
    }
}
