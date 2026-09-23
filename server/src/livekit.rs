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
    /// Sourdine imposée par un modérateur : ne reçoit aucun flux.
    pub deafened: bool,
}

impl Publish {
    fn sources(&self) -> Vec<&'static str> {
        let mut sources = Vec::new();
        if self.microphone { sources.push("microphone"); }
        if self.camera { sources.push("camera"); }
        if self.screen { sources.extend(["screen_share", "screen_share_audio"]); }
        sources
    }
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

/// Salle de l'appel d'un groupe privé.
pub fn room_for_group(group_id: uuid::Uuid) -> String {
    format!("gdm-{group_id}")
}

/// Jeton de participation à une salle.
pub fn join_token(cfg: &LiveKitConfig, room: &str, identity: &str, name: &str, publish: Publish) -> Option<String> {
    let sources = publish.sources();
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
            can_subscribe: Some(!publish.deafened),
            // Canal de données : réactions et indicateurs légers entre pairs.
            can_publish_data: Some(true),
            can_publish_sources: Some(sources),
            can_update_own_metadata: Some(false),
        },
    })
}

/// Authentifie un webhook LiveKit : l'en-tête `Authorization` porte un JWT
/// HS256 signé avec le secret d'API, dont la revendication `sha256` est
/// l'empreinte SHA-256 (base64) du corps exact reçu.
pub fn verify_webhook(cfg: &LiveKitConfig, authorization: &str, body: &[u8]) -> bool {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let token = authorization.trim().trim_start_matches("Bearer ").trim();
    let mut v = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    v.set_issuer(&[cfg.api_key.as_str()]);
    v.set_required_spec_claims(&["iss"]);
    let Ok(data) = jsonwebtoken::decode::<serde_json::Value>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(cfg.api_secret.as_bytes()),
        &v,
    ) else {
        return false;
    };
    let expected = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body));
    data.claims["sha256"].as_str() == Some(expected.as_str())
}

/// Jeton d'administration d'une salle, pour l'API RoomService.
fn admin_token(cfg: &LiveKitConfig, room: &str) -> Option<String> {
    let t = now();
    sign(cfg, &Claims {
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
    })
}

/// Appel Twirp `livekit.RoomService/<method>`. `true` si le SFU a accepté
/// (ou si le participant n'y est déjà plus : 404).
async fn room_service(http: &reqwest::Client, cfg: &LiveKitConfig, method: &str, room: &str, identity: &str, body: serde_json::Value) -> bool {
    let Some(admin) = admin_token(cfg, room) else { return false };
    let url = format!("{}/twirp/livekit.RoomService/{method}", cfg.internal_url.trim_end_matches('/'));
    let res = http
        .post(url)
        .bearer_auth(admin)
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() || r.status() == reqwest::StatusCode::NOT_FOUND => true,
        Ok(r) => {
            tracing::warn!(room, identity, method, status = %r.status(), "LiveKit RoomService refusé");
            false
        }
        Err(e) => {
            tracing::warn!(room, identity, method, "LiveKit RoomService injoignable : {e}");
            false
        }
    }
}

/// Retire un participant du SFU (sortie, éjection, perte de permission).
/// Sans cela, un client exclu côté ForgeChat resterait connecté au média.
pub async fn remove_participant(http: &reqwest::Client, cfg: &LiveKitConfig, room: &str, identity: &str) {
    room_service(http, cfg, "RemoveParticipant", room, identity,
        serde_json::json!({ "room": room, "identity": identity })).await;
}

/// Corps de `UpdateParticipant` : nouvelles permissions du participant.
/// Le SFU dépublie aussitôt une piste dont la source n'est plus autorisée
/// (micro d'un membre rendu muet par un modérateur) et coupe les abonnements
/// si `canSubscribe` tombe (sourdine serveur).
fn update_body(room: &str, identity: &str, publish: Publish) -> serde_json::Value {
    let sources: Vec<String> = publish.sources().iter().map(|s| s.to_uppercase()).collect();
    serde_json::json!({
        "room": room,
        "identity": identity,
        "permission": {
            "canSubscribe": !publish.deafened,
            "canPublish": !sources.is_empty(),
            "canPublishData": true,
            "canPublishSources": sources,
        },
    })
}

