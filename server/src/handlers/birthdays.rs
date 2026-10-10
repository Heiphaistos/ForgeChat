//! Anniversaires (lot « Profil et social »).
//!
//! Date = jour et mois ; l'année est facultative et n'est JAMAIS montrée à personne
//! (stockée en 2000 quand elle est absente). Chiffrée au repos : `users.birthday_enc`
//! (migration 117, `seal` / `open`), `users.birthday` reste NULL. Visibilité : personne, amis, ou
//! amis + membres des serveurs choisis (`birthday_servers`). Le jour J (UTC) : les amis
//! qui la voient sont prévenus, et chaque serveur choisi qui a activé le message
//! automatique (`servers.birthday_channel_id`) le poste dans son salon, une seule fois
//! par an (`birthday_celebrated_year`).

use axum::{extract::{Path, State}, Extension, Json};
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// Année de stockage quand l'utilisateur n'en donne pas (bissextile : 29 février possible).
const NO_YEAR: i32 = 2000;
/// Serveurs choisis au plus.
const MAX_SERVERS: usize = 100;

pub const VISIBILITIES: [&str; 3] = ["nobody", "friends", "servers"];

const AT_REST_INFO: &str = "forgechat birthday v1";

/// Date chiffrée pour `users.birthday_enc` (AES-256-GCM, clé HKDF de EMAIL_ENC_KEY, AAD = compte).
pub fn seal(user_id: Uuid, date: NaiveDate) -> String {
    crate::email_crypto::seal_with(AT_REST_INFO, &user_id.to_string(), &date.to_string())
}

pub fn open(user_id: Uuid, stored: &str) -> Option<NaiveDate> {
    crate::email_crypto::open_with(AT_REST_INFO, &user_id.to_string(), stored)?.parse().ok()
}

/// Au démarrage : chiffre les dates encore en clair puis les efface. Idempotent.
pub async fn migrate_at_rest(db: &sqlx::PgPool) -> anyhow::Result<u64> {
    let rows: Vec<(Uuid, NaiveDate)> = sqlx::query_as("SELECT id, birthday FROM users WHERE birthday IS NOT NULL")
        .fetch_all(db)
        .await?;
    for (id, date) in &rows {
        sqlx::query("UPDATE users SET birthday_enc=$2, birthday=NULL WHERE id=$1")
            .bind(id)
            .bind(seal(*id, *date))
            .execute(db)
            .await?;
    }
    Ok(rows.len() as u64)
}

/// `viewer` voit-il l'anniversaire ? (soi-même : toujours)
pub fn visible(visibility: &str, is_self: bool, is_friend: bool, in_chosen_server: bool) -> bool {
    is_self || match visibility {
        "friends" => is_friend,
        "servers" => is_friend || in_chosen_server,
        _ => false,
    }
}

/// Le jour J ; un 29 février se fête le 28 les années non bissextiles.
pub fn is_today(month: u32, day: u32, today: NaiveDate) -> bool {
    if month == 2 && day == 29 && NaiveDate::from_ymd_opt(today.year(), 2, 29).is_none() {
        return today.month() == 2 && today.day() == 28;
    }
    today.month() == month && today.day() == day
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(deny_unknown_fields)]
pub struct BirthdayDate {
    pub month: u32,
    pub day: u32,
    pub year: Option<i32>,
}

impl BirthdayDate {
    /// Date stockée + « l'année a été donnée » ; refuse une date impossible ou future.
    pub fn to_stored(self, today: NaiveDate) -> std::result::Result<(NaiveDate, bool), &'static str> {
        let date = NaiveDate::from_ymd_opt(self.year.unwrap_or(NO_YEAR), self.month, self.day)
            .ok_or("Date d'anniversaire invalide")?;
        if let Some(y) = self.year {
            if y < 1900 || date > today {
                return Err("Année de naissance invalide");
            }
        }
        Ok((date, self.year.is_some()))
    }
}

// ─── Réglages de l'utilisateur ──────────────────────────────────────────────

