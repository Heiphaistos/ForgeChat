//! Notifications push de l'app mobile (Android), via le service push d'Expo
//! (qui relaie vers FCM). Complète le Web Push (`push.rs`) sans le modifier :
//! mêmes événements, mêmes règles (`notify.rs` : hors ligne seulement, Ne pas
//! déranger, DM et salons muets, niveaux de notification).
//!
//! - Activé par `PUSH_ENABLED=true`. `EXPO_ACCESS_TOKEN` est facultatif (requis
//!   seulement si « Enhanced push security » est activé sur le projet Expo).
//! - Vie privée : par défaut, le texte des messages n'est PAS envoyé (il
//!   transiterait par Expo et Google), seulement « Nouveau message de X ».
//!   L'utilisateur active l'aperçu appareil par appareil (`show_preview`).
//! - Les données jointes ne sont que des identifiants : l'app les revalide.
//! - Jetons invalides (`DeviceNotRegistered`) supprimés automatiquement.
//! - Anti-rafale : au plus un push par (utilisateur, conversation) toutes les 3 s.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{error::{AppError, Result}, middleware::auth::Claims, state::AppState};

const EXPO_PUSH_URL: &str = "https://exp.host/--/api/v2/push/send";
/// Au-delà, les appareils les moins récemment vus de l'utilisateur sont retirés.
const MAX_DEVICES_PER_USER: i64 = 10;
const PREVIEW_MAX_CHARS: usize = 140;

pub struct MobilePushConfig {
    url: String,
    access_token: Option<String>,
    http: reqwest::Client,
}

fn is_enabled(v: Option<&str>) -> bool {
    matches!(v.map(|s| s.trim().to_ascii_lowercase()).as_deref(), Some("true" | "1" | "yes"))
}

impl MobilePushConfig {
    pub fn from_env() -> Option<Arc<Self>> {
        if !is_enabled(std::env::var("PUSH_ENABLED").ok().as_deref()) {
            return None;
        }
        let access_token = std::env::var("EXPO_ACCESS_TOKEN").ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        // Tests locaux uniquement : un binaire de production parle toujours à Expo.
        #[cfg(debug_assertions)]
        let url = std::env::var("EXPO_PUSH_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| EXPO_PUSH_URL.into());
        #[cfg(not(debug_assertions))]
        let url = EXPO_PUSH_URL.to_string();
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .user_agent("ForgeChat")
            .build()
            .ok()?;
        Some(Arc::new(Self { url, access_token, http }))
    }
}

// ─── Appareils ───────────────────────────────────────────────────────────────

/// Jeton Expo : `ExponentPushToken[xxxx]` (ou `ExpoPushToken[xxxx]`).
pub fn is_valid_expo_token(token: &str) -> bool {
    if token.len() > 200 {
        return false;
    }
    let inner = token
        .strip_prefix("ExponentPushToken[")
        .or_else(|| token.strip_prefix("ExpoPushToken["))
        .and_then(|t| t.strip_suffix(']'));
    match inner {
        Some(i) => !i.is_empty() && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        None => false,
    }
}

#[derive(Deserialize)]
pub struct RegisterDeviceBody {
    pub token: String,
    pub platform: String,
    pub provider: Option<String>,
    pub show_preview: Option<bool>,
    pub device_name: Option<String>,
    /// Secret aléatoire de l'installation de l'app (16 à 128 caractères), jamais montré.
    pub device_id: Option<String>,
}

/// Empreinte du secret d'installation : `None` si absent, erreur si mal formé.
fn device_key_hash(device_id: Option<&str>) -> Result<Option<String>> {
    let Some(id) = device_id else { return Ok(None) };
    if !(16..=128).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::BadRequest("Identifiant d'appareil invalide".into()));
    }
    use base64::Engine;
    use sha2::{Digest, Sha256};
    Ok(Some(base64::engine::general_purpose::STANDARD.encode(Sha256::digest(id.as_bytes()))))
}

