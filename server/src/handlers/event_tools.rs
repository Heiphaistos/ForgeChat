//! Événements de serveur : récurrence, rappels et export calendrier (.ics).

use axum::{
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    Extension,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub const RECURRENCES: &[&str] = &["none", "daily", "weekly", "monthly"];

pub fn validate(recurrence: Option<&str>, reminder_minutes: Option<i32>) -> Result<()> {
    if recurrence.is_some_and(|r| !RECURRENCES.contains(&r)) {
        return Err(AppError::BadRequest("Récurrence invalide (none, daily, weekly, monthly)".into()));
    }
    if reminder_minutes.is_some_and(|m| !(1..=10_080).contains(&m)) {
        return Err(AppError::BadRequest("Rappel : 1 minute à 7 jours".into()));
    }
    Ok(())
}

/// Champs libres d'un événement (création ET modification : la modification n'avait aucune borne).
/// `image_url` : chemin d'envoi du serveur ou https, jamais `javascript:`/`data:` ni une chaîne géante.
pub fn validate_fields(name: Option<&str>, description: Option<&str>, image_url: Option<&str>, max_attendees: Option<i64>) -> Result<()> {
    let bad = |m: &str| Err(AppError::BadRequest(m.into()));
    if name.is_some_and(|n| n.trim().is_empty() || n.chars().count() > 100) || description.is_some_and(|d| d.chars().count() > 2000) {
        return bad("Nom (1-100) ou description (2000) invalide");
    }
    if image_url.is_some_and(|u| !u.is_empty() && (u.len() > 500 || !(u.starts_with("/uploads/") || u.starts_with("https://")))) {
        return bad("Image invalide");
    }
    if max_attendees.is_some_and(|n| !(1..=100_000).contains(&n)) {
        return bad("Nombre de places invalide");
    }
    Ok(())
}

// ─── Export calendrier (RFC 5545) ────────────────────────────────────────────

pub struct IcsEvent {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub start: DateTime<Utc>,
    pub end: Option<DateTime<Utc>>,
    pub recurrence: String,
    pub reminder_minutes: Option<i32>,
}

fn ics_text(s: &str) -> String {
    s.chars().filter(|c| *c == '\n' || !c.is_control()).collect::<String>()
        .replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n")
}

/// Plie une ligne à 75 octets (sans couper un caractère UTF-8), suite précédée d'un espace.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut len = 0;
    for c in line.chars() {
        if len + c.len_utf8() > 75 {
            out.push_str("\r\n ");
            len = 1;
        }
        out.push(c);
        len += c.len_utf8();
    }
    out.push_str("\r\n");
    out
}

fn ics_date(d: &DateTime<Utc>) -> String {
    d.format("%Y%m%dT%H%M%SZ").to_string()
}

pub fn build_ics(calendar_name: &str, events: &[IcsEvent], now: DateTime<Utc>) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".into(),
        "PRODID:-//ForgeChat//Evenements//FR".into(),
        "CALSCALE:GREGORIAN".into(),
        format!("X-WR-CALNAME:{}", ics_text(calendar_name)),
    ];
    for e in events {
        lines.push("BEGIN:VEVENT".into());
        lines.push(format!("UID:{}@forgechat", e.id));
        lines.push(format!("DTSTAMP:{}", ics_date(&now)));
        lines.push(format!("DTSTART:{}", ics_date(&e.start)));
        lines.push(format!("DTEND:{}", ics_date(&e.end.unwrap_or(e.start + chrono::Duration::hours(1)))));
        lines.push(format!("SUMMARY:{}", ics_text(&e.name)));
        if let Some(d) = e.description.as_deref().filter(|d| !d.is_empty()) {
            lines.push(format!("DESCRIPTION:{}", ics_text(d)));
        }
        match e.recurrence.as_str() {
            "daily" => lines.push("RRULE:FREQ=DAILY".into()),
            "weekly" => lines.push("RRULE:FREQ=WEEKLY".into()),
            "monthly" => lines.push("RRULE:FREQ=MONTHLY".into()),
            _ => {}
        }
        if let Some(m) = e.reminder_minutes {
            lines.extend([
                "BEGIN:VALARM".to_string(),
                "ACTION:DISPLAY".into(),
                format!("DESCRIPTION:{}", ics_text(&e.name)),
                format!("TRIGGER:-PT{m}M"),
                "END:VALARM".into(),
            ]);
        }
        lines.push("END:VEVENT".into());
    }
    lines.push("END:VCALENDAR".into());
    lines.iter().map(|l| fold(l)).collect()
}

