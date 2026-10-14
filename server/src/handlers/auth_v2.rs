//! Connexion v2 (docs/CHIFFREMENT-E2E.md §3) : le serveur ne reçoit plus jamais le mot de passe,
//! qui protège aussi la clé privée E2E. L'appareil calcule
//! `master = PBKDF2-SHA256(NFKC(mot de passe), kdf_salt, 600 000)`, puis
//! `auth = HKDF(master, "forgechat auth v2")` (envoyé) et `wrapKey = HKDF(master, "forgechat wrap v2")`
//! (gardé). Le serveur stocke `auth_hash = bcrypt(auth)` et `kdf_salt`.
//!
//! Compte non migré (`auth_hash` NULL) : `password_hash = bcrypt(mot de passe)` sert encore,
//! jusqu'à la prochaine connexion d'une appli à jour qui pose `auth_hash` et efface `password_hash`.

use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
    Extension, Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    privacy::{client_key, pseudonym},
    state::AppState,
};

pub const AUTH_LEN: usize = 32;
pub const SALT_LEN: usize = 16;
/// Valeur de `password_hash` d'un compte migré : aucun mot de passe ne la vérifie (bcrypt la refuse).
pub const NO_PASSWORD: &str = "!v2";
pub const UPGRADE_MSG: &str = "Mets à jour ForgeChat pour te connecter";

fn b64_exact(s: &str, len: usize, what: &str) -> Result<Vec<u8>> {
    let bad = || AppError::BadRequest(format!("{what} invalide"));
    if s.len() > 64 {
        return Err(bad());
    }
    let b = URL_SAFE_NO_PAD.decode(s).map_err(|_| bad())?;
    if b.len() != len {
        return Err(bad());
    }
    Ok(b)
}

/// `auth` : exactement 32 octets en base64url sans remplissage.
pub fn check_auth(auth: &str) -> Result<()> {
    b64_exact(auth, AUTH_LEN, "auth").map(|_| ())
}

/// `kdf_salt` : exactement 16 octets en base64url sans remplissage.
pub fn check_salt(salt: &str) -> Result<()> {
    b64_exact(salt, SALT_LEN, "kdf_salt").map(|_| ())
}

/// bcrypt de la chaîne base64url (43 caractères, sous la limite de 72 octets de bcrypt).
pub fn hash_auth(auth: &str) -> Result<String> {
    check_auth(auth)?;
    bcrypt::hash(auth, bcrypt::DEFAULT_COST).map_err(|e| AppError::Internal(e.into()))
}

/// Dérivations acceptées : `pbkdf2` (historique) et `argon2id` (m = 19 Mio, t = 2, p = 1).
pub const KDFS: [&str; 2] = ["pbkdf2", "argon2id"];

/// Valide la dérivation annoncée par l'appli ; absente = `pbkdf2` (anciennes applis).
pub fn check_kdf(kdf: Option<&str>) -> Result<&'static str> {
    match kdf {
        None => Ok("pbkdf2"),
        Some(k) => KDFS.iter().copied().find(|x| *x == k).ok_or_else(|| AppError::BadRequest("kdf invalide".into())),
    }
}

pub fn email_norm(email: &str) -> String {
    email.trim().to_lowercase()
}

/// Sel factice d'un e-mail inconnu : HMAC(secret serveur, e-mail)[0..16], stable d'une requête à
/// l'autre, donc indiscernable du sel d'un compte réel non migré (pas d'énumération).
pub fn fake_salt(secret: &str, email: &str) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()).expect("HMAC accepte toute clé");
    mac.update(b"forgechat prelogin v2|");
    mac.update(email.as_bytes());
    URL_SAFE_NO_PAD.encode(&mac.finalize().into_bytes()[..SALT_LEN])
}

// ─── Compteurs anti-force brute (fail-closed) ───────────────────────────────

fn redis_down<E>(_: E) -> AppError {
    AppError::Unavailable("Service momentanément indisponible, réessaie dans un instant".into())
}

