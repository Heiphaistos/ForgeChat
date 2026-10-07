//! Niveaux et XP natifs (sans bot). Le serveur ne lit jamais le contenu chiffré :
//! l'XP vient du seul FAIT d'écrire (une fois par minute au plus) ou d'être en vocal
//! avec quelqu'un (une fois par minute, tâche périodique).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// XP cumulée pour atteindre le niveau `n` : 100 × n².
pub fn xp_for_level(n: i32) -> i64 {
    100 * (n as i64) * (n as i64)
}

pub fn level_for(xp: i64) -> i32 {
    let mut l = ((xp.max(0) as f64) / 100.0).sqrt() as i32;
    while xp_for_level(l + 1) <= xp {
        l += 1;
    }
    while l > 0 && xp_for_level(l) > xp {
        l -= 1;
    }
    l
}

#[derive(Deserialize)]
pub struct LevelRole {
    pub level: i32,
    pub role_id: Uuid,
}

#[derive(Deserialize)]
pub struct LevelSettingsInput {
    pub enabled: bool,
    pub xp_per_message: i32,
    pub xp_per_voice_minute: i32,
    #[serde(default)]
    pub roles: Vec<LevelRole>,
}

/// GET /servers/:id/levels — réglages (tout membre : l'appli sait si c'est actif).
pub async fn get_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let row = sqlx::query("SELECT enabled, xp_per_message, xp_per_voice_minute FROM level_settings WHERE server_id=$1")
        .bind(server_id).fetch_optional(&state.db).await?;
    let roles: Vec<serde_json::Value> = sqlx::query("SELECT level, role_id FROM level_roles WHERE server_id=$1 ORDER BY level")
        .bind(server_id).fetch_all(&state.db).await?.iter()
        .map(|r| serde_json::json!({ "level": r.get::<i32, _>("level"), "role_id": r.get::<Uuid, _>("role_id") }))
        .collect();
    Ok(Json(serde_json::json!({
        "enabled": row.as_ref().is_some_and(|r| r.get::<bool, _>("enabled")),
        "xp_per_message": row.as_ref().map_or(15, |r| r.get::<i32, _>("xp_per_message")),
        "xp_per_voice_minute": row.as_ref().map_or(10, |r| r.get::<i32, _>("xp_per_voice_minute")),
        "roles": roles,
    })))
}

