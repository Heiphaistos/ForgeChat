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

use crate::{models::role::Permissions, state::{AppState, VoiceStateData}};
// bcrypt est importé via le crate root (Cargo.toml)

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let ticket = params.get("ticket").cloned();
    let token = params.get("token").cloned().unwrap_or_default();
    let config_secret = state.config.jwt_secret.clone();
    let config_issuer = state.config.jwt_issuer.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, state, ticket, token, config_secret, config_issuer))
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    ticket: Option<String>,
    token: String,
    secret: String,
    issuer: String,
) {
    // Priorité 1 : ticket éphémère Redis (web — ne logue pas le JWT)
    // Priorité 2 : JWT direct (Tauri)
    let user_id: Uuid = if let Some(t) = ticket {
        let key = format!("ws_ticket:{}", t);
        let uid_str: Option<String> = {
            let mut redis = state.redis.lock().await;
            use redis::AsyncCommands;
            // Single-use : supprimer le ticket immédiatement après validation
            let val: Option<String> = redis.get(&key).await.unwrap_or(None);
            if val.is_some() {
                let _: () = redis.del(&key).await.unwrap_or(());
            }
            val
        };
        match uid_str.and_then(|s| Uuid::parse_str(&s).ok()) {
            Some(id) => id,
            None => {
                tracing::warn!("WebSocket: ticket invalide ou expiré");
                return;
            }
        }
    } else {
        match crate::middleware::auth::verify_token(&token, &secret, &issuer) {
            Some(c) => c.sub,
            None => {
                tracing::warn!("WebSocket: token invalide");
                return;
            }
        }
    };

    tracing::info!("WS connecté: {}", user_id);

    // Charger le username une fois au connect pour éviter les DB queries dans les TYPING events
    let cached_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();

    // Réutiliser le sender existant pour supporter plusieurs onglets/appareils simultanés
    let tx = {
        let mut clients = state.clients.write().await;
        let tx = clients.entry(user_id).or_insert_with(|| {
            let (tx, _) = broadcast::channel::<String>(512);
            tx
        }).clone();
        drop(clients);
        *state.conn_counts.write().await.entry(user_id).or_insert(0) += 1;
        tx
    };

    // Lire le statut préféré : les utilisateurs "invisible" restent invisibles au connect
    let preferred_status: String = {
        use sqlx::Row;
        sqlx::query("SELECT status FROM users WHERE id=$1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .map(|r| r.get::<String, _>("status"))
            .unwrap_or_else(|| "online".to_string())
    };

    let is_invisible = preferred_status == "invisible";
    // Invisible → on garde le statut invisible en DB ; sinon → online
    let db_status = if is_invisible { "invisible" } else { "online" };
    let _ = sqlx::query("UPDATE users SET status=$1 WHERE id=$2")
        .bind(db_status)
        .bind(user_id)
        .execute(&state.db)
        .await;

    // Broadcast "offline" aux autres si invisible, "online" sinon
    if !is_invisible {
        broadcast_presence(&state, user_id, "online").await;
    }

    // Envoyer au nouveau client le snapshot de présence — filtré aux amis + membres de serveurs communs
    {
        use sqlx::Row;
        let connected_ids: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
        if !connected_ids.is_empty() {
            let rows = sqlx::query(
                "SELECT DISTINCT u.id, u.status, u.activity_type, u.activity_name, u.activity_detail
                 FROM users u
                 WHERE u.id = ANY($1) AND u.id != $2 AND u.status != 'invisible'
                   AND (
                       EXISTS(
                           SELECT 1 FROM server_members sm1
                           JOIN server_members sm2 ON sm1.server_id = sm2.server_id
                           WHERE sm1.user_id = $2 AND sm2.user_id = u.id
                       )
                       OR EXISTS(
                           SELECT 1 FROM friendships f
                           WHERE f.status = 'accepted'
                             AND ((f.user_id = $2 AND f.friend_id = u.id)
                               OR (f.friend_id = $2 AND f.user_id = u.id))
                       )
                   )"
            )
            .bind(&connected_ids)
            .bind(user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            if !rows.is_empty() {
                let users: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
                    "user_id": r.get::<Uuid, _>("id"),
                    "status": r.get::<String, _>("status"),
                    "activity_type": r.get::<Option<String>, _>("activity_type"),
                    "activity_name": r.get::<Option<String>, _>("activity_name"),
                    "activity_detail": r.get::<Option<String>, _>("activity_detail"),
                })).collect();

                let init_event = serde_json::json!({
                    "type": "PRESENCE_INIT",
                    "users": users,
                }).to_string();

                let clients = state.clients.read().await;
                if let Some(tx) = clients.get(&user_id) {
                    let _ = tx.send(init_event);
                }
            }
        }
    }

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
    let username_clone = cached_username.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // Limite de taille pour éviter les attaques DoS
                    if text.len() > 64 * 1024 {
                        tracing::warn!("WS: message trop grand ({} bytes) de {}", text.len(), user_id);
                        break;
                    }
                    handle_ws_message(&state_clone, user_id, &text, &username_clone).await;
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

    // Nettoyage à la déconnexion — seulement si c'est le dernier onglet/appareil
    let is_last = {
        let mut counts = state.conn_counts.write().await;
        let count = counts.entry(user_id).or_insert(0);
        *count = count.saturating_sub(1);
        let last = *count == 0;
        if last { counts.remove(&user_id); }
        drop(counts);
        if last { state.clients.write().await.remove(&user_id); }
        last
    };

    if is_last {
        let _ = sqlx::query("UPDATE users SET status='offline' WHERE id=$1")
            .bind(user_id)
            .execute(&state.db)
            .await;
        broadcast_presence(&state, user_id, "offline").await;
        cleanup_voice(&state, user_id).await;
    }

    tracing::info!("WS déconnecté: {}", user_id);
}