async fn load_ics(state: &AppState, server_id: Uuid, event_id: Option<Uuid>) -> Result<Vec<IcsEvent>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, name, description, start_time, end_time, recurrence, reminder_minutes
         FROM server_events
         WHERE server_id=$1 AND ($2::UUID IS NULL OR id=$2)
           AND ($2::UUID IS NOT NULL OR recurrence <> 'none' OR COALESCE(end_time, start_time) > NOW() - INTERVAL '30 days')
         ORDER BY start_time LIMIT 500"
    )
    .bind(server_id)
    .bind(event_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows.iter().map(|r| IcsEvent {
        id: r.get("id"),
        name: r.get("name"),
        description: r.get("description"),
        start: r.get("start_time"),
        end: r.get("end_time"),
        recurrence: r.get("recurrence"),
        reminder_minutes: r.get("reminder_minutes"),
    }).collect())
}

fn ics_response(body: String, filename: &str) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        body,
    )
}

/// GET /servers/:id/events.ics — tous les événements à venir (et récurrents) du serveur.
pub async fn server_ics(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<impl IntoResponse> {
    crate::handlers::servers::require_member(&state, claims.sub, server_id).await?;
    let name: String = sqlx::query_scalar("SELECT name FROM servers WHERE id=$1")
        .bind(server_id).fetch_one(&state.db).await?;
    let events = load_ics(&state, server_id, None).await?;
    Ok(ics_response(build_ics(&name, &events, Utc::now()), "evenements.ics"))
}

/// GET /servers/:server_id/events/:event_id/ics — « ajouter à mon agenda ».
pub async fn event_ics(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, event_id)): Path<(Uuid, Uuid)>,
) -> Result<impl IntoResponse> {
    crate::handlers::servers::require_member(&state, claims.sub, server_id).await?;
    let events = load_ics(&state, server_id, Some(event_id)).await?;
    let Some(first) = events.first() else {
        return Err(AppError::NotFound("Événement introuvable".into()));
    };
    Ok(ics_response(build_ics(&first.name, &events, Utc::now()), "evenement.ics"))
}

// ─── Tâche périodique : report des récurrences et rappels ───────────────────

