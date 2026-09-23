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
        // Mêmes contrôles que l'API : un jeton révoqué (déconnexion, mot de passe
        // changé) ouvrait encore la WebSocket et recevait tous les DM pendant 24 h.
        let Some(c) = crate::middleware::auth::verify_token(&token, &secret, &issuer) else {
            tracing::warn!("WebSocket: token invalide");
            return;
        };
        let blocked: Option<String> = {
            use redis::AsyncCommands;
            let key = format!("jwtblock:{}", crate::middleware::auth::hash_token(&token));
            let mut redis = state.redis.lock().await;
            redis.get(&key).await.unwrap_or(None)
        };
        if blocked.is_some() || crate::middleware::auth::is_revoked(&state, &c).await {
            tracing::warn!("WebSocket: token révoqué");
            return;
        }
        c.sub
    };

    // N5 — identité de CONNEXION, distincte de l'identité d'utilisateur.
    // Plusieurs onglets partagent le même `user_id` mais ont chacun leur
    // `session_id` : l'état vocal est désormais rattaché à la session.
    let session_id = Uuid::new_v4();

    tracing::info!("WS connecté: {} (session {})", user_id, session_id);

    // Charger le username une fois au connect pour éviter les DB queries dans les TYPING events
    let cached_username: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();

    // Réutiliser le sender existant pour supporter plusieurs onglets/appareils simultanés
    // Les deux verrous sont tenus ENSEMBLE, toujours dans le même ordre (clients
    // puis compteur) que la déconnexion : sinon, pendant un rechargement, la socket
    // qui se ferme pouvait retirer l'émetteur que celle qui s'ouvre venait de
    // récupérer, et ce nouvel onglet ne recevait plus aucun événement.
    let tx = {
        let mut clients = state.clients.write().await;
        let mut counts = state.conn_counts.write().await;
        let tx = clients.entry(user_id).or_insert_with(|| {
            let (tx, _) = broadcast::channel::<String>(512);
            tx
        }).clone();
        *counts.entry(user_id).or_insert(0) += 1;
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

    // N5 — envoyé directement sur CETTE socket (pas via le broadcast partagé
    // entre onglets) : chaque session apprend son propre identifiant et peut
    // ignorer les événements qu'elle a elle-même déclenchés (DM_CALL_TAKEN).
    let _ = sender
        .send(Message::Text(
            serde_json::json!({ "type": "SESSION_INIT", "session_id": session_id }).to_string(),
        ))
        .await;

    let mut rx = tx.subscribe();

    let send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(msg) => {
                    if sender.send(Message::Text(msg)).await.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Buffer overrun: skip missed messages and continue
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
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
                    handle_ws_message(&state_clone, user_id, session_id, &text, &username_clone).await;
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
        let mut clients = state.clients.write().await;
        let mut counts = state.conn_counts.write().await;
        let count = counts.entry(user_id).or_insert(0);
        *count = count.saturating_sub(1);
        let last = *count == 0;
        if last {
            counts.remove(&user_id);
            clients.remove(&user_id);
        }
        last
    };

    // N5 — le vocal se nettoie à la fermeture de CHAQUE session, mais seulement
    // si c'est la session qui détenait le vocal (un 2e onglet fermé n'éjecte
    // plus l'onglet en appel).
    cleanup_voice(&state, user_id, Some(session_id)).await;

    if is_last {
        let _ = sqlx::query("UPDATE users SET status='offline' WHERE id=$1")
            .bind(user_id)
            .execute(&state.db)
            .await;
        broadcast_presence(&state, user_id, "offline").await;
        cleanup_stage(&state, user_id).await;

        // Appels DM encore en sonnerie : l'appelant a disparu sans HANGUP (crash,
        // fermeture d'onglet) → résoudre en 'missed' et prévenir le destinataire
        // tout de suite (sinon son modal attend le timeout 45s). Les appels
        // 'answered' ne sont pas touchés : le média P2P survit à une coupure WS.
        if let Ok(rows) = sqlx::query(
            "UPDATE call_history SET status='missed', ended_at=NOW()
             WHERE caller_id=$1 AND status='ringing'
             RETURNING callee_id, dm_id"
        )
        .bind(user_id)
        .fetch_all(&state.db)
        .await
        {
            use sqlx::Row;
            for row in rows {
                let callee: Uuid = row.get("callee_id");
                let event = serde_json::json!({
                    "type": "DM_CALL_ENDED",
                    "from": user_id,
                    "dm_id": row.get::<Option<Uuid>, _>("dm_id"),
                });
                state.broadcast_to_user(callee, event.to_string()).await;
            }
        }
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

/// Sortie du vocal. `session` = la session WS qui part (`None` = VOICE_LEAVE
/// explicite d'une session dont on vérifie déjà la propriété en amont).
pub(crate) async fn cleanup_voice(state: &AppState, user_id: Uuid, session: Option<Uuid>) {
    // N5 — ne rien faire si ce n'est pas la session qui détient le vocal.
    if let Some(sid) = session {
        let owner = state.voice_sessions.read().await.get(&user_id).copied();
        match owner {
            Some(owner_sid) if owner_sid == sid => {}
            Some(_) => {
                tracing::debug!(
                    user_id = %user_id, session = %sid,
                    "cleanup_voice ignoré : cette session ne détient pas le vocal"
                );
                return;
            }
            None => return,
        }
    }

    if let Some((channel_id, remaining, prev_state)) = state.voice_leave(user_id).await {
        // Le média passe par le SFU : sans cette éjection, un utilisateur sorti
        // (ou exclu) côté ForgeChat resterait audible et visible.
        if let Some(lk) = state.livekit.clone() {
            let http = state.http_client.clone();
            tokio::spawn(async move {
                crate::livekit::remove_participant(&http, &lk, &crate::livekit::room_for_channel(channel_id), &user_id.to_string()).await;
            });
        }
        // S2 — l'utilisateur partageait son écran : le badge LIVE doit tomber
        // chez tout le monde, y compris sur un crash / fermeture d'onglet.
        if prev_state.map(|s| s.screen).unwrap_or(false) {
            state.broadcast_to_channel_members_except(channel_id, None, serde_json::json!({
                "type": "STREAM_END",
                "user_id": user_id,
                "channel_id": channel_id,
            }).to_string()).await;
        }

        // N13 — une main levée ne reste pas levée après le départ de son auteur
        for cid in state.voice_hand_cleanup(user_id).await {
            state.broadcast_to_channel_members(cid, serde_json::json!({
                "type": "HAND_RAISE",
                "channel_id": cid.to_string(),
                "user_id": user_id.to_string(),
                "raised": false,
            }).to_string()).await;
        }

        let event = serde_json::json!({
            "type": "VOICE_USER_LEFT",
            "user_id": user_id,
            "channel_id": channel_id,
        });
        // N10 — ciblé sur les membres du serveur qui voient ce canal, plus
        // l'instance entière.
        state.broadcast_to_channel_members_except(channel_id, Some(user_id), event.to_string()).await;

        // Si canal temporaire et dernier participant → supprimer automatiquement
        if remaining.is_empty() {
            // N1 — fenêtre de grâce : un canal auto-create vient peut-être
            // d'être créé et le VOICE_JOIN de redirection n'est pas encore
            // arrivé. Le supprimer ici détruit le canal avant son premier
            // occupant (symptôme : utilisateur hors de tout canal, micro ouvert).
            // ponytail: si le VOICE_JOIN de redirection n'arrive jamais (client
            // tué pendant la fenêtre), le canal temporaire vide survit jusqu'au
            // prochain leave d'un occupant. Ajouter un balayage périodique des
            // canaux `is_temporary` vides si ça devient visible.
            if state.temp_channel_in_grace(channel_id).await {
                tracing::debug!(
                    channel_id = %channel_id,
                    "Canal temporaire dans sa fenêtre de grâce : suppression différée"
                );
                return;
            }

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
                        "server_id": server_id,
                        "channel_id": channel_id,
                    });
                    state.broadcast_to_server_members(server_id, del_event.to_string()).await;
                }
            }
        }
    }
}

