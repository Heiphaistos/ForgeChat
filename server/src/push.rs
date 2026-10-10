//! Notifications Web Push (RFC 8030 + VAPID RFC 8292, chiffrement aes128gcm).
//!
//! Crate `web-push-native` (Rust pur) plutôt que `web-push` : cette dernière
//! dépend de `ece`, donc d'openssl, ce qui casse la compilation Windows et
//! alourdit l'image Docker. La requête HTTP est construite par la crate puis
//! envoyée avec reqwest (rustls), sans suivre de redirection. Le jeton VAPID (JWT
//! ES256) est signé ici avec p256 : la fonctionnalité `vapid` de la crate tirait
//! jwt-simple, donc la crate `rsa` (RUSTSEC-2023-0071).
//!
//! Désactivé proprement si `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
//! `VAPID_SUBJECT` manquent : les routes répondent `enabled: false` et rien
//! n'est envoyé.

use std::sync::Arc;
use std::time::Duration;

use axum::{extract::State, Extension, Json};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use uuid::Uuid;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use web_push_native::{Auth, WebPushBuilder};

use crate::{error::{AppError, Result}, middleware::auth::Claims, state::AppState};

/// Au-delà, les abonnements les plus anciens de l'utilisateur sont supprimés.
const MAX_SUBSCRIPTIONS_PER_USER: i64 = 20;

pub struct PushConfig {
    key: SigningKey,
    /// Clé publique (point P-256 non compressé, base64url) donnée aux navigateurs.
    pub public_key: String,
    subject: String,
    http: reqwest::Client,
}

impl PushConfig {
    pub fn from_env() -> Option<Arc<Self>> {
        let get = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let (public, private, subject) = (get("VAPID_PUBLIC_KEY")?, get("VAPID_PRIVATE_KEY")?, get("VAPID_SUBJECT")?);
        let raw = URL_SAFE_NO_PAD.decode(private.trim_end_matches('=')).ok()?;
        let key = SigningKey::from_slice(&raw).ok()?;
        let derived = public_key_b64(&raw)?;
        if derived != public.trim_end_matches('=') {
            tracing::error!("VAPID_PUBLIC_KEY ne correspond pas à VAPID_PRIVATE_KEY : Web Push désactivé");
            return None;
        }
        let http = crate::net_guard::public_client(0, "ForgeChat")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .ok()?;
        Some(Arc::new(Self { key, public_key: derived, subject, http }))
    }
}

fn public_key_b64(private_raw: &[u8]) -> Option<String> {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let secret = p256::SecretKey::from_slice(private_raw).ok()?;
    Some(URL_SAFE_NO_PAD.encode(secret.public_key().to_encoded_point(false).as_bytes()))
}

/// Durée de validité du jeton VAPID (RFC 8292 : 24 h au plus).
const VAPID_TTL_SECS: i64 = 12 * 3600;

/// En-tête `Authorization: vapid t=<JWT ES256>, k=<clé publique>` (RFC 8292) pour `endpoint`.
fn vapid_header(cfg: &PushConfig, endpoint: &str, now: i64) -> anyhow::Result<String> {
    let aud = reqwest::Url::parse(endpoint)?.origin().ascii_serialization();
    let b64 = |v: serde_json::Value| URL_SAFE_NO_PAD.encode(v.to_string());
    let input = format!(
        "{}.{}",
        b64(serde_json::json!({ "typ": "JWT", "alg": "ES256" })),
        b64(serde_json::json!({ "aud": aud, "exp": now + VAPID_TTL_SECS, "sub": cfg.subject })),
    );
    let sig: Signature = cfg.key.sign(input.as_bytes());
    Ok(format!("vapid t={input}.{}, k={}", URL_SAFE_NO_PAD.encode(sig.to_bytes()), cfg.public_key))
}

/// `forgechat generate-vapid-keys` : imprime une paire prête pour le `.env`.
pub fn print_new_vapid_keys() {
    let secret = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let raw = secret.to_bytes();
    println!("VAPID_PUBLIC_KEY={}", public_key_b64(&raw).unwrap_or_default());
    println!("VAPID_PRIVATE_KEY={}", URL_SAFE_NO_PAD.encode(raw));
}