/// PUT /servers/:id/levels — MANAGE_SERVER. Rôles débloqués : seulement des rôles
/// sans droit sensible (même règle que l'onboarding), sous le rôle le plus haut de l'acteur.
pub async fn put_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<LevelSettingsInput>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    if !(0..=1000).contains(&body.xp_per_message) || !(0..=1000).contains(&body.xp_per_voice_minute) {
        return Err(AppError::BadRequest("XP : 0 à 1000".into()));
    }
    if body.roles.len() > 50 || body.roles.iter().any(|r| !(1..=1000).contains(&r.level)) {
        return Err(AppError::BadRequest("50 rôles au plus, niveaux 1 à 1000".into()));
    }
    let server_roles: HashMap<Uuid, (i64, bool)> = sqlx::query_as::<_, (Uuid, i64, bool)>(
        "SELECT id, permissions, is_everyone FROM roles WHERE server_id=$1"
    ).bind(server_id).fetch_all(&state.db).await?.into_iter().map(|(id, p, e)| (id, (p, e))).collect();
    for r in &body.roles {
        let (perms, everyone) = server_roles.get(&r.role_id).ok_or_else(|| AppError::BadRequest("Rôle inconnu".into()))?;
        if !crate::handlers::onboarding::role_grantable(*perms, *everyone) {
            return Err(AppError::BadRequest("Ce rôle a des droits sensibles : il ne peut pas être débloqué par niveau".into()));
        }
        crate::handlers::servers::require_role_below(&state, claims.sub, r.role_id, server_id).await?;
    }
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO level_settings (server_id, enabled, xp_per_message, xp_per_voice_minute, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (server_id) DO UPDATE SET enabled=$2, xp_per_message=$3, xp_per_voice_minute=$4, updated_at=NOW()"
    ).bind(server_id).bind(body.enabled).bind(body.xp_per_message).bind(body.xp_per_voice_minute)
    .execute(&mut *tx).await?;
    sqlx::query("DELETE FROM level_roles WHERE server_id=$1").bind(server_id).execute(&mut *tx).await?;
    for r in &body.roles {
        sqlx::query("INSERT INTO level_roles (server_id, level, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
            .bind(server_id).bind(r.level).bind(r.role_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    crate::handlers::audit::log_event(&state, server_id, "LEVELS_UPDATE", Some(claims.sub), None, None, None,
        Some(serde_json::json!({ "enabled": body.enabled }))).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct BoardQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

fn member_json(r: &sqlx::postgres::PgRow) -> serde_json::Value {
    let xp: i64 = r.get("xp");
    let level = level_for(xp);
    serde_json::json!({
        "user_id": r.get::<Uuid, _>("user_id"),
        "username": r.get::<String, _>("username"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "xp": xp,
        "level": level,
        "level_xp": xp_for_level(level),
        "next_level_xp": xp_for_level(level + 1),
        "messages": r.get::<i32, _>("messages"),
        "voice_minutes": r.get::<i32, _>("voice_minutes"),
        "rank": r.get::<i64, _>("rank"),
    })
}

const BOARD_SQL: &str = "SELECT * FROM (
    SELECT ml.user_id, u.username, COALESCE(sm.server_avatar, u.avatar) AS avatar, ml.xp, ml.messages, ml.voice_minutes,
           RANK() OVER (ORDER BY ml.xp DESC) AS rank
    FROM member_levels ml
    JOIN server_members sm ON sm.server_id = ml.server_id AND sm.user_id = ml.user_id
    JOIN users u ON u.id = ml.user_id
    WHERE ml.server_id = $1) b";

/// GET /servers/:id/levels/leaderboard — classement (membres actuels seulement).
pub async fn leaderboard(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(q): Query<BoardQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    let rows = sqlx::query(&format!("{BOARD_SQL} ORDER BY rank, username LIMIT $2 OFFSET $3"))
        .bind(server_id)
        .bind(q.limit.unwrap_or(50).clamp(1, 100))
        .bind(q.offset.unwrap_or(0).clamp(0, 100_000))
        .fetch_all(&state.db).await?;
    Ok(Json(rows.iter().map(member_json).collect()))
}

/// GET /servers/:id/levels/members/:user_id — carte de niveau d'un membre.
pub async fn member_card(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    if let Some(r) = sqlx::query(&format!("{BOARD_SQL} WHERE user_id = $2"))
        .bind(server_id).bind(user_id).fetch_optional(&state.db).await?
    {
        return Ok(Json(member_json(&r)));
    }
    // Membre sans XP encore : carte au niveau 0.
    let r = sqlx::query(
        "SELECT u.id AS user_id, u.username, COALESCE(sm.server_avatar, u.avatar) AS avatar, 0::BIGINT AS xp,
                0 AS messages, 0 AS voice_minutes, 0::BIGINT AS rank
         FROM server_members sm JOIN users u ON u.id = sm.user_id WHERE sm.server_id=$1 AND sm.user_id=$2"
    ).bind(server_id).bind(user_id).fetch_optional(&state.db).await?
    .ok_or_else(|| AppError::NotFound("Membre introuvable".into()))?;
    Ok(Json(member_json(&r)))
}

// ─── Gains d'XP ──────────────────────────────────────────────────────────────

/// Après un message dans un salon : XP une fois par minute au plus (anti-spam).
pub fn on_message(state: &AppState, server_id: Uuid, user_id: Uuid) {
    let state = state.clone();
    tokio::spawn(async move {
        let gain: Option<i32> = sqlx::query_scalar("SELECT xp_per_message FROM level_settings WHERE server_id=$1 AND enabled")
            .bind(server_id).fetch_optional(&state.db).await.ok().flatten();
        let Some(gain) = gain.filter(|g| *g > 0) else { return };
        let row = sqlx::query(
            "INSERT INTO member_levels (server_id, user_id, xp, messages, last_message_xp_at)
             VALUES ($1, $2, $3, 1, NOW())
             ON CONFLICT (server_id, user_id) DO UPDATE
             SET xp = member_levels.xp + $3, messages = member_levels.messages + 1, last_message_xp_at = NOW()
             WHERE member_levels.last_message_xp_at IS NULL OR member_levels.last_message_xp_at < NOW() - INTERVAL '60 seconds'
             RETURNING xp, level"
        ).bind(server_id).bind(user_id).bind(gain as i64).fetch_optional(&state.db).await;
        if let Ok(Some(r)) = row {
            after_gain(&state, server_id, user_id, r.get("xp"), r.get("level")).await;
        }
    });
}

/// Niveau franchi : enregistré, rôles débloqués donnés, membre prévenu.
async fn after_gain(state: &AppState, server_id: Uuid, user_id: Uuid, xp: i64, old_level: i32) {
    let level = level_for(xp);
    if level <= old_level {
        return;
    }
    let updated = sqlx::query("UPDATE member_levels SET level=$3 WHERE server_id=$1 AND user_id=$2 AND level < $3")
        .bind(server_id).bind(user_id).bind(level).execute(&state.db).await;
    if !updated.is_ok_and(|r| r.rows_affected() > 0) {
        return;
    }
    let roles: Vec<(Uuid, i64, bool)> = sqlx::query_as(
        "SELECT r.id, r.permissions, r.is_everyone FROM level_roles lr JOIN roles r ON r.id = lr.role_id
         WHERE lr.server_id=$1 AND lr.level <= $2"
    ).bind(server_id).bind(level).fetch_all(&state.db).await.unwrap_or_default();
    let grant: Vec<Uuid> = roles.iter()
        .filter(|(_, p, e)| crate::handlers::onboarding::role_grantable(*p, *e))
        .map(|(id, _, _)| *id).collect();
    let added = sqlx::query(
        "INSERT INTO member_roles (user_id, server_id, role_id) SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT DO NOTHING"
    ).bind(user_id).bind(server_id).bind(&grant).execute(&state.db).await
        .map(|r| r.rows_affected()).unwrap_or(0);
    if added > 0 {
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "MEMBER_ROLE_UPDATE", "server_id": server_id, "user_id": user_id,
        }).to_string()).await;
    }
    state.broadcast_to_user(user_id, serde_json::json!({
        "type": "LEVEL_UP", "server_id": server_id, "level": level, "roles_added": added,
    }).to_string()).await;
}

