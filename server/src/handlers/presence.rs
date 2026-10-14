//! Présence (audit P1-3).
//!
//! `users.preferred_status` = statut CHOISI (online / idle / dnd / invisible),
//! persisté. `users.status` = statut EN DIRECT vu par les autres, recalculé ici
//! à chaque connexion, déconnexion, changement d'activité ou de choix :
//! hors ligne sans session, « invisible » vu hors ligne, « absent » automatique
//! seulement si toutes les sessions sont inactives.

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::state::AppState;

/// Parmi `ids`, ceux qui voient la présence de `me` et réciproquement : amis
/// acceptés ou membres d'un serveur commun. Les autres (inconnus, visiteurs)
/// ne voient ni statut ni statut personnalisé (recherche, fiche, profil).
pub(crate) async fn related_users(
    db: &sqlx::PgPool,
    me: Uuid,
    ids: &[Uuid],
) -> sqlx::Result<HashSet<Uuid>> {
    Ok(sqlx::query_scalar::<_, Uuid>(
        "SELECT u FROM UNNEST($1::uuid[]) AS u WHERE
            EXISTS(SELECT 1 FROM server_members a JOIN server_members b ON a.server_id=b.server_id
                   WHERE a.user_id=$2 AND b.user_id=u)
         OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted'
                   AND ((f.user_id=$2 AND f.friend_id=u) OR (f.friend_id=$2 AND f.user_id=u)))",
    )
    .bind(ids)
    .bind(me)
    .fetch_all(db)
    .await?
    .into_iter()
    .collect())
}

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
/// dans les listes de membres). Le statut riche (activité, « en appel ») suit
/// les réglages de visibilité de l'utilisateur, destinataire par destinataire.
pub(crate) async fn broadcast_presence(state: &AppState, user_id: Uuid, status: &str) {
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

    // Un utilisateur hors ligne (ou invisible) ne dévoile ni activité ni appel.
    let rich = if status == "offline" {
        RichStatus::default()
    } else {
        load_rich(state, &[user_id]).await.remove(&user_id).unwrap_or_default()
    };
    let friends = friends_of(state, user_id).await;
    let event = |is_self: bool, is_friend: bool| {
        let mut ev = rich.view(is_self, is_friend);
        ev["type"] = "PRESENCE_UPDATE".into();
        ev["user_id"] = serde_json::json!(user_id);
        ev["status"] = status.into();
        ev.to_string()
    };
    let (for_self, for_friends, for_others) = (event(true, true), event(false, true), event(false, false));

    let clients = state.clients.read().await;
    if let Some(tx) = clients.get(&user_id) {
        let _ = tx.send(for_self);
    }
    for uid in relevant {
        if let Some(tx) = clients.get(&uid) {
            let _ = tx.send(if friends.contains(&uid) { for_friends.clone() } else { for_others.clone() });
        }
    }
}

/// Entrée ou sortie d'un appel (salon vocal, appel de groupe, appel privé) :
/// « en appel » change pour ceux qui ont le droit de le voir.
pub(crate) fn call_changed(state: &AppState, users: Vec<Uuid>) {
    let state = state.clone();
    tokio::spawn(async move {
        for uid in users {
            let status: Option<String> = sqlx::query_scalar("SELECT status FROM users WHERE id=$1")
                .bind(uid)
                .fetch_optional(&state.db)
                .await
                .ok()
                .flatten();
            if let Some(status) = status {
                broadcast_presence(&state, uid, &status).await;
            }
        }
    });
}

// ─── Statut riche (lot « Profil et social ») ────────────────────────────────

/// Visibilité d'un élément du statut riche : everyone / friends / nobody.
pub fn shown_to(visibility: &str, is_self: bool, is_friend: bool) -> bool {
    is_self || match visibility {
        "nobody" => false,
        "friends" => is_friend,
        _ => true,
    }
}

/// Activité (jeu détecté par le bureau, musique saisie à la main…) et appel en cours.
#[derive(Default, Clone)]
pub(crate) struct RichStatus {
    pub activity_type: Option<String>,
    pub activity_name: Option<String>,
    pub activity_detail: Option<String>,
    pub in_call: bool,
    pub activity_visibility: String,
    pub call_visibility: String,
}