/// Compte une tentative ; 429 au-delà de `max` dans la fenêtre. Redis injoignable : 503, jamais
/// un passage libre.
pub async fn hit(state: &AppState, key: &str, max: i64, window_secs: i64) -> Result<()> {
    let mut redis = state.redis.lock().await;
    let n: i64 = redis.incr(key, 1).await.map_err(redis_down)?;
    if n == 1 {
        if let Err(e) = redis.expire(key, window_secs).await.map(|_: bool| ()) {
            // Sans TTL le compteur bloquerait la clé à vie : on la retire avant de refuser.
            let _: std::result::Result<i64, _> = redis.del(key).await;
            return Err(redis_down(e));
        }
    }
    if n > max {
        drop(redis);
        crate::security_events::record(state, "rate_limited").await;
        return Err(AppError::TooManyRequests);
    }
    Ok(())
}

/// Compteur par e-mail (pseudonymisé), commun à la connexion, au prelogin, à l'inscription et à
/// l'oubli de mot de passe pour un même compte.
pub fn account_key(prefix: &str, email: &str) -> String {
    format!("{prefix}:{}", pseudonym(&email_norm(email)))
}

// ─── Prelogin ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PreloginBody {
    email: String,
}

/// Rend `(kdf_salt, legacy, kdf)` pour un e-mail ; inconnu = sel factice et `legacy`, comme un compte non migré.
pub async fn prelogin_lookup(db: &PgPool, secret: &str, email: &str) -> Result<(String, bool, String)> {
    let email = email_norm(email);
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT kdf_salt, kdf FROM users WHERE email_hmac=$1 AND auth_hash IS NOT NULL AND kdf_salt IS NOT NULL")
            .bind(crate::email_crypto::hmac(&email))
            .fetch_optional(db)
            .await?;
    Ok(match row {
        Some((s, kdf)) => (s, false, kdf),
        None => (fake_salt(secret, &email), true, "pbkdf2".into()),
    })
}

/// POST /api/auth/prelogin {email} → {kdf_salt, legacy}
pub async fn prelogin(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<PreloginBody>,
) -> Result<Json<Value>> {
    if body.email.len() > 254 {
        return Err(AppError::BadRequest("Email invalide".into()));
    }
    hit(&state, &format!("prelogin_ip:{}", client_key(&headers, &addr)), 30, 900).await?;
    hit(&state, &account_key("prelogin_acct", &body.email), 30, 900).await?;
    let (kdf_salt, legacy, kdf) = prelogin_lookup(&state.db, &state.config.jwt_secret, &body.email).await?;
    Ok(Json(json!({ "kdf_salt": kdf_salt, "legacy": legacy, "kdf": kdf })))
}

/// GET /users/me/kdf → {kdf_salt, legacy} du compte connecté (avant une action sensible).
pub async fn my_kdf(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    let (salt, migrated, kdf): (Option<String>, bool, String) =
        sqlx::query_as("SELECT kdf_salt, auth_hash IS NOT NULL, kdf FROM users WHERE id=$1")
            .bind(claims.sub)
            .fetch_one(&state.db)
            .await?;
    Ok(Json(json!({ "kdf_salt": salt.filter(|_| migrated), "legacy": !migrated, "kdf": kdf })))
}

// ─── Preuve du mot de passe pour une action sensible ────────────────────────

/// Résultat de la vérification d'une preuve, sans effet de bord (testable sans Redis).
#[derive(Debug, PartialEq)]
pub enum ProofCheck {
    Ok,
    Wrong,
    /// Mot de passe en clair envoyé pour un compte migré : appli trop ancienne.
    Upgrade,
}

