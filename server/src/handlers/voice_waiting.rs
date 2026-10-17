//! Salle d'attente vocale (réglage `channels.waiting_room`, migration 090).
//!
//! Un arrivant sans MOVE_MEMBERS qui envoie VOICE_JOIN n'entre pas : il reçoit
//! `VOICE_WAITING { channel_id }` et attend. Les participants du salon reçoivent
//! `VOICE_WAITING_UPDATE { channel_id, waiting: [{ user_id, username }] }` (aussi
//! envoyé à chaque arrivée dans le salon). Un modérateur (MOVE_MEMBERS) répond par
//! WebSocket :
//! - `VOICE_ADMIT { channel_id, user_id }` → l'arrivant reçoit `VOICE_ADMITTED`
//!   et renvoie VOICE_JOIN, accepté cette fois (et à ses reconnexions, 6 h) ;
//! - `VOICE_DENY { channel_id, user_id }` → l'arrivant reçoit `VOICE_WAITING_DENIED`.
//!
//! VOICE_LEAVE ou la fermeture du WebSocket retirent l'arrivant de l'attente.
//! État en mémoire seulement (comme `voice_rooms`).

use std::{
    collections::HashMap,
    sync::LazyLock,
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::websocket::has_perm,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// Un arrivant admis le reste ce temps (reconnexion réseau sans repasser par l'attente).
const ADMITTED_TTL: Duration = Duration::from_secs(6 * 3600);
/// Au plus ce nombre d'arrivants en attente par salon.
const MAX_WAITING: usize = 50;

#[derive(Default)]
pub struct WaitingStore {
    /// salon → (utilisateur → nom affiché), dans l'ordre d'arrivée.
    waiting: HashMap<Uuid, Vec<(Uuid, String)>>,
    admitted: HashMap<(Uuid, Uuid), Instant>,
}

impl WaitingStore {
    pub fn is_admitted(&mut self, channel: Uuid, user: Uuid, now: Instant) -> bool {
        self.admitted.retain(|_, t| now.duration_since(*t) < ADMITTED_TTL);
        self.admitted.contains_key(&(channel, user))
    }

    /// Ajoute l'arrivant (retiré de toute autre attente). `false` si la file est pleine.
    pub fn enqueue(&mut self, channel: Uuid, user: Uuid, name: &str) -> bool {
        self.forget(user);
        let list = self.waiting.entry(channel).or_default();
        if list.len() >= MAX_WAITING {
            return false;
        }
        list.push((user, name.chars().take(64).collect()));
        true
    }

    /// Retire l'utilisateur de toute attente ; renvoie les salons modifiés.
    pub fn forget(&mut self, user: Uuid) -> Vec<Uuid> {
        let mut changed = Vec::new();
        for (ch, list) in self.waiting.iter_mut() {
            let before = list.len();
            list.retain(|(u, _)| *u != user);
            if list.len() != before {
                changed.push(*ch);
            }
        }
        self.waiting.retain(|_, l| !l.is_empty());
        changed
    }

    /// Fait entrer (`admit`) ou refuse : `false` si l'utilisateur n'attendait pas ici.
    pub fn decide(&mut self, channel: Uuid, user: Uuid, admit: bool, now: Instant) -> bool {
        let Some(list) = self.waiting.get_mut(&channel) else { return false };
        let before = list.len();
        list.retain(|(u, _)| *u != user);
        if list.len() == before {
            return false;
        }
        if list.is_empty() {
            self.waiting.remove(&channel);
        }
        if admit {
            self.admitted.insert((channel, user), now);
        }
        true
    }

    pub fn list(&self, channel: Uuid) -> serde_json::Value {
        let list = self.waiting.get(&channel).map(Vec::as_slice).unwrap_or(&[]);
        serde_json::Value::Array(
            list.iter().map(|(u, n)| serde_json::json!({ "user_id": u, "username": n })).collect(),
        )
    }
}

static STORE: LazyLock<Mutex<WaitingStore>> = LazyLock::new(|| Mutex::new(WaitingStore::default()));

async fn room_members(state: &AppState, channel_id: Uuid) -> Vec<Uuid> {
    state.voice_rooms.read().await.get(&channel_id).map(|r| r.iter().copied().collect()).unwrap_or_default()
}

fn update_event(channel_id: Uuid, waiting: serde_json::Value) -> String {
    serde_json::json!({ "type": "VOICE_WAITING_UPDATE", "channel_id": channel_id, "waiting": waiting }).to_string()
}

async fn notify_room(state: &AppState, channel_id: Uuid) {
    let list = STORE.lock().await.list(channel_id);
    state.send_to_users(&room_members(state, channel_id).await, update_event(channel_id, list)).await;
}

/// VOICE_JOIN dans un salon à salle d'attente : `true` si l'arrivant doit attendre
/// (il a alors reçu VOICE_WAITING, ou VOICE_JOIN_ERROR si la file est pleine).
pub async fn must_wait(state: &AppState, user_id: Uuid, channel_id: Uuid, perms: i64, username: &str) -> bool {
    if has_perm(perms, Permissions::MOVE_MEMBERS) {
        return false;
    }
    let in_room = state.voice_rooms.read().await.get(&channel_id).is_some_and(|r| r.contains(&user_id));
    let queued = {
        let mut store = STORE.lock().await;
        if in_room || store.is_admitted(channel_id, user_id, Instant::now()) {
            return false;
        }
        store.enqueue(channel_id, user_id, username)
    };
    let event = if queued {
        serde_json::json!({ "type": "VOICE_WAITING", "channel_id": channel_id })
    } else {
        serde_json::json!({ "type": "VOICE_JOIN_ERROR", "channel_id": channel_id, "reason": "waiting_full", "current": 0 })
    };
    state.broadcast_to_user(user_id, event.to_string()).await;
    if queued {
        notify_room(state, channel_id).await;
    }
    true
}

/// Arrivée effective dans le salon : liste d'attente courante pour le nouveau participant.
pub async fn send_current(state: &AppState, user_id: Uuid, channel_id: Uuid) {
    let list = STORE.lock().await.list(channel_id);
    if list.as_array().is_some_and(|l| !l.is_empty()) {
        state.broadcast_to_user(user_id, update_event(channel_id, list)).await;
    }
}

/// VOICE_LEAVE / fermeture du WebSocket : l'utilisateur n'attend plus.
pub async fn forget(state: &AppState, user_id: Uuid) {
    let changed = STORE.lock().await.forget(user_id);
    for ch in changed {
        notify_room(state, ch).await;
    }
}

/// VOICE_ADMIT / VOICE_DENY d'un modérateur (MOVE_MEMBERS sur ce salon).
pub async fn handle_decision(state: &AppState, moderator: Uuid, msg: &serde_json::Value) {
    let admit = msg["type"].as_str() == Some("VOICE_ADMIT");
    let (Some(channel_id), Some(target)) = (
        msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()),
        msg["user_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()),
    ) else { return };
    let allowed = state.effective_channel_permissions(moderator, channel_id).await
        .is_some_and(|(_, perms)| has_perm(perms, Permissions::MOVE_MEMBERS) && has_perm(perms, Permissions::VIEW_CHANNEL));
    if !allowed {
        tracing::warn!(user_id = %moderator, channel_id = %channel_id, "VOICE_ADMIT/DENY rejeté : MOVE_MEMBERS manquant");
        return;
    }
    if !STORE.lock().await.decide(channel_id, target, admit, Instant::now()) {
        return;
    }
    let kind = if admit { "VOICE_ADMITTED" } else { "VOICE_WAITING_DENIED" };
    state.broadcast_to_user(target, serde_json::json!({ "type": kind, "channel_id": channel_id }).to_string()).await;
    notify_room(state, channel_id).await;
}

#[derive(Deserialize)]
pub struct WaitingRoomBody {
    pub enabled: bool,
}

/// PUT /servers/:server_id/channels/:channel_id/waiting-room { enabled } — MANAGE ou EDIT_CHANNELS.
pub async fn set_waiting_room(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<WaitingRoomBody>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::channel_access::require_channel_manage(&state, claims.sub, server_id, channel_id, Permissions::MANAGE_CHANNELS | Permissions::EDIT_CHANNELS).await?;
    let updated: Option<Uuid> = sqlx::query_scalar(
        "UPDATE channels SET waiting_room = $3
         WHERE id = $1 AND server_id = $2 AND type::text IN ('voice', 'stage') RETURNING id",
    )
    .bind(channel_id)
    .bind(server_id)
    .bind(body.enabled)
    .fetch_optional(&state.db)
    .await?;
    if updated.is_none() {
        return Err(AppError::NotFound("Salon vocal introuvable".into()));
    }
    let event = serde_json::json!({
        "type": "CHANNEL_UPDATE",
        "server_id": server_id,
        "channel": { "id": channel_id, "server_id": server_id, "waiting_room": body.enabled },
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    Ok(Json(serde_json::json!({ "ok": true, "waiting_room": body.enabled })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_admit_deny_and_forget() {
        let mut s = WaitingStore::default();
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let (u, v) = (Uuid::new_v4(), Uuid::new_v4());
        let now = Instant::now();
        assert!(s.enqueue(a, u, "alice"));
        assert!(s.enqueue(a, v, "bob"));
        assert_eq!(s.list(a).as_array().unwrap().len(), 2);
        // Attendre ailleurs retire de la première attente.
        assert!(s.enqueue(b, u, "alice"));
        assert_eq!(s.list(a).as_array().unwrap().len(), 1);
        // Seul quelqu'un qui attend ICI peut être admis.
        assert!(!s.decide(a, u, true, now));
        assert!(s.decide(b, u, true, now));
        assert!(s.is_admitted(b, u, now));
        assert!(!s.is_admitted(a, u, now));
        assert!(!s.is_admitted(b, u, now + ADMITTED_TTL));
        // Refus : pas admis.
        assert!(s.decide(a, v, false, now));
        assert!(!s.is_admitted(a, v, now));
        assert!(s.list(a).as_array().unwrap().is_empty());
        // Départ : retiré.
        assert!(s.enqueue(a, v, "bob"));
        assert_eq!(s.forget(v), vec![a]);
        assert!(s.forget(v).is_empty());
    }

    #[test]
    fn queue_is_bounded() {
        let mut s = WaitingStore::default();
        let ch = Uuid::new_v4();
        for _ in 0..MAX_WAITING {
            assert!(s.enqueue(ch, Uuid::new_v4(), "x"));
        }
        assert!(!s.enqueue(ch, Uuid::new_v4(), "x"));
    }
}
