//! « Regarder ensemble » / « Musique ensemble » : une vidéo YouTube (ou YouTube Music)
//! synchronisée dans un salon vocal, avec file d'attente partagée.
//!
//! Protocole WebSocket (client → serveur, tous avec `channel_id`) :
//! - `WATCH_ADD { url }` : lance la vidéo, ou l'ajoute à la file si une joue déjà ;
//! - `WATCH_STATE { item, playing, position }` : lecture / pause / déplacement ;
//! - `WATCH_NEXT { item }` : vidéo suivante (ou fin s'il n'y en a plus) ;
//! - `WATCH_STOP` : arrête l'activité ;
//! - `WATCH_SYNC` : demande l'état courant (page rouverte en cours d'appel).
//!
//! Serveur → participants du salon vocal UNIQUEMENT :
//! `WATCH_STATE { channel_id, item, video_id, playing, position, at, queue, by }`,
//! `WATCH_STOP { channel_id }` et, pour l'expéditeur seul, `WATCH_ERROR { reason }`.
//! `position` est la position À L'ÉMISSION : le client la date avec son heure de
//! réception (pas de dépendance à l'horloge du serveur), `at` n'est qu'indicatif.
//! `item` numérote la vidéo courante : un WATCH_STATE / WATCH_NEXT qui vise une
//! vidéo déjà remplacée est ignoré (fin de vidéo signalée par tous les clients).
//!
//! État en mémoire seulement, comme `voice_rooms` : purgé quand le salon se vide.

use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use crate::state::AppState;

/// 5 changements par 10 s et par utilisateur.
const RATE_LIMIT: usize = 5;
const RATE_WINDOW: Duration = Duration::from_secs(10);
const MAX_QUEUE: usize = 20;
/// Position maximale acceptée (12 h) : borne un client qui enverrait n'importe quoi.
const MAX_POSITION_S: f64 = 12.0 * 3600.0;

/// Identifiant YouTube : exactement 11 caractères [A-Za-z0-9_-].
pub fn is_video_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Extrait l'identifiant d'une adresse youtube.com/watch?v=, youtu.be/ ou
/// youtube.com/shorts/. Tout autre hôte (dont `youtube.com@autre.site`) est refusé.
pub fn parse_video_id(input: &str) -> Option<String> {
    let s = input.trim();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(s);
    let end = s.find(['/', '?', '#']).unwrap_or(s.len());
    let (host, rest) = s.split_at(end);
    let rest = rest.split('#').next().unwrap_or("");
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let id = match host.to_ascii_lowercase().as_str() {
        "youtu.be" => path.strip_prefix('/')?.trim_end_matches('/'),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            if path.trim_end_matches('/') == "/watch" {
                query.split('&').find_map(|kv| kv.strip_prefix("v="))?
            } else {
                path.strip_prefix("/shorts/")?.trim_end_matches('/')
            }
        }
        _ => return None,
    };
    is_video_id(id).then(|| id.to_string())
}

#[derive(Clone)]
pub struct WatchSession {
    item: u64,
    video_id: String,
    playing: bool,
    /// Position (s) à l'instant `at`.
    position: f64,
    at: Instant,
    queue: VecDeque<String>,
    by: Uuid,
}

impl WatchSession {
    fn position_now(&self, now: Instant) -> f64 {
        if self.playing { self.position + now.duration_since(self.at).as_secs_f64() } else { self.position }
    }

    fn event(&self, channel_id: Uuid, now: Instant) -> String {
        let at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        serde_json::json!({
            "type": "WATCH_STATE",
            "channel_id": channel_id,
            "item": self.item,
            "video_id": self.video_id,
            "playing": self.playing,
            "position": self.position_now(now),
            "at": at,
            "queue": self.queue,
            "by": self.by,
        }).to_string()
    }
}

pub enum Cmd {
    Add(String),
    State { item: u64, playing: bool, position: f64 },
    Next { item: u64 },
    Stop,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// Nouvel état à diffuser.
    Updated,
    /// Activité terminée : diffuser WATCH_STOP.
    Stopped,
    /// Rien à diffuser (commande périmée ou sans effet).
    Ignored,
    /// Refus, renvoyé à l'expéditeur seul.
    Rejected(&'static str),
}

#[derive(Default)]
pub struct WatchStore {
    rooms: HashMap<Uuid, WatchSession>,
    rate: HashMap<Uuid, VecDeque<Instant>>,
    next_item: u64,
}

impl WatchStore {
    /// Fenêtre glissante par utilisateur.
    fn rate_ok(&mut self, user: Uuid, now: Instant) -> bool {
        self.rate.retain(|_, q| q.back().is_some_and(|t| now.duration_since(*t) < RATE_WINDOW));
        let q = self.rate.entry(user).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= RATE_WINDOW) {
            q.pop_front();
        }
        if q.len() >= RATE_LIMIT { return false; }
        q.push_back(now);
        true
    }

