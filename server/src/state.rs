use std::{collections::{HashMap, HashSet}, sync::Arc};
use redis::aio::MultiplexedConnection;
use sqlx::PgPool;
use tokio::sync::{broadcast, Mutex, RwLock};
use uuid::Uuid;

use crate::config::Config;

pub type WsSender = broadcast::Sender<String>;
pub type ClientMap = Arc<RwLock<HashMap<Uuid, WsSender>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: Arc<Mutex<MultiplexedConnection>>,
    pub config: Config,
    pub clients: ClientMap,
    pub channel_subs: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>>,
    // Salons vocaux : channel_id → {user_id}
    pub voice_rooms: Arc<RwLock<HashMap<Uuid, HashSet<Uuid>>>>,
    // Utilisateur courant dans quel salon : user_id → channel_id
    pub user_voice: Arc<RwLock<HashMap<Uuid, Uuid>>>,
}

impl AppState {
    pub fn new(
        db: PgPool,
        redis: MultiplexedConnection,
        config: Config,
    ) -> Self {
        Self {
            db,
            redis: Arc::new(Mutex::new(redis)),
            config,
            clients: Arc::new(RwLock::new(HashMap::new())),
            channel_subs: Arc::new(RwLock::new(HashMap::new())),
            voice_rooms: Arc::new(RwLock::new(HashMap::new())),
            user_voice: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_or_create_channel_tx(&self, channel_id: Uuid) -> broadcast::Sender<String> {
        let read = self.channel_subs.read().await;
        if let Some(tx) = read.get(&channel_id) {
            return tx.clone();
        }
        drop(read);
        let mut write = self.channel_subs.write().await;
        let (tx, _) = broadcast::channel(256);
        write.insert(channel_id, tx.clone());
        tx
    }

    pub async fn broadcast_to_channel(&self, channel_id: Uuid, event: String) {
        let read = self.channel_subs.read().await;
        if let Some(tx) = read.get(&channel_id) {
            let _ = tx.send(event);
        }
    }

    pub async fn broadcast_to_user(&self, user_id: Uuid, event: String) {
        let read = self.clients.read().await;
        if let Some(tx) = read.get(&user_id) {
            let _ = tx.send(event);
        }
    }

    // Rejoindre un salon vocal — retourne les user_ids déjà présents
    pub async fn voice_join(&self, user_id: Uuid, channel_id: Uuid) -> Vec<Uuid> {
        // Auto-leave de l'ancien salon si nécessaire
        {
            let mut user_voice = self.user_voice.write().await;
            if let Some(old_ch) = user_voice.get(&user_id).copied() {
                if old_ch != channel_id {
                    let mut rooms = self.voice_rooms.write().await;
                    if let Some(room) = rooms.get_mut(&old_ch) {
                        room.remove(&user_id);
                    }
                }
            }
            user_voice.insert(user_id, channel_id);
        }

        let mut rooms = self.voice_rooms.write().await;
        let room = rooms.entry(channel_id).or_insert_with(HashSet::new);
        let existing: Vec<Uuid> = room.iter().filter(|&&u| u != user_id).copied().collect();
        room.insert(user_id);
        existing
    }

    // Quitter le salon vocal — retourne le channel_id quitté et les pairs restants
    pub async fn voice_leave(&self, user_id: Uuid) -> Option<(Uuid, Vec<Uuid>)> {
        let mut user_voice = self.user_voice.write().await;
        let channel_id = user_voice.remove(&user_id)?;
        drop(user_voice);

        let mut rooms = self.voice_rooms.write().await;
        if let Some(room) = rooms.get_mut(&channel_id) {
            room.remove(&user_id);
            let remaining: Vec<Uuid> = room.iter().copied().collect();
            Some((channel_id, remaining))
        } else {
            Some((channel_id, vec![]))
        }
    }

    // Broadcast à tous les participants d'un salon vocal
    pub async fn broadcast_to_voice_room(&self, channel_id: Uuid, event: String) {
        let rooms = self.voice_rooms.read().await;
        let clients = self.clients.read().await;
        if let Some(room) = rooms.get(&channel_id) {
            for uid in room {
                if let Some(tx) = clients.get(uid) {
                    let _ = tx.send(event.clone());
                }
            }
        }
    }
}
