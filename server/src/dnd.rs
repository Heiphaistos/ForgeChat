//! « Ne pas déranger » programmé (audit 2026-10-12, amélioration n° 48).
//!
//! Plages horaires par jour de la semaine, dans le fuseau de l'utilisateur (IANA, heure d'été
//! comprise), exceptions pour les contacts favoris. Appliqué par le SERVEUR aux notifications push
//! (web, Android, iOS) : un téléphone éteint ou une appli fermée ne sonne plus la nuit. Les
//! messages arrivent toujours, seule la notification est retenue.
use axum::{extract::State, Extension, Json};
use chrono::{DateTime, Datelike, Timelike, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow, PartialEq)]
pub struct Schedule {
    pub enabled: bool,
    /// Bits : lundi = 1, mardi = 2 … dimanche = 64.
    pub days: i16,
    pub start_min: i16,
    pub end_min: i16,
    pub tz: String,
    pub allow_favorites: bool,
}

impl Default for Schedule {
    fn default() -> Self {
        Schedule { enabled: false, days: 127, start_min: 22 * 60, end_min: 7 * 60, tz: "Europe/Paris".into(), allow_favorites: true }
    }
}

fn day_bit(weekday: chrono::Weekday) -> i16 {
    1 << weekday.num_days_from_monday()
}

/// Vrai si `now` tombe dans une plage calme. Plage qui passe minuit : rattachée au jour où elle
/// commence. Plage vide (début = fin) : jamais.
pub fn in_quiet(now: DateTime<Utc>, s: &Schedule) -> bool {
    if !s.enabled || s.start_min == s.end_min || s.days == 0 {
        return false;
    }
    let tz: chrono_tz::Tz = s.tz.parse().unwrap_or(chrono_tz::Europe::Paris);
    let local = now.with_timezone(&tz);
    let minute = (local.hour() * 60 + local.minute()) as i16;
    let today = day_bit(local.weekday());
    let yesterday = day_bit(local.weekday().pred());
    if s.start_min < s.end_min {
        s.days & today != 0 && minute >= s.start_min && minute < s.end_min
    } else {
        (s.days & today != 0 && minute >= s.start_min) || (s.days & yesterday != 0 && minute < s.end_min)
    }
}

async fn load(state: &AppState, user_id: Uuid) -> Schedule {
    sqlx::query_as::<_, Schedule>(
        "SELECT enabled, days, start_min, end_min, tz, allow_favorites FROM dnd_schedules WHERE user_id=$1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default()
}

/// Notification à retenir pour `user_id` maintenant ? `from` : auteur (exception des favoris).
pub async fn silenced(state: &AppState, user_id: Uuid, from: Option<Uuid>) -> bool {
    let s = load(state, user_id).await;
    if !in_quiet(Utc::now(), &s) {
        return false;
    }
    if let (true, Some(from)) = (s.allow_favorites, from) {
        let fav: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_favorites WHERE user_id=$1 AND target_id=$2)")
            .bind(user_id)
            .bind(from)
            .fetch_one(&state.db)
            .await
            .unwrap_or(false);
        if fav {
            return false;
        }
    }
    true
}

/// Auteur d'une conversation privée à deux (l'autre participant).
pub async fn dm_peer(state: &AppState, dm_id: Uuid, me: Uuid) -> Option<Uuid> {
    sqlx::query_scalar("SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END FROM dm_channels WHERE id=$1")
        .bind(dm_id)
        .bind(me)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
}

/// GET /api/users/me/dnd-schedule
pub async fn get_schedule(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Schedule>> {
    Ok(Json(load(&state, claims.sub).await))
}

/// PUT /api/users/me/dnd-schedule
pub async fn put_schedule(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(s): Json<Schedule>,
) -> Result<Json<Schedule>> {
    if !(0..=127).contains(&s.days) || !(0..1440).contains(&s.start_min) || !(0..1440).contains(&s.end_min) {
        return Err(AppError::BadRequest("Plage invalide".into()));
    }
    if s.tz.len() > 64 || s.tz.parse::<chrono_tz::Tz>().is_err() {
        return Err(AppError::BadRequest("Fuseau horaire inconnu".into()));
    }
    sqlx::query(
        "INSERT INTO dnd_schedules (user_id, enabled, days, start_min, end_min, tz, allow_favorites, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id) DO UPDATE SET enabled=EXCLUDED.enabled, days=EXCLUDED.days, start_min=EXCLUDED.start_min,
            end_min=EXCLUDED.end_min, tz=EXCLUDED.tz, allow_favorites=EXCLUDED.allow_favorites, updated_at=NOW()",
    )
    .bind(claims.sub)
    .bind(s.enabled)
    .bind(s.days)
    .bind(s.start_min)
    .bind(s.end_min)
    .bind(&s.tz)
    .bind(s.allow_favorites)
    .execute(&state.db)
    .await?;
    Ok(Json(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    #[test]
    fn overnight_weekdays_in_paris() {
        // Lundi→vendredi, 22:00 → 07:00, Paris. 2026-10-12 est un lundi ; heure d'été (UTC+2).
        let s = Schedule { enabled: true, days: 0b0011111, start_min: 22 * 60, end_min: 7 * 60, tz: "Europe/Paris".into(), allow_favorites: true };
        assert!(in_quiet(at(2026, 10, 12, 20, 30), &s), "lundi 22:30 Paris");
        assert!(in_quiet(at(2026, 10, 13, 4, 0), &s), "mardi 06:00 Paris (nuit de lundi)");
        assert!(!in_quiet(at(2026, 10, 13, 5, 0), &s), "mardi 07:00 Paris : fin");
        assert!(!in_quiet(at(2026, 10, 12, 12, 0), &s), "lundi midi");
        // Vendredi soir compris, samedi soir non ; dimanche 06:00 non (samedi pas coché).
        assert!(in_quiet(at(2026, 10, 16, 21, 0), &s), "vendredi 23:00");
        assert!(in_quiet(at(2026, 10, 17, 3, 0), &s), "samedi 05:00 (nuit de vendredi)");
        assert!(!in_quiet(at(2026, 10, 17, 21, 0), &s), "samedi 23:00");
        assert!(!in_quiet(at(2026, 10, 18, 4, 0), &s), "dimanche 06:00");
        // Heure d'hiver (UTC+1) : 22:30 Paris = 21:30 UTC.
        assert!(in_quiet(at(2026, 11, 2, 21, 30), &s));
        assert!(!in_quiet(at(2026, 11, 2, 20, 30), &s), "21:30 Paris en hiver");
    }

    #[test]
    fn daytime_range_and_disabled() {
        let s = Schedule { enabled: true, days: 127, start_min: 9 * 60, end_min: 17 * 60, tz: "UTC".into(), allow_favorites: false };
        assert!(in_quiet(at(2026, 10, 12, 10, 0), &s));
        assert!(!in_quiet(at(2026, 10, 12, 17, 0), &s));
        assert!(!in_quiet(at(2026, 10, 12, 10, 0), &Schedule { enabled: false, ..s.clone() }));
        assert!(!in_quiet(at(2026, 10, 12, 10, 0), &Schedule { start_min: 600, end_min: 600, ..s }));
    }
}
