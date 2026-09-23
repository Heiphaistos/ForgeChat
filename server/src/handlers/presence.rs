//! Présence (audit P1-3).
//!
//! `users.preferred_status` = statut CHOISI (online / idle / dnd / invisible),
//! persisté. `users.status` = statut EN DIRECT vu par les autres, recalculé ici
//! à chaque connexion, déconnexion, changement d'activité ou de choix :
//! hors ligne sans session, « invisible » vu hors ligne, « absent » automatique
//! seulement si toutes les sessions sont inactives.

use uuid::Uuid;

use crate::state::AppState;

/// Statuts qu'un utilisateur peut choisir.
pub const CHOOSABLE: [&str; 4] = ["online", "idle", "dnd", "invisible"];

/// Statut vu par les autres.
pub fn live_status(preferred: &str, sessions: usize, idle_sessions: usize) -> &'static str {
    if sessions == 0 {
        return "offline";
    }
    match preferred {
        "invisible" => "offline",
        "dnd" => "dnd",
        "idle" => "idle",
        _ if idle_sessions >= sessions => "idle",
        _ => "online",
    }
}

/// Recalcule le statut en direct et le diffuse s'il a changé.
pub(crate) async fn refresh(state: &AppState, user_id: Uuid) {
    let sessions = state.conn_counts.read().await.get(&user_id).copied().unwrap_or(0);
    let idle = state.idle_sessions.read().await.get(&user_id).map(|s| s.len()).unwrap_or(0);
    let preferred: String = sqlx::query_scalar("SELECT preferred_status FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "online".into());
    let live = live_status(&preferred, sessions, idle);
    let changed = sqlx::query_scalar::<_, Uuid>(
        "UPDATE users SET status=$1 WHERE id=$2 AND status IS DISTINCT FROM $1 RETURNING id",
    )
    .bind(live)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;
    match changed {
        Ok(Some(_)) => broadcast_presence(state, user_id, live).await,
        Ok(None) => {}
        Err(e) => tracing::warn!(user_id = %user_id, "présence non enregistrée : {e}"),
    }
}

/// Une session signale son inactivité (ou son retour).
pub(crate) async fn set_session_idle(state: &AppState, user_id: Uuid, session_id: Uuid, idle: bool) {
    {
        let mut map = state.idle_sessions.write().await;
        let set = map.entry(user_id).or_default();
        if idle { set.insert(session_id); } else { set.remove(&session_id); }
        if set.is_empty() { map.remove(&user_id); }
    }
    refresh(state, user_id).await;
}

/// Session fermée : elle ne compte plus parmi les inactives.
pub(crate) async fn forget_session(state: &AppState, user_id: Uuid, session_id: Uuid) {
    let mut map = state.idle_sessions.write().await;
    if let Some(set) = map.get_mut(&user_id) {
        set.remove(&session_id);
        if set.is_empty() { map.remove(&user_id); }
    }
}

/// Diffuse le statut en direct aux amis et membres de serveurs communs
/// connectés, ainsi qu'aux autres sessions de l'utilisateur (sa propre ligne
/// dans les listes de membres).
pub(crate) async fn broadcast_presence(state: &AppState, user_id: Uuid, status: &str) {
    use sqlx::Row;

    let connected: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
    if connected.is_empty() { return; }

    // Envoyer uniquement aux utilisateurs connectés qui partagent un serveur ou sont amis
    // (privacy + perf : évite O(n) pour chaque connect/disconnect)
    let mut relevant: Vec<Uuid> = sqlx::query_scalar::<_, Uuid>(
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
    relevant.push(user_id);

    // Un utilisateur hors ligne (ou invisible) ne dévoile pas son activité.
    let activity_row = if status == "offline" {
        None
    } else {
        sqlx::query("SELECT activity_type, activity_name, activity_detail FROM users WHERE id=$1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
    };

    let event = serde_json::json!({
        "type": "PRESENCE_UPDATE",
        "user_id": user_id,
        "status": status,
        "activity_type": activity_row.as_ref().and_then(|r| r.get::<Option<String>, _>("activity_type")),
        "activity_name": activity_row.as_ref().and_then(|r| r.get::<Option<String>, _>("activity_name")),
        "activity_detail": activity_row.as_ref().and_then(|r| r.get::<Option<String>, _>("activity_detail")),
    })
    .to_string();

    let clients = state.clients.read().await;
    for uid in relevant {
        if let Some(tx) = clients.get(&uid) {
            let _ = tx.send(event.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::live_status;

    #[test]
    fn le_statut_choisi_survit_et_l_absence_est_agregee() {
        assert_eq!(live_status("dnd", 0, 0), "offline");
        assert_eq!(live_status("dnd", 1, 1), "dnd");
        assert_eq!(live_status("invisible", 2, 0), "offline");
        assert_eq!(live_status("online", 2, 1), "online");
        assert_eq!(live_status("online", 2, 2), "idle");
        assert_eq!(live_status("idle", 1, 0), "idle");
    }
}
