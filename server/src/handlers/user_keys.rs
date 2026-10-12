//! Clé de compte du chiffrement de bout en bout (docs/CHIFFREMENT-E2E.md §3).
//!
//! Le serveur stocke la clé publique et deux enveloppes opaques de la clé
//! privée, chiffrées sur l'appareil (wrapKey dérivée du mot de passe, code de
//! récupération). Il valide strictement leur forme mais ne peut ni les ouvrir
//! ni les vérifier. Les actions sensibles exigent `auth` (connexion v2), ou
//! `password` pour un compte pas encore migré (handlers/auth_v2.rs).

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::auth_v2::verify_proof,
    middleware::auth::Claims,
    state::AppState,
};

/// Ancienneté maximale de la connexion pour remplacer la clé (secondes).
const FRESH_SESSION_SECS: i64 = 600;
/// Anciennes clés publiques conservées par compte.
const OLD_KEYS_KEPT: i64 = 20;

/// Clé privée enveloppée, base64url : v1 = {v:1, salt 16 o, iv 12 o, ct 32 o + tag 16 o}
/// (PBKDF2 du mot de passe, encore lisible pour la migration) ; v2 = {v:2, iv, ct} (wrapKey de la
/// connexion v2, pas de sel propre).
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Wrapped {
    pub v: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub salt: Option<String>,
    pub iv: String,
    pub ct: String,
}

fn b64_exact(s: &str, len: usize, what: &str) -> Result<Vec<u8>> {
    let bad = || AppError::BadRequest(format!("{what} invalide"));
    // Borne avant décodage : rien d'énorme n'est alloué.
    if s.len() > 128 {
        return Err(bad());
    }
    let b = URL_SAFE_NO_PAD.decode(s).map_err(|_| bad())?;
    if b.len() != len {
        return Err(bad());
    }
    Ok(b)
}

impl Wrapped {
    pub fn validate(&self) -> Result<()> {
        match (self.v, self.salt.as_deref()) {
            (1, Some(salt)) => {
                b64_exact(salt, 16, "salt")?;
            }
            (2, None) => {}
            _ => return Err(AppError::BadRequest("Version d'enveloppe inconnue".into())),
        }
        b64_exact(&self.iv, 12, "iv")?;
        b64_exact(&self.ct, 48, "ct")?;
        Ok(())
    }
}

/// Vérifie la clé publique (point P-256 non compressé, 65 o) et rend son empreinte.
pub fn public_fingerprint(public: &str) -> Result<String> {
    let raw = b64_exact(public, 65, "Clé publique")?;
    if raw[0] != 4 {
        return Err(AppError::BadRequest("Clé publique invalide".into()));
    }
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(&raw)))
}

fn to_json(w: &Wrapped) -> Value {
    serde_json::to_value(w).unwrap_or(Value::Null)
}

fn no_key() -> AppError {
    AppError::NotFound("NO_KEY".into())
}