async fn my_birthday(state: &AppState, me: Uuid) -> Result<serde_json::Value> {
    use sqlx::Row;
    let r = sqlx::query("SELECT birthday_enc, birthday_has_year, birthday_visibility FROM users WHERE id=$1")
        .bind(me)
        .fetch_one(&state.db)
        .await?;
    let date = r.get::<Option<String>, _>("birthday_enc").and_then(|s| open(me, &s));
    let has_year: bool = r.get("birthday_has_year");
    let servers: Vec<Uuid> = sqlx::query_scalar(
        "SELECT bs.server_id FROM birthday_servers bs
         JOIN server_members sm ON sm.server_id = bs.server_id AND sm.user_id = bs.user_id
         WHERE bs.user_id=$1",
    )
    .bind(me)
    .fetch_all(&state.db)
    .await?;
    Ok(serde_json::json!({
        "birthday": date.map(|d| serde_json::json!({
            "month": d.month(), "day": d.day(), "year": has_year.then(|| d.year()),
        })),
        "visibility": r.get::<String, _>("birthday_visibility"),
        "server_ids": servers,
    }))
}

/// GET /users/me/birthday
pub async fn get_my_birthday(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    Ok(Json(my_birthday(&state, claims.sub).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BirthdayBody {
    /// Absent = inchangé ; null = retirer la date.
    #[serde(default, deserialize_with = "crate::models::serde_helpers::deserialize_double_option")]
    pub birthday: Option<Option<BirthdayDate>>,
    pub visibility: Option<String>,
    pub server_ids: Option<Vec<Uuid>>,
}

/// PUT /users/me/birthday { birthday?: {month, day, year?} | null, visibility?, server_ids? }
pub async fn set_my_birthday(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<BirthdayBody>,
) -> Result<Json<serde_json::Value>> {
    if crate::handlers::password_reset::over_limit(&state, &format!("birthday:{}", claims.sub), 30, 600).await {
        return Err(AppError::TooManyRequests);
    }
    if let Some(ref v) = body.visibility {
        if !VISIBILITIES.contains(&v.as_str()) {
            return Err(AppError::BadRequest("Visibilité invalide (nobody|friends|servers)".into()));
        }
    }
    let today = chrono::Utc::now().date_naive();
    let stored = match body.birthday {
        Some(Some(d)) => Some(Some(d.to_stored(today).map_err(|e| AppError::BadRequest(e.into()))?)),
        Some(None) => Some(None),
        None => None,
    };
    if let Some(ref ids) = body.server_ids {
        if ids.len() > MAX_SERVERS {
            return Err(AppError::BadRequest("Trop de serveurs".into()));
        }
    }

    let mut tx = state.db.begin().await?;
    if let Some(stored) = stored {
        let (date, has_year) = match stored {
            Some((d, y)) => (Some(seal(claims.sub, d)), y),
            None => (None, true),
        };
        // Nouvelle date : elle pourra être fêtée cette année si le jour n'est pas passé.
        sqlx::query(
            "UPDATE users SET birthday_enc=$2, birthday_has_year=$3, birthday_celebrated_year=NULL WHERE id=$1",
        )
        .bind(claims.sub)
        .bind(date)
        .bind(has_year)
        .execute(&mut *tx)
        .await?;
    }
    if let Some(ref v) = body.visibility {
        sqlx::query("UPDATE users SET birthday_visibility=$2 WHERE id=$1")
            .bind(claims.sub)
            .bind(v)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(ref ids) = body.server_ids {
        sqlx::query("DELETE FROM birthday_servers WHERE user_id=$1")
            .bind(claims.sub)
            .execute(&mut *tx)
            .await?;
        // Seuls les serveurs dont on est membre (IDOR : un id inconnu est ignoré).
        sqlx::query(
            "INSERT INTO birthday_servers (user_id, server_id)
             SELECT $1, sm.server_id FROM server_members sm
             WHERE sm.user_id=$1 AND sm.server_id = ANY($2)
             ON CONFLICT DO NOTHING",
        )
        .bind(claims.sub)
        .bind(ids)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(Json(my_birthday(&state, claims.sub).await?))
}

/// Jour et mois de l'anniversaire de `owner` s'il est visible par `viewer` (jamais l'année).
pub async fn for_viewer(state: &AppState, owner: Uuid, viewer: Uuid, is_friend: bool) -> Option<serde_json::Value> {
    use sqlx::Row;
    let r = sqlx::query(
        "SELECT u.birthday_enc, u.birthday_visibility,
                EXISTS(SELECT 1 FROM birthday_servers bs
                       JOIN server_members a ON a.server_id = bs.server_id AND a.user_id = bs.user_id
                       JOIN server_members b ON b.server_id = bs.server_id AND b.user_id = $2
                       WHERE bs.user_id = u.id) AS shared
         FROM users u WHERE u.id=$1 AND u.birthday_enc IS NOT NULL",
    )
    .bind(owner)
    .bind(viewer)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;
    let vis: String = r.get("birthday_visibility");
    if !visible(&vis, owner == viewer, is_friend, r.get("shared")) {
        return None;
    }
    let d = open(owner, &r.get::<String, _>("birthday_enc"))?;
    Some(serde_json::json!({ "month": d.month(), "day": d.day() }))
}

// ─── Réglage du serveur ─────────────────────────────────────────────────────

/// GET /servers/:server_id/birthday-channel
pub async fn get_server_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let channel: Option<Uuid> = sqlx::query_scalar("SELECT birthday_channel_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    Ok(Json(serde_json::json!({ "channel_id": channel })))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerChannelBody {
    /// null = message automatique désactivé.
    pub channel_id: Option<Uuid>,
}

/// PUT /servers/:server_id/birthday-channel { channel_id | null } — gérer le serveur.
pub async fn set_server_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ServerChannelBody>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    if let Some(ch) = body.channel_id {
        let ok: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1 AND server_id=$2 AND type='text')",
        )
        .bind(ch)
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
        if !ok {
            return Err(AppError::BadRequest("Choisis un salon textuel de ce serveur".into()));
        }
    }
    sqlx::query("UPDATE servers SET birthday_channel_id=$2 WHERE id=$1")
        .bind(server_id)
        .bind(body.channel_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "channel_id": body.channel_id })))
}