/// Applique au participant déjà connecté les droits recalculés (modération vocale).
pub async fn update_participant(http: &reqwest::Client, cfg: &LiveKitConfig, room: &str, identity: &str, publish: Publish) -> bool {
    room_service(http, cfg, "UpdateParticipant", room, identity, update_body(room, identity, publish)).await
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
        let tok = join_token(&cfg(), "voice-1", "user-1", "Momo", Publish { microphone: true, camera: true, screen: false, deafened: false }).unwrap();
        let c = lire(&tok);
        assert_eq!(c["sub"], "user-1");
        assert_eq!(c["video"]["room"], "voice-1");
        assert_eq!(c["video"]["roomJoin"], true);
        assert_eq!(c["video"]["canPublish"], true);
        assert_eq!(c["video"]["canPublishSources"], serde_json::json!(["microphone", "camera"]));
        assert!(c["video"].get("roomAdmin").is_none());
    }

    fn signe_webhook(body: &[u8], secret: &str, iss: &str) -> String {
        use base64::Engine;
        use sha2::{Digest, Sha256};
        let claims = serde_json::json!({
            "iss": iss,
            "exp": now() + 60,
            "sha256": base64::engine::general_purpose::STANDARD.encode(Sha256::digest(body)),
        });
        jsonwebtoken::encode(&jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256), &claims,
            &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes())).unwrap()
    }

    #[test]
    fn un_webhook_n_est_accepte_que_signe_et_intact() {
        let c = cfg();
        let body = br#"{"event":"participant_left"}"#;
        let ok = signe_webhook(body, &c.api_secret, &c.api_key);
        assert!(verify_webhook(&c, &ok, body));
        assert!(verify_webhook(&c, &format!("Bearer {ok}"), body));
        // corps modifié d'un octet
        assert!(!verify_webhook(&c, &ok, br#"{"event":"participant_lefT"}"#));
        // mauvais secret, mauvais émetteur, jeton absent
        assert!(!verify_webhook(&c, &signe_webhook(body, "autre-secret-assez-long-pour-hs256", &c.api_key), body));
        assert!(!verify_webhook(&c, &signe_webhook(body, &c.api_secret, "APIautre"), body));
        assert!(!verify_webhook(&c, "", body));
    }

    #[test]
    fn la_salle_privee_ne_depend_pas_de_l_appelant() {
        let a = uuid::Uuid::new_v4();
        let b = uuid::Uuid::new_v4();
        assert_eq!(room_for_dm(a, b), room_for_dm(b, a));
        assert_ne!(room_for_dm(a, b), room_for_dm(a, uuid::Uuid::new_v4()));
    }

    #[test]
    fn la_moderation_retire_le_micro_et_l_ecoute() {
        let b = update_body("voice-1", "u", Publish { microphone: false, camera: true, screen: false, deafened: true });
        assert_eq!(b["permission"]["canPublishSources"], serde_json::json!(["CAMERA"]));
        assert_eq!(b["permission"]["canSubscribe"], false);
        let c = lire(&join_token(&cfg(), "voice-1", "u", "u", Publish { deafened: true, ..Publish::default() }).unwrap());
        assert_eq!(c["video"]["canSubscribe"], false);
    }

    #[test]
    fn un_spectateur_ne_peut_rien_publier() {
        let c = lire(&join_token(&cfg(), "voice-1", "u", "u", Publish::default()).unwrap());
        assert_eq!(c["video"]["canPublish"], false);
        assert_eq!(c["video"]["canSubscribe"], true);
    }
}