impl RichStatus {
    /// Champs vus par un destinataire donné (toujours présents, `null` si masqués).
    pub fn view(&self, is_self: bool, is_friend: bool) -> serde_json::Value {
        let act = shown_to(&self.activity_visibility, is_self, is_friend);
        serde_json::json!({
            "activity_type": if act { self.activity_type.clone() } else { None },
            "activity_name": if act { self.activity_name.clone() } else { None },
            "activity_detail": if act { self.activity_detail.clone() } else { None },
            "in_call": self.in_call && shown_to(&self.call_visibility, is_self, is_friend),
        })
    }
}

/// Statut riche de plusieurs utilisateurs (une requête + l'état des appels en mémoire).
pub(crate) async fn load_rich(state: &AppState, ids: &[Uuid]) -> HashMap<Uuid, RichStatus> {
    use sqlx::Row;
    if ids.is_empty() { return HashMap::new(); }
    let calls = in_call_set(state, ids).await;
    sqlx::query(
        "SELECT u.id, u.activity_type, u.activity_name, u.activity_detail,
                COALESCE(us.activity_visibility, 'everyone') AS activity_visibility,
                COALESCE(us.call_visibility, 'friends') AS call_visibility
         FROM users u LEFT JOIN user_settings us ON us.user_id = u.id
         WHERE u.id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|r| {
        let id: Uuid = r.get("id");
        (id, RichStatus {
            activity_type: r.get("activity_type"),
            activity_name: r.get("activity_name"),
            activity_detail: r.get("activity_detail"),
            in_call: calls.contains(&id),
            activity_visibility: r.get("activity_visibility"),
            call_visibility: r.get("call_visibility"),
        })
    })
    .collect()
}

/// Amis acceptés d'un utilisateur.
pub(crate) async fn friends_of(state: &AppState, user_id: Uuid) -> HashSet<Uuid> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END
         FROM friendships WHERE status='accepted' AND (user_id=$1 OR friend_id=$1)",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect()
}

/// Parmi `ids`, ceux qui sont en appel : salon vocal, appel de groupe, ou appel
/// privé décroché dont les deux interlocuteurs sont encore connectés (un appel
/// jamais raccroché proprement ne reste pas « en cours » indéfiniment).
pub(crate) async fn in_call_set(state: &AppState, ids: &[Uuid]) -> HashSet<Uuid> {
    let wanted: HashSet<Uuid> = ids.iter().copied().collect();
    let mut set: HashSet<Uuid> = {
        let voice = state.user_voice.read().await;
        wanted.iter().copied().filter(|u| voice.contains_key(u)).collect()
    };
    for call in state.group_calls.read().await.values() {
        set.extend(call.intersection(&wanted).copied());
    }
    let pairs: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT caller_id, callee_id FROM call_history
         WHERE status='answered' AND ended_at IS NULL AND started_at > NOW() - INTERVAL '6 hours'
           AND (caller_id = ANY($1) OR callee_id = ANY($1))",
    )
    .bind(ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    if !pairs.is_empty() {
        let online = state.clients.read().await;
        for (a, b) in pairs {
            if online.contains_key(&a) && online.contains_key(&b) {
                set.extend([a, b].into_iter().filter(|u| wanted.contains(u)));
            }
        }
    }
    set
}

#[cfg(test)]
mod tests {
    use super::{live_status, shown_to, RichStatus};

    #[test]
    fn le_statut_riche_suit_la_visibilite() {
        assert!(shown_to("everyone", false, false));
        assert!(!shown_to("friends", false, false));
        assert!(shown_to("friends", false, true));
        assert!(!shown_to("nobody", false, true));
        assert!(shown_to("nobody", true, false));
        let r = RichStatus {
            activity_type: Some("listening".into()),
            activity_name: Some("Daft Punk".into()),
            in_call: true,
            activity_visibility: "everyone".into(),
            call_visibility: "friends".into(),
            ..Default::default()
        };
        assert_eq!(r.view(false, false)["activity_name"], "Daft Punk");
        assert_eq!(r.view(false, false)["in_call"], false);
        assert_eq!(r.view(false, true)["in_call"], true);
        let hidden = RichStatus { activity_visibility: "nobody".into(), ..r };
        assert!(hidden.view(false, true)["activity_type"].is_null());
        assert_eq!(hidden.view(true, false)["activity_type"], "listening");
    }

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