/// Toutes les minutes : XP vocal (au moins deux personnes dans le salon, pas d'XP
/// en restant seul) et statistiques de présence vocale du jour.
pub async fn voice_tick(state: &AppState) {
    let voice = state.user_voice.read().await.clone();
    let mut by_channel: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for (user, channel) in voice {
        by_channel.entry(channel).or_default().push(user);
    }
    let mut by_server: HashMap<Uuid, Vec<(Uuid, usize)>> = HashMap::new();
    for (channel, users) in &by_channel {
        if let Some(server) = state.channel_server_id(*channel).await {
            for u in users {
                by_server.entry(server).or_default().push((*u, users.len()));
            }
        }
    }
    for (server_id, users) in by_server {
        let _ = sqlx::query(
            "INSERT INTO server_voice_daily (server_id, day, minutes, peak) VALUES ($1, CURRENT_DATE, $2, $2)
             ON CONFLICT (server_id, day) DO UPDATE
             SET minutes = server_voice_daily.minutes + $2, peak = GREATEST(server_voice_daily.peak, $2)"
        ).bind(server_id).bind(users.len() as i32).execute(&state.db).await;
        let gain: Option<i32> = sqlx::query_scalar("SELECT xp_per_voice_minute FROM level_settings WHERE server_id=$1 AND enabled")
            .bind(server_id).fetch_optional(&state.db).await.ok().flatten();
        let Some(gain) = gain.filter(|g| *g > 0) else { continue };
        for (user_id, with) in users {
            if with < 2 {
                continue;
            }
            let row = sqlx::query(
                "INSERT INTO member_levels (server_id, user_id, xp, voice_minutes) VALUES ($1, $2, $3, 1)
                 ON CONFLICT (server_id, user_id) DO UPDATE
                 SET xp = member_levels.xp + $3, voice_minutes = member_levels.voice_minutes + 1
                 RETURNING xp, level"
            ).bind(server_id).bind(user_id).bind(gain as i64).fetch_optional(&state.db).await;
            if let Ok(Some(r)) = row {
                after_gain(state, server_id, user_id, r.get("xp"), r.get("level")).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_curve() {
        assert_eq!(level_for(0), 0);
        assert_eq!(level_for(99), 0);
        assert_eq!(level_for(100), 1);
        assert_eq!(level_for(399), 1);
        assert_eq!(level_for(400), 2);
        assert_eq!(level_for(-5), 0);
        for n in 0..500 {
            assert_eq!(level_for(xp_for_level(n)), n);
            assert_eq!(level_for(xp_for_level(n + 1) - 1), n);
        }
    }
}
