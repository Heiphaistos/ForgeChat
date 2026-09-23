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
         SELECT due.user_id, due.message_id, COALESCE(m.content, dm.content) AS content
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
        let event = serde_json::json!({
            "type": "REMINDER",
            "message_id": r.get::<Uuid, _>("message_id").to_string(),
            "content": r.get::<Option<String>, _>("content"),
        });
        state.broadcast_to_user(r.get::<Uuid, _>("user_id"), event.to_string()).await;
    }
}