pub async fn tick(state: &AppState) {
    // Occurrence terminée d'un événement récurrent : reportée à la suivante (au plus
    // 400 pas d'un coup : un événement quotidien oublié depuis un an rattrape vite).
    let mut rolled: Vec<(Uuid, Uuid)> = Vec::new();
    for _ in 0..400 {
        let rows: Vec<(Uuid, Uuid)> = match sqlx::query_as(
            "UPDATE server_events SET
                start_time = start_time + CASE recurrence WHEN 'daily' THEN INTERVAL '1 day' WHEN 'weekly' THEN INTERVAL '7 days' ELSE INTERVAL '1 month' END,
                end_time = end_time + CASE recurrence WHEN 'daily' THEN INTERVAL '1 day' WHEN 'weekly' THEN INTERVAL '7 days' ELSE INTERVAL '1 month' END
             WHERE recurrence <> 'none' AND COALESCE(end_time, start_time) < NOW()
             RETURNING id, server_id"
        )
        .fetch_all(&state.db)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("Événements récurrents : report impossible : {e}");
                break;
            }
        };
        if rows.is_empty() {
            break;
        }
        rolled.extend(rows);
    }
    rolled.sort();
    rolled.dedup();
    for (event_id, server_id) in rolled {
        let ev = serde_json::json!({ "type": "SERVER_EVENT_UPDATE", "server_id": server_id, "event_id": event_id });
        state.broadcast_to_server_members(server_id, ev.to_string()).await;
    }

    // Rappels : une seule fois par occurrence (`reminded_for` = début rappelé).
    use sqlx::Row;
    let due = match sqlx::query(
        "UPDATE server_events SET reminded_for = start_time
         WHERE reminder_minutes IS NOT NULL AND start_time > NOW()
           AND start_time - reminder_minutes * INTERVAL '1 minute' <= NOW()
           AND reminded_for IS DISTINCT FROM start_time
         RETURNING id, server_id, name, start_time, creator_id"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Rappels d'événements : {e}");
            return;
        }
    };
    for r in due {
        let (event_id, server_id): (Uuid, Uuid) = (r.get("id"), r.get("server_id"));
        let name: String = r.get("name");
        let start: DateTime<Utc> = r.get("start_time");
        let users: Vec<Uuid> = sqlx::query_scalar(
            "SELECT a.user_id FROM event_attendees a
             JOIN server_members sm ON sm.user_id = a.user_id AND sm.server_id = $2
             WHERE a.event_id = $1 AND a.status IN ('going', 'interested')
             UNION SELECT $3"
        )
        .bind(event_id)
        .bind(server_id)
        .bind(r.get::<Uuid, _>("creator_id"))
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
        let ev = serde_json::json!({
            "type": "EVENT_REMINDER", "server_id": server_id, "event_id": event_id,
            "name": name, "start_time": start,
        });
        state.send_to_users(&users, ev.to_string()).await;
        let title = format!("Bientôt : {name}");
        let body = format!("Début à {} (UTC)", start.format("%H:%M"));
        crate::mobile_push::spawn_send(state, users.clone(), crate::mobile_push::Notice::new(
            title.clone(), &body, body.clone(), crate::mobile_push::Target::Event { server_id },
        ));
        crate::push::spawn_send_if_offline(state, users, serde_json::json!({
            "title": title, "body": body,
            "url": format!("/servers/{server_id}/events"), "tag": event_id,
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn event_fields_are_bounded() {
        assert!(validate_fields(Some("Soirée"), Some("x"), Some("/uploads/a.png"), Some(10)).is_ok());
        assert!(validate_fields(None, None, Some("https://cdn.example/a.png"), None).is_ok());
        assert!(validate_fields(None, None, Some(""), None).is_ok());
        assert!(validate_fields(Some("  "), None, None, None).is_err());
        assert!(validate_fields(Some(&"a".repeat(101)), None, None, None).is_err());
        assert!(validate_fields(None, Some(&"a".repeat(2001)), None, None).is_err());
        assert!(validate_fields(None, None, Some("javascript:alert(1)"), None).is_err());
        assert!(validate_fields(None, None, Some("http://x/a.png"), None).is_err());
        assert!(validate_fields(None, None, Some(&format!("https://{}", "a".repeat(500))), None).is_err());
        assert!(validate_fields(None, None, None, Some(-1)).is_err());
        assert!(validate_fields(None, None, None, Some(i64::from(i32::MAX))).is_err());
    }

    #[test]
    fn ics_escapes_folds_and_repeats() {
        let start = Utc.with_ymd_and_hms(2026, 10, 9, 18, 30, 0).unwrap();
        let ev = IcsEvent {
            id: Uuid::nil(),
            name: "Soirée; jeux, quiz".into(),
            description: Some(format!("Ligne 1\nLigne 2 {}", "é".repeat(60))),
            start,
            end: None,
            recurrence: "weekly".into(),
            reminder_minutes: Some(15),
        };
        let ics = build_ics("Jötunheim", &[ev], start);
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n") && ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.contains("SUMMARY:Soirée\\; jeux\\, quiz\r\n"));
        assert!(ics.contains("DTSTART:20261009T183000Z\r\nDTEND:20261009T193000Z\r\n"));
        assert!(ics.contains("RRULE:FREQ=WEEKLY\r\n") && ics.contains("TRIGGER:-PT15M\r\n"));
        assert!(ics.contains("Ligne 1\\nLigne 2"));
        for line in ics.split("\r\n") {
            assert!(line.len() <= 75, "ligne trop longue : {line}");
        }
    }

    #[test]
    fn validation() {
        assert!(validate(Some("weekly"), Some(30)).is_ok());
        assert!(validate(Some("yearly"), None).is_err());
        assert!(validate(None, Some(0)).is_err());
        assert!(validate(None, Some(10_081)).is_err());
    }
}