/// POST /api/push/devices
pub async fn register_device(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<RegisterDeviceBody>,
) -> Result<Json<serde_json::Value>> {
    if state.mobile_push.is_none() {
        return Err(AppError::BadRequest("Notifications push mobiles non configurées sur ce serveur".into()));
    }
    if !is_valid_expo_token(&body.token) {
        return Err(AppError::BadRequest("Jeton push invalide".into()));
    }
    if body.platform != "android" && body.platform != "ios" {
        return Err(AppError::BadRequest("Plateforme invalide (android|ios)".into()));
    }
    if body.provider.as_deref().unwrap_or("expo") != "expo" {
        return Err(AppError::BadRequest("Fournisseur push non pris en charge".into()));
    }
    // 30 enregistrements par heure et par compte.
    {
        use redis::AsyncCommands;
        let key = format!("push_reg:{}", claims.sub);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&key, 1i64).await.unwrap_or(0);
        if count == 1 {
            let _: () = redis.expire(&key, 3600).await.unwrap_or(());
        }
        if count > 30 {
            return Err(AppError::TooManyRequests);
        }
    }
    let device_name: Option<String> = body
        .device_name
        .as_deref()
        .map(|n| n.chars().filter(|c| !c.is_control()).take(64).collect::<String>())
        .filter(|n| !n.trim().is_empty());

    let key_hash = device_key_hash(body.device_id.as_deref())?;

    // Un jeton identifie un téléphone : il suit le dernier compte connecté dessus, mais seulement
    // si la demande vient de la même installation (même secret). Sans ce contrôle, un compte qui
    // connaît le jeton d'un autre téléphone le détournait. Une ligne sans secret (app antérieure)
    // ne se laisse reprendre que par une demande sans secret, comme avant.
    let kept = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO push_devices (user_id, token, platform, show_preview, device_name, device_key_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
             show_preview = EXCLUDED.show_preview, device_name = EXCLUDED.device_name, last_seen_at = NOW(),
             device_key_hash = COALESCE(EXCLUDED.device_key_hash, push_devices.device_key_hash)
         WHERE push_devices.user_id = EXCLUDED.user_id
            OR push_devices.device_key_hash IS NOT DISTINCT FROM EXCLUDED.device_key_hash
         RETURNING id"
    )
    .bind(claims.sub)
    .bind(&body.token)
    .bind(&body.platform)
    .bind(body.show_preview.unwrap_or(false))
    .bind(&device_name)
    .bind(&key_hash)
    .fetch_optional(&state.db)
    .await?;
    if kept.is_none() {
        return Err(AppError::Conflict("Ce jeton push est déjà lié à un autre appareil".into()));
    }

    sqlx::query(
        "DELETE FROM push_devices WHERE id IN (
             SELECT id FROM push_devices WHERE user_id = $1
             ORDER BY last_seen_at DESC OFFSET $2
         )"
    )
    .bind(claims.sub)
    .bind(MAX_DEVICES_PER_USER)
    .execute(&state.db)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