    fn start(&mut self, channel: Uuid, user: Uuid, video_id: String, queue: VecDeque<String>, now: Instant) {
        self.next_item += 1;
        self.rooms.insert(channel, WatchSession {
            item: self.next_item, video_id, playing: true, position: 0.0, at: now, queue, by: user,
        });
    }

    pub fn apply(&mut self, channel: Uuid, user: Uuid, cmd: Cmd, now: Instant) -> Outcome {
        if !self.rate_ok(user, now) { return Outcome::Rejected("rate_limited"); }
        match cmd {
            Cmd::Add(url) => {
                let Some(id) = parse_video_id(&url) else { return Outcome::Rejected("invalid_url"); };
                match self.rooms.get_mut(&channel) {
                    None => self.start(channel, user, id, VecDeque::new(), now),
                    Some(s) if s.queue.len() >= MAX_QUEUE => return Outcome::Rejected("queue_full"),
                    Some(s) => s.queue.push_back(id),
                }
                Outcome::Updated
            }
            Cmd::State { item, playing, position } => {
                let Some(s) = self.rooms.get_mut(&channel).filter(|s| s.item == item) else { return Outcome::Ignored; };
                if !position.is_finite() { return Outcome::Rejected("invalid_position"); }
                s.playing = playing;
                s.position = position.clamp(0.0, MAX_POSITION_S);
                s.at = now;
                s.by = user;
                Outcome::Updated
            }
            Cmd::Next { item } => {
                let Some(s) = self.rooms.get_mut(&channel).filter(|s| s.item == item) else { return Outcome::Ignored; };
                let mut queue = std::mem::take(&mut s.queue);
                match queue.pop_front() {
                    Some(id) => { self.start(channel, user, id, queue, now); Outcome::Updated }
                    None => { self.rooms.remove(&channel); Outcome::Stopped }
                }
            }
            Cmd::Stop => if self.rooms.remove(&channel).is_some() { Outcome::Stopped } else { Outcome::Ignored },
        }
    }

    pub fn event(&self, channel: Uuid, now: Instant) -> Option<String> {
        self.rooms.get(&channel).map(|s| s.event(channel, now))
    }

    pub fn purge(&mut self, channel: Uuid) {
        self.rooms.remove(&channel);
    }
}

fn stop_event(channel_id: Uuid) -> String {
    serde_json::json!({ "type": "WATCH_STOP", "channel_id": channel_id }).to_string()
}

/// Participants actuels du salon vocal (et non tout le serveur).
async fn room_members(state: &AppState, channel_id: Uuid) -> Vec<Uuid> {
    state.voice_rooms.read().await.get(&channel_id).map(|r| r.iter().copied().collect()).unwrap_or_default()
}

/// Envoie l'état courant à un arrivant (VOICE_JOIN, WATCH_SYNC). Rien si aucune vidéo.
pub async fn send_current(state: &AppState, user_id: Uuid, channel_id: Uuid) {
    let ev = state.watch.lock().await.event(channel_id, Instant::now());
    if let Some(ev) = ev {
        state.broadcast_to_user(user_id, ev).await;
    }
}