/// `auth` pour un compte migré ; `password` seulement pour un compte pas encore migré.
pub fn check_proof(password_hash: &str, auth_hash: Option<&str>, auth: Option<&str>, password: Option<&str>) -> ProofCheck {
    let ok = |b: bool| if b { ProofCheck::Ok } else { ProofCheck::Wrong };
    match (auth_hash, auth, password) {
        (Some(h), Some(a), _) => ok(check_auth(a).is_ok() && bcrypt::verify(a, h).unwrap_or(false)),
        (Some(_), None, Some(_)) => ProofCheck::Upgrade,
        (None, _, Some(p)) => ok(!p.is_empty() && p.len() <= 128 && bcrypt::verify(p, password_hash).unwrap_or(false)),
        _ => ProofCheck::Wrong,
    }
}

/// Vérifie la preuve du compte connecté ; 10 essais / 15 min par compte, toutes routes confondues.
pub async fn verify_proof(state: &AppState, user_id: Uuid, auth: Option<&str>, password: Option<&str>) -> Result<()> {
    hit(state, &format!("proof:{user_id}"), 10, 900).await?;
    let (pw_hash, auth_hash): (String, Option<String>) =
        sqlx::query_as("SELECT password_hash, auth_hash FROM users WHERE id=$1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;
    match check_proof(&pw_hash, auth_hash.as_deref(), auth, password) {
        ProofCheck::Ok => Ok(()),
        ProofCheck::Wrong => Err(AppError::BadRequest("Mot de passe actuel incorrect".into())),
        ProofCheck::Upgrade => Err(AppError::UpgradeRequired(UPGRADE_MSG.into())),
    }
}

/// Migration v1 → v2 d'un compte dont le mot de passe vient d'être vérifié : `auth_hash` et
/// `kdf_salt` posés, `password_hash` rendu inutilisable, en une seule requête (atomique).
/// Sans effet si le compte est déjà migré (rejeu, deux appareils en même temps).
pub async fn migrate_account(db: &PgPool, user_id: Uuid, auth_new: &str, kdf_salt_new: &str, kdf: &str) -> Result<bool> {
    check_salt(kdf_salt_new)?;
    let kdf = check_kdf(Some(kdf))?;
    let auth_hash = hash_auth(auth_new)?;
    let done = sqlx::query(
        "UPDATE users SET auth_hash=$2, kdf_salt=$3, password_hash=$4, kdf=$5, updated_at=NOW()
         WHERE id=$1 AND auth_hash IS NULL",
    )
    .bind(user_id)
    .bind(&auth_hash)
    .bind(kdf_salt_new)
    .bind(NO_PASSWORD)
    .bind(kdf)
    .execute(db)
    .await?;
    Ok(done.rows_affected() == 1)
}

// ─── Passage à Argon2id (audit 2026-10-12, M3) ──────────────────────────────

#[derive(Deserialize)]
pub struct UpgradeKdfBody {
    old_auth: String,
    new_auth: String,
    new_kdf_salt: String,
    kdf: String,
    /// Clé de compte E2E re-scellée par la nouvelle wrapKey (obligatoire si le compte en a une).
    #[serde(default)]
    wrapped: Option<Value>,
}

/// POST /auth/upgrade-kdf : l'appli, qui vient de prouver le mot de passe, le re-dérive avec
/// Argon2id. Preuve, sel, dérivation et enveloppe E2E changent ensemble (une transaction) ; les
/// sessions restent ouvertes (même mot de passe). Seulement de `pbkdf2` vers `argon2id`.
pub async fn upgrade_kdf(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpgradeKdfBody>,
) -> Result<Json<Value>> {
    if body.kdf != "argon2id" {
        return Err(AppError::BadRequest("kdf invalide".into()));
    }
    check_auth(&body.new_auth)?;
    check_salt(&body.new_kdf_salt)?;
    let wrapped = match &body.wrapped {
        None | Some(Value::Null) => None,
        Some(v) => {
            let w: crate::handlers::user_keys::Wrapped =
                serde_json::from_value(v.clone()).map_err(|_| AppError::BadRequest("wrapped invalide".into()))?;
            w.validate()?;
            Some(serde_json::to_value(&w).map_err(|e| AppError::Internal(e.into()))?)
        }
    };
    verify_proof(&state, claims.sub, Some(&body.old_auth), None).await?;
    let has_key: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_keys WHERE user_id=$1)")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
    if has_key && wrapped.is_none() {
        return Err(AppError::BadRequest("wrapped requis".into()));
    }
    let new_hash = hash_auth(&body.new_auth)?;
    let mut tx = state.db.begin().await?;
    let done = sqlx::query(
        "UPDATE users SET auth_hash=$2, kdf_salt=$3, kdf='argon2id', updated_at=NOW()
         WHERE id=$1 AND kdf='pbkdf2' AND auth_hash IS NOT NULL",
    )
    .bind(claims.sub)
    .bind(&new_hash)
    .bind(&body.new_kdf_salt)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() != 1 {
        return Err(AppError::Conflict("KDF_ALREADY_UPGRADED".into()));
    }
    if let Some(w) = wrapped {
        sqlx::query("UPDATE user_keys SET wrapped=$2 WHERE user_id=$1")
            .bind(claims.sub)
            .bind(w)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "kdf": "argon2id" })))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTH: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    #[test]
    fn fake_salt_is_deterministic_and_secret_bound() {
        let a = fake_salt("s1", "x@gmail.com");
        assert_eq!(a, fake_salt("s1", "x@gmail.com"));
        assert_ne!(a, fake_salt("s2", "x@gmail.com"));
        assert_ne!(a, fake_salt("s1", "y@gmail.com"));
        assert!(check_salt(&a).is_ok());
    }

    #[test]
    fn auth_and_salt_formats() {
        assert!(check_auth(AUTH).is_ok());
        assert!(check_auth(&AUTH[..42]).is_err());
        assert!(check_auth(&format!("{AUTH}=")).is_err());
        assert!(check_auth("mot de passe").is_err());
        assert!(check_auth(&"A".repeat(10_000)).is_err());
        assert!(check_salt("AAAAAAAAAAAAAAAAAAAAAA").is_ok());
        assert!(check_salt(AUTH).is_err());
    }

    #[test]
    fn kdf_names() {
        assert_eq!(check_kdf(None).unwrap(), "pbkdf2");
        assert_eq!(check_kdf(Some("argon2id")).unwrap(), "argon2id");
        assert!(check_kdf(Some("md5")).is_err());
    }

    #[test]
    fn proof_rules() {
        let auth_hash = bcrypt::hash(AUTH, 4).unwrap();
        let pw_hash = bcrypt::hash("ancien mot de passe", 4).unwrap();
        // Compte migré : auth seulement, le mot de passe en clair est refusé (appli à mettre à jour).
        assert_eq!(check_proof(NO_PASSWORD, Some(&auth_hash), Some(AUTH), None), ProofCheck::Ok);
        assert_eq!(check_proof(NO_PASSWORD, Some(&auth_hash), Some(&AUTH.replace('A', "B")), None), ProofCheck::Wrong);
        assert_eq!(check_proof(NO_PASSWORD, Some(&auth_hash), None, Some("ancien mot de passe")), ProofCheck::Upgrade);
        assert_eq!(check_proof(NO_PASSWORD, Some(&auth_hash), None, None), ProofCheck::Wrong);
        // Compte non migré : mot de passe vérifié par l'ancien bcrypt ; un auth seul ne prouve rien.
        assert_eq!(check_proof(&pw_hash, None, None, Some("ancien mot de passe")), ProofCheck::Ok);
        assert_eq!(check_proof(&pw_hash, None, None, Some("faux")), ProofCheck::Wrong);
        assert_eq!(check_proof(&pw_hash, None, Some(AUTH), None), ProofCheck::Wrong);
        // Le marqueur d'un compte migré ne se vérifie avec aucun mot de passe.
        assert_eq!(check_proof(NO_PASSWORD, None, None, Some(NO_PASSWORD)), ProofCheck::Wrong);
    }
}

#[cfg(test)]
#[path = "auth_v2_db_tests.rs"]
mod db_tests;
