use axum::{extract::State, http::{HeaderMap, StatusCode}, Extension, Json};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

/// Durée de vie des credentials TURN éphémères (TURN REST API) — 1 h.
const TURN_TTL_S: u64 = 3600;

/// GET /api/voice/ice-config
/// Retourne la configuration ICE : STUN configurés (STUN_URLS) + TURN si configuré.
/// Aucun serveur STUN public par défaut.
///
/// Deux modes TURN :
/// - **éphémère** (recommandé) si `TURN_STATIC_AUTH_SECRET` est défini :
///   `username = "<expiry_unix>:<aléatoire>"`, `credential = base64(HMAC-SHA1(secret, username))`,
///   valable `TURN_TTL_S`. Le secret ne quitte jamais le serveur (correctif N6).
/// - sans ce secret : pas de TURN (les identifiants statiques ne sont plus distribués).
///
/// Le champ `ttl` indique au client dans combien de secondes recharger
/// (0 = credentials statiques, pas d'expiration).
pub async fn get_ice_config(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Uniquement les serveurs STUN configurés (STUN_URLS) : aucun STUN public par défaut, qui
    // verrait l'adresse IP de chaque participant. Sans STUN_URLS ni TURN, la liste est vide.
    let mut servers = Vec::new();
    if !state.config.stun_urls.is_empty() {
        servers.push(serde_json::json!({ "urls": state.config.stun_urls }));
    }

    let mut ttl: u64 = 0;

    if let Some(turn_url) = &state.config.turn_url {
        if let Some(secret) = state.config.turn_static_auth_secret.as_deref().filter(|s| !s.is_empty()) {
            // Mode éphémère (coturn `use-auth-secret` / `static-auth-secret`)
            let expiry = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
                + TURN_TTL_S;
            // Partie aléatoire, pas l'identifiant du compte : coturn ne voit ni ne journalise
            // qui relaie. Il ne vérifie que HMAC(secret, nom complet) et l'expiration.
            let nonce: String = rand::Rng::sample_iter(rand::thread_rng(), &rand::distributions::Alphanumeric)
                .take(16)
                .map(char::from)
                .collect();
            let username = format!("{}:{}", expiry, nonce);
            let credential = turn_credential(secret, &username)?;
            ttl = TURN_TTL_S;
            servers.push(serde_json::json!({
                "urls": [turn_url],
                "username": username,
                "credential": credential,
            }));
        } else {
            // Plus jamais d'identifiants statiques distribués à tous les comptes (relais
            // ouvert à n'importe qui les ayant vus une fois) : sans secret, pas de TURN.
            tracing::warn!("TURN: TURN_URL défini sans TURN_STATIC_AUTH_SECRET : relais désactivé (TURN_USERNAME/TURN_PASSWORD ne sont plus distribués)");
        }
    }

    Ok(Json(serde_json::json!({ "ice_servers": servers, "ttl": ttl })))
}

/// base64(HMAC-SHA1(secret, username)) — format attendu par coturn.
fn turn_credential(secret: &str, username: &str) -> Result<String, AppError> {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha1::Sha1;

    let mut mac = Hmac::<Sha1>::new_from_slice(secret.as_bytes())
        .map_err(|_| AppError::Internal(anyhow::anyhow!("TURN: secret HMAC invalide")))?;
    mac.update(username.as_bytes());
    Ok(base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes()))
}