/// Point d'entrée des messages WATCH_* du WebSocket.
pub async fn handle(state: &AppState, user_id: Uuid, msg: &serde_json::Value) {
    let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else { return; };
    // Seuls les participants du salon vocal pilotent ou lisent l'activité.
    if state.user_voice.read().await.get(&user_id) != Some(&channel_id) {
        tracing::warn!(user_id = %user_id, channel_id = %channel_id, "WATCH rejeté : hors du salon vocal");
        return;
    }
    let item = msg["item"].as_u64().unwrap_or(0);
    let cmd = match msg["type"].as_str() {
        Some("WATCH_SYNC") => return send_current(state, user_id, channel_id).await,
        Some("WATCH_ADD") => Cmd::Add(msg["url"].as_str().unwrap_or("").chars().take(300).collect()),
        Some("WATCH_STATE") => {
            let (Some(playing), Some(position)) = (msg["playing"].as_bool(), msg["position"].as_f64()) else { return; };
            Cmd::State { item, playing, position }
        }
        Some("WATCH_NEXT") => Cmd::Next { item },
        Some("WATCH_STOP") => Cmd::Stop,
        _ => return,
    };
    let now = Instant::now();
    let (outcome, event) = {
        let mut store = state.watch.lock().await;
        let outcome = store.apply(channel_id, user_id, cmd, now);
        let event = store.event(channel_id, now);
        (outcome, event)
    };
    match outcome {
        Outcome::Updated => if let Some(ev) = event {
            state.send_to_users(&room_members(state, channel_id).await, ev).await;
        },
        Outcome::Stopped => state.send_to_users(&room_members(state, channel_id).await, stop_event(channel_id)).await,
        Outcome::Ignored => {}
        Outcome::Rejected(reason) => {
            tracing::warn!(user_id = %user_id, channel_id = %channel_id, reason, "WATCH rejeté");
            state.broadcast_to_user(user_id, serde_json::json!({
                "type": "WATCH_ERROR", "channel_id": channel_id, "reason": reason,
            }).to_string()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_urls_only() {
        let id = Some("dQw4w9WgXcQ".to_string());
        assert_eq!(parse_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), id);
        assert_eq!(parse_video_id("  youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s "), id);
        assert_eq!(parse_video_id("https://m.youtube.com/watch/?v=dQw4w9WgXcQ#x"), id);
        assert_eq!(parse_video_id("https://youtu.be/dQw4w9WgXcQ?si=abc"), id);
        assert_eq!(parse_video_id("http://YOUTU.BE/dQw4w9WgXcQ/"), id);
        assert_eq!(parse_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=x"), id);
        // YouTube Music (musique en salon vocal) : même identifiant.
        assert_eq!(parse_video_id("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM"), id);
        for bad in [
            "dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXc",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQQ",
            "https://www.youtube.com/watch?v=dQw4w9WgX<Q",
            "https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ",
            "https://evil.example/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://www.youtube.com/watch?vv=dQw4w9WgXcQ",
            "javascript:alert(1)//youtu.be/dQw4w9WgXcQ",
            "",
        ] {
            assert_eq!(parse_video_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn rate_limit_is_five_per_ten_seconds() {
        let mut store = WatchStore::default();
        let (ch, user, other) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let t0 = Instant::now();
        for _ in 0..5 {
            assert_ne!(store.apply(ch, user, Cmd::Stop, t0), Outcome::Rejected("rate_limited"));
        }
        assert_eq!(store.apply(ch, user, Cmd::Stop, t0 + Duration::from_secs(9)), Outcome::Rejected("rate_limited"));
        // Un autre participant n'est pas bloqué par le premier.
        assert_eq!(store.apply(ch, other, Cmd::Stop, t0), Outcome::Ignored);
        assert_eq!(store.apply(ch, user, Cmd::Stop, t0 + Duration::from_secs(10)), Outcome::Ignored);
    }

    #[test]
    fn queue_and_stale_commands() {
        let mut store = WatchStore::default();
        let (ch, a, b) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let t0 = Instant::now();
        assert_eq!(store.apply(ch, a, Cmd::Add("https://youtu.be/aaaaaaaaaaa".into()), t0), Outcome::Updated);
        assert_eq!(store.apply(ch, b, Cmd::Add("https://youtu.be/bbbbbbbbbbb".into()), t0), Outcome::Updated);
        assert_eq!(store.apply(ch, b, Cmd::Add("https://exemple.fr".into()), t0), Outcome::Rejected("invalid_url"));
        let first = store.rooms[&ch].item;
        assert_eq!(store.rooms[&ch].queue.len(), 1);
        // Position en lecture = position + temps écoulé ; en pause, figée.
        assert_eq!(store.apply(ch, a, Cmd::State { item: first, playing: true, position: 30.0 }, t0), Outcome::Updated);
        assert!((store.rooms[&ch].position_now(t0 + Duration::from_secs(5)) - 35.0).abs() < 1e-6);
        // Fin de vidéo signalée par les deux clients : une seule avance.
        assert_eq!(store.apply(ch, a, Cmd::Next { item: first }, t0), Outcome::Updated);
        assert_eq!(store.apply(ch, b, Cmd::Next { item: first }, t0), Outcome::Ignored);
        let second = store.rooms[&ch].item;
        assert_eq!(store.rooms[&ch].video_id, "bbbbbbbbbbb");
        assert_eq!(store.apply(ch, a, Cmd::State { item: first, playing: false, position: 1.0 }, t0), Outcome::Ignored);
        assert_eq!(store.apply(ch, a, Cmd::State { item: second, playing: false, position: f64::NAN }, t0), Outcome::Rejected("invalid_position"));
        assert_eq!(store.apply(ch, b, Cmd::Next { item: second }, t0 + Duration::from_secs(20)), Outcome::Stopped);
        assert!(store.event(ch, t0).is_none());
    }
}
