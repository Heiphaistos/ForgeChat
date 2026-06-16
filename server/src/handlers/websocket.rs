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

    let (tx, _rx) = broadcast::channel::<String>(512);
    state.clients.write().await.insert(user_id, tx.clone());

    let _ = sqlx::query("UPDATE users SET status='online' WHERE id=$1")
        .bind(user_id)
        .execute(&state.db)
        .await;

    let (mut sender, mut receiver) = socket.split();
    let mut rx = tx.subscribe();

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let state_clone = state.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    handle_ws_message(&state_clone, user_id, &text).await;
                }
                Message::Close(_) => break,
                Message::Ping(_) => {}
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Nettoyage à la déconnexion
    state.clients.write().await.remove(&user_id);
    let _ = sqlx::query("UPDATE users SET status='offline' WHERE id=$1")
        .bind(user_id)
        .execute(&state.db)
        .await;

    // Quitter le salon vocal automatiquement
    cleanup_voice(&state, user_id).await;

    tracing::info!("WS déconnecté: {}", user_id);
}

async fn cleanup_voice(state: &AppState, user_id: Uuid) {
    if let Some((channel_id, _remaining)) = state.voice_leave(user_id).await {
        let event = serde_json::json!({
            "type": "VOICE_USER_LEFT",
            "user_id": user_id,
            "channel_id": channel_id,
        });
        state.broadcast_to_voice_room(channel_id, event.to_string()).await;
    }
}

async fn handle_ws_message(state: &AppState, user_id: Uuid, text: &str) {
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    match msg["type"].as_str() {
        // ────────── Canal texte ──────────
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

        // ────────── Vocal / Vidéo (WebRTC signaling) ──────────
        Some("VOICE_JOIN") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };

            // Récupérer les participants existants
            let existing_ids = state.voice_join(user_id, channel_id).await;

            // Chercher les infos des pairs existants
            let mut existing_peers = Vec::new();
            for peer_id in &existing_ids {
                if let Ok(row) = sqlx::query(
                    "SELECT username, avatar, discriminator FROM users WHERE id=$1"
                )
                .bind(peer_id)
                .fetch_one(&state.db)
                .await
                {
                    use sqlx::Row;
                    existing_peers.push(serde_json::json!({
                        "user_id": peer_id,
                        "username": row.get::<String, _>("username"),
                        "avatar": row.get::<Option<String>, _>("avatar"),
                        "discriminator": row.get::<String, _>("discriminator"),
                    }));
                }
            }

            // Envoyer au rejoignant la liste des pairs existants → il créera les offres
            let joining_event = serde_json::json!({
                "type": "VOICE_EXISTING_PEERS",
                "channel_id": channel_id,
                "peers": existing_peers,
            });
            state.broadcast_to_user(user_id, joining_event.to_string()).await;

            // Récupérer les infos du rejoignant
            let joiner_info = sqlx::query(
                "SELECT username, avatar, discriminator FROM users WHERE id=$1"
            )
            .bind(user_id)
            .fetch_optional(&state.db)
            .await;

            if let Ok(Some(row)) = joiner_info {
                use sqlx::Row;
                let notif = serde_json::json!({
                    "type": "VOICE_USER_JOINED",
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "username": row.get::<String, _>("username"),
                    "avatar": row.get::<Option<String>, _>("avatar"),
                    "discriminator": row.get::<String, _>("discriminator"),
                });
                // Notifier les pairs existants (pas le rejoignant lui-même)
                let clients = state.clients.read().await;
                for peer_id in &existing_ids {
                    if let Some(tx) = clients.get(peer_id) {
                        let _ = tx.send(notif.to_string());
                    }
                }
            }
        }

        Some("VOICE_LEAVE") => {
            cleanup_voice(state, user_id).await;
        }

        Some("VOICE_SIGNAL") => {
            // Relayer le message de signaling (offer/answer/ICE) vers le pair cible
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            let signal = serde_json::json!({
                "type": "VOICE_SIGNAL",
                "from": user_id,
                "payload": msg["payload"],
            });
            state.broadcast_to_user(to, signal.to_string()).await;
        }

        _ => {}
    }
}
