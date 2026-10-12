//! Clés d'accès (passkeys) comme second facteur — audit 2026-10-12, amélioration n° 3.
//!
//! Elles complètent la double authentification par code, sans la remplacer : il faut d'abord
//! activer le TOTP, qui reste le secours (et le seul facteur des applis de bureau et mobiles, dont
//! l'origine n'est pas celle du site). À la connexion web, l'utilisateur choisit l'une ou l'autre.
//! Vérification cryptographique : crate::webauthn.
use axum::{
    extract::{Path, State},
    Extension, Json,
};
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::auth_v2::hit,
    middleware::auth::Claims,
    state::AppState,
    webauthn::{self, b64u, unb64u, RelyingParty},
};

const MAX_KEYS: i64 = 10;
const CEREMONY_SECS: u64 = 300;

/// Domaine et origine du site (FRONTEND_URL), ex. `forgechat.heiphaistos.org`.
pub fn relying_party(state: &AppState) -> (String, Vec<String>) {
    let url = reqwest::Url::parse(&state.config.frontend_url).ok();
    let id = url.as_ref().and_then(|u| u.host_str()).unwrap_or("localhost").to_string();
    let origin = url.map(|u| u.origin().ascii_serialization()).unwrap_or_default();
    (id, vec![origin])
}

fn bad(msg: &str) -> AppError {
    AppError::BadRequest(format!("Clé d'accès refusée : {msg}"))
}

/// GET /auth/passkeys : clés du compte (jamais les clés publiques).
pub async fn list(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    let rows: Vec<(Uuid, String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT id, name, created_at, last_used_at FROM webauthn_credentials WHERE user_id=$1 ORDER BY created_at",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!(rows
        .into_iter()
        .map(|(id, name, created_at, last_used_at)| json!({ "id": id, "name": name, "created_at": created_at, "last_used_at": last_used_at }))
        .collect::<Vec<_>>())))
}

/// POST /auth/passkeys/register/start : options de `navigator.credentials.create`.
pub async fn register_start(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    hit(&state, &format!("passkey_reg:{}", claims.sub), 10, 3600).await?;
    let (username, totp): (String, bool) = sqlx::query_as("SELECT username, totp_enabled FROM users WHERE id=$1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
    if !totp {
        return Err(AppError::BadRequest(
            "Active d'abord la double authentification par code : elle reste le secours de tes clés d'accès.".into(),
        ));
    }
    let existing: Vec<Vec<u8>> = sqlx::query_scalar("SELECT credential_id FROM webauthn_credentials WHERE user_id=$1")
        .bind(claims.sub)
        .fetch_all(&state.db)
        .await?;
    if existing.len() as i64 >= MAX_KEYS {
        return Err(AppError::BadRequest(format!("{MAX_KEYS} clés d'accès au plus")));
    }
    let challenge = webauthn::new_challenge();
    let _: () = state
        .redis
        .lock()
        .await
        .set_ex(format!("passkey_reg_ch:{}", claims.sub), &challenge, CEREMONY_SECS)
        .await
        .map_err(|_| AppError::Unavailable("Service momentanément indisponible".into()))?;
    let (rp_id, _) = relying_party(&state);
    Ok(Json(json!({
        "challenge": challenge,
        "rp": { "id": rp_id, "name": "ForgeChat" },
        "user": { "id": b64u(claims.sub.as_bytes()), "name": username, "displayName": username },
        "pubKeyCredParams": [{ "type": "public-key", "alg": webauthn::ALG_ES256 }],
        "authenticatorSelection": { "residentKey": "preferred", "userVerification": "preferred" },
        "excludeCredentials": existing.iter().map(|id| json!({ "type": "public-key", "id": b64u(id) })).collect::<Vec<_>>(),
        "attestation": "none",
        "timeout": CEREMONY_SECS * 1000,
    })))
}

#[derive(Deserialize)]
pub struct RegisterFinish {
    pub name: String,
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
    #[serde(rename = "attestationObject")]
    pub attestation_object: String,
}

/// POST /auth/passkeys/register/finish : vérifie et enregistre la clé.
pub async fn register_finish(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<RegisterFinish>,
) -> Result<Json<Value>> {
    let name: String = body.name.trim().chars().take(64).collect();
    if name.is_empty() {
        return Err(AppError::BadRequest("Nom de la clé requis".into()));
    }
    let challenge: Option<String> = {
        let mut redis = state.redis.lock().await;
        let key = format!("passkey_reg_ch:{}", claims.sub);
        let (v, _): (Option<String>, i64) = redis::pipe().atomic().get(&key).del(&key).query_async(&mut *redis).await.unwrap_or((None, 0));
        v
    };
    let challenge = challenge.ok_or_else(|| bad("cérémonie expirée, recommence"))?;
    let (rp_id, origins) = relying_party(&state);
    let rp = RelyingParty { id: &rp_id, origins: &origins };
    let cred = webauthn::verify_registration(
        &unb64u(&body.client_data_json).map_err(bad)?,
        &unb64u(&body.attestation_object).map_err(bad)?,
        &challenge,
        &rp,
    )
    .map_err(bad)?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, sign_count, name)
         SELECT $1, $2, $3, $4, $5 WHERE (SELECT count(*) FROM webauthn_credentials WHERE user_id=$1) < $6
         RETURNING id",
    )
    .bind(claims.sub)
    .bind(&cred.credential_id)
    .bind(&cred.public_key)
    .bind(cred.sign_count as i64)
    .bind(&name)
    .bind(MAX_KEYS)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest(format!("{MAX_KEYS} clés d'accès au plus")))?;
    Ok(Json(json!({ "id": id, "name": name })))
}

