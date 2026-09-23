//! Appels vocaux/vidéo de groupe privé (P2-4), sur le SFU LiveKit : salle
//! `gdm-<group_id>`, jeton délivré seulement aux membres du groupe. L'appel vit
//! tant qu'il a des participants ; on le rejoint et le quitte à tout moment.
//!
//! Événements WS :
//! - reçus : `GROUP_CALL_JOIN { group_id, call_type }`, `GROUP_CALL_LEAVE { group_id }`
//! - émis : `GROUP_CALL_MEDIA` (à la session qui rejoint), `GROUP_CALL_RING`
//!   (aux autres membres quand l'appel démarre), `GROUP_CALL_UPDATE` (liste des
//!   participants, à tous les membres).

use uuid::Uuid;

use crate::state::AppState;

/// Durée de sonnerie, alignée sur les appels 1:1.
const RING_TIMEOUT_S: u64 = 45;

pub async fn is_member(state: &AppState, group_id: Uuid, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)",
    )
    .bind(group_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

async fn members(state: &AppState, group_id: Uuid) -> Vec<Uuid> {
    sqlx::query_scalar("SELECT user_id FROM group_dm_members WHERE dm_id=$1")
        .bind(group_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
}

pub async fn participants(state: &AppState, group_id: Uuid) -> Vec<Uuid> {
    state
        .group_calls
        .read()
        .await
        .get(&group_id)
        .map(|m| m.iter().copied().collect())
        .unwrap_or_default()
}

async fn broadcast_update(state: &AppState, group_id: Uuid) {
    let event = serde_json::json!({
        "type": "GROUP_CALL_UPDATE",
        "group_id": group_id,
        "participants": participants(state, group_id).await,
    })
    .to_string();
    for uid in members(state, group_id).await {
        state.broadcast_to_user(uid, event.clone()).await;
    }
}

pub async fn join(
    state: &AppState,
    user_id: Uuid,
    session_id: Uuid,
    username: &str,
    msg: &serde_json::Value,
) {
    let Some(group_id) = msg["group_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else { return };
    let error = |reason: &str| {
        serde_json::json!({ "type": "GROUP_CALL_ERROR", "group_id": group_id, "reason": reason }).to_string()
    };
    if !is_member(state, group_id, user_id).await {
        state.broadcast_to_user(user_id, error("forbidden")).await;
        return;
    }
    let Some(lk) = state.livekit.as_ref() else {
        state.broadcast_to_user(user_id, error("unavailable")).await;
        return;
    };
    let call_type = if msg["call_type"].as_str() == Some("video") { "video" } else { "voice" };

    let started = {
        let mut calls = state.group_calls.write().await;
        let call = calls.entry(group_id).or_default();
        let started = call.is_empty();
        call.insert(user_id);
        started
    };
    let room = crate::livekit::room_for_group(group_id);
    let token = crate::livekit::join_token(
        lk, &room, &user_id.to_string(), username,
        crate::livekit::Publish { microphone: true, camera: true, screen: true, deafened: false },
    );
    state.broadcast_to_user(user_id, serde_json::json!({
        "type": "GROUP_CALL_MEDIA",
        "group_id": group_id,
        "session_id": session_id,
        "livekit": { "url": lk.public_url, "room": room, "token": token },
    }).to_string()).await;
    broadcast_update(state, group_id).await;

    // Sonnerie à l'ouverture de l'appel seulement, limitée (5 / min / groupe et appelant).
    if started && crate::handlers::websocket::rate_ok(state, format!("gcall_rate:{user_id}:{group_id}"), 5, 60).await {
        let ring = serde_json::json!({
            "type": "GROUP_CALL_RING",
            "group_id": group_id,
            "from": user_id,
            "from_username": username,
            "call_type": call_type,
            "ring_timeout_ms": RING_TIMEOUT_S * 1000,
        })
        .to_string();
        let all = members(state, group_id).await;
        let targets: Vec<Uuid> = {
            let online = state.clients.read().await;
            all.into_iter().filter(|u| *u != user_id && online.contains_key(u)).collect()
        };
        for uid in targets {
            state.broadcast_to_user(uid, ring.clone()).await;
        }
    }
}

/// Retire `user_id` de l'appel du groupe (bouton raccrocher, exclusion du
/// groupe, ou absence prolongée du SFU signalée par le webhook LiveKit : une
/// simple coupure WebSocket ne coupe pas l'appel, le média passe par le SFU).
pub async fn leave(state: &AppState, group_id: Uuid, user_id: Uuid) {
    let removed = {
        let mut calls = state.group_calls.write().await;
        let Some(call) = calls.get_mut(&group_id) else { return };
        let removed = call.remove(&user_id);
        if call.is_empty() {
            calls.remove(&group_id);
        }
        removed
    };
    if !removed {
        return;
    }
    if let Some(lk) = state.livekit.clone() {
        let http = state.http_client.clone();
        let room = crate::livekit::room_for_group(group_id);
        tokio::spawn(async move {
            crate::livekit::remove_participant(&http, &lk, &room, &user_id.to_string()).await;
        });
    }
    broadcast_update(state, group_id).await;
}