/// Nettoyage Scène — UNIQUEMENT à la vraie déconnexion WS (voir doc de
/// stage_cleanup_user_everywhere). Un simple STAGE_LEAVE_SPEAKER explicite gère
/// déjà le cas "je descends de la scène volontairement" séparément.
async fn cleanup_stage(state: &AppState, user_id: Uuid) {
    for (channel_id, was_speaker, had_hand_raised) in state.stage_cleanup_user_everywhere(user_id).await {
        if was_speaker {
            state.broadcast_to_channel_members(channel_id, serde_json::json!({
                "type": "STAGE_SPEAKER_REMOVE",
                "user_id": user_id,
                "channel_id": channel_id,
            }).to_string()).await;
        }
        if had_hand_raised {
            state.broadcast_to_channel_members(channel_id, serde_json::json!({
                "type": "STAGE_HAND_RAISE",
                "user_id": user_id,
                "raised": false,
                "channel_id": channel_id,
            }).to_string()).await;
        }
    }
}

/// Vérifie qu'un canal DM existe entre deux utilisateurs (autorisation des événements d'appel).
async fn users_share_dm(state: &AppState, a: Uuid, b: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM dm_channels
            WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)
        )"
    )
    .bind(a).bind(b)
    .fetch_one(&state.db).await.unwrap_or(false)
}


/// Durée de sonnerie d'un appel DM (N19) — doit rester égale à la constante
/// client (`call.ts:272-276`).
const DM_RING_TIMEOUT_S: u64 = 45;

/// N5 — un appel décroché/refusé depuis un onglet doit éteindre la modale des
/// AUTRES onglets du même utilisateur. Le broadcast atteint toutes les
/// sessions ; `session_id` permet à celle qui a agi de s'ignorer.
async fn notify_call_taken(
    state: &AppState,
    user_id: Uuid,
    session_id: Uuid,
    dm_id: &serde_json::Value,
    action: &str,
) {
    state.broadcast_to_user(user_id, serde_json::json!({
        "type": "DM_CALL_TAKEN",
        "user_id": user_id,
        "session_id": session_id,
        "dm_id": dm_id,
        "action": action,
    }).to_string()).await;
}

/// N9 — limiteur de débit Redis générique, même motif que `TYPING_START` /
/// `DM_CALL_INIT` : compteur INCR + EXPIRE sur la fenêtre.
/// Retourne `true` si l'action est autorisée.
pub(crate) async fn rate_ok(state: &AppState, key: String, limit: i64, window_s: i64) -> bool {
    use redis::AsyncCommands;
    let mut redis = state.redis.lock().await;
    let count: i64 = redis.incr(&key, 1i64).await.unwrap_or(0);
    if count == 1 {
        let _: () = redis.expire(&key, window_s).await.unwrap_or(());
    }
    // count == 0 => Redis indisponible : on laisse passer plutôt que de couper le vocal.
    count == 0 || count <= limit
}

/// Permissions effectives de `user_id` sur `channel_id`, overrides de canal
/// compris. `None` = pas membre du serveur du canal.
async fn channel_perms(state: &AppState, user_id: Uuid, channel_id: Uuid) -> Option<(Uuid, i64)> {
    state.effective_channel_permissions(user_id, channel_id).await
}

fn has_perm(perms: i64, bit: i64) -> bool {
    perms & Permissions::ADMINISTRATOR != 0 || perms & bit != 0
}