/// DELETE /api/push/devices/:token (seulement un jeton de l'appelant).
pub async fn unregister_device(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(token): Path<String>,
) -> Result<StatusCode> {
    if !is_valid_expo_token(&token) {
        return Err(AppError::BadRequest("Jeton push invalide".into()));
    }
    sqlx::query("DELETE FROM push_devices WHERE token = $1 AND user_id = $2")
        .bind(&token)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Déconnexion de toutes les sessions (logout, mot de passe changé ou
/// réinitialisé) : plus aucune notification vers les téléphones du compte.
pub async fn forget_devices(state: &AppState, user_id: Uuid) {
    if let Err(e) = sqlx::query("DELETE FROM push_devices WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
    {
        tracing::warn!("push mobile : suppression des appareils de {user_id} impossible : {e}");
    }
}

// ─── Contenu ─────────────────────────────────────────────────────────────────

/// Où mène la notification (données lues par l'app, `src/services/push.ts`).
#[derive(Clone, Debug)]
pub enum Target {
    Dm(Uuid),
    Group(Uuid),
    Channel { server_id: Uuid, channel_id: Uuid },
    /// Appel vers un destinataire hors ligne : l'appelant a déjà reçu
    /// « hors ligne », la notification ouvre la conversation.
    MissedCall { dm_id: Option<Uuid>, caller: Uuid },
    /// Rappel d'événement : ouvre les événements du serveur.
    Event { server_id: Uuid },
}

impl Target {
    fn data(&self) -> serde_json::Value {
        match self {
            Target::Dm(id) | Target::MissedCall { dm_id: Some(id), .. } => json!({ "kind": "dm", "dm_id": id }),
            Target::Group(id) => json!({ "kind": "group", "group_id": id }),
            Target::Channel { server_id, channel_id } => {
                json!({ "kind": "channel", "server_id": server_id, "channel_id": channel_id })
            }
            Target::MissedCall { dm_id: None, caller } => json!({ "kind": "call", "from": caller }),
            Target::Event { server_id } => json!({ "kind": "event", "server_id": server_id }),
        }
    }

    /// Clé anti-rafale : une conversation.
    fn collapse_key(&self) -> String {
        match self {
            Target::Dm(id) | Target::Group(id) => id.to_string(),
            Target::Channel { channel_id, .. } => channel_id.to_string(),
            Target::MissedCall { caller, .. } => format!("call:{caller}"),
            Target::Event { server_id } => format!("event:{server_id}"),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Notice {
    pub title: String,
    /// Texte avec aperçu du contenu, pour les appareils qui l'ont autorisé.
    pub preview: String,
    /// Texte sans contenu (par défaut).
    pub generic: String,
    pub target: Target,
}

impl Notice {
    pub fn new(title: impl Into<String>, preview: &str, generic: impl Into<String>, target: Target) -> Self {
        Self { title: clean(&title.into(), 100), preview: clean(preview, PREVIEW_MAX_CHARS), generic: generic.into(), target }
    }
}

/// Retire les caractères de contrôle (sauf retour à la ligne) et tronque.
fn clean(s: &str, max: usize) -> String {
    let mut out: String = s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect();
    if s.chars().count() > max {
        out.push('…');
    }
    out
}

/// Messages au format de l'API Expo, un par appareil `(jeton, aperçu autorisé)`.
fn build_messages(n: &Notice, devices: &[(String, bool)]) -> Vec<serde_json::Value> {
    devices
        .iter()
        .map(|(token, show_preview)| {
            json!({
                "to": token,
                "title": n.title,
                "body": if *show_preview { &n.preview } else { &n.generic },
                "data": n.target.data(),
                "sound": "default",
                "priority": "high",
                "channelId": "messages",
            })
        })
        .collect()
}

/// Jetons à oublier d'après la réponse d'Expo (tickets dans l'ordre des messages).
fn dead_tokens(response: &serde_json::Value, tokens: &[String]) -> Vec<String> {
    let Some(tickets) = response["data"].as_array() else { return Vec::new() };
    tickets
        .iter()
        .zip(tokens)
        .filter(|(t, _)| t["status"] == "error" && t["details"]["error"] == "DeviceNotRegistered")
        .map(|(_, tok)| tok.clone())
        .collect()
}

// ─── Envoi ───────────────────────────────────────────────────────────────────

/// Envoie `n` aux téléphones de `user_id` s'il n'a aucune session WebSocket.
/// Les règles (DND, sourdine, niveaux) sont appliquées par l'appelant (`notify.rs`).
pub async fn send(state: &AppState, user_id: Uuid, n: &Notice) {
    let Some(cfg) = state.mobile_push.clone() else { return };
    if state.clients.read().await.contains_key(&user_id) {
        return;
    }
    {
        let key = format!("push_rl:{}:{}", user_id, n.target.collapse_key());
        let mut redis = state.redis.lock().await;
        let first: Option<String> = redis::cmd("SET")
            .arg(&key).arg(1).arg("NX").arg("EX").arg(3)
            .query_async(&mut *redis)
            .await
            .unwrap_or(None);
        if first.is_none() {
            return;
        }
    }
    let devices: Vec<(String, bool)> = sqlx::query_as("SELECT token, show_preview FROM push_devices WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    if devices.is_empty() {
        return;
    }
    let tokens: Vec<String> = devices.iter().map(|(t, _)| t.clone()).collect();
    if let Err(e) = deliver(state, &cfg, &build_messages(n, &devices), &tokens).await {
        tracing::warn!("push mobile : envoi à {user_id} échoué : {e}");
    }
}

/// Variante pour plusieurs destinataires, en tâche de fond.
pub fn spawn_send(state: &AppState, users: Vec<Uuid>, n: Notice) {
    if state.mobile_push.is_none() || users.is_empty() {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        for uid in users {
            send(&state, uid, &n).await;
        }
    });
}

async fn deliver(state: &AppState, cfg: &MobilePushConfig, messages: &[serde_json::Value], tokens: &[String]) -> anyhow::Result<()> {
    let mut req = cfg.http.post(&cfg.url).header("Accept", "application/json").json(messages);
    if let Some(t) = &cfg.access_token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    let status = resp.status();
    if !status.is_success() {
        anyhow::bail!("Expo a répondu {status}");
    }
    let body: serde_json::Value = resp.json().await?;
    for token in dead_tokens(&body, tokens) {
        let _ = sqlx::query("DELETE FROM push_devices WHERE token = $1").bind(&token).execute(&state.db).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_key_format() {
        assert_eq!(device_key_hash(None).unwrap(), None);
        let a = device_key_hash(Some("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0")).unwrap().unwrap();
        assert_eq!(a, device_key_hash(Some("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0")).unwrap().unwrap());
        assert!(a.len() <= 64);
        assert!(device_key_hash(Some("court")).is_err());
        assert!(device_key_hash(Some("pas d'espace ni d'apostrophe!")).is_err());
    }

    #[test]
    fn expo_token_format() {
        assert!(is_valid_expo_token("ExponentPushToken[abcDEF123-_]"));
        assert!(is_valid_expo_token("ExpoPushToken[xyz]"));
        assert!(!is_valid_expo_token("ExponentPushToken[]"));
        assert!(!is_valid_expo_token("ExponentPushToken[a b]"));
        assert!(!is_valid_expo_token("ExponentPushToken[abc"));
        assert!(!is_valid_expo_token("https://exemple.invalid/ExponentPushToken[x]"));
        assert!(!is_valid_expo_token("fcm:abcdef"));
        assert!(!is_valid_expo_token(&format!("ExponentPushToken[{}]", "a".repeat(250))));
    }

    #[test]
    fn enabled_values() {
        assert!(is_enabled(Some("true")) && is_enabled(Some(" TRUE ")) && is_enabled(Some("1")));
        assert!(!is_enabled(None) && !is_enabled(Some("")) && !is_enabled(Some("false")) && !is_enabled(Some("0")));
    }

    #[test]
    fn preview_only_on_devices_that_allow_it() {
        let dm = Uuid::new_v4();
        let n = Notice::new("bob", "le code secret est 1234", "Nouveau message privé", Target::Dm(dm));
        let msgs = build_messages(&n, &[("ExponentPushToken[a]".into(), false), ("ExponentPushToken[b]".into(), true)]);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["to"], "ExponentPushToken[a]");
        assert_eq!(msgs[0]["body"], "Nouveau message privé");
        assert!(!msgs[0].to_string().contains("1234"), "aucun contenu sans aperçu autorisé");
        assert_eq!(msgs[1]["body"], "le code secret est 1234");
        for m in &msgs {
            assert_eq!(m["title"], "bob");
            assert_eq!(m["channelId"], "messages");
            assert_eq!(m["priority"], "high");
            assert_eq!(m["data"], json!({ "kind": "dm", "dm_id": dm }));
        }
    }

    #[test]
    fn data_matches_what_the_app_opens() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert_eq!(Target::Group(a).data(), json!({ "kind": "group", "group_id": a }));
        assert_eq!(
            Target::Channel { server_id: a, channel_id: b }.data(),
            json!({ "kind": "channel", "server_id": a, "channel_id": b })
        );
        assert_eq!(Target::MissedCall { dm_id: Some(a), caller: b }.data(), json!({ "kind": "dm", "dm_id": a }));
        assert_eq!(Target::MissedCall { dm_id: None, caller: b }.data(), json!({ "kind": "call", "from": b }));
        assert_eq!(Target::Channel { server_id: a, channel_id: b }.collapse_key(), b.to_string());
        assert_eq!(Target::MissedCall { dm_id: Some(a), caller: b }.collapse_key(), format!("call:{b}"));
    }

    #[test]
    fn text_is_cleaned_and_truncated() {
        let n = Notice::new("a\u{7}b", &"x".repeat(300), "g", Target::Dm(Uuid::nil()));
        assert_eq!(n.title, "ab");
        assert_eq!(n.preview.chars().count(), PREVIEW_MAX_CHARS + 1);
        assert!(n.preview.ends_with('…'));
        assert_eq!(clean("ligne 1\nligne 2", 50), "ligne 1\nligne 2");
    }

    #[test]
    fn unregistered_devices_are_detected() {
        let tokens = vec!["ExponentPushToken[ok]".to_string(), "ExponentPushToken[old]".to_string(), "ExponentPushToken[x]".to_string()];
        let resp = json!({ "data": [
            { "status": "ok", "id": "1" },
            { "status": "error", "message": "not registered", "details": { "error": "DeviceNotRegistered" } },
            { "status": "error", "details": { "error": "MessageRateExceeded" } },
        ]});
        assert_eq!(dead_tokens(&resp, &tokens), vec!["ExponentPushToken[old]".to_string()]);
        assert!(dead_tokens(&json!({ "errors": [{ "code": "PUSH_TOO_MANY_EXPERIENCE_IDS" }] }), &tokens).is_empty());
    }
}
