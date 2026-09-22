//! Serveur média LiveKit (SFU) : jetons d'accès et éjection.
//!
//! Le vocal pair-à-pair (maillage) échouait entre deux machines du même
//! réseau local et ne tient pas au-delà de quelques caméras. Chaque client
//! se connecte désormais au seul SFU. ForgeChat garde l'autorité : il ne
//! délivre un jeton qu'après les contrôles de `VOICE_JOIN` (membre, permissions,
//! mot de passe, limite de places) et retire le participant du SFU à la sortie.
//!
//! Jeton : JWT HS256 signé avec le secret d'API LiveKit, `iss` = clé d'API,
//! `sub` = identité (id utilisateur), subvention `video`.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// Durée de validité du jeton. Il ne sert qu'à l'ouverture de la connexion
/// (et aux reconnexions complètes) : une session déjà établie n'expire pas.
const TOKEN_TTL_S: u64 = 6 * 3600;

#[derive(Clone, Debug)]
pub struct LiveKitConfig {
    /// URL publique donnée aux clients, ex. `wss://forgechat.heiphaistos.org/livekit`.
    pub public_url: String,
    /// URL interne de l'API du SFU, ex. `http://livekit:7880`.
    pub internal_url: String,
    pub api_key: String,
    pub api_secret: String,
}

impl LiveKitConfig {
    /// `None` si l'une des variables manque : le vocal refuse alors l'entrée
    /// avec un message clair plutôt que de retomber sur un maillage cassé.
    pub fn from_env() -> Option<Self> {
        let get = |k: &str| std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Some(Self {
            public_url: get("LIVEKIT_URL")?,
            internal_url: get("LIVEKIT_INTERNAL_URL").unwrap_or_else(|| "http://livekit:7880".into()),
            api_key: get("LIVEKIT_API_KEY")?,
            api_secret: get("LIVEKIT_API_SECRET")?,
        })
    }
}

/// Sources qu'un participant peut publier, dérivées des permissions ForgeChat.
#[derive(Clone, Copy, Debug, Default)]
pub struct Publish {
    pub microphone: bool,
    pub camera: bool,
    pub screen: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoGrant<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    room: Option<&'a str>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    room_join: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    room_admin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_publish: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_subscribe: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_publish_data: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_publish_sources: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_update_own_metadata: Option<bool>,
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    sub: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    nbf: u64,
    exp: u64,
    video: VideoGrant<'a>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn sign(cfg: &LiveKitConfig, claims: &Claims) -> Option<String> {
    jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
        claims,
        &jsonwebtoken::EncodingKey::from_secret(cfg.api_secret.as_bytes()),
    )
    .map_err(|e| tracing::error!("jeton LiveKit : {e}"))
    .ok()
}

/// Nom de salle LiveKit d'un canal vocal de serveur.
pub fn room_for_channel(channel_id: uuid::Uuid) -> String {
    format!("voice-{channel_id}")
}

/// Salle d'un appel privé : ordre des identifiants normalisé, les deux
/// interlocuteurs calculent le même nom quel que soit l'appelant.
pub fn room_for_dm(a: uuid::Uuid, b: uuid::Uuid) -> String {
    let (x, y) = if a < b { (a, b) } else { (b, a) };
    format!("dm-{x}-{y}")
}

/// Jeton de participation à une salle.
pub fn join_token(cfg: &LiveKitConfig, room: &str, identity: &str, name: &str, publish: Publish) -> Option<String> {
    let mut sources = Vec::new();
    if publish.microphone { sources.push("microphone"); }
    if publish.camera { sources.push("camera"); }
    if publish.screen { sources.extend(["screen_share", "screen_share_audio"]); }
    let t = now();
    sign(cfg, &Claims {
        iss: &cfg.api_key,
        sub: identity,
        name: Some(name),
        nbf: t.saturating_sub(10),
        exp: t + TOKEN_TTL_S,
        video: VideoGrant {
            room: Some(room),
            room_join: true,
            room_admin: false,
            can_publish: Some(!sources.is_empty()),
            can_subscribe: Some(true),
            // Canal de données : réactions et indicateurs légers entre pairs.
            can_publish_data: Some(true),
            can_publish_sources: Some(sources),
            can_update_own_metadata: Some(false),
        },
    })
}

