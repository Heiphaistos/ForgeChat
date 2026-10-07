//! Badges de succès (lot « Profil et social »), calculés côté serveur à la lecture
//! à partir de compteurs et de faits vérifiables, jamais déclarés par l'appli :
//! ancienneté du compte, messages envoyés (compteur seul, aucun contenu), premier
//! vocal à plusieurs, événements suivis, amis, serveur fondé.
//!
//! Anti-triche simple : un message compte au plus toutes les 3 secondes et 500 fois
//! par jour ; le premier vocal exige quelqu'un d'autre dans l'appel ; un événement ne
//! compte qu'une fois commencé et pas pour son créateur ; « fondateur » exige un
//! serveur d'au moins 3 membres.

use uuid::Uuid;

use crate::state::AppState;

/// Faits mesurés sur un compte.
#[derive(Debug, Default)]
pub struct Facts {
    pub account_days: i64,
    pub messages: i64,
    pub voice: bool,
    pub events: i64,
    pub friends: i64,
    pub founder: bool,
}

/// Plus haut palier atteint d'une échelle (seuils décroissants).
fn tier(value: i64, ladder: &[(i64, &'static str)]) -> Option<&'static str> {
    ladder.iter().find(|(min, _)| value >= *min).map(|(_, id)| *id)
}

/// Identifiants des badges (mêmes clés de traduction côté web et mobile).
pub fn badges(f: &Facts) -> Vec<&'static str> {
    let mut out = Vec::new();
    out.extend(tier(f.account_days, &[(1095, "age_3y"), (730, "age_2y"), (365, "age_1y"), (182, "age_6m"), (30, "age_1m")]));
    out.extend(tier(f.messages, &[(100_000, "msg_100k"), (10_000, "msg_10k"), (1_000, "msg_1k"), (100, "msg_100")]));
    if f.voice {
        out.push("first_voice");
    }
    out.extend(tier(f.events, &[(10, "events_10"), (1, "events_1")]));
    out.extend(tier(f.friends, &[(25, "friends_25"), (1, "friends_1")]));
    if f.founder {
        out.push("founder");
    }
    out
}

/// Faits d'un compte (une requête).
pub async fn facts(state: &AppState, user_id: Uuid) -> Facts {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT (CURRENT_DATE - u.created_at::date)::BIGINT AS days,
                COALESCE(s.messages_sent, 0) AS messages,
                s.first_voice_at IS NOT NULL AS voice,
                (SELECT COUNT(*) FROM event_attendees ea JOIN server_events e ON e.id = ea.event_id
                  WHERE ea.user_id = u.id AND ea.status IN ('going','interested')
                    AND e.start_time < NOW() AND e.creator_id <> u.id) AS events,
                (SELECT COUNT(*) FROM friendships
                  WHERE status='accepted' AND (user_id = u.id OR friend_id = u.id)) AS friends,
                EXISTS(SELECT 1 FROM servers sv WHERE sv.owner_id = u.id
                  AND (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = sv.id) >= 3) AS founder
         FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
         WHERE u.id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();
    row.map(|r| Facts {
        account_days: r.get("days"),
        messages: r.get("messages"),
        voice: r.get("voice"),
        events: r.get("events"),
        friends: r.get("friends"),
        founder: r.get("founder"),
    })
    .unwrap_or_default()
}

/// Un message envoyé (salon, MP, groupe) : compteur seul, limité contre le remplissage.
pub fn count_message(state: &AppState, user_id: Uuid) {
    let state = state.clone();
    tokio::spawn(async move {
        use crate::handlers::websocket::rate_ok;
        if !rate_ok(&state, format!("badge_msg:{user_id}"), 1, 3).await
            || !rate_ok(&state, format!("badge_msg_day:{user_id}"), 500, 86_400).await
        {
            return;
        }
        if let Err(e) = sqlx::query(
            "INSERT INTO user_stats (user_id, messages_sent) VALUES ($1, 1)
             ON CONFLICT (user_id) DO UPDATE SET messages_sent = user_stats.messages_sent + 1",
        )
        .bind(user_id)
        .execute(&state.db)
        .await
        {
            tracing::warn!("compteur de messages : {e}");
        }
    });
}

/// Appel à plusieurs (salon vocal occupé, appel privé décroché, appel de groupe
/// rejoint) : premier vocal de chacun, s'il ne l'avait pas encore.
pub fn voice_together(state: &AppState, users: Vec<Uuid>) {
    if users.len() < 2 {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = sqlx::query(
            "INSERT INTO user_stats (user_id, first_voice_at) SELECT u, NOW() FROM UNNEST($1::uuid[]) u
             ON CONFLICT (user_id) DO UPDATE SET first_voice_at = COALESCE(user_stats.first_voice_at, NOW())",
        )
        .bind(&users)
        .execute(&state.db)
        .await
        {
            tracing::warn!("premier vocal : {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badges_par_palier() {
        assert!(badges(&Facts::default()).is_empty());
        let f = Facts { account_days: 400, messages: 1_500, voice: true, events: 3, friends: 30, founder: true };
        assert_eq!(badges(&f), vec!["age_1y", "msg_1k", "first_voice", "events_1", "friends_25", "founder"]);
        let f = Facts { account_days: 29, messages: 99, ..Default::default() };
        assert!(badges(&f).is_empty());
        let f = Facts { account_days: 30, messages: 100, events: 10, friends: 1, ..Default::default() };
        assert_eq!(badges(&f), vec!["age_1m", "msg_100", "events_10", "friends_1"]);
        let f = Facts { account_days: 5000, messages: 1_000_000, ..Default::default() };
        assert_eq!(badges(&f), vec!["age_3y", "msg_100k"]);
    }
}