/// Ce bit de permission est-il réellement administré sur ce serveur ?
///
/// ⚠ Les rôles `@everyone` sont créés (`servers.rs:52-65`) avec
/// VIEW_CHANNEL|SEND_MESSAGES|READ_HISTORY|ADD_REACTIONS|ATTACH_FILES —
/// **sans** CONNECT_VOICE, SPEAK_VOICE ni STREAM. Refuser sur cette seule base
/// éjecterait tout le monde du vocal sur tous les serveurs existants.
/// On ne fait donc appliquer le bit que si quelqu'un l'a explicitement posé
/// quelque part : sur un rôle du serveur, ou dans un override de ce canal.
/// Une migration qui ajoute ces bits à `@everyone` rendra ce garde-fou inutile.
async fn perm_is_administered(state: &AppState, server_id: Uuid, channel_id: Uuid, bit: i64) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM roles WHERE server_id=$1 AND (permissions & $3) <> 0
            UNION ALL
            SELECT 1 FROM channel_permissions WHERE channel_id=$2 AND ((allow | deny) & $3) <> 0
        )"
    )
    .bind(server_id)
    .bind(channel_id)
    .bind(bit)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

/// `has_perm` + garde-fou de rétrocompatibilité (voir `perm_is_administered`).
async fn voice_perm_ok(
    state: &AppState, server_id: Uuid, channel_id: Uuid, perms: i64, bit: i64,
) -> bool {
    has_perm(perms, bit) || !perm_is_administered(state, server_id, channel_id, bit).await
}