/// GET /users/me/keys
pub async fn get_my_keys(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>> {
    let row: Option<(String, String, Value, Option<Value>)> = sqlx::query_as(
        "SELECT public_key, fingerprint, wrapped, backup FROM user_keys WHERE user_id=$1",
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;
    let (public, fingerprint, wrapped, backup) = row.ok_or_else(no_key)?;
    Ok(Json(json!({ "public": public, "fingerprint": fingerprint, "wrapped": wrapped, "backup": backup })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateKeyBody {
    public: String,
    wrapped: Wrapped,
    backup: Option<Wrapped>,
}

/// Valide une clé complète et rend l'empreinte de sa partie publique.
fn validate_key(public: &str, wrapped: &Wrapped, backup: Option<&Wrapped>) -> Result<String> {
    wrapped.validate()?;
    if let Some(b) = backup {
        b.validate()?;
    }
    public_fingerprint(public)
}

/// PUT /users/me/keys — création seulement (409 KEY_EXISTS sinon).
pub async fn create_my_keys(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateKeyBody>,
) -> Result<Json<Value>> {
    let fingerprint = validate_key(&body.public, &body.wrapped, body.backup.as_ref())?;
    let mut tx = state.db.begin().await?;
    let done = sqlx::query(
        "INSERT INTO user_keys (user_id, public_key, fingerprint, wrapped, backup, backup_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::jsonb IS NULL THEN NULL ELSE NOW() END)
         ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(claims.sub)
    .bind(&body.public)
    .bind(&fingerprint)
    .bind(to_json(&body.wrapped))
    .bind(body.backup.as_ref().map(to_json))
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("KEY_EXISTS".into()));
    }
    // Journal de transparence (amélioration n° 10), dans la même transaction.
    let kt_seq = crate::key_log::append(&mut tx, claims.sub, &body.public).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "fingerprint": fingerprint, "kt_seq": kt_seq })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RewrapBody {
    #[serde(default)]
    auth: Option<String>,
    #[serde(default)]
    password: Option<String>,
    wrapped: Wrapped,
}

/// PUT /users/me/keys/wrapped {auth, wrapped} — ré-enveloppe : migration v1 → v2 juste après la
/// connexion (idempotent), ou après une réinitialisation par e-mail + code de récupération.
pub async fn rewrap_my_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<RewrapBody>,
) -> Result<Json<Value>> {
    body.wrapped.validate()?;
    verify_proof(&state, claims.sub, body.auth.as_deref(), body.password.as_deref()).await?;
    let done = sqlx::query("UPDATE user_keys SET wrapped=$2 WHERE user_id=$1")
        .bind(claims.sub)
        .bind(to_json(&body.wrapped))
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(no_key());
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupBody {
    #[serde(default)]
    auth: Option<String>,
    #[serde(default)]
    password: Option<String>,
    backup: Wrapped,
}

/// PUT /users/me/keys/backup — nouveau code de récupération.
pub async fn put_my_backup(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<BackupBody>,
) -> Result<Json<Value>> {
    body.backup.validate()?;
    verify_proof(&state, claims.sub, body.auth.as_deref(), body.password.as_deref()).await?;
    let done = sqlx::query("UPDATE user_keys SET backup=$2, backup_at=NOW() WHERE user_id=$1")
        .bind(claims.sub)
        .bind(to_json(&body.backup))
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(no_key());
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PasswordBody {
    #[serde(default)]
    auth: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

/// DELETE /users/me/keys/backup — supprime le code de récupération.
pub async fn delete_my_backup(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PasswordBody>,
) -> Result<Json<Value>> {
    verify_proof(&state, claims.sub, body.auth.as_deref(), body.password.as_deref()).await?;
    sqlx::query("UPDATE user_keys SET backup=NULL, backup_at=NULL WHERE user_id=$1")
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResetKeyBody {
    #[serde(default)]
    auth: Option<String>,
    #[serde(default)]
    password: Option<String>,
    public: String,
    wrapped: Wrapped,
    backup: Option<Wrapped>,
}

/// POST /users/me/keys/reset — nouvelle clé quand l'ancienne est perdue
/// (mot de passe oublié sans code de récupération). Exige une connexion de
/// moins de 10 min et le mot de passe : un jeton volé ne suffit pas à
/// remplacer l'identité. L'ancienne clé publique est archivée.
pub async fn reset_my_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<ResetKeyBody>,
) -> Result<Json<Value>> {
    let fingerprint = validate_key(&body.public, &body.wrapped, body.backup.as_ref())?;
    if !is_fresh(claims.iat, chrono::Utc::now().timestamp()) {
        return Err(AppError::ForbiddenMsg("FRESH_LOGIN_REQUIRED".into()));
    }
    verify_proof(&state, claims.sub, body.auth.as_deref(), body.password.as_deref()).await?;

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO user_keys_old (user_id, public_key, fingerprint, created_at)
         SELECT user_id, public_key, fingerprint, created_at FROM user_keys WHERE user_id=$1",
    )
    .bind(claims.sub)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM user_keys_old WHERE user_id=$1 AND id NOT IN (
            SELECT id FROM user_keys_old WHERE user_id=$1 ORDER BY retired_at DESC, id DESC LIMIT $2)",
    )
    .bind(claims.sub)
    .bind(OLD_KEYS_KEPT)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO user_keys (user_id, public_key, fingerprint, wrapped, backup, backup_at)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::jsonb IS NULL THEN NULL ELSE NOW() END)
         ON CONFLICT (user_id) DO UPDATE SET public_key=EXCLUDED.public_key, fingerprint=EXCLUDED.fingerprint,
            wrapped=EXCLUDED.wrapped, backup=EXCLUDED.backup, backup_at=EXCLUDED.backup_at, created_at=NOW()",
    )
    .bind(claims.sub)
    .bind(&body.public)
    .bind(&fingerprint)
    .bind(to_json(&body.wrapped))
    .bind(body.backup.as_ref().map(to_json))
    .execute(&mut *tx)
    .await?;
    let kt_seq = crate::key_log::append(&mut tx, claims.sub, &body.public).await?;
    tx.commit().await?;
    tracing::info!(user_id = %claims.sub, "clé E2E réinitialisée");
    Ok(Json(json!({ "ok": true, "fingerprint": fingerprint, "kt_seq": kt_seq })))
}

fn is_fresh(iat: i64, now: i64) -> bool {
    iat > 0 && now - iat <= FRESH_SESSION_SECS && iat <= now + 60
}

/// GET /users/:id/keys/public — seulement si l'appelant partage un serveur,
/// un MP, un groupe ou une amitié avec la personne (sinon 404, pas d'énumération).
pub async fn get_public_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>> {
    let not_found = || AppError::NotFound("Clé introuvable".into());
    if user_id != claims.sub {
        let related: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM server_members a JOIN server_members b ON a.server_id=b.server_id
                            WHERE a.user_id=$1 AND b.user_id=$2)
                 OR EXISTS(SELECT 1 FROM dm_channels
                            WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1))
                 OR EXISTS(SELECT 1 FROM group_dm_members a JOIN group_dm_members b ON a.dm_id=b.dm_id
                            WHERE a.user_id=$1 AND b.user_id=$2)
                 OR EXISTS(SELECT 1 FROM friendships WHERE status='accepted'
                            AND ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)))",
        )
        .bind(claims.sub)
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        if !related {
            return Err(not_found());
        }
    }
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT public_key, fingerprint FROM user_keys WHERE user_id=$1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
    let (public, fingerprint) = row.ok_or_else(not_found)?;
    // Entrée du journal de transparence où cette clé doit figurer (vérifiée par l'appli).
    let kt_seq = crate::key_log::latest_seq(&state.db, user_id).await;
    Ok(Json(json!({ "user_id": user_id, "public": public, "fingerprint": fingerprint, "kt_seq": kt_seq })))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Valeurs de docs/e2e-vectors.json : le format du serveur suit celui des clients.
    const PUB: &str = "BOICWfpxS3xMFy1Hk9p-Od4Lx4J_0RTvujHlEL1uqLnjS1OXGYcw8PD4ah_Is1vmLjum1Xl-EcrukfhXNWmLIGE";
    const FP: &str = "8NZ0m7mf9YzfiPUaB20uTbeVS5wS2DkJ5V36XPlhLv4";

    fn wrapped() -> Wrapped {
        Wrapped {
            v: 1,
            salt: Some("MjM0NTY3ODk6Ozw9Pj9AQQ".into()),
            iv: "RkdISUpLTE1OT1BR".into(),
            ct: "qrP0E2lRj1Ywingccp04DXW4S5WAAuSIkk9t_gGSd6cwf34kTjLUpmyoulia68tZ".into(),
        }
    }

    #[test]
    fn fingerprint_matches_clients() {
        assert_eq!(public_fingerprint(PUB).unwrap(), FP);
    }

    #[test]
    fn rejects_bad_public_keys() {
        assert!(public_fingerprint("").is_err());
        assert!(public_fingerprint(&PUB[..PUB.len() - 2]).is_err()); // trop courte
        assert!(public_fingerprint(&format!("{PUB}=")).is_err()); // remplissage
        assert!(public_fingerprint(&PUB.replace('-', "+")).is_err()); // base64 classique
        let compressed = URL_SAFE_NO_PAD.encode([2u8; 65]);
        assert!(public_fingerprint(&compressed).is_err()); // préfixe ≠ 04
        assert!(public_fingerprint(&"A".repeat(10_000)).is_err());
    }

    #[test]
    fn validates_wrapped() {
        assert!(wrapped().validate().is_ok());
        assert!(Wrapped { v: 2, ..wrapped() }.validate().is_err()); // v2 n'a pas de sel
        assert!(Wrapped { v: 2, salt: None, ..wrapped() }.validate().is_ok());
        assert!(Wrapped { v: 1, salt: None, ..wrapped() }.validate().is_err());
        assert!(Wrapped { v: 3, salt: None, ..wrapped() }.validate().is_err());
        assert!(Wrapped { salt: Some("AAAA".into()), ..wrapped() }.validate().is_err());
        assert_eq!(to_json(&Wrapped { v: 2, salt: None, ..wrapped() }).get("salt"), None);
        assert!(Wrapped { iv: URL_SAFE_NO_PAD.encode([0u8; 16]), ..wrapped() }.validate().is_err());
        assert!(Wrapped { ct: URL_SAFE_NO_PAD.encode([0u8; 47]), ..wrapped() }.validate().is_err());
        assert!(Wrapped { ct: "!!".into(), ..wrapped() }.validate().is_err());
    }

    #[test]
    fn rejects_unknown_fields() {
        let ok = r#"{"v":1,"salt":"MjM0NTY3ODk6Ozw9Pj9AQQ","iv":"RkdISUpLTE1OT1BR","ct":"x"}"#;
        assert!(serde_json::from_str::<Wrapped>(ok).is_ok());
        let extra = r#"{"v":1,"salt":"a","iv":"b","ct":"c","priv":"fuite"}"#;
        assert!(serde_json::from_str::<Wrapped>(extra).is_err());
        let body = format!(r#"{{"public":"{PUB}","wrapped":{ok},"private_key":"x"}}"#);
        assert!(serde_json::from_str::<CreateKeyBody>(&body).is_err());
    }

    #[test]
    fn fresh_session_window() {
        let now = 1_000_000;
        assert!(is_fresh(now - 30, now));
        assert!(is_fresh(now - FRESH_SESSION_SECS, now));
        assert!(!is_fresh(now - FRESH_SESSION_SECS - 1, now));
        assert!(!is_fresh(0, now)); // anciens jetons sans iat
        assert!(!is_fresh(now + 3600, now));
    }
}