/// Retire un participant du SFU (sortie, éjection, perte de permission).
/// Sans cela, un client exclu côté ForgeChat resterait connecté au média.
pub async fn remove_participant(http: &reqwest::Client, cfg: &LiveKitConfig, room: &str, identity: &str) {
    let t = now();
    let Some(admin) = sign(cfg, &Claims {
        iss: &cfg.api_key,
        sub: "forgechat-server",
        name: None,
        nbf: t.saturating_sub(10),
        exp: t + 60,
        video: VideoGrant {
            room: Some(room),
            room_join: false,
            room_admin: true,
            can_publish: None,
            can_subscribe: None,
            can_publish_data: None,
            can_publish_sources: None,
            can_update_own_metadata: None,
        },
    }) else { return };
    let url = format!("{}/twirp/livekit.RoomService/RemoveParticipant", cfg.internal_url.trim_end_matches('/'));
    let res = http
        .post(url)
        .bearer_auth(admin)
        .json(&serde_json::json!({ "room": room, "identity": identity }))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;
    match res {
        // 404 : déjà parti du SFU (fermeture d'onglet), rien à faire.
        Ok(r) if r.status().is_success() || r.status() == reqwest::StatusCode::NOT_FOUND => {}
        Ok(r) => tracing::warn!(room, identity, status = %r.status(), "LiveKit RemoveParticipant refusé"),
        Err(e) => tracing::warn!(room, identity, "LiveKit RemoveParticipant injoignable : {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};

    fn cfg() -> LiveKitConfig {
        LiveKitConfig {
            public_url: "wss://x/livekit".into(),
            internal_url: "http://livekit:7880".into(),
            api_key: "APIkey".into(),
            api_secret: "secret-de-test-assez-long-pour-hs256".into(),
        }
    }

    fn lire(tok: &str) -> serde_json::Value {
        let mut v = Validation::new(Algorithm::HS256);
        v.set_issuer(&["APIkey"]);
        v.validate_nbf = true;
        decode::<serde_json::Value>(tok, &DecodingKey::from_secret(cfg().api_secret.as_bytes()), &v)
            .unwrap()
            .claims
    }

    #[test]
    fn le_jeton_porte_la_salle_et_les_sources_autorisees() {
        let tok = join_token(&cfg(), "voice-1", "user-1", "Momo", Publish { microphone: true, camera: true, screen: false }).unwrap();
        let c = lire(&tok);
        assert_eq!(c["sub"], "user-1");
        assert_eq!(c["video"]["room"], "voice-1");
        assert_eq!(c["video"]["roomJoin"], true);
        assert_eq!(c["video"]["canPublish"], true);
        assert_eq!(c["video"]["canPublishSources"], serde_json::json!(["microphone", "camera"]));
        assert!(c["video"].get("roomAdmin").is_none());
    }

    #[test]
    fn la_salle_privee_ne_depend_pas_de_l_appelant() {
        let a = uuid::Uuid::new_v4();
        let b = uuid::Uuid::new_v4();
        assert_eq!(room_for_dm(a, b), room_for_dm(b, a));
        assert_ne!(room_for_dm(a, b), room_for_dm(a, uuid::Uuid::new_v4()));
    }

    #[test]
    fn un_spectateur_ne_peut_rien_publier() {
        let c = lire(&join_token(&cfg(), "voice-1", "u", "u", Publish::default()).unwrap());
        assert_eq!(c["video"]["canPublish"], false);
        assert_eq!(c["video"]["canSubscribe"], true);
    }
}
