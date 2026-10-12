//! Livraison des rappels de messages (audit P1-8).
//!
//! Un rappel n'est marqué envoyé que s'il part vers une session WebSocket
//! ouverte. Hors ligne, il attend : la reconnexion le livre aussitôt.

use uuid::Uuid;

use crate::state::AppState;

/// Livre les rappels échus des utilisateurs connectés (tous, ou un seul).
/// Le rappel est réservé (`sent = TRUE`) dans la même requête qui le lit :
/// la boucle périodique et une reconnexion simultanée ne l'envoient pas deux fois.
pub(crate) async fn deliver_due(state: &AppState, only: Option<Uuid>) {
    let targets: Vec<Uuid> = match only {
        Some(uid) => vec![uid],
        None => state.clients.read().await.keys().copied().collect(),
    };
    if targets.is_empty() {
        return;
    }
    // LEFT JOIN des deux tables possibles : `message_id` désigne un message de
    // salon OU de conversation privée (cf. set_reminder).
    let due = sqlx::query(
        "WITH due AS (
             UPDATE message_reminders SET sent = TRUE
             WHERE id IN (
                 SELECT id FROM message_reminders
                 WHERE remind_at <= NOW() AND sent = FALSE AND user_id = ANY($1)
                 ORDER BY remind_at
                 LIMIT 50
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING user_id, message_id
         )
         SELECT due.user_id, due.message_id, m.channel_id, COALESCE(m.content, dm.content) AS content
         FROM due
         LEFT JOIN messages m ON m.id = due.message_id
         LEFT JOIN dm_messages dm ON dm.id = due.message_id",
    )
    .bind(&targets)
    .fetch_all(&state.db)
    .await;
    let rows = match due {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("Rappels : lecture impossible : {e}");
            return;
        }
    };
    for r in rows {
        use sqlx::Row;
        let user: Uuid = r.get("user_id");
        // Salon devenu invisible depuis la pose du rappel : rappel sans le texte.
        let mut content: Option<String> = r.get("content");
        if let Some(cid) = r.get::<Option<Uuid>, _>("channel_id") {
            if state.hidden_channels(user, None, Some(cid)).await.map(|h| h.contains(&cid)).unwrap_or(true) {
                content = None;
            }
        }
        let event = serde_json::json!({
            "type": "REMINDER",
            "message_id": r.get::<Uuid, _>("message_id").to_string(),
            "content": content,
        });
        state.broadcast_to_user(r.get::<Uuid, _>("user_id"), event.to_string()).await;
    }
}

/// Rappels échus d'utilisateurs HORS LIGNE qui ont un téléphone ou un navigateur abonné aux
/// notifications (amélioration n° 47) : envoyés en notification, sans le texte (messages chiffrés),
/// avec un lien vers le message. Sans abonnement, ils attendent la reconnexion comme avant.
pub(crate) async fn push_offline_due(state: &AppState) {
    if state.push.is_none() && state.mobile_push.is_none() {
        return;
    }
    let online: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
    let rows: Vec<(Uuid, Uuid, Option<Uuid>, Option<Uuid>, Option<Uuid>)> = match sqlx::query_as(
        "WITH due AS (
             UPDATE message_reminders SET sent = TRUE
             WHERE id IN (
                 SELECT r.id FROM message_reminders r
                 WHERE r.remind_at <= NOW() AND r.sent = FALSE AND NOT (r.user_id = ANY($1))
                   AND (EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = r.user_id)
                        OR EXISTS (SELECT 1 FROM push_devices pd WHERE pd.user_id = r.user_id))
                 ORDER BY r.remind_at
                 LIMIT 50
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING user_id, message_id
         )
         SELECT due.user_id, due.message_id, m.channel_id, c.server_id, dm.dm_channel_id
         FROM due
         LEFT JOIN messages m ON m.id = due.message_id
         LEFT JOIN channels c ON c.id = m.channel_id
         LEFT JOIN dm_messages dm ON dm.id = due.message_id",
    )
    .bind(&online)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("Rappels hors ligne : lecture impossible : {e}");
            return;
        }
    };
    for (user, message, channel, server, dm) in rows {
        use crate::mobile_push::{Notice, Target};
        let (url, target) = match (server, channel, dm) {
            (Some(s), Some(c), _) => (format!("/servers/{s}/channels/{c}?highlight={message}"), Target::Channel { server_id: s, channel_id: c }),
            (_, _, Some(d)) => (format!("/dms/{d}?highlight={message}"), Target::Dm(d)),
            _ => continue, // message supprimé depuis
        };
        let body = "Tu as demandé un rappel pour ce message.";
        crate::push::spawn_send_if_offline(state, vec![user], serde_json::json!({
            "title": "Rappel", "body": body, "url": url, "tag": format!("reminder-{message}"),
        }));
        crate::mobile_push::spawn_send(state, vec![user], Notice::new("Rappel", body, body, target).with_message(message));
    }
}

/// GET /api/reminders : rappels à venir (sans le texte : il peut être chiffré, l'appli l'ouvre).
pub async fn list(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> crate::error::Result<axum::Json<serde_json::Value>> {
    let rows: Vec<(Uuid, Uuid, chrono::DateTime<chrono::Utc>, Option<Uuid>, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT r.id, r.message_id, r.remind_at, m.channel_id, c.server_id, dm.dm_channel_id
         FROM message_reminders r
         LEFT JOIN messages m ON m.id = r.message_id
         LEFT JOIN channels c ON c.id = m.channel_id
         LEFT JOIN dm_messages dm ON dm.id = r.message_id
         WHERE r.user_id = $1 AND r.sent = FALSE
         ORDER BY r.remind_at
         LIMIT 200",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(axum::Json(serde_json::json!(rows
        .into_iter()
        .map(|(id, message_id, remind_at, channel_id, server_id, dm_id)| serde_json::json!({
            "id": id, "message_id": message_id, "remind_at": remind_at,
            "channel_id": channel_id, "server_id": server_id, "dm_id": dm_id,
        }))
        .collect::<Vec<_>>())))
}

/// DELETE /api/reminders/:id
pub async fn cancel(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> crate::error::Result<axum::Json<serde_json::Value>> {
    let n = sqlx::query("DELETE FROM message_reminders WHERE id = $1 AND user_id = $2 AND sent = FALSE")
        .bind(id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(crate::error::AppError::NotFound("Rappel introuvable".into()));
    }
    Ok(axum::Json(serde_json::json!({ "ok": true })))
}