/// GET /api/voice/state — bootstrap REST de l'état vocal (correctif N11).
///
/// Renvoie, pour tous les serveurs dont l'utilisateur est membre, les
/// participants de chaque canal vocal avec leur état (muted/deafened/video/
/// screen/hand_raised). Le client l'appelle au montage et après reconnexion.
pub async fn get_voice_state(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    use sqlx::Row;

    // Canaux vocaux occupés, restreints aux serveurs dont l'utilisateur est membre
    let occupied: Vec<Uuid> = {
        let rooms = state.voice_rooms.read().await;
        rooms.iter().filter(|(_, m)| !m.is_empty()).map(|(c, _)| *c).collect()
    };
    if occupied.is_empty() {
        return Ok(Json(serde_json::json!({ "channels": [] })));
    }

    let visible = sqlx::query(
        "SELECT c.id, c.server_id
         FROM channels c
         JOIN server_members sm ON sm.server_id = c.server_id
         WHERE c.id = ANY($1) AND sm.user_id = $2"
    )
    .bind(&occupied)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let mut channels = Vec::new();
    for row in &visible {
        let channel_id: Uuid = row.get("id");
        let server_id: Option<Uuid> = row.get("server_id");

        let members: Vec<Uuid> = state
            .voice_rooms
            .read()
            .await
            .get(&channel_id)
            .map(|m| m.iter().copied().collect())
            .unwrap_or_default();
        if members.is_empty() { continue; }

        let hands = state
            .voice_hand_raises
            .read()
            .await
            .get(&channel_id)
            .map(|m| m.keys().copied().collect::<Vec<_>>())
            .unwrap_or_default();

        let users = sqlx::query(
            "SELECT u.id, u.username, u.avatar, u.discriminator,
                    COALESCE(sm.voice_muted, FALSE) AS voice_muted,
                    COALESCE(sm.voice_deafened, FALSE) AS voice_deafened
             FROM users u
             LEFT JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $2
             WHERE u.id = ANY($1)"
        )
        .bind(&members)
        .bind(server_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let states = state.voice_states.read().await;
        let participants: Vec<serde_json::Value> = users
            .iter()
            .map(|u| {
                let uid: Uuid = u.get("id");
                let vs = states.get(&uid);
                serde_json::json!({
                    "user_id": uid,
                    "username": u.get::<String, _>("username"),
                    "avatar": u.get::<Option<String>, _>("avatar"),
                    "discriminator": u.get::<String, _>("discriminator"),
                    "muted": vs.map(|v| v.muted).unwrap_or(false),
                    "deafened": vs.map(|v| v.deafened).unwrap_or(false),
                    "video": vs.map(|v| v.video).unwrap_or(false),
                    "screen": vs.map(|v| v.screen).unwrap_or(false),
                    "recording": vs.map(|v| v.recording).unwrap_or(false),
                    "hand_raised": hands.contains(&uid),
                    "server_muted": u.get::<bool, _>("voice_muted"),
                    "server_deafened": u.get::<bool, _>("voice_deafened"),
                })
            })
            .collect();
        drop(states);

        channels.push(serde_json::json!({
            "channel_id": channel_id,
            "server_id": server_id,
            "participants": participants,
        }));
    }

    Ok(Json(serde_json::json!({ "channels": channels })))
}

/// POST /api/voice/telemetry — stats WebRTC échantillonnées (F9).
/// Loguées en `info`, aucun stockage DB.
pub async fn post_voice_telemetry(
    State(_state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Garde-fou : un payload obèse ne doit pas noyer les logs.
    let payload = body.to_string();
    if payload.len() > 16 * 1024 {
        return Err(AppError::BadRequest("Télémétrie trop volumineuse (max 16 Ko)".into()));
    }
    // Anonyme : ni compte ni user-agent, seulement l'état de l'appel.
    tracing::info!(target: "voice_telemetry", stats = %payload, "voice telemetry");
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Délai laissé à un participant sorti du SFU pour y revenir (reconnexion
/// complète du SDK, changement de réseau) avant d'effacer sa présence.
const SFU_GRACE_S: u64 = 20;

fn sfu_absents() -> &'static std::sync::Mutex<std::collections::HashMap<(Uuid, Uuid), u64>> {
    static M: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<(Uuid, Uuid), u64>>> = std::sync::OnceLock::new();
    M.get_or_init(Default::default)
}

/// POST /api/livekit/webhook — événements du SFU (sans JWT ForgeChat : signé par LiveKit).
///
/// Présence fantôme : un onglet figé ou une coupure du média peut laisser un
/// utilisateur « dans le salon » côté ForgeChat alors qu'il n'est plus sur le
/// SFU (ni son ni image, mais toujours affiché). S'il n'y est pas revenu au bout
/// de `SFU_GRACE_S`, on le retire du salon comme une sortie normale.
pub async fn livekit_webhook(State(state): State<AppState>, headers: HeaderMap, body: bytes::Bytes) -> StatusCode {
    let Some(lk) = state.livekit.clone() else { return StatusCode::NOT_FOUND };
    let auth = headers.get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !crate::livekit::verify_webhook(&lk, auth, &body) {
        tracing::warn!("webhook LiveKit refusé : signature invalide");
        return StatusCode::UNAUTHORIZED;
    }
    let Ok(ev) = serde_json::from_slice::<serde_json::Value>(&body) else { return StatusCode::BAD_REQUEST };
    let room = ev["room"]["name"].as_str().unwrap_or("");
    // Salon vocal de serveur ou appel de groupe privé (même délai de grâce).
    let group_call = room.starts_with("gdm-");
    let (Some(channel_id), Some(user_id)) = (
        room.strip_prefix("voice-").or_else(|| room.strip_prefix("gdm-")).and_then(|c| c.parse::<Uuid>().ok()),
        ev["participant"]["identity"].as_str().and_then(|u| u.parse::<Uuid>().ok()),
    ) else {
        return StatusCode::OK; // appels 1:1 et événements de salle : rien à faire
    };
    let key = (user_id, channel_id);
    match ev["event"].as_str() {
        Some("participant_joined") => {
            sfu_absents().lock().unwrap_or_else(|e| e.into_inner()).remove(&key);
            // Révocation : un client exclu/sorti garde un jeton (initial ou rafraîchi par le SFU)
            // valable ~10 min. Tout (re)join au SFU sans présence ForgeChat dans ce salon
            // (VOICE_JOIN fait foi, droits revérifiés) est éjecté aussitôt.
            // Appel de groupe : le membre du groupe fait foi (`gdm-<groupe>`), un ancien membre est éjecté.
            let allowed = if group_call {
                crate::handlers::group_calls::is_member(&state, channel_id, user_id).await
            } else {
                state.user_voice.read().await.get(&user_id) == Some(&channel_id)
            };
            if !allowed {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "join SFU sans présence ForgeChat : éjecté");
                let http = state.http_client.clone();
                let room = if group_call { crate::livekit::room_for_group(channel_id) } else { crate::livekit::room_for_channel(channel_id) };
                tokio::spawn(async move {
                    crate::livekit::remove_participant(&http, &lk, &room, &user_id.to_string()).await;
                });
            }
        }
        Some("participant_left") => {
            let marker = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
            sfu_absents().lock().unwrap_or_else(|e| e.into_inner()).insert(key, marker);
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(SFU_GRACE_S)).await;
                let still_absent = sfu_absents().lock().unwrap_or_else(|e| e.into_inner()).get(&key) == Some(&marker);
                if !still_absent {
                    return;
                }
                sfu_absents().lock().unwrap_or_else(|e| e.into_inner()).remove(&key);
                if group_call {
                    crate::handlers::group_calls::leave(&state, channel_id, user_id).await;
                    return;
                }
                let in_room = state.user_voice.read().await.get(&user_id) == Some(&channel_id);
                if in_room {
                    tracing::warn!(user_id = %user_id, channel_id = %channel_id, "présence fantôme retirée : absent du SFU depuis {SFU_GRACE_S} s");
                    crate::handlers::websocket::cleanup_voice(&state, user_id, None).await;
                    // cleanup_voice prévient tout le salon SAUF l'intéressé : sans ce
                    // message, son interface le croyait encore connecté, à jamais muet.
                    state.broadcast_to_user(user_id, serde_json::json!({
                        "type": "VOICE_FORCE_DISCONNECT",
                        "channel_id": channel_id,
                        "reason": "media_lost",
                    }).to_string()).await;
                }
            });
        }
        _ => {}
    }
    StatusCode::OK
}

/// STUN_URLS : liste séparée par des virgules ; seules les URL stun: / stuns: sont gardées.
pub fn parse_stun_urls(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|u| u.starts_with("stun:") || u.starts_with("stuns:"))
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod stun_tests {
    use super::parse_stun_urls;

    #[test]
    fn parses_only_stun_urls() {
        assert!(parse_stun_urls("").is_empty());
        assert_eq!(
            parse_stun_urls(" stun:a.example:3478, turn:x, ,stuns:b.example:5349,http://c "),
            vec!["stun:a.example:3478".to_string(), "stuns:b.example:5349".to_string()]
        );
    }
}
