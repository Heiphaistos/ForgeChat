use axum::{extract::State, http::{HeaderMap, StatusCode}, Extension, Json};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

/// Durée de vie des credentials TURN éphémères (TURN REST API) — 1 h.
const TURN_TTL_S: u64 = 3600;

/// GET /api/voice/ice-config
/// Retourne la configuration ICE (STUN + TURN si configuré).
///
/// Deux modes TURN :
/// - **éphémère** (recommandé) si `TURN_STATIC_AUTH_SECRET` est défini :
///   `username = "<expiry_unix>:<user_id>"`, `credential = base64(HMAC-SHA1(secret, username))`,
///   valable `TURN_TTL_S`. Le secret ne quitte jamais le serveur (correctif N6).
/// - **statique** en repli si seule `TURN_PASSWORD` est fournie (ancien comportement).
///
/// Le champ `ttl` indique au client dans combien de secondes recharger
/// (0 = credentials statiques, pas d'expiration).
pub async fn get_ice_config(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut servers = vec![
        serde_json::json!({
            "urls": [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302"
            ]
        }),
    ];

    let mut ttl: u64 = 0;

    if let Some(turn_url) = &state.config.turn_url {
        if let Some(secret) = state.config.turn_static_auth_secret.as_deref().filter(|s| !s.is_empty()) {
            // Mode éphémère (coturn `use-auth-secret` / `static-auth-secret`)
            let expiry = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
                + TURN_TTL_S;
            let username = format!("{}:{}", expiry, claims.sub);
            let credential = turn_credential(secret, &username)?;
            ttl = TURN_TTL_S;
            servers.push(serde_json::json!({
                "urls": [turn_url],
                "username": username,
                "credential": credential,
            }));
        } else if let (Some(turn_user), Some(turn_pass)) =
            (&state.config.turn_username, &state.config.turn_password)
        {
            servers.push(serde_json::json!({
                "urls": [turn_url],
                "username": turn_user,
                "credential": turn_pass,
            }));
        } else {
            tracing::warn!("TURN: TURN_URL défini sans TURN_STATIC_AUTH_SECRET ni TURN_PASSWORD — relais inutilisable");
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
            "SELECT id, username, avatar, discriminator FROM users WHERE id = ANY($1)"
        )
        .bind(&members)
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
                    "hand_raised": hands.contains(&uid),
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
    Extension(claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Garde-fou : un payload obèse ne doit pas noyer les logs.
    let payload = body.to_string();
    if payload.len() > 16 * 1024 {
        return Err(AppError::BadRequest("Télémétrie trop volumineuse (max 16 Ko)".into()));
    }
    tracing::info!(target: "voice_telemetry", user_id = %claims.sub, stats = %payload, "voice telemetry");
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
    let (Some(channel_id), Some(user_id)) = (
        room.strip_prefix("voice-").and_then(|c| c.parse::<Uuid>().ok()),
        ev["participant"]["identity"].as_str().and_then(|u| u.parse::<Uuid>().ok()),
    ) else {
        return StatusCode::OK; // appels privés et événements de salle : rien à faire
    };
    let key = (user_id, channel_id);
    match ev["event"].as_str() {
        Some("participant_joined") => {
            sfu_absents().lock().unwrap().remove(&key);
        }
        Some("participant_left") => {
            let marker = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
            sfu_absents().lock().unwrap().insert(key, marker);
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(SFU_GRACE_S)).await;
                let still_absent = sfu_absents().lock().unwrap().get(&key) == Some(&marker);
                if !still_absent {
                    return;
                }
                sfu_absents().lock().unwrap().remove(&key);
                let in_room = state.user_voice.read().await.get(&user_id) == Some(&channel_id);
                if in_room {
                    tracing::warn!(user_id = %user_id, channel_id = %channel_id, "présence fantôme retirée : absent du SFU depuis {SFU_GRACE_S} s");
                    crate::handlers::websocket::cleanup_voice(&state, user_id, None).await;
                }
            });
        }
        _ => {}
    }
    StatusCode::OK
}