async fn handle_ws_message(
    state: &AppState,
    user_id: Uuid,
    session_id: Uuid,
    text: &str,
    cached_username: &str,
) {
    let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };

    match msg["type"].as_str() {
        // ────────── Canal texte ──────────
        // SUBSCRIBE_CHANNEL supprimé : chaque appel lançait une tâche qui ne se
        // terminait jamais, sur un canal où rien n'était publié (fuite mémoire).
        // Les événements de salon passent par broadcast_to_channel_members.
        Some("TYPING_START") => {
            if let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
                // Rate limit: 1 TYPING_START par 3s par (user, channel) via Redis
                let rate_key = format!("typing:{}:{}", user_id, channel_id);
                {
                    use redis::AsyncCommands;
                    let mut redis = state.redis.lock().await;
                    let exists: bool = redis.exists(&rate_key).await.unwrap_or(false);
                    if exists { return; }
                    let _: () = redis.set_ex(&rate_key, 1u8, 3).await.unwrap_or(());
                }
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

        // Typing indicator pour les threads (broadcast aux membres du serveur)
        Some("THREAD_TYPING") => {
            let thread_id = msg["thread_id"].as_str().and_then(|s| s.parse::<Uuid>().ok());
            let server_id = msg["server_id"].as_str().and_then(|s| s.parse::<Uuid>().ok());
            if let (Some(tid), Some(sid)) = (thread_id, server_id) {
                let is_member: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)"
                )
                .bind(sid).bind(user_id)
                .fetch_one(&state.db).await.unwrap_or(false);
                if is_member {
                    let event = serde_json::json!({
                        "type": "THREAD_TYPING",
                        "thread_id": tid,
                        "user_id": user_id,
                        "username": cached_username,
                    });
                    state.broadcast_to_server_members(sid, event.to_string()).await;
                }
            }
        }

        // ────────── Vocal / Vidéo (WebRTC signaling) ──────────
        Some("VOICE_JOIN") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                tracing::warn!(user_id = %user_id, "VOICE_JOIN rejeté : channel_id absent ou invalide");
                return;
            };

            // N9 — 10 joins par minute et par utilisateur
            if !rate_ok(state, format!("rl:vjoin:{}", user_id), 10, 60).await {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_JOIN rejeté : rate limit");
                state.broadcast_to_user(user_id, serde_json::json!({
                    "type": "VOICE_JOIN_ERROR",
                    "channel_id": channel_id,
                    "reason": "rate_limited",
                    "current": 0,
                }).to_string()).await;
                return;
            }

            // N8 — appartenance ET permissions de canal (CONNECT_VOICE / SPEAK_VOICE),
            // overrides `channel_permissions` compris.
            let Some((server_id, perms)) = channel_perms(state, user_id, channel_id).await else {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_JOIN rejeté : non membre du serveur");
                return;
            };
            if !voice_perm_ok(state, server_id, channel_id, perms, Permissions::CONNECT_VOICE).await {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_JOIN rejeté : CONNECT_VOICE manquant");
                let current = state.voice_rooms.read().await
                    .get(&channel_id).map(|r| r.len()).unwrap_or(0);
                state.broadcast_to_user(user_id, serde_json::json!({
                    "type": "VOICE_JOIN_ERROR",
                    "channel_id": channel_id,
                    "reason": "missing_permission",
                    "permission": "CONNECT_VOICE",
                    "current": current,
                }).to_string()).await;
                return;
            }
            // Un membre en timeout peut écouter mais pas parler (comme Discord).
            let timed_out = crate::handlers::servers::require_not_timed_out(state, user_id, server_id).await.is_err();
            let can_speak = !timed_out && voice_perm_ok(state, server_id, channel_id, perms, Permissions::SPEAK_VOICE).await;
            let can_stream = !timed_out && voice_perm_ok(state, server_id, channel_id, perms, crate::state::PERM_STREAM).await;
            let listen_only = msg["listen_only"].as_bool().unwrap_or(false);
            let Some(livekit) = state.livekit.clone() else {
                state.broadcast_to_user(user_id, serde_json::json!({
                    "type": "VOICE_JOIN_ERROR",
                    "channel_id": channel_id,
                    "reason": "media_unavailable",
                    "current": 0,
                }).to_string()).await;
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
                        tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_JOIN rejeté : mot de passe vocal incorrect");
                        let current = state.voice_rooms.read().await
                            .get(&channel_id).map(|r| r.len()).unwrap_or(0);
                        let err = serde_json::json!({
                            "type": "VOICE_JOIN_ERROR",
                            "channel_id": channel_id,
                            "reason": "wrong_password",
                            "current": current,
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
                            // N1 — fenêtre de grâce : le client va faire
                            // leave()+join() pour suivre la redirection, la room
                            // sera vide entre les deux. Interdire la suppression
                            // pendant 10 s.
                            state.mark_temp_channel(new_ch.id).await;
                            // Notifier tous les clients du nouveau canal
                            let create_event = serde_json::json!({
                                "type": "CHANNEL_CREATE",
                                "server_id": server_id,
                                "channel": new_ch,
                            });
                            // Broadcast au channel du serveur (abonnés)
                            state.broadcast_to_server_members(server_id, create_event.to_string()).await;
                        }
                    }
                }
            }

            let max_users = user_limit.map(|l| l as usize);
            // Changement de salon sans VOICE_LEAVE : sortir proprement de l'ancien
            // (VOICE_USER_LEFT, fin de LIVE, éjection du SFU, salon temporaire vidé).
            // Avant, l'utilisateur restait affiché dans l'ancien salon.
            let previous = state.user_voice.read().await.get(&user_id).copied();
            if previous.is_some_and(|p| p != effective_channel_id) {
                cleanup_voice(state, user_id, None).await;
            }
            let Some(existing_ids) = state.voice_join(user_id, effective_channel_id, max_users).await else {
                // N16 — le client affiche « Canal plein (current/limit) » : sans
                // `current` il imprimait `undefined`.
                let current = state.voice_rooms.read().await
                    .get(&effective_channel_id).map(|r| r.len()).unwrap_or(0);
                tracing::warn!(user_id = %user_id, channel_id = %effective_channel_id, "VOICE_JOIN rejeté : canal plein");
                let err = serde_json::json!({
                    "type": "VOICE_JOIN_ERROR",
                    "channel_id": effective_channel_id,
                    "reason": "channel_full",
                    "limit": user_limit,
                    "current": current,
                });
                state.broadcast_to_user(user_id, err.to_string()).await;
                return;
            };

            // N5 — cette session détient désormais le vocal pour cet utilisateur.
            state.voice_sessions.write().await.insert(user_id, session_id);

            // N13 — mains levées déjà en l'air dans ce canal
            let hand_raised_ids: Vec<Uuid> = state.voice_hand_raises.read().await
                .get(&effective_channel_id)
                .map(|m| m.keys().copied().collect())
                .unwrap_or_default();

            // Construire la liste des pairs existants avec leur état vocal
            // Nom affiché dans le jeton du SFU (repli sur l'id si la lecture échoue).
            let joiner_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
                .bind(user_id)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| user_id.to_string());

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
                        "deafened": vs.as_ref().map(|v| v.deafened).unwrap_or(false),
                        "video": vs.as_ref().map(|v| v.video).unwrap_or(false),
                        "screen": vs.as_ref().map(|v| v.screen).unwrap_or(false),
                        "recording": vs.as_ref().map(|v| v.recording).unwrap_or(false),
                        "hand_raised": hand_raised_ids.contains(peer_id),
                    }));
                }
            }

            state.broadcast_to_user(user_id, serde_json::json!({
                "type": "VOICE_EXISTING_PEERS",
                "channel_id": effective_channel_id,
                "peers": existing_peers,
                // N13 — mains levées du canal, pour qu'un arrivant les voie
                "hand_raises": state.voice_hand_raises.read().await
                    .get(&effective_channel_id)
                    .map(|m| m.values().cloned().collect::<Vec<_>>())
                    .unwrap_or_default(),
                // N8 — le client sait s'il peut ouvrir son micro
                "can_speak": can_speak,
                // Accès au serveur média, délivré seulement après tous les contrôles ci-dessus.
                "livekit": {
                    "url": livekit.public_url,
                    "room": crate::livekit::room_for_channel(effective_channel_id),
                    "token": crate::livekit::join_token(
                        &livekit,
                        &crate::livekit::room_for_channel(effective_channel_id),
                        &user_id.to_string(),
                        &joiner_name,
                        crate::livekit::Publish {
                            microphone: can_speak && !listen_only,
                            camera: can_speak && !listen_only,
                            screen: can_stream && !listen_only,
                        },
                    ),
                },
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
                // N10 — ciblé sur les membres du serveur qui voient ce canal
                // (la sidebar du serveur concerné en a besoin), plus toute l'instance.
                state.broadcast_to_channel_members_except(
                    effective_channel_id, Some(user_id), notif.to_string(),
                ).await;

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
            cleanup_voice(state, user_id, Some(session_id)).await;
        }

        Some("VOICE_STATE") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                tracing::warn!(user_id = %user_id, "VOICE_STATE rejeté : channel_id absent ou invalide");
                return;
            };
            // N9 — 20 changements d'état par 10 s
            if !rate_ok(state, format!("rl:vstate:{}", user_id), 20, 10).await {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_STATE rejeté : rate limit");
                return;
            }
            let muted = msg["muted"].as_bool().unwrap_or(false);
            let deafened = msg["deafened"].as_bool().unwrap_or(false);
            let video = msg["video"].as_bool().unwrap_or(false);
            let screen = msg["screen"].as_bool().unwrap_or(false);
            let recording = msg["recording"].as_bool().unwrap_or(false);

            // Vérifier que l'utilisateur est dans ce canal vocal.
            // IMPORTANT : lire user_voice (peuplé par voice_join), PAS voice_states —
            // voice_states n'est rempli que par ce handler, donc le premier VOICE_STATE
            // échouerait toujours et aucun VOICE_STATE_UPDATE ne serait jamais broadcasté
            // (mute/caméra/partage d'écran invisibles pour les autres).
            {
                let uv = state.user_voice.read().await;
                let in_channel = uv.get(&user_id)
                    .map(|c| *c == channel_id)
                    .unwrap_or(false);
                if !in_channel {
                    tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_STATE rejeté : utilisateur absent de ce canal vocal");
                    return;
                }
            }

            // Permissions de canal (overrides compris) — sert à PRIORITY_SPEAKER,
            // SPEAK_VOICE (N8) et STREAM (S4).
            let Some((server_id, perms)) = channel_perms(state, user_id, channel_id).await else {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_STATE rejeté : non membre du serveur");
                return;
            };
            let priority_speaker = has_perm(perms, Permissions::PRIORITY_SPEAKER);

            // S4 — le partage d'écran exige la permission STREAM (bit 40).
            if screen && !voice_perm_ok(state, server_id, channel_id, perms, crate::state::PERM_STREAM).await {
                tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_STATE rejeté : STREAM manquant");
                state.broadcast_to_user(user_id, serde_json::json!({
                    "type": "VOICE_STATE_ERROR",
                    "channel_id": channel_id,
                    "reason": "missing_permission",
                    "permission": "STREAM",
                }).to_string()).await;
                return;
            }

            // N8 — sans SPEAK_VOICE l'utilisateur reste muet quoi qu'il envoie.
            let muted = if voice_perm_ok(state, server_id, channel_id, perms, Permissions::SPEAK_VOICE).await { muted } else {
                if !muted {
                    tracing::warn!(user_id = %user_id, channel_id = %channel_id, "VOICE_STATE forcé muet : SPEAK_VOICE manquant");
                    state.broadcast_to_user(user_id, serde_json::json!({
                        "type": "VOICE_STATE_ERROR",
                        "channel_id": channel_id,
                        "reason": "missing_permission",
                        "permission": "SPEAK_VOICE",
                    }).to_string()).await;
                }
                true
            };

            // Récupérer l'ancien état screen pour détecter changements Go Live
            let prev_screen = {
                let states = state.voice_states.read().await;
                states.get(&user_id).map(|s| s.screen).unwrap_or(false)
            };

            state.voice_states.write().await.insert(user_id, VoiceStateData {
                channel_id, muted, deafened, video, screen, recording,
            });
            state.persist_voice_to_redis().await;

            let event = serde_json::json!({
                "type": "VOICE_STATE_UPDATE",
                "user_id": user_id,
                "channel_id": channel_id,
                "muted": muted,
                "deafened": deafened,
                "video": video,
                "screen": screen,
                "recording": recording,
                "priority_speaker": priority_speaker,
            });
            // N10 — ciblé sur les membres du serveur qui voient ce canal
            state.broadcast_to_channel_members_except(channel_id, Some(user_id), event.to_string()).await;

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
                    state.broadcast_to_channel_members_except(channel_id, Some(user_id), stream_event.to_string()).await;
                }
            } else if !screen && prev_screen {
                let stream_event = serde_json::json!({
                    "type": "STREAM_END",
                    "user_id": user_id,
                    "channel_id": channel_id,
                });
                state.broadcast_to_channel_members_except(channel_id, Some(user_id), stream_event.to_string()).await;
            }
        }

        // VOICE_SIGNAL (négociation pair-à-pair) supprimé : tout le média passe par
        // le SFU LiveKit depuis la 3.251.0. Un client antérieur l'envoyant encore
        // tombe dans le cas « type inconnu », sans effet.

        // ────────── Canal Scène (Stage) ──────────
        // État en mémoire (state.stage_speakers / state.stage_hand_raises), même
        // philosophie que voice_rooms — pas de persistance DB, nettoyé par
        // cleanup_voice à la déconnexion/VOICE_LEAVE.
        Some("STAGE_JOIN") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
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

            let speaker_ids: Vec<Uuid> = state.stage_speakers.read().await
                .get(&channel_id).map(|s| s.iter().copied().collect()).unwrap_or_default();

            let mut speakers = Vec::new();
            for sid in &speaker_ids {
                if let Ok(Some(row)) = sqlx::query("SELECT username, avatar FROM users WHERE id=$1")
                    .bind(sid).fetch_optional(&state.db).await
                {
                    use sqlx::Row;
                    speakers.push(serde_json::json!({
                        "user_id": sid,
                        "username": row.get::<String, _>("username"),
                        "avatar": row.get::<Option<String>, _>("avatar"),
                    }));
                }
            }
            let hand_raises: Vec<serde_json::Value> = state.stage_hand_raises.read().await
                .get(&channel_id).map(|m| m.values().cloned().collect()).unwrap_or_default();

            state.broadcast_to_user(user_id, serde_json::json!({
                "type": "STAGE_STATE",
                "channel_id": channel_id,
                "speakers": speakers,
                "hand_raises": hand_raises,
            }).to_string()).await;
        }

        Some("STAGE_HAND_RAISE") | Some("STAGE_REQUEST_SPEAK") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
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

            // "Demander à parler" alimente la même file d'attente modérateur que
            // lever la main — pas de double mécanisme à maintenir côté client.
            let raised = if msg["type"].as_str() == Some("STAGE_REQUEST_SPEAK") {
                true
            } else {
                msg["raised"].as_bool().unwrap_or(false)
            };

            let Ok(Some(urow)) = sqlx::query("SELECT username, avatar FROM users WHERE id=$1")
                .bind(user_id).fetch_optional(&state.db).await else { return; };
            use sqlx::Row;
            let username: String = urow.get("username");
            let avatar: Option<String> = urow.get("avatar");

            let entry = serde_json::json!({
                "type": "STAGE_HAND_RAISE",
                "user_id": user_id,
                "username": username,
                "avatar": avatar,
                "raised": raised,
                "channel_id": channel_id,
            });
            {
                let mut raises = state.stage_hand_raises.write().await;
                let map = raises.entry(channel_id).or_insert_with(std::collections::HashMap::new);
                if raised { map.insert(user_id, entry.clone()); } else { map.remove(&user_id); }
            }

            state.broadcast_to_channel_members(channel_id, entry.to_string()).await;
        }

        Some("STAGE_INVITE_SPEAK") => {
            let (Some(channel_id), Some(target_id)) = (
                msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()),
                msg["target_user_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()),
            ) else { return; };

            let server_id_opt: Option<Uuid> = sqlx::query_scalar(
                "SELECT server_id FROM channels WHERE id=$1"
            ).bind(channel_id).fetch_optional(&state.db).await.unwrap_or(None).flatten();
            let Some(server_id) = server_id_opt else { return; };

            // Modérateur uniquement (MANAGE_CHANNELS) — l'auto-invitation (prendre la
            // parole soi-même) est acceptée, pas de cas particulier nécessaire.
            if crate::handlers::servers::require_permission_and_channel(
                state, user_id, server_id, channel_id, Permissions::MANAGE_CHANNELS,
            ).await.is_err() {
                return;
            }

            let Ok(Some(urow)) = sqlx::query("SELECT username, avatar FROM users WHERE id=$1")
                .bind(target_id).fetch_optional(&state.db).await else { return; };
            use sqlx::Row;
            let username: String = urow.get("username");
            let avatar: Option<String> = urow.get("avatar");

            {
                let mut speakers = state.stage_speakers.write().await;
                speakers.entry(channel_id).or_insert_with(std::collections::HashSet::new).insert(target_id);
            }
            {
                let mut raises = state.stage_hand_raises.write().await;
                if let Some(map) = raises.get_mut(&channel_id) { map.remove(&target_id); }
            }

            state.broadcast_to_channel_members(channel_id, serde_json::json!({
                "type": "STAGE_SPEAKER_ADD",
                "user_id": target_id,
                "username": username,
                "avatar": avatar,
                "channel_id": channel_id,
            }).to_string()).await;
            state.broadcast_to_channel_members(channel_id, serde_json::json!({
                "type": "STAGE_HAND_RAISE",
                "user_id": target_id,
                "raised": false,
                "channel_id": channel_id,
            }).to_string()).await;
        }

        Some("STAGE_LEAVE_SPEAKER") => {
            let Some(channel_id) = msg["channel_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            let target_id = msg["target_user_id"].as_str()
                .and_then(|s| s.parse::<Uuid>().ok())
                .unwrap_or(user_id);

            // Self-service pour redescendre soi-même ; MANAGE_CHANNELS requis pour
            // rétrograder quelqu'un d'autre.
            if target_id != user_id {
                let server_id_opt: Option<Uuid> = sqlx::query_scalar(
                    "SELECT server_id FROM channels WHERE id=$1"
                ).bind(channel_id).fetch_optional(&state.db).await.unwrap_or(None).flatten();
                let Some(server_id) = server_id_opt else { return; };
                if crate::handlers::servers::require_permission_and_channel(
                    state, user_id, server_id, channel_id, Permissions::MANAGE_CHANNELS,
                ).await.is_err() {
                    return;
                }
            }

            let removed = {
                let mut speakers = state.stage_speakers.write().await;
                speakers.get_mut(&channel_id).map(|s| s.remove(&target_id)).unwrap_or(false)
            };
            if removed {
                state.broadcast_to_channel_members(channel_id, serde_json::json!({
                    "type": "STAGE_SPEAKER_REMOVE",
                    "user_id": target_id,
                    "channel_id": channel_id,
                }).to_string()).await;
            }
        }

        Some("WHITEBOARD_DRAW") | Some("WHITEBOARD_CLEAR") => {
            if let Some(channel_id) = msg["channel_id"].as_str()
                .and_then(|s| s.parse::<Uuid>().ok())
            {
                // N9 — flux de dessin : très généreux (300 traits par 10 s),
                // juste de quoi empêcher un client malveillant de noyer le canal.
                if !rate_ok(state, format!("rl:wb:{}", user_id), 300, 10).await {
                    tracing::warn!(user_id = %user_id, channel_id = %channel_id, "WHITEBOARD rejeté : rate limit");
                    return;
                }
                let is_member: bool = sqlx::query_scalar(
                    "SELECT EXISTS(
                        SELECT 1 FROM channels c
                        JOIN server_members sm ON sm.server_id = c.server_id
                        WHERE c.id = $1 AND sm.user_id = $2
                    )"
                ).bind(channel_id).bind(user_id).fetch_one(&state.db).await.unwrap_or(false);
                if !is_member { return; }
                // Tableau blanc des salons vocaux uniquement, salon visible, trait borné :
                // un client pouvait relayer 64 Ko x 300 fois par 10 s vers tout un salon.
                if state.hidden_channels(user_id, None, Some(channel_id)).await.map(|h| h.contains(&channel_id)).unwrap_or(true) {
                    return;
                }
                let is_voice: bool = sqlx::query_scalar(
                    "SELECT type IN ('voice', 'video', 'stage') FROM channels WHERE id=$1"
                ).bind(channel_id).fetch_optional(&state.db).await.ok().flatten().unwrap_or(false);
                if !is_voice || msg["points"].as_array().is_some_and(|p| p.len() > 2000) {
                    return;
                }
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

        Some("GROUP_CALL_JOIN") => {
            crate::handlers::group_calls::join(state, user_id, session_id, cached_username, &msg).await;
        }

        Some("GROUP_CALL_LEAVE") => {
            if let Some(group_id) = msg["group_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) {
                crate::handlers::group_calls::leave(state, group_id, user_id).await;
            }
        }

        Some("DM_CALL_INIT") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            // Rate limit : max 5 appels par minute par paire d'utilisateurs.
            // IMPORTANT : répondre DM_CALL_ERROR, jamais un drop muet — l'appelant
            // sonnerait dans le vide sans aucun feedback (flaky E2E du 2026-07-14).
            {
                use redis::AsyncCommands;
                let rate_key = format!("call_rate:{}:{}", user_id, to);
                let mut redis = state.redis.lock().await;
                let count: i64 = redis.incr(&rate_key, 1i64).await.unwrap_or(0);
                if count == 1 {
                    let _: () = redis.expire(&rate_key, 60).await.unwrap_or(());
                }
                if count > 5 {
                    let err = serde_json::json!({
                        "type": "DM_CALL_ERROR",
                        "reason": "rate_limited",
                        "dm_id": msg["dm_id"],
                    });
                    state.broadcast_to_user(user_id, err.to_string()).await;
                    return;
                }
            }
            // Vérifier que les deux utilisateurs ont un canal DM ouvert (anti-spam)
            if !users_share_dm(state, user_id, to).await { return; }
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
            // Historique d'appels : nouvelle entrée en sonnerie
            let dm_uuid = msg["dm_id"].as_str().and_then(|s| s.parse::<Uuid>().ok());
            let call_type = msg["call_type"].as_str().unwrap_or("voice");
            let _ = sqlx::query(
                "INSERT INTO call_history (caller_id, callee_id, dm_id, call_type, status)
                 VALUES ($1, $2, $3, $4, 'ringing')"
            )
            .bind(user_id).bind(to).bind(dm_uuid)
            .bind(if call_type == "video" { "video" } else { "voice" })
            .execute(&state.db).await;

            let event = serde_json::json!({
                "type": "DM_CALL_INCOMING",
                "from": user_id,
                "from_username": cached_username,
                "dm_id": msg["dm_id"],
                "call_type": call_type,
                // N19 — le client n'a plus à coder sa propre durée de sonnerie
                "ring_timeout_ms": DM_RING_TIMEOUT_S * 1000,
            });
            state.broadcast_to_user(to, event.to_string()).await;

            // N19 — expiration côté serveur alignée sur le client (45 s) : sans
            // elle, un appel non décroché restait 'ringing' en base indéfiniment
            // et seul le client décidait de l'abandon.
            let expiry_state = state.clone();
            let dm_val = msg["dm_id"].clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(DM_RING_TIMEOUT_S)).await;
                let expired = sqlx::query(
                    "UPDATE call_history SET status='missed', ended_at=NOW()
                     WHERE id = (SELECT id FROM call_history
                                 WHERE caller_id=$1 AND callee_id=$2 AND status='ringing'
                                 ORDER BY started_at DESC LIMIT 1)
                     RETURNING id"
                )
                .bind(user_id).bind(to)
                .fetch_optional(&expiry_state.db).await;
                if matches!(expired, Ok(Some(_))) {
                    let ended = serde_json::json!({
                        "type": "DM_CALL_ENDED",
                        "from": user_id,
                        "dm_id": dm_val,
                        "reason": "timeout",
                    }).to_string();
                    expiry_state.broadcast_to_user(to, ended.clone()).await;
                    expiry_state.broadcast_to_user(user_id, ended).await;
                }
            });
        }

        Some("DM_CALL_ACCEPT") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            if !users_share_dm(state, user_id, to).await { return; }
            // Historique : appel décroché — started_at repart pour mesurer le temps de parole
            let _ = sqlx::query(
                "UPDATE call_history SET status='answered', started_at=NOW()
                 WHERE id = (SELECT id FROM call_history
                             WHERE caller_id=$1 AND callee_id=$2 AND status='ringing'
                             ORDER BY started_at DESC LIMIT 1)"
            )
            .bind(to).bind(user_id)
            .execute(&state.db).await;
            // Accès au SFU pour les deux interlocuteurs, délivré seulement après
            // la vérification de la conversation privée commune ci-dessus.
            let room = crate::livekit::room_for_dm(user_id, to);
            let media = |uid: Uuid, name: &str| state.livekit.as_ref().map(|lk| serde_json::json!({
                "url": lk.public_url,
                "room": room,
                "token": crate::livekit::join_token(lk, &room, &uid.to_string(), name,
                    crate::livekit::Publish { microphone: true, camera: true, screen: true }),
            }));
            let caller_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
                .bind(to).fetch_optional(&state.db).await.ok().flatten()
                .unwrap_or_else(|| to.to_string());
            let event = serde_json::json!({
                "type": "DM_CALL_ACCEPTED",
                "from": user_id,
                "dm_id": msg["dm_id"],
                "livekit": media(to, &caller_name),
            });
            state.broadcast_to_user(to, event.to_string()).await;
            // Seule la session qui a décroché se connecte (les autres onglets
            // reçoivent aussi DM_CALL_TAKEN et ferment leur sonnerie).
            state.broadcast_to_user(user_id, serde_json::json!({
                "type": "DM_CALL_MEDIA",
                "dm_id": msg["dm_id"],
                "session_id": session_id,
                "livekit": media(user_id, &cached_username),
            }).to_string()).await;
            notify_call_taken(state, user_id, session_id, &msg["dm_id"], "accepted").await;
        }

        Some("DM_CALL_DECLINE") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            if !users_share_dm(state, user_id, to).await { return; }
            // Historique : appel refusé
            let _ = sqlx::query(
                "UPDATE call_history SET status='declined', ended_at=NOW()
                 WHERE id = (SELECT id FROM call_history
                             WHERE caller_id=$1 AND callee_id=$2 AND status='ringing'
                             ORDER BY started_at DESC LIMIT 1)"
            )
            .bind(to).bind(user_id)
            .execute(&state.db).await;
            let event = serde_json::json!({
                "type": "DM_CALL_DECLINED",
                "from": user_id,
                "dm_id": msg["dm_id"],
            });
            state.broadcast_to_user(to, event.to_string()).await;
            notify_call_taken(state, user_id, session_id, &msg["dm_id"], "declined").await;
        }

        Some("DM_CALL_HANGUP") => {
            let Some(to) = msg["to"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else {
                return;
            };
            if !users_share_dm(state, user_id, to).await { return; }
            // Historique : raccrochage — sonnerie sans réponse => missed,
            // conversation en cours => ended + durée de parole
            let _ = sqlx::query(
                "UPDATE call_history SET
                    ended_at = NOW(),
                    duration_s = CASE WHEN status='answered'
                        THEN EXTRACT(EPOCH FROM (NOW() - started_at))::INT ELSE NULL END,
                    status = CASE WHEN status='answered' THEN 'ended' ELSE 'missed' END
                 WHERE id = (SELECT id FROM call_history
                             WHERE ((caller_id=$1 AND callee_id=$2) OR (caller_id=$2 AND callee_id=$1))
                               AND status IN ('ringing','answered')
                             ORDER BY started_at DESC LIMIT 1)"
            )
            .bind(user_id).bind(to)
            .execute(&state.db).await;
            let event = serde_json::json!({
                "type": "DM_CALL_ENDED",
                "from": user_id,
                "dm_id": msg["dm_id"],
            });
            state.broadcast_to_user(to, event.to_string()).await;
            // Fin d'appel : les deux quittent le SFU, même si un client ne le fait pas.
            if let Some(lk) = state.livekit.clone() {
                let http = state.http_client.clone();
                let room = crate::livekit::room_for_dm(user_id, to);
                tokio::spawn(async move {
                    for uid in [user_id, to] {
                        crate::livekit::remove_participant(&http, &lk, &room, &uid.to_string()).await;
                    }
                });
            }
        }

        Some("VOICE_REACTION") => {
            if let (Some(channel_id_val), Some(emoji_val)) = (
                msg["channel_id"].as_str(),
                msg["emoji"].as_str(),
            ) {
                if let Ok(cid) = channel_id_val.parse::<Uuid>() {
                    // N9 — 20 réactions par minute
                    if !rate_ok(state, format!("rl:vreact:{}", user_id), 20, 60).await {
                        tracing::warn!(user_id = %user_id, channel_id = %cid, "VOICE_REACTION rejeté : rate limit");
                        return;
                    }
                    let is_member: bool = sqlx::query_scalar(
                        "SELECT EXISTS(
                            SELECT 1 FROM channels c
                            JOIN server_members sm ON sm.server_id = c.server_id
                            WHERE c.id = $1 AND sm.user_id = $2
                        )"
                    ).bind(cid).bind(user_id).fetch_one(&state.db).await.unwrap_or(false);
                    if !is_member {
                        tracing::warn!(user_id = %user_id, channel_id = %cid, "VOICE_REACTION rejeté : non membre du serveur");
                        return;
                    }
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

        // Main levée en vocal -- envoyé par le client depuis toujours, mais jamais
        // géré ici : silencieusement dropé par le `_ => {}` du bas, donc invisible
        // pour tous les autres participants (seul l'auteur voyait sa propre main
        // levée via son état local optimiste).
        Some("HAND_RAISE") => {
            if let (Some(channel_id_val), Some(raised)) = (
                msg["channel_id"].as_str(),
                msg["raised"].as_bool(),
            ) {
                if let Ok(cid) = channel_id_val.parse::<Uuid>() {
                    // N9 — 10 mains levées par minute
                    if !rate_ok(state, format!("rl:hand:{}", user_id), 10, 60).await {
                        tracing::warn!(user_id = %user_id, channel_id = %cid, "HAND_RAISE rejeté : rate limit");
                        return;
                    }
                    let is_member: bool = sqlx::query_scalar(
                        "SELECT EXISTS(
                            SELECT 1 FROM channels c
                            JOIN server_members sm ON sm.server_id = c.server_id
                            WHERE c.id = $1 AND sm.user_id = $2
                        )"
                    ).bind(cid).bind(user_id).fetch_one(&state.db).await.unwrap_or(false);
                    if !is_member {
                        tracing::warn!(user_id = %user_id, channel_id = %cid, "HAND_RAISE rejeté : non membre du serveur");
                        return;
                    }
                    // N13 — état serveur, même motif que `stage_hand_raises` :
                    // un arrivant voit les mains déjà levées et elles retombent
                    // au départ de leur auteur.
                    {
                        let mut raises = state.voice_hand_raises.write().await;
                        if raised {
                            let avatar: Option<String> = sqlx::query_scalar(
                                "SELECT avatar FROM users WHERE id=$1"
                            ).bind(user_id).fetch_optional(&state.db).await.unwrap_or(None).flatten();
                            raises.entry(cid).or_default().insert(user_id, serde_json::json!({
                                "user_id": user_id.to_string(),
                                "username": cached_username,
                                "avatar": avatar,
                            }));
                        } else if let Some(m) = raises.get_mut(&cid) {
                            m.remove(&user_id);
                        }
                        raises.retain(|_, m| !m.is_empty());
                    }
                    let event = serde_json::json!({
                        "type": "HAND_RAISE",
                        "channel_id": channel_id_val,
                        "user_id": user_id.to_string(),
                        "username": cached_username,
                        "raised": raised,
                    });
                    state.broadcast_to_channel_members(cid, event.to_string()).await;
                }
            }
        }

        // Lecture soundboard en vocal -- même piège que HAND_RAISE : jamais géré
        // côté serveur, donc un son ne se jouait que pour la personne qui cliquait.
        Some("SOUNDBOARD_PLAY") => {
            if let (Some(channel_id_val), Some(sound_id_val)) = (
                msg["channel_id"].as_str(),
                msg["sound_id"].as_str(),
            ) {
                if let Ok(cid) = channel_id_val.parse::<Uuid>() {
                    // N9 — 5 sons par minute
                    if !rate_ok(state, format!("rl:sound:{}", user_id), 5, 60).await {
                        tracing::warn!(user_id = %user_id, channel_id = %cid, "SOUNDBOARD_PLAY rejeté : rate limit");
                        return;
                    }
                    let is_member: bool = sqlx::query_scalar(
                        "SELECT EXISTS(
                            SELECT 1 FROM channels c
                            JOIN server_members sm ON sm.server_id = c.server_id
                            WHERE c.id = $1 AND sm.user_id = $2
                        )"
                    ).bind(cid).bind(user_id).fetch_one(&state.db).await.unwrap_or(false);
                    if !is_member {
                        tracing::warn!(user_id = %user_id, channel_id = %cid, "SOUNDBOARD_PLAY rejeté : non membre du serveur");
                        return;
                    }
                    let event = serde_json::json!({
                        "type": "SOUNDBOARD_PLAY",
                        "channel_id": channel_id_val,
                        "sound_id": sound_id_val,
                        "user_id": user_id.to_string(),
                    });
                    state.broadcast_to_channel_members(cid, event.to_string()).await;
                }
            }
        }

        _ => {}
    }
}