// ─── Tâche quotidienne ──────────────────────────────────────────────────────

/// Toutes les heures : fête les anniversaires du jour pas encore fêtés cette année.
pub async fn run(state: &AppState) {
    use sqlx::Row;
    let today = chrono::Utc::now().date_naive();
    let year = today.year();
    // ponytail: dates chiffrées, donc balayage de tous les comptes qui en ont une (déchiffrement
    // en mémoire, une fois par heure) ; au-delà de ~100 000 comptes, garder à part le (mois, jour)
    // sous forme d'empreinte HMAC pour filtrer en SQL.
    let rows = sqlx::query(
        "SELECT id, birthday_enc FROM users
         WHERE birthday_enc IS NOT NULL AND birthday_visibility <> 'nobody'
           AND (birthday_celebrated_year IS NULL OR birthday_celebrated_year < $1)",
    )
    .bind(year)
    .fetch_all(&state.db)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => return tracing::warn!("anniversaires : {e}"),
    };
    let mut count = 0usize;
    for r in rows {
        let id: Uuid = r.get("id");
        let Some(d) = open(id, &r.get::<String, _>("birthday_enc")) else { continue };
        if !is_today(d.month(), d.day(), today) {
            continue;
        }
        // Réservation atomique : une seule instance fête un anniversaire donné.
        let claimed = sqlx::query_scalar::<_, Uuid>(
            "UPDATE users SET birthday_celebrated_year=$2 WHERE id=$1
             AND (birthday_celebrated_year IS NULL OR birthday_celebrated_year < $2) RETURNING id",
        )
        .bind(id)
        .bind(year)
        .fetch_optional(&state.db)
        .await;
        if matches!(claimed, Ok(Some(_))) {
            celebrate(state, id).await;
            count += 1;
        }
    }
    if count > 0 {
        tracing::info!("anniversaires fêtés : {count}");
    }
}