/// Un endpoint d'abonnement doit être une URL https vers un nom de domaine
/// public (jamais une IP, jamais un nom local) : le serveur y fait des POST.
fn is_valid_endpoint(endpoint: &str) -> bool {
    if endpoint.len() > 2048 || !crate::handlers::audit::is_ssrf_safe_url(endpoint) {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(endpoint) else { return false };
    match url.host_str() {
        Some(h) => !h.starts_with('[') && h.parse::<std::net::IpAddr>().is_err() && h.contains('.'),
        None => false,
    }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

pub async fn get_public_key(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "enabled": state.push.is_some(),
        "public_key": state.push.as_ref().map(|p| p.public_key.clone()),
    }))
}

#[derive(Deserialize)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Deserialize)]
pub struct SubscribeBody {
    pub endpoint: String,
    pub keys: SubscriptionKeys,
    /// Autres comptes connectés dans ce navigateur (plusieurs comptes) : ils gardent leurs
    /// notifications. Absent : l'endpoint suit le dernier compte connecté, comme avant.
    pub other_accounts: Option<Vec<Uuid>>,
}

pub async fn subscribe(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SubscribeBody>,
) -> Result<Json<serde_json::Value>> {
    if state.push.is_none() {
        return Err(AppError::BadRequest("Notifications push non configurées sur ce serveur".into()));
    }
    if !is_valid_endpoint(&body.endpoint) {
        return Err(AppError::BadRequest("Endpoint push invalide".into()));
    }
    // Clés : point P-256 valide et secret de 16 octets, sinon chaque envoi échouerait.
    let p256dh = body.keys.p256dh.trim_end_matches('=');
    let auth = body.keys.auth.trim_end_matches('=');
    let p256dh_ok = URL_SAFE_NO_PAD.decode(p256dh).ok()
        .is_some_and(|k| p256::PublicKey::from_sec1_bytes(&k).is_ok());
    let auth_ok = URL_SAFE_NO_PAD.decode(auth).ok().is_some_and(|a| a.len() == 16);
    if !p256dh_ok || !auth_ok {
        return Err(AppError::BadRequest("Clés d'abonnement invalides".into()));
    }

    // Un endpoint identifie un navigateur : il sert aux comptes connectés dedans, les autres
    // comptes qui l'avaient enregistré le perdent.
    let keep: Vec<Uuid> = body.other_accounts.clone().unwrap_or_default().into_iter()
        .take(crate::mobile_push::MAX_ACCOUNTS_PER_DEVICE).collect();
    sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id <> $2 AND NOT (user_id = ANY($3))")
        .bind(&body.endpoint)
        .bind(claims.sub)
        .bind(&keep)
        .execute(&state.db)
        .await?;
    sqlx::query(
        "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth, created_at = NOW()"
    )
    .bind(claims.sub)
    .bind(&body.endpoint)
    .bind(p256dh)
    .bind(auth)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "DELETE FROM push_subscriptions WHERE id IN (
             SELECT id FROM push_subscriptions WHERE user_id = $1
             ORDER BY created_at DESC OFFSET $2
         )"
    )
    .bind(claims.sub)
    .bind(MAX_SUBSCRIPTIONS_PER_USER)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct UnsubscribeBody {
    pub endpoint: String,
}