async fn broadcast_presence(state: &AppState, user_id: Uuid, status: &str) {
    use sqlx::Row;

    let connected: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
    if connected.is_empty() { return; }

    // Envoyer uniquement aux utilisateurs connectés qui partagent un serveur ou sont amis
    // (privacy + perf : évite O(n) pour chaque connect/disconnect)
    let relevant: Vec<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT DISTINCT other_id FROM (
             SELECT sm2.user_id AS other_id
             FROM server_members sm1
             JOIN server_members sm2 ON sm1.server_id = sm2.server_id
             WHERE sm1.user_id = $1 AND sm2.user_id != $1
               AND sm2.user_id = ANY($2)
             UNION
             SELECT CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END AS other_id
             FROM friendships f
             WHERE (f.user_id = $1 OR f.friend_id = $1)
               AND f.status = 'accepted'
               AND CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END = ANY($2)
         ) x"
    )
    .bind(user_id)
    .bind(&connected)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if relevant.is_empty() { return; }

    // Récupérer l'activité pour l'inclure dans le broadcast
    let activity_row = sqlx::query(
        "SELECT activity_type, activity_name, activity_detail FROM users WHERE id=$1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let event = if let Some(row) = activity_row {
        serde_json::json!({
            "type": "PRESENCE_UPDATE",
            "user_id": user_id,
            "status": status,
            "activity_type": row.get::<Option<String>, _>("activity_type"),
            "activity_name": row.get::<Option<String>, _>("activity_name"),
            "activity_detail": row.get::<Option<String>, _>("activity_detail"),
        })
    } else {
        serde_json::json!({
            "type": "PRESENCE_UPDATE",
            "user_id": user_id,
            "status": status,
        })
    }
    .to_string();

    let clients = state.clients.read().await;
    for uid in relevant {
        if let Some(tx) = clients.get(&uid) {
            let _ = tx.send(event.clone());
        }
    }
}

