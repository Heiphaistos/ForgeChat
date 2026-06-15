use std::{collections::HashMap, sync::Arc};
use axum::extract::ws::Message;
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
}