pub async fn unsubscribe(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UnsubscribeBody>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2")
        .bind(claims.sub)
        .bind(&body.endpoint)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Envoi ───────────────────────────────────────────────────────────────────

/// Pousse `payload` (JSON lu par `sw.js` : title, body, url, tag) vers tous les
/// navigateurs abonnés de l'utilisateur, **seulement s'il n'a aucune session
/// WebSocket** (sinon le client affiche lui-même la notification).
/// Les abonnements expirés (404 / 410) sont supprimés.
pub async fn send_if_offline(state: &AppState, user_id: Uuid, payload: &serde_json::Value) {
    let Some(cfg) = state.push.clone() else { return };
    if state.clients.read().await.contains_key(&user_id) {
        return;
    }
    let subs: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1"
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let body = payload.to_string();
    for (id, endpoint, p256dh, auth) in subs {
        match deliver(&cfg, &endpoint, &p256dh, &auth, &body).await {
            Ok(404) | Ok(410) => {
                let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                    .bind(id)
                    .execute(&state.db)
                    .await;
            }
            Ok(status) if !(200..300).contains(&status) => {
                tracing::debug!("Web Push : réponse {status} pour l'abonnement {id}");
            }
            Ok(_) => {}
            Err(e) => tracing::debug!("Web Push : échec d'envoi ({id}) : {e}"),
        }
    }
}

/// Variante pour plusieurs destinataires, lancée en tâche de fond pour ne pas
/// retarder la réponse HTTP de l'envoi du message.
pub fn spawn_send_if_offline(state: &AppState, users: Vec<Uuid>, payload: serde_json::Value) {
    if state.push.is_none() || users.is_empty() { return; }
    let state = state.clone();
    tokio::spawn(async move {
        for uid in users {
            send_if_offline(&state, uid, &payload).await;
        }
    });
}

async fn deliver(cfg: &PushConfig, endpoint: &str, p256dh: &str, auth: &str, body: &str) -> anyhow::Result<u16> {
    // Revalidé à l'envoi : une ligne ancienne ou modifiée en base ne doit pas
    // faire émettre une requête vers le réseau interne.
    if !is_valid_endpoint(endpoint) {
        anyhow::bail!("endpoint refusé");
    }
    let ua_public = p256::PublicKey::from_sec1_bytes(&URL_SAFE_NO_PAD.decode(p256dh)?)?;
    let auth_bytes = URL_SAFE_NO_PAD.decode(auth)?;
    if auth_bytes.len() != 16 { anyhow::bail!("secret auth invalide"); }
    let request = WebPushBuilder::new(endpoint.parse()?, ua_public, Auth::clone_from_slice(&auth_bytes))
        .with_valid_duration(Duration::from_secs(24 * 3600))
        .build(body.as_bytes().to_vec())
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut request = reqwest::Request::try_from(request)?;
    request.headers_mut().insert("Urgency", reqwest::header::HeaderValue::from_static("high"));
    request.headers_mut().insert(
        reqwest::header::AUTHORIZATION,
        vapid_header(cfg, endpoint, chrono::Utc::now().timestamp())?.parse()?,
    );
    Ok(cfg.http.execute(request).await?.status().as_u16())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_must_be_public_https_domain() {
        assert!(is_valid_endpoint("https://fcm.googleapis.com/fcm/send/abc"));
        assert!(is_valid_endpoint("https://updates.push.services.mozilla.com/wpush/v2/x"));
        assert!(!is_valid_endpoint("http://fcm.googleapis.com/fcm/send/abc"));
        assert!(!is_valid_endpoint("https://127.0.0.1/x"));
        assert!(!is_valid_endpoint("https://10.0.0.5/x"));
        assert!(!is_valid_endpoint("https://[::1]/x"));
        assert!(!is_valid_endpoint("https://8.8.8.8/x"));
        assert!(!is_valid_endpoint("https://localhost/x"));
        assert!(!is_valid_endpoint("https://redis.internal/x"));
        assert!(!is_valid_endpoint("https://redis/x"));
    }

    #[test]
    fn generated_keys_roundtrip() {
        let secret = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let raw = secret.to_bytes();
        assert!(SigningKey::from_slice(&raw).is_ok());
        let public = public_key_b64(&raw).unwrap();
        assert_eq!(URL_SAFE_NO_PAD.decode(public).unwrap().len(), 65);
    }

    /// Jeton VAPID : JWT ES256 vérifiable avec la clé publique annoncée, `aud` = origine.
    #[test]
    fn vapid_jwt_verifies() {
        use p256::ecdsa::{signature::Verifier, VerifyingKey};
        let secret = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let raw = secret.to_bytes();
        let cfg = PushConfig {
            key: SigningKey::from_slice(&raw).unwrap(),
            public_key: public_key_b64(&raw).unwrap(),
            subject: "mailto:admin@example.com".into(),
            http: reqwest::Client::new(),
        };
        let h = vapid_header(&cfg, "https://fcm.googleapis.com/fcm/send/abc", 1_000).unwrap();
        let (t, k) = h.strip_prefix("vapid t=").unwrap().split_once(", k=").unwrap();
        assert_eq!(k, cfg.public_key);
        let (input, sig) = t.rsplit_once('.').unwrap();
        let vk = VerifyingKey::from_sec1_bytes(&URL_SAFE_NO_PAD.decode(k).unwrap()).unwrap();
        let sig = Signature::from_slice(&URL_SAFE_NO_PAD.decode(sig).unwrap()).unwrap();
        assert!(vk.verify(input.as_bytes(), &sig).is_ok());
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(input.split('.').nth(1).unwrap()).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["exp"], 1_000 + VAPID_TTL_SECS);
        assert_eq!(claims["sub"], "mailto:admin@example.com");
    }
}
