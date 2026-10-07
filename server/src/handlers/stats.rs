//! Statistiques d'un serveur sur une période (administrateurs) : croissance des
//! membres, messages par jour (un COMPTE, jamais le contenu), salons actifs,
//! présence vocale (minutes et pic, relevés chaque minute par `levels::voice_tick`).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{Duration, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::Result,
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub days: Option<i64>,
}

/// Membres en fin de chaque jour, en remontant depuis l'effectif actuel.
pub fn member_series(now: i64, joins: &[i64], leaves: &[i64]) -> Vec<i64> {
    let mut out = vec![0; joins.len()];
    let mut count = now;
    for i in (0..joins.len()).rev() {
        out[i] = count.max(0);
        count = count - joins[i] + leaves[i];
    }
    out
}

/// GET /servers/:server_id/stats/history?days=30 — MANAGE_SERVER.
pub async fn history(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let days = q.days.unwrap_or(30).clamp(7, 90);
    let today = Utc::now().date_naive();
    let start = today - Duration::days(days - 1);

    let by_day = |rows: Vec<(NaiveDate, i64)>| -> HashMap<NaiveDate, i64> { rows.into_iter().collect() };
    let messages = by_day(sqlx::query_as(
        "SELECT m.created_at::date, COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE c.server_id = $1 AND m.created_at >= $2 GROUP BY 1"
    ).bind(server_id).bind(start).fetch_all(&state.db).await?);
    let joins = by_day(sqlx::query_as(
        "SELECT created_at::date, COUNT(*) FROM audit_log
         WHERE server_id = $1 AND action = 'MEMBER_JOIN' AND created_at >= $2 GROUP BY 1"
    ).bind(server_id).bind(start).fetch_all(&state.db).await?);
    let leaves = by_day(sqlx::query_as(
        "SELECT created_at::date, COUNT(*) FROM audit_log
         WHERE server_id = $1 AND action IN ('MEMBER_LEAVE', 'MEMBER_KICK', 'MEMBER_BAN') AND created_at >= $2 GROUP BY 1"
    ).bind(server_id).bind(start).fetch_all(&state.db).await?);
    let voice: HashMap<NaiveDate, (i32, i32)> = sqlx::query("SELECT day, minutes, peak FROM server_voice_daily WHERE server_id=$1 AND day >= $2")
        .bind(server_id).bind(start).fetch_all(&state.db).await?
        .iter().map(|r| (r.get("day"), (r.get("minutes"), r.get("peak")))).collect();
    let member_count: i32 = sqlx::query_scalar("SELECT member_count FROM servers WHERE id=$1")
        .bind(server_id).fetch_one(&state.db).await?;

    let dates: Vec<NaiveDate> = (0..days).map(|i| start + Duration::days(i)).collect();
    let j: Vec<i64> = dates.iter().map(|d| joins.get(d).copied().unwrap_or(0)).collect();
    let l: Vec<i64> = dates.iter().map(|d| leaves.get(d).copied().unwrap_or(0)).collect();
    let members = member_series(member_count as i64, &j, &l);
    let series: Vec<serde_json::Value> = dates.iter().enumerate().map(|(i, d)| {
        let (vm, vp) = voice.get(d).copied().unwrap_or((0, 0));
        serde_json::json!({
            "day": d, "messages": messages.get(d).copied().unwrap_or(0),
            "joins": j[i], "leaves": l[i], "members": members[i],
            "voice_minutes": vm, "voice_peak": vp,
        })
    }).collect();

    let channels: Vec<serde_json::Value> = sqlx::query(
        "SELECT c.id, c.name, c.type, COUNT(m.id) AS messages, COUNT(DISTINCT m.user_id) AS authors
         FROM channels c JOIN messages m ON m.channel_id = c.id AND m.created_at >= $2
         WHERE c.server_id = $1 GROUP BY c.id ORDER BY messages DESC LIMIT 10"
    ).bind(server_id).bind(start).fetch_all(&state.db).await?.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"), "name": r.get::<String, _>("name"), "type": r.get::<String, _>("type"),
        "messages": r.get::<i64, _>("messages"), "authors": r.get::<i64, _>("authors"),
    })).collect();
    let in_voice_now = {
        let voice = state.user_voice.read().await.clone();
        let mut n = 0;
        for ch in voice.values() {
            if state.channel_server_id(*ch).await == Some(server_id) {
                n += 1;
            }
        }
        n
    };

    Ok(Json(serde_json::json!({
        "days": days,
        "member_count": member_count,
        "in_voice_now": in_voice_now,
        "series": series,
        "channels": channels,
    })))
}

#[cfg(test)]
mod tests {
    #[test]
    fn members_backwards_from_today() {
        // 3 jours : +2 le 1er, +1/-1 le 2e, +3 le 3e ; 10 membres aujourd'hui.
        assert_eq!(super::member_series(10, &[2, 1, 3], &[0, 1, 0]), vec![7, 7, 10]);
        assert_eq!(super::member_series(0, &[0, 0], &[0, 5]), vec![5, 0]);
    }
}