/// DELETE /auth/passkeys/:id
pub async fn delete(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>> {
    let n = sqlx::query("DELETE FROM webauthn_credentials WHERE id=$1 AND user_id=$2")
        .bind(id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound("Clé introuvable".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// Options de `navigator.credentials.get` pour une connexion dont le mot de passe est déjà
/// vérifié, ou None si le compte n'a pas de clé. Le défi (2 min) est lié au compte.
pub async fn login_options(state: &AppState, user_id: Uuid) -> Result<Option<Value>> {
    let ids: Vec<Vec<u8>> = sqlx::query_scalar("SELECT credential_id FROM webauthn_credentials WHERE user_id=$1")
        .bind(user_id)
        .fetch_all(&state.db)
        .await?;
    if ids.is_empty() {
        return Ok(None);
    }
    let challenge = webauthn::new_challenge();
    let _: () = state
        .redis
        .lock()
        .await
        .set_ex(format!("passkey_login:{challenge}"), user_id.to_string(), 120)
        .await
        .map_err(|_| AppError::Unavailable("Service momentanément indisponible".into()))?;
    let (rp_id, _) = relying_party(state);
    Ok(Some(json!({
        "challenge": challenge,
        "rpId": rp_id,
        "allowCredentials": ids.iter().map(|id| json!({ "type": "public-key", "id": b64u(id) })).collect::<Vec<_>>(),
        "userVerification": "preferred",
        "timeout": 120_000,
    })))
}

#[derive(Debug, Deserialize)]
pub struct Assertion {
    pub id: String,
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
    #[serde(rename = "authenticatorData")]
    pub authenticator_data: String,
    pub signature: String,
}

/// Second facteur par clé d'accès, pendant la connexion (mot de passe déjà vérifié).
/// Défi à usage unique, lié à ce compte ; clé du compte ; signature et compteur vérifiés.
pub async fn check_assertion(state: &AppState, user_id: Uuid, a: &Assertion) -> Result<bool> {
    let client_data = unb64u(&a.client_data_json).map_err(bad)?;
    let challenge = serde_json::from_slice::<Value>(&client_data)
        .ok()
        .and_then(|v| v["challenge"].as_str().map(str::to_string))
        .ok_or_else(|| bad("clientDataJSON illisible"))?;
    let owner: Option<String> = {
        let mut redis = state.redis.lock().await;
        let key = format!("passkey_login:{challenge}");
        let (v, _): (Option<String>, i64) = redis::pipe().atomic().get(&key).del(&key).query_async(&mut *redis).await.unwrap_or((None, 0));
        v
    };
    if owner.as_deref() != Some(user_id.to_string().as_str()) {
        return Ok(false);
    }
    let cred_id = unb64u(&a.id).map_err(bad)?;
    let row: Option<(Uuid, Vec<u8>, i64)> =
        sqlx::query_as("SELECT id, public_key, sign_count FROM webauthn_credentials WHERE user_id=$1 AND credential_id=$2")
            .bind(user_id)
            .bind(&cred_id)
            .fetch_optional(&state.db)
            .await?;
    let Some((id, public_key, stored)) = row else { return Ok(false) };
    let (rp_id, origins) = relying_party(state);
    let rp = RelyingParty { id: &rp_id, origins: &origins };
    let checked = webauthn::verify_assertion(
        &client_data,
        &unb64u(&a.authenticator_data).map_err(bad)?,
        &unb64u(&a.signature).map_err(bad)?,
        &challenge,
        &rp,
        &public_key,
        u32::try_from(stored).unwrap_or(0),
    );
    match checked {
        Ok(count) => {
            // Mise à jour conditionnelle : deux connexions simultanées avec la même signature
            // ne passent pas toutes les deux.
            let n = sqlx::query(
                "UPDATE webauthn_credentials SET sign_count=$2, last_used_at=NOW() WHERE id=$1 AND sign_count=$3",
            )
            .bind(id)
            .bind(count as i64)
            .bind(stored)
            .execute(&state.db)
            .await?
            .rows_affected();
            Ok(n == 1)
        }
        Err(e) => {
            tracing::info!("clé d'accès refusée : {e}");
            Ok(false)
        }
    }
}