async fn celebrate(state: &AppState, user_id: Uuid) {
    use sqlx::Row;
    let Ok(Some(u)) = sqlx::query("SELECT username, display_name, birthday_visibility FROM users WHERE id=$1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
    else {
        return;
    };
    let name: String = u.get::<Option<String>, _>("display_name").unwrap_or_else(|| u.get("username"));
    let visibility: String = u.get("birthday_visibility");

    // Rappel aux amis : en direct s'ils sont connectés, sinon notification (MP existant).
    let friends: Vec<(Uuid, Option<Uuid>)> = sqlx::query_as(
        "SELECT CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END AS fid,
                (SELECT d.id FROM dm_channels d
                  WHERE (d.user1_id=$1 AND d.user2_id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END)
                     OR (d.user2_id=$1 AND d.user1_id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END)
                  LIMIT 1) AS dm
         FROM friendships f WHERE f.status='accepted' AND (f.user_id=$1 OR f.friend_id=$1)",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let event = serde_json::json!({ "type": "BIRTHDAY_TODAY", "user_id": user_id, "name": name }).to_string();
    for (fid, dm) in friends {
        state.broadcast_to_user(fid, event.clone()).await;
        if let Some(dm) = dm {
            let title = format!("🎂 {name}");
            let body = "C'est son anniversaire aujourd'hui !";
            crate::notify::push_direct(
                state,
                vec![fid],
                Some(dm),
                serde_json::json!({ "title": title, "body": body, "url": format!("/dms/{dm}"), "tag": format!("birthday-{user_id}") }),
                crate::mobile_push::Notice::new(title.clone(), body, body, crate::mobile_push::Target::Dm(dm)),
            );
        }
    }

    if visibility != "servers" {
        return;
    }
    // Message automatique dans les serveurs choisis qui l'ont activé (dont il est encore membre).
    let targets: Vec<(Uuid, Uuid, Uuid)> = sqlx::query_as(
        "SELECT s.id, s.birthday_channel_id, s.owner_id FROM birthday_servers bs
         JOIN servers s ON s.id = bs.server_id
         JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = bs.user_id
         WHERE bs.user_id=$1 AND s.birthday_channel_id IS NOT NULL",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    for (server_id, channel_id, owner_id) in targets {
        post_message(state, server_id, channel_id, owner_id, user_id).await;
    }
}

/// Message système en clair (marqué « non chiffré », comme les webhooks) : aucun contenu
/// de conversation, seulement la mention de la personne fêtée.
async fn post_message(state: &AppState, server_id: Uuid, channel_id: Uuid, owner_id: Uuid, user_id: Uuid) {
    let msg_id = Uuid::new_v4();
    let content = format!("🎂 Joyeux anniversaire <@{user_id}> ! 🎉");
    let inserted = sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type, webhook_display_name)
         VALUES ($1, $2, $3, $4, 'webhook', 'ForgeChat')",
    )
    .bind(msg_id)
    .bind(channel_id)
    .bind(owner_id)
    .bind(&content)
    .execute(&state.db)
    .await;
    if let Err(e) = inserted {
        return tracing::warn!("message d'anniversaire : {e}");
    }
    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "channel_id": channel_id,
        "server_id": server_id,
        "message": {
            "id": msg_id,
            "channel_id": channel_id,
            "content": content,
            "author_username": "ForgeChat",
            "type": "webhook",
            "unencrypted": true,
            "created_at": chrono::Utc::now(),
        }
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn visibilite() {
        assert!(!visible("nobody", false, true, true));
        assert!(visible("nobody", true, false, false));
        assert!(visible("friends", false, true, false));
        assert!(!visible("friends", false, false, true));
        assert!(visible("servers", false, false, true));
        assert!(visible("servers", false, true, false));
        assert!(!visible("servers", false, false, false));
    }

    #[test]
    fn jour_j_et_29_fevrier() {
        assert!(is_today(10, 7, d(2026, 10, 7)));
        assert!(!is_today(10, 8, d(2026, 10, 7)));
        assert!(is_today(2, 29, d(2027, 2, 28)));
        assert!(!is_today(2, 29, d(2028, 2, 28)));
        assert!(is_today(2, 29, d(2028, 2, 29)));
    }

    #[test]
    fn date_saisie() {
        let today = d(2026, 10, 7);
        let ok = BirthdayDate { month: 2, day: 29, year: None }.to_stored(today).unwrap();
        assert_eq!(ok, (d(2000, 2, 29), false));
        assert_eq!(BirthdayDate { month: 3, day: 4, year: Some(1990) }.to_stored(today).unwrap(), (d(1990, 3, 4), true));
        assert!(BirthdayDate { month: 2, day: 29, year: Some(2001) }.to_stored(today).is_err());
        assert!(BirthdayDate { month: 13, day: 1, year: None }.to_stored(today).is_err());
        assert!(BirthdayDate { month: 4, day: 31, year: None }.to_stored(today).is_err());
        assert!(BirthdayDate { month: 1, day: 1, year: Some(1850) }.to_stored(today).is_err());
        assert!(BirthdayDate { month: 12, day: 1, year: Some(2026) }.to_stored(today).is_err());
    }
}
