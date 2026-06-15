use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{middleware::auth::verify_token, state::AppState};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let token = params.get("token").cloned().unwrap_or_default();
    let config_secret = state.config.jwt_secret.clone();

    ws.on_upgrade(move |socket| handle_socket(socket, state, token, config_secret))
}

async fn handle_socket(socket: WebSocket, state: AppState, token: String, secret: String) {
    let claims = match verify_token(&token, &secret) {
        Some(c) => c,
        None => {
            tracing::warn!("WebSocket: token invalide");
            return;
        }
    };

    let user_id = claims.sub;
    tracing::info!("WS connecté: {}", user_id);

    let (tx, _rx) = broadcast::channel::<String>(256);
    state.clients.write().await.insert(user_id, tx.clone());

    // Mettre à jour le statut online
    let _ = sqlx::query("UPDATE users SET status='online' WHERE id=$1")
        .bind(user_id)
        .execute(&state.db)
        .await;

    let (mut sender, mut receiver) = socket.split();
    let mut rx = tx.subscribe();

    // Tâche d'envoi sortant
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Tâche de réception des messages entrants (subscriptions de canaux, etc.)
    let state_clone = state.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    handle_ws_message(&state_clone, user_id, &text).await;
                }
                Message::Close(_) => break,
                Message::Ping(p) => {
                    // Pong automatique géré par axum
                    let _ = p;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Déconnexion
    state.clients.write().await.remove(&user_id);
    let _ = sqlx::query("UPDATE users SET status='offline' WHERE id=$1")
        .bind(user_id)
        .execute(&state.db)
        .await;

    tracing::info!("WS déconnecté: {}", user_id);
}

async fn handle_ws_message(state: &AppState, user_id: Uuid, text: &str) {
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    match msg["type"].as_str() {
        Some("SUBSCRIBE_CHANNEL") => {
            if let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
                let tx = state.get_or_create_channel_tx(channel_id).await;
                let read = state.clients.read().await;
                if let Some(user_tx) = read.get(&user_id) {
                    let mut rx = tx.subscribe();
                    let user_tx = user_tx.clone();
                    tokio::spawn(async move {
                        while let Ok(msg) = rx.recv().await {
                            if user_tx.send(msg).is_err() {
                                break;
                            }
                        }
                    });
                }
            }
        }
        Some("TYPING_START") => {
            if let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
                let event = serde_json::json!({
                    "type": "TYPING_START",
                    "channel_id": channel_id,
                    "user_id": user_id,
                });
                state.broadcast_to_channel(channel_id, event.to_string()).await;
            }
        }
        Some("HEARTBEAT") => {
            let read = state.clients.read().await;
            if let Some(tx) = read.get(&user_id) {
                let _ = tx.send(serde_json::json!({ "type": "HEARTBEAT_ACK" }).to_string());
            }
        }
        _ => {}
    }
}