async fn cleanup_voice(state: &AppState, user_id: Uuid) {
    if let Some((channel_id, remaining)) = state.voice_leave(user_id).await {
        let event = serde_json::json!({
            "type": "VOICE_USER_LEFT",
            "user_id": user_id,
            "channel_id": channel_id,
        });
        // Broadcast à tous les clients connectés (sidebar participantes globale)
        broadcast_to_all(state, user_id, event.to_string()).await;

        // Si canal temporaire et dernier participant → supprimer automatiquement
        if remaining.is_empty() {
            let is_temp: bool = sqlx::query_scalar(
                "SELECT is_temporary FROM channels WHERE id=$1"
            )
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None)
            .unwrap_or(false);

            if is_temp {
                // Récupérer server_id avant suppression
                let server_id_opt: Option<Uuid> = sqlx::query_scalar(
                    "SELECT server_id FROM channels WHERE id=$1"
                )
                .bind(channel_id)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
                .flatten();

                let _ = sqlx::query("DELETE FROM channels WHERE id=$1 AND is_temporary=TRUE")
                    .bind(channel_id)
                    .execute(&state.db)
                    .await;

                if let Some(server_id) = server_id_opt {
                    let del_event = serde_json::json!({
                        "type": "CHANNEL_DELETE",
                        "channel_id": channel_id,
                    });
                    state.broadcast_to_server_members(server_id, del_event.to_string()).await;
                }
            }
        }
    }
}

async fn broadcast_to_all(state: &AppState, exclude: Uuid, event: String) {
    let clients = state.clients.read().await;
    for (uid, tx) in clients.iter() {
        if *uid != exclude {
            let _ = tx.send(event.clone());
        }
    }
}

async fn handle_ws_message(state: &AppState, user_id: Uuid, text: &str, cached_username: &str) {
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    match msg["type"].as_str() {
        // ────────── Canal texte ──────────
        Some("SUBSCRIBE_CHANNEL") => {
            if let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
                // Vérifier que l'utilisateur est membre du serveur auquel appartient ce channel
                let member_ok = sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(
                        SELECT 1 FROM channels c
                        JOIN server_members sm ON sm.server_id = c.server_id
                        WHERE c.id = $1 AND sm.user_id = $2
                    )"
                )
                .bind(channel_id)
                .bind(user_id)
                .fetch_one(&state.db)
                .await
                .unwrap_or(false);

                // Autoriser aussi les DM channels
                let dm_ok = if !member_ok {
                    sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id = $1 AND (user1_id = $2 OR user2_id = $2))"
                    )
                    .bind(channel_id)
                    .bind(user_id)
                    .fetch_one(&state.db)
                    .await
                    .unwrap_or(false)
                } else {
                    false
                };

                if !member_ok && !dm_ok {
                    tracing::warn!("WS SUBSCRIBE_CHANNEL refusé: user {} canal {}", user_id, channel_id);
                } else {
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
        }

        Some("TYPING_START") => {
            if let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
                // Vérifier que l'utilisateur est membre du serveur du canal
                let is_member: bool = sqlx::query_scalar(
                    "SELECT EXISTS(
                        SELECT 1 FROM channels c
                        JOIN server_members sm ON sm.server_id = c.server_id
                        WHERE c.id = $1 AND sm.user_id = $2
                    )"
                )
                .bind(channel_id).bind(user_id)
                .fetch_one(&state.db).await.unwrap_or(false);
                if !is_member { return; }
                let event = serde_json::json!({
                    "type": "TYPING_START",
                    "channel_id": channel_id,
                    "user_id": user_id,
                    "username": cached_username,
                });
                state.broadcast_to_channel_members(channel_id, event.to_string()).await;
            }
        }

        Some("HEARTBEAT") => {
            let read = state.clients.read().await;
            if let Some(tx) = read.get(&user_id) {
                let _ = tx.send(serde_json::json!({ "type": "HEARTBEAT_ACK" }).to_string());
            }
        }

        // Accusé de lecture DM — déclenche DM_READ_RECEIPT chez l'autre participant
        Some("DM_READ") => {
            use sqlx::Row;
            if let (Some(conv_str), Some(msg_str)) = (
                msg["conversation_id"].as_str(),
                msg["message_id"].as_str(),
            ) {
                if let (Ok(conv_id), Ok(msg_id)) = (
                    conv_str.parse::<Uuid>(),
                    msg_str.parse::<Uuid>(),
                ) {
                    // Récupérer l'autre participant + infos du lecteur
                    let row = sqlx::query(
                        "SELECT
                            CASE WHEN user1_id=$1 THEN user2_id ELSE user1_id END AS other_id
                         FROM dm_channels WHERE id=$2 AND (user1_id=$1 OR user2_id=$1)"
                    )
                    .bind(user_id).bind(conv_id)
                    .fetch_optional(&state.db).await;

                    if let Ok(Some(row)) = row {
                        let other_id: Uuid = row.get("other_id");
                        // Mettre à jour la table de réception
                        let _ = sqlx::query(
                            "INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at)
                             VALUES ($1,$2,NOW())
                             ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at=NOW()"
                        )
                        .bind(conv_id).bind(user_id)
                        .execute(&state.db).await;

                        // Récupérer avatar du lecteur
                        let avatar: Option<String> = sqlx::query_scalar(
                            "SELECT avatar FROM users WHERE id=$1"
                        ).bind(user_id).fetch_optional(&state.db).await.ok().flatten();

                        let receipt_event = serde_json::json!({
                            "type": "DM_READ_RECEIPT",
                            "conversation_id": conv_id,
                            "message_id": msg_id,
                            "user_id": user_id,
                            "username": cached_username,
                            "avatar": avatar,
                        });
                        state.broadcast_to_user(other_id, receipt_event.to_string()).await;
                    }
                }
            }
        }

        // Typing indicator pour DMs (1-1 et groupes)
        Some("TYPING") => {
            if let Some(conv_id_str) = msg["conversation_id"].as_str() {
                if let Ok(conv_uuid) = conv_id_str.parse::<Uuid>() {
                    let event = serde_json::json!({
                        "type": "TYPING",
                        "conversation_id": conv_uuid,
                        "user_id": user_id,
                        "username": cached_username,
                    });
                    let event_str = event.to_string();
                    // Broadcast to both DM participants
                    let other_ids: Vec<Uuid> = sqlx::query_scalar(
                        "SELECT user1_id as u FROM dm_channels WHERE id=$1 AND user2_id=$2
                         UNION ALL
                         SELECT user2_id FROM dm_channels WHERE id=$1 AND user1_id=$2"
                    )
                    .bind(conv_uuid)
                    .bind(user_id)
                    .fetch_all(&state.db)
                    .await
                    .unwrap_or_default();
                    // Also check group DMs
                    let group_ids: Vec<Uuid> = if other_ids.is_empty() {
                        sqlx::query_scalar(
                            "SELECT user_id FROM group_dm_members WHERE dm_id=$1 AND user_id != $2"
                        )
                        .bind(conv_uuid)
                        .bind(user_id)
                        .fetch_all(&state.db)
                        .await
                        .unwrap_or_default()
                    } else { vec![] };
                    let clients = state.clients.read().await;
                    for uid in other_ids.into_iter().chain(group_ids) {
                        if let Some(tx) = clients.get(&uid) {
                            let _ = tx.send(event_str.clone());
                        }
                    }
                }
            }
        }

        // ────────── Vocal / Vidéo (WebRTC signaling) ──────────
        Some("VOICE_JOIN") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };

            // Vérification user_limit, voice_password et is_auto_create
            let channel_row = sqlx::query(
                "SELECT user_limit, voice_password_hash, is_auto_create, auto_create_name, server_id FROM channels WHERE id=$1"
            )
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);

            // Destination effective (peut changer si canal auto-create)
            let mut effective_channel_id = channel_id;
            let mut user_limit: Option<i32> = None;

            if let Some(ref row) = channel_row {
                use sqlx::Row;
                user_limit = row.get("user_limit");
                let password_hash: Option<String> = row.get("voice_password_hash");
                let is_auto_create: bool = row.get("is_auto_create");
                let auto_create_name: Option<String> = row.get("auto_create_name");
                let server_id_col: Option<Uuid> = row.get("server_id");

                // Vérification mot de passe vocal
                if let Some(ref hash) = password_hash {
                    let provided = msg["password"].as_str().unwrap_or("");
                    let ok = bcrypt::verify(provided, hash).unwrap_or(false);
                    if !ok {
                        let err = serde_json::json!({
                            "type": "VOICE_JOIN_ERROR",
                            "channel_id": channel_id,
                            "reason": "wrong_password",
                        });
                        state.broadcast_to_user(user_id, err.to_string()).await;
                        return;
                    }
                }

                // Canal auto-create : créer un canal temporaire pour cet utilisateur
                if is_auto_create {
                    if let (Some(server_id), Ok(Some(urow))) = (
                        server_id_col,
                        sqlx::query("SELECT username FROM users WHERE id=$1")
                            .bind(user_id)
                            .fetch_optional(&state.db)
                            .await,
                    ) {
                        use sqlx::Row as _;
                        let username: String = urow.get("username");
                        let template = auto_create_name
                            .as_deref()
                            .unwrap_or("{username}'s Channel");
                        let new_name = template.replace("{username}", &username);

                        if let Ok(new_ch) = sqlx::query_as::<_, crate::models::channel::Channel>(
                            "INSERT INTO channels (server_id, name, type, is_temporary, created_by_auto, position)
                             VALUES ($1, $2, 'voice', TRUE, $3,
                               (SELECT COALESCE(MAX(position), 0) + 1 FROM channels WHERE server_id=$1))
                             RETURNING *"
                        )
                        .bind(server_id)
                        .bind(&new_name)
                        .bind(user_id)
                        .fetch_one(&state.db)
                        .await
                        {
                            effective_channel_id = new_ch.id;
                            // Notifier tous les clients du nouveau canal
                            let create_event = serde_json::json!({
                                "type": "CHANNEL_CREATE",
                                "channel": new_ch,
                            });
                            // Broadcast au channel du serveur (abonnés)
                            state.broadcast_to_server_members(server_id, create_event.to_string()).await;
                        }
                    }
                }
            }

            let max_users = user_limit.map(|l| l as usize);
            let Some(existing_ids) = state.voice_join(user_id, effective_channel_id, max_users).await else {
                let err = serde_json::json!({
                    "type": "VOICE_JOIN_ERROR",
                    "channel_id": effective_channel_id,
                    "reason": "channel_full",
                    "limit": user_limit,
                });
                state.broadcast_to_user(user_id, err.to_string()).await;
                return;
            };

            // Construire la liste des pairs existants avec leur état vocal
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
                    let vs = state.voice_states.read().await.get(peer_id).cloned();
                    existing_peers.push(serde_json::json!({
                        "user_id": peer_id,
                        "username": row.get::<String, _>("username"),
                        "avatar": row.get::<Option<String>, _>("avatar"),
                        "discriminator": row.get::<String, _>("discriminator"),
                        "muted": vs.as_ref().map(|v| v.muted).unwrap_or(false),
                        "video": vs.as_ref().map(|v| v.video).unwrap_or(false),
                        "screen": vs.as_ref().map(|v| v.screen).unwrap_or(false),
                    }));
                }
            }

            state.broadcast_to_user(user_id, serde_json::json!({
                "type": "VOICE_EXISTING_PEERS",
                "channel_id": effective_channel_id,
                "peers": existing_peers,
            }).to_string()).await;

            // Récupérer les infos du rejoignant
            if let Ok(Some(row)) = sqlx::query(
                "SELECT username, avatar, discriminator FROM users WHERE id=$1"
            )
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            {
                use sqlx::Row;
                let notif = serde_json::json!({
                    "type": "VOICE_USER_JOINED",
                    "channel_id": effective_channel_id,
                    "user_id": user_id,
                    "username": row.get::<String, _>("username"),
                    "avatar": row.get::<Option<String>, _>("avatar"),
                    "discriminator": row.get::<String, _>("discriminator"),
                });
                // Broadcast global : tous les clients voient le join (sidebar)
                broadcast_to_all(state, user_id, notif.to_string()).await;

                // Si canal temporaire différent du canal cliqué, notifier le client de la redirection
                if effective_channel_id != channel_id {
                    state.broadcast_to_user(user_id, serde_json::json!({
                        "type": "VOICE_REDIRECT",
                        "from_channel_id": channel_id,
                        "channel_id": effective_channel_id,
                    }).to_string()).await;
                }
            }
        }

        Some("VOICE_LEAVE") => {
            cleanup_voice(state, user_id).await;
        }

        Some("VOICE_STATE") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            let muted = msg["muted"].as_bool().unwrap_or(false);
            let deafened = msg["deafened"].as_bool().unwrap_or(false);
            let video = msg["video"].as_bool().unwrap_or(false);
            let screen = msg["screen"].as_bool().unwrap_or(false);

            // Vérifier si l'utilisateur a la permission PRIORITY_SPEAKER
            let server_id_opt = sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT server_id FROM channels WHERE id=$1"
            )
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None)
            .flatten();

            let priority_speaker = if let Some(server_id) = server_id_opt {
                // Vérifier via les rôles du membre
                let perms: Option<i64> = sqlx::query_scalar(
                    "SELECT BIT_OR(r.permissions) FROM roles r
                     JOIN member_roles mr ON mr.role_id = r.id
                     WHERE mr.user_id = $1 AND r.server_id = $2"
                )
                .bind(user_id)
                .bind(server_id)
                .fetch_optional(&state.db)
                .await
                .unwrap_or(None)
                .flatten();

                let combined = perms.unwrap_or(0);
                combined & Permissions::ADMINISTRATOR != 0
                    || combined & Permissions::PRIORITY_SPEAKER != 0
            } else {
                false
            };

            // Récupérer l'ancien état screen pour détecter changements Go Live
            let prev_screen = {
                let states = state.voice_states.read().await;
                states.get(&user_id).map(|s| s.screen).unwrap_or(false)
            };

            state.voice_states.write().await.insert(user_id, VoiceStateData {
                channel_id, muted, deafened, video, screen,
            });

            let event = serde_json::json!({
                "type": "VOICE_STATE_UPDATE",
                "user_id": user_id,
                "channel_id": channel_id,
                "muted": muted,
                "deafened": deafened,
                "video": video,
                "screen": screen,
                "priority_speaker": priority_speaker,
            });
            // Broadcast à toute la room + à tous pour la sidebar
            broadcast_to_all(state, user_id, event.to_string()).await;

            // Go Live : émettre STREAM_START / STREAM_END selon changement d'état screen
            if screen && !prev_screen {
                if let Ok(Some(row)) = sqlx::query("SELECT username FROM users WHERE id=$1")
                    .bind(user_id)
                    .fetch_optional(&state.db)
                    .await
                {
                    use sqlx::Row;
                    let username: String = row.get("username");
                    let stream_event = serde_json::json!({
                        "type": "STREAM_START",
                        "user_id": user_id,
                        "username": username,
                        "channel_id": channel_id,
                    });
                    broadcast_to_all(state, user_id, stream_event.to_string()).await;
                }
            } else if !screen && prev_screen {
                let stream_event = serde_json::json!({
                    "type": "STREAM_END",
                    "user_id": user_id,
                    "channel_id": channel_id,
                });
                broadcast_to_all(state, user_id, stream_event.to_string()).await;
            }
        }

        Some("VOICE_SIGNAL") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            // Vérifier qu'un canal DM existe entre les deux parties (anti-spam WebRTC)
            let authorized: bool = sqlx::query_scalar(
                "SELECT EXISTS(
                    SELECT 1 FROM dm_channels
                    WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)
                )"
            )
            .bind(user_id).bind(to)
            .fetch_one(&state.db).await.unwrap_or(false);
            if !authorized { return; }
            let signal = serde_json::json!({
                "type": "VOICE_SIGNAL",
                "from": user_id,
                "payload": msg["payload"],
            });
            state.broadcast_to_user(to, signal.to_string()).await;
        }

        Some("WHITEBOARD_DRAW") | Some("WHITEBOARD_CLEAR") => {
            if let Some(channel_id) = msg["channel_id"].as_str()
                .and_then(|s| s.parse::<Uuid>().ok())
            {
                let event = serde_json::json!({
                    "type": msg["type"].as_str().unwrap_or("WHITEBOARD_DRAW"),
                    "channel_id": msg["channel_id"],
                    "tool": msg["tool"],
                    "color": msg["color"],
                    "size": msg["size"],
                    "points": msg["points"],
                    "user_id": user_id,
                });
                state.broadcast_to_channel_members(channel_id, event.to_string()).await;
            }
        }

        Some("DM_CALL_INIT") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            // Rate limit : max 3 appels par minute par paire d'utilisateurs
            {
                use redis::AsyncCommands;
                let rate_key = format!("call_rate:{}:{}", user_id, to);
                let mut redis = state.redis.lock().await;
                let count: i64 = redis.incr(&rate_key, 1i64).await.unwrap_or(0);
                if count == 1 {
                    let _: () = redis.expire(&rate_key, 60).await.unwrap_or(());
                }
                if count > 3 { return; }
            }
            // Vérifier que les deux utilisateurs ont un canal DM ouvert (anti-spam)
            let has_dm = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1))"
            )
            .bind(user_id).bind(to)
            .fetch_one(&state.db).await.unwrap_or(false);
            if !has_dm { return; }
            // Vérifier que le destinataire n'a pas bloqué l'appelant
            let is_blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2)"
            ).bind(to).bind(user_id).fetch_one(&state.db).await.unwrap_or(false);
            if is_blocked { return; }
            // Informer l'appelant si le destinataire est hors ligne
            let is_online = state.clients.read().await.contains_key(&to);
            if !is_online {
                let err = serde_json::json!({
                    "type": "DM_CALL_ERROR",
                    "reason": "offline",
                    "dm_id": msg["dm_id"],
                });
                state.broadcast_to_user(user_id, err.to_string()).await;
                return;
            }
            let event = serde_json::json!({
                "type": "DM_CALL_INCOMING",
                "from": user_id,
                "from_username": cached_username,
                "dm_id": msg["dm_id"],
                "call_type": msg["call_type"].as_str().unwrap_or("voice"),
            });
            state.broadcast_to_user(to, event.to_string()).await;
        }

        Some("DM_CALL_ACCEPT") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            let event = serde_json::json!({
                "type": "DM_CALL_ACCEPTED",
                "from": user_id,
                "dm_id": msg["dm_id"],
            });
            state.broadcast_to_user(to, event.to_string()).await;
        }

        Some("DM_CALL_DECLINE") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            let event = serde_json::json!({
                "type": "DM_CALL_DECLINED",
                "from": user_id,
                "dm_id": msg["dm_id"],
            });
            state.broadcast_to_user(to, event.to_string()).await;
        }

        Some("DM_CALL_HANGUP") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            let event = serde_json::json!({
                "type": "DM_CALL_ENDED",
                "from": user_id,
                "dm_id": msg["dm_id"],
            });
            state.broadcast_to_user(to, event.to_string()).await;
        }

        Some("VOICE_REACTION") => {
            if let (Some(channel_id_val), Some(emoji_val)) = (
                msg["channel_id"].as_str(),
                msg["emoji"].as_str(),
            ) {
                if let Ok(cid) = channel_id_val.parse::<Uuid>() {
                    let event = serde_json::json!({
                        "type": "VOICE_REACTION",
                        "channel_id": channel_id_val,
                        "emoji": emoji_val,
                        "user_id": user_id.to_string(),
                    });
                    state.broadcast_to_channel_members(cid, event.to_string()).await;
                }
            }
        }

        _ => {}
    }
}
