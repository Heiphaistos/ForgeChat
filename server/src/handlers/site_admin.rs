//! Administration du site : inscription sur invitation, liste des comptes, bannissement global,
//! réglages et journal des actions.
//!
//! L'administration est réservée au rôle de site « El Patron ». Y accèdent :
//! - le propriétaire du site, dont l'e-mail est `FORGECHAT_ADMIN_EMAIL` (`heiphaistos44@gmail.com` par
//!   défaut), qui détient le rôle d'office ;
//! - les comptes à qui le propriétaire a attribué le rôle (table `site_role_members`).
//! Seul le propriétaire attribue ou retire le rôle : aucun El Patron ne peut en nommer un autre.
//! Les e-mails sont uniques et la création d'un compte se fait sur invitation.
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Duration, Utc};
use rand::Rng;
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

/// Ensemble Redis des comptes bannis du site (vérifié à chaque requête authentifiée).
pub const BANNED_SET: &str = "sitebanned";

/// Le compte « Utilisateur supprimé » (migration 063) existe dès l'installation : il ne compte pas.
pub const NO_REAL_USERS_SQL: &str = "SELECT NOT EXISTS(SELECT 1 FROM users WHERE NOT is_bot AND email NOT LIKE '%@forgechat.invalid')";

/// Alphabet sans caractères ambigus (ni 0/O, ni 1/I/L).
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 12;

// ─── Droits ────────────────────────────────────────────────────────────────

/// E-mail du seul administrateur (minuscules).
pub fn admin_email() -> String {
    std::env::var("FORGECHAT_ADMIN_EMAIL")
        .ok()
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "heiphaistos44@gmail.com".to_string())
}

/// Propriétaire du site : le compte de `FORGECHAT_ADMIN_EMAIL`.
pub async fn is_owner(state: &AppState, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT lower(email) = $2 AND NOT is_bot FROM users WHERE id=$1")
        .bind(user_id)
        .bind(admin_email())
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
}

/// Détient le rôle « El Patron » (le propriétaire l'a d'office) : accès à l'administration et pleins
/// pouvoirs sur chaque serveur dont il est membre. Même fonction SQL que les calculs de permissions.
pub async fn is_site_admin(state: &AppState, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT fc_is_god($1)")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false)
}

/// Écrit l'e-mail du propriétaire là où la fonction SQL `fc_is_god` le lit (au démarrage).
pub async fn sync_owner_email(state: &AppState) {
    let _ = sqlx::query("INSERT INTO site_settings (key, value) VALUES ('owner_email', $1) ON CONFLICT (key) DO UPDATE SET value = $1")
        .bind(admin_email())
        .execute(&state.db)
        .await;
    lift_sanctions(state).await;
}

/// Un compte tout-puissant ne reste ni banni d'un serveur, ni en timeout, ni muet / sourd imposé (sanctions antérieures au rôle).
async fn lift_sanctions(state: &AppState) {
    let _ = sqlx::query("DELETE FROM user_timeouts WHERE fc_is_god(user_id)").execute(&state.db).await;
    let _ = sqlx::query("DELETE FROM bans WHERE fc_is_god(user_id)").execute(&state.db).await;
    let _ = sqlx::query("UPDATE server_members SET voice_muted=false, voice_deafened=false WHERE (voice_muted OR voice_deafened) AND fc_is_god(user_id)")
        .execute(&state.db)
        .await;
}

pub async fn require_site_admin(state: &AppState, claims: &Claims) -> Result<()> {
    if is_site_admin(state, claims.sub).await { Ok(()) } else { Err(AppError::Forbidden) }
}

/// Réservé au propriétaire : attribution du rôle El Patron.
async fn require_owner(state: &AppState, claims: &Claims) -> Result<()> {
    if is_owner(state, claims.sub).await { Ok(()) } else { Err(AppError::Forbidden) }
}

async fn audit(state: &AppState, admin: Uuid, action: &str, target: Option<Uuid>, detail: Value) {
    let _ = sqlx::query("INSERT INTO admin_audit (admin_id, action, target_user_id, detail) VALUES ($1,$2,$3,$4)")
        .bind(admin)
        .bind(action)
        .bind(target)
        .bind(detail)
        .execute(&state.db)
        .await;
}

// ─── Mode d'inscription et codes d'invitation ──────────────────────────────

pub async fn registration_mode(state: &AppState) -> String {
    sqlx::query_scalar::<_, String>("SELECT value FROM site_settings WHERE key='registration_mode'")
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .filter(|m| matches!(m.as_str(), "open" | "invite" | "closed"))
        .unwrap_or_else(|| "invite".into())
}

/// Forme canonique d'un code saisi : majuscules, sans tiret ni espace.
pub fn normalize_code(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn generate_code() -> String {
    let mut rng = rand::thread_rng();
    (0..CODE_LEN).map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char).collect()
}

fn pretty_code(code: &str) -> String {
    code.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("-")
}

/// Consomme une utilisation du code, dans la transaction d'inscription : si le compte n'est
/// finalement pas créé (pseudo pris), la transaction est annulée et le code n'est pas brûlé.
pub async fn consume_invite(tx: &mut Transaction<'_, Postgres>, raw_code: &str) -> Result<(Uuid, Option<Uuid>)> {
    let code = normalize_code(raw_code);
    let bad = || AppError::ForbiddenMsg("Code d'invitation invalide, expiré ou déjà utilisé".into());
    if code.len() != CODE_LEN {
        return Err(bad());
    }
    let row = sqlx::query(
        "UPDATE registration_invites SET uses = uses + 1
         WHERE code=$1 AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > NOW())
         RETURNING id, created_by",
    )
    .bind(&code)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(bad)?;
    Ok((row.get("id"), row.get("created_by")))
}

/// Informations publiques pour l'écran d'inscription.
pub async fn registration_info(State(state): State<AppState>) -> Result<Json<Value>> {
    let no_users: bool = sqlx::query_scalar(NO_REAL_USERS_SQL).fetch_one(&state.db).await?;
    let mode = registration_mode(&state).await;
    // Première installation : le premier compte se crée sans code (et devient administrateur).
    let effective = if no_users { "open".to_string() } else { mode };
    Ok(Json(json!({ "mode": effective, "first_user": no_users })))
}

// ─── Bannissement ──────────────────────────────────────────────────────────

pub async fn is_banned(state: &AppState, user_id: Uuid) -> bool {
    let mut redis = state.redis.lock().await;
    redis.sismember::<_, _, bool>(BANNED_SET, user_id.to_string()).await.unwrap_or(false)
}

/// Recharge l'ensemble Redis depuis la base (au démarrage : Redis a pu être vidé).
pub async fn sync_banned_set(state: &AppState) {
    let ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM users WHERE site_banned_at IS NOT NULL")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    let mut redis = state.redis.lock().await;
    let _: () = redis.del(BANNED_SET).await.unwrap_or(());
    for id in ids {
        let _: () = redis.sadd(BANNED_SET, id.to_string()).await.unwrap_or(());
    }
}

/// Coupe tout accès d'un compte : jetons de rafraîchissement, sessions, jetons d'accès, WebSocket.
async fn cut_access(state: &AppState, user_id: Uuid, notify: &str) {
    let _ = sqlx::query("DELETE FROM refresh_tokens WHERE user_id=$1").bind(user_id).execute(&state.db).await;
    let _ = sqlx::query("DELETE FROM user_sessions WHERE user_id=$1").bind(user_id).execute(&state.db).await;
    crate::middleware::auth::revoke_all_tokens_strict(state, user_id).await;
    state.broadcast_to_user(user_id, json!({ "type": notify }).to_string()).await;
}

// ─── Aperçu et comptes ─────────────────────────────────────────────────────

pub async fn admin_me(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    Ok(Json(json!({ "admin": true, "owner": is_owner(&state, claims.sub).await })))
}

pub async fn overview(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let row = sqlx::query(
        "SELECT
           (SELECT COUNT(*) FROM users WHERE NOT is_bot AND email NOT LIKE '%@forgechat.invalid') AS total,
           (SELECT COUNT(*) FROM users WHERE NOT is_bot AND email NOT LIKE '%@forgechat.invalid' AND created_at > NOW() - INTERVAL '1 day') AS new_1d,
           (SELECT COUNT(*) FROM users WHERE NOT is_bot AND email NOT LIKE '%@forgechat.invalid' AND created_at > NOW() - INTERVAL '7 days') AS new_7d,
           (SELECT COUNT(*) FROM users WHERE NOT is_bot AND email NOT LIKE '%@forgechat.invalid' AND created_at > NOW() - INTERVAL '30 days') AS new_30d,
           (SELECT COUNT(*) FROM users WHERE site_banned_at IS NOT NULL) AS banned,
           (SELECT COUNT(*) FROM site_role_members WHERE role = 'el-patron') AS patrons,
           (SELECT COUNT(*) FROM servers) AS servers,
           (SELECT COUNT(*) FROM messages) AS messages,
           (SELECT COUNT(*) FROM registration_invites
              WHERE revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > NOW())) AS active_invites,
           (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE last_seen > NOW() - INTERVAL '24 hours') AS active_24h,
           (SELECT COUNT(DISTINCT user_id) FROM user_sessions WHERE last_seen > NOW() - INTERVAL '7 days') AS active_7d",
    )
    .fetch_one(&state.db)
    .await?;
    let online = state.clients.read().await.len() as i64;
    let g = |k: &str| row.get::<i64, _>(k);
    Ok(Json(json!({
        "total_users": g("total"), "online_now": online,
        "new_24h": g("new_1d"), "new_7d": g("new_7d"), "new_30d": g("new_30d"),
        "banned": g("banned"), "patrons": g("patrons"),
        "servers": g("servers"), "messages": g("messages"),
        "active_invites": g("active_invites"),
        "active_24h": g("active_24h"), "active_7d": g("active_7d"),
        "registration_mode": registration_mode(&state).await,
    })))
}

#[derive(Deserialize)]
pub struct UsersQuery {
    pub q: Option<String>,
    /// all | online | banned | admins | recent
    pub filter: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_users(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<UsersQuery>,
) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);
    let like = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("%{}%", s.replace('%', "\\%").replace('_', "\\_")));
    let online_ids: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
    let filter = q.filter.as_deref().unwrap_or("all");

    let rows = sqlx::query(
        "SELECT u.id, u.username, u.discriminator, u.email, u.avatar, u.created_at, u.is_bot,
                (lower(u.email) = $6) AS is_owner,
                EXISTS(SELECT 1 FROM site_role_members r WHERE r.user_id = u.id AND r.role = 'el-patron') AS is_patron,
                u.site_banned_at, u.site_ban_reason,
                inv.username AS invited_by_name, ri.note AS invite_note,
                (SELECT MAX(last_seen) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.user_id = u.id) AS server_count,
                (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) AS message_count,
                COUNT(*) OVER() AS total
         FROM users u
         LEFT JOIN users inv ON inv.id = u.invited_by
         LEFT JOIN registration_invites ri ON ri.id = u.registration_invite_id
         WHERE u.email NOT LIKE '%@forgechat.invalid'
           AND ($1::text IS NULL OR u.username ILIKE $1 OR u.email ILIKE $1 OR u.id::text ILIKE $1)
           AND (CASE $2
                  WHEN 'online'  THEN u.id = ANY($3)
                  WHEN 'banned'  THEN u.site_banned_at IS NOT NULL
                  WHEN 'patrons' THEN lower(u.email) = $6
                                      OR EXISTS(SELECT 1 FROM site_role_members r WHERE r.user_id = u.id AND r.role = 'el-patron')
                  WHEN 'recent'  THEN u.created_at > NOW() - INTERVAL '7 days'
                  ELSE TRUE END)
         ORDER BY u.created_at DESC
         LIMIT $4 OFFSET $5",
    )
    .bind(like)
    .bind(filter)
    .bind(&online_ids)
    .bind(limit)
    .bind(offset)
    .bind(admin_email())
    .fetch_all(&state.db)
    .await?;

    let total = rows.first().map(|r| r.get::<i64, _>("total")).unwrap_or(0);
    let users: Vec<Value> = rows
        .iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            json!({
                "id": id,
                "username": r.get::<String, _>("username"),
                "discriminator": r.get::<String, _>("discriminator"),
                "email": r.get::<String, _>("email"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "created_at": r.get::<DateTime<Utc>, _>("created_at"),
                "is_bot": r.get::<bool, _>("is_bot"),
                "is_owner": r.get::<bool, _>("is_owner"),
                "is_patron": r.get::<bool, _>("is_patron") || r.get::<bool, _>("is_owner"),
                "banned_at": r.get::<Option<DateTime<Utc>>, _>("site_banned_at"),
                "ban_reason": r.get::<Option<String>, _>("site_ban_reason"),
                "invited_by": r.get::<Option<String>, _>("invited_by_name"),
                "invite_note": r.get::<Option<String>, _>("invite_note"),
                "last_seen": r.get::<Option<DateTime<Utc>>, _>("last_seen"),
                "online": online_ids.contains(&id),
                "server_count": r.get::<i64, _>("server_count"),
                "message_count": r.get::<i64, _>("message_count"),
            })
        })
        .collect();
    Ok(Json(json!({ "total": total, "users": users })))
}

/// Détail d'un compte : appareils connectés, serveurs, personnes qu'il a invitées.
pub async fn user_detail(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let sessions = sqlx::query("SELECT device_info, created_at, last_seen FROM user_sessions WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 20")
        .bind(user_id).fetch_all(&state.db).await?;
    let servers = sqlx::query(
        "SELECT s.id, s.name, sm.joined_at, (s.owner_id = $1) AS owner
         FROM server_members sm JOIN servers s ON s.id = sm.server_id WHERE sm.user_id=$1 ORDER BY sm.joined_at DESC LIMIT 50",
    ).bind(user_id).fetch_all(&state.db).await?;
    let invited = sqlx::query("SELECT id, username, created_at FROM users WHERE invited_by=$1 ORDER BY created_at DESC LIMIT 50")
        .bind(user_id).fetch_all(&state.db).await?;
    Ok(Json(json!({
        "sessions": sessions.iter().map(|r| json!({
            "device": r.get::<Option<String>, _>("device_info"),
            "created_at": r.get::<DateTime<Utc>, _>("created_at"),
            "last_seen": r.get::<DateTime<Utc>, _>("last_seen"),
        })).collect::<Vec<_>>(),
        "servers": servers.iter().map(|r| json!({
            "id": r.get::<Uuid, _>("id"), "name": r.get::<String, _>("name"),
            "joined_at": r.get::<DateTime<Utc>, _>("joined_at"), "owner": r.get::<bool, _>("owner"),
        })).collect::<Vec<_>>(),
        "invited": invited.iter().map(|r| json!({
            "id": r.get::<Uuid, _>("id"), "username": r.get::<String, _>("username"),
            "created_at": r.get::<DateTime<Utc>, _>("created_at"),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
pub struct BanBody {
    pub reason: Option<String>,
}

pub async fn ban_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<BanBody>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    if user_id == claims.sub {
        return Err(AppError::BadRequest("Vous ne pouvez pas vous bannir vous-même".into()));
    }
    if is_site_admin(&state, user_id).await {
        return Err(AppError::ForbiddenMsg("Un El Patron ne peut pas être banni : le propriétaire doit d'abord lui retirer le rôle".into()));
    }
    let reason = body.reason.map(|r| r.trim().chars().take(300).collect::<String>()).filter(|r| !r.is_empty());
    let done = sqlx::query("UPDATE users SET site_banned_at=NOW(), site_ban_reason=$2 WHERE id=$1 AND site_banned_at IS NULL")
        .bind(user_id)
        .bind(&reason)
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)").bind(user_id).fetch_one(&state.db).await?;
        return if exists { Ok(StatusCode::NO_CONTENT) } else { Err(AppError::NotFound("Compte introuvable".into())) };
    }
    {
        let mut redis = state.redis.lock().await;
        let _: () = redis.sadd(BANNED_SET, user_id.to_string()).await.unwrap_or(());
    }
    cut_access(&state, user_id, "ACCOUNT_BANNED").await;
    audit(&state, claims.sub, "ban", Some(user_id), json!({ "reason": reason })).await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unban_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    sqlx::query("UPDATE users SET site_banned_at=NULL, site_ban_reason=NULL WHERE id=$1").bind(user_id).execute(&state.db).await?;
    {
        let mut redis = state.redis.lock().await;
        let _: () = redis.srem(BANNED_SET, user_id.to_string()).await.unwrap_or(());
    }
    audit(&state, claims.sub, "unban", Some(user_id), json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Déconnecte le compte de tous ses appareils sans le bannir.
pub async fn force_logout(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    cut_access(&state, user_id, "FORCE_LOGOUT").await;
    audit(&state, claims.sub, "force_logout", Some(user_id), json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct PatronBody {
    pub patron: bool,
}

/// Attribue ou retire le rôle « El Patron ». Réservé au propriétaire du site.
pub async fn set_patron(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<PatronBody>,
) -> Result<StatusCode> {
    require_owner(&state, &claims).await?;
    if is_owner(&state, user_id).await {
        return Err(AppError::BadRequest("Le propriétaire détient le rôle d'office".into()));
    }
    if body.patron {
        if is_banned(&state, user_id).await {
            return Err(AppError::BadRequest("Ce compte est banni".into()));
        }
        let eligible: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND NOT is_bot AND email NOT LIKE '%@forgechat.invalid')",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        if !eligible {
            return Err(AppError::NotFound("Compte introuvable".into()));
        }
        sqlx::query("INSERT INTO site_role_members (role, user_id, granted_by) VALUES ('el-patron', $1, $2) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .bind(claims.sub)
            .execute(&state.db)
            .await?;
    } else {
        sqlx::query("DELETE FROM site_role_members WHERE role='el-patron' AND user_id=$1").bind(user_id).execute(&state.db).await?;
        // Plus de rôle, plus de supervision : ses adhésions de supervision disparaissent avec lui.
        sqlx::query("DELETE FROM server_members WHERE user_id=$1 AND supervisor").bind(user_id).execute(&state.db).await?;
    }
    if body.patron {
        lift_sanctions(&state).await;
    }
    audit(&state, claims.sub, if body.patron { "grant_patron" } else { "revoke_patron" }, Some(user_id), json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Serveurs : annuaire, supervision, suspension, suppression ─────────────
//
// El Patron modère l'instance : il voit tous les serveurs et peut y entrer sans y avoir été invité.
// La supervision est VISIBLE (le superviseur apparaît dans les membres, une ligne « supervision par
// l'administration » est écrite dans le journal du serveur et dans le journal admin). Elle ne donne aucun accès aux
// messages privés ni au contenu chiffré de bout en bout : un superviseur est exclu des destinataires de
// clés des salons chiffrés (e2e_channel::viewers).

#[derive(Deserialize)]
pub struct ServersQuery {
    pub q: Option<String>,
    /// all | public | suspended | supervised
    pub filter: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn list_servers(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<ServersQuery>,
) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);
    let like = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("%{}%", s.replace('%', "\\%").replace('_', "\\_")));
    let rows = sqlx::query(
        "SELECT s.id, s.name, s.icon, s.is_public, s.created_at, s.suspended_at, s.suspended_reason,
                s.owner_id, o.username AS owner_name,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id AND NOT sm.supervisor) AS members,
                (SELECT COUNT(*) FROM channels c WHERE c.server_id = s.id) AS channels,
                (SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.server_id = s.id) AS messages,
                (SELECT COALESCE(SUM(a.size), 0)::bigint FROM attachments a
                   JOIN messages m ON m.id = a.message_id JOIN channels c ON c.id = m.channel_id
                  WHERE c.server_id = s.id) AS storage_bytes,
                EXISTS(SELECT 1 FROM server_members sm WHERE sm.server_id = s.id AND sm.user_id = $1) AS joined,
                EXISTS(SELECT 1 FROM server_members sm WHERE sm.server_id = s.id AND sm.user_id = $1 AND sm.supervisor) AS supervising,
                COUNT(*) OVER() AS total
         FROM servers s LEFT JOIN users o ON o.id = s.owner_id
         WHERE ($2::text IS NULL OR s.name ILIKE $2 OR o.username ILIKE $2 OR s.id::text ILIKE $2)
           AND (CASE $3
                  WHEN 'public' THEN s.is_public
                  WHEN 'suspended' THEN s.suspended_at IS NOT NULL
                  WHEN 'supervised' THEN EXISTS(SELECT 1 FROM server_members sm WHERE sm.server_id = s.id AND sm.user_id = $1 AND sm.supervisor)
                  ELSE TRUE END)
         ORDER BY s.created_at DESC
         LIMIT $4 OFFSET $5",
    )
    .bind(claims.sub)
    .bind(like)
    .bind(q.filter.as_deref().unwrap_or("all"))
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;
    let total = rows.first().map(|r| r.get::<i64, _>("total")).unwrap_or(0);
    let servers: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id"),
                "name": r.get::<String, _>("name"),
                "icon": r.get::<Option<String>, _>("icon"),
                "is_public": r.get::<bool, _>("is_public"),
                "created_at": r.get::<DateTime<Utc>, _>("created_at"),
                "owner_id": r.get::<Option<Uuid>, _>("owner_id"),
                "owner": r.get::<Option<String>, _>("owner_name"),
                "members": r.get::<i64, _>("members"),
                "channels": r.get::<i64, _>("channels"),
                "messages": r.get::<i64, _>("messages"),
                "storage_bytes": r.get::<i64, _>("storage_bytes"),
                "suspended_at": r.get::<Option<DateTime<Utc>>, _>("suspended_at"),
                "suspended_reason": r.get::<Option<String>, _>("suspended_reason"),
                "joined": r.get::<bool, _>("joined"),
                "supervising": r.get::<bool, _>("supervising"),
            })
        })
        .collect();
    Ok(Json(json!({ "total": total, "servers": servers })))
}

async fn server_name(state: &AppState, server_id: Uuid) -> Result<String> {
    sqlx::query_scalar::<_, String>("SELECT name FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))
}

/// Écrit une ligne dans le journal d'audit du serveur lui-même (lisible par ses modérateurs).
async fn server_audit(state: &AppState, server_id: Uuid, admin: Uuid, action: &str, details: Value) {
    let _ = sqlx::query(
        "INSERT INTO audit_log (server_id, action, user_id, username, details)
         VALUES ($1, $2, $3, (SELECT username FROM users WHERE id=$3), $4)",
    )
    .bind(server_id)
    .bind(action)
    .bind(admin)
    .bind(details)
    .execute(&state.db)
    .await;
}

/// Entre dans un serveur en superviseur (visible), sans invitation ni consentement.
pub async fn supervise_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    let name = server_name(&state, server_id).await?;
    let inserted = sqlx::query(
        "INSERT INTO server_members (user_id, server_id, supervisor) VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING",
    )
    .bind(claims.sub)
    .bind(server_id)
    .execute(&state.db)
    .await?;
    if inserted.rows_affected() > 0 {
        let note = "Supervision par l'administration de ForgeChat (modération de l'instance)";
        server_audit(&state, server_id, claims.sub, "site_supervision", json!({ "note": note })).await;
        audit(&state, claims.sub, "supervise_server", None, json!({ "server_id": server_id, "server": name })).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Quitte la supervision. Une adhésion ordinaire (non posée par la supervision) n'est jamais retirée.
pub async fn end_supervision(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    let done = sqlx::query("DELETE FROM server_members WHERE user_id=$1 AND server_id=$2 AND supervisor")
        .bind(claims.sub)
        .bind(server_id)
        .execute(&state.db)
        .await?;
    if done.rows_affected() > 0 {
        server_audit(&state, server_id, claims.sub, "site_supervision_end", json!({})).await;
        audit(&state, claims.sub, "end_supervision", None, json!({ "server_id": server_id })).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SuspendBody {
    pub reason: Option<String>,
}

pub async fn suspend_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<SuspendBody>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    let name = server_name(&state, server_id).await?;
    let reason = body.reason.map(|r| r.trim().chars().take(300).collect::<String>()).filter(|r| !r.is_empty());
    sqlx::query("UPDATE servers SET suspended_at=COALESCE(suspended_at, NOW()), suspended_reason=$2 WHERE id=$1")
        .bind(server_id)
        .bind(&reason)
        .execute(&state.db)
        .await?;
    state
        .broadcast_to_server_members(server_id, json!({ "type": "SERVER_SUSPENDED", "server_id": server_id, "reason": reason }).to_string())
        .await;
    server_audit(&state, server_id, claims.sub, "site_suspend", json!({ "reason": reason })).await;
    audit(&state, claims.sub, "suspend_server", None, json!({ "server_id": server_id, "server": name, "reason": reason })).await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unsuspend_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    let name = server_name(&state, server_id).await?;
    sqlx::query("UPDATE servers SET suspended_at=NULL, suspended_reason=NULL WHERE id=$1").bind(server_id).execute(&state.db).await?;
    server_audit(&state, server_id, claims.sub, "site_unsuspend", json!({})).await;
    audit(&state, claims.sub, "unsuspend_server", None, json!({ "server_id": server_id, "server": name })).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Suppression définitive d'un serveur (hébergement abusif) : mot de passe (et 2FA) de l'administrateur exigés.
pub async fn delete_server_admin(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    body: Option<Json<crate::handlers::servers::ReauthBody>>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    crate::handlers::servers::verify_reauth(&state, claims.sub, &body.map(|b| b.0).unwrap_or_default()).await?;
    let name = server_name(&state, server_id).await?;
    state
        .broadcast_to_server_members(server_id, json!({ "type": "SERVER_DELETE", "server_id": server_id }).to_string())
        .await;
    sqlx::query("DELETE FROM servers WHERE id=$1").bind(server_id).execute(&state.db).await?;
    audit(&state, claims.sub, "delete_server", None, json!({ "server_id": server_id, "server": name })).await;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Invitations ───────────────────────────────────────────────────────────

pub async fn list_invites(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let rows = sqlx::query(
        "SELECT i.id, i.code, i.note, i.max_uses, i.uses, i.expires_at, i.revoked_at, i.created_at, u.username AS creator,
                COALESCE((SELECT json_agg(json_build_object('id', x.id, 'username', x.username, 'at', iu.used_at) ORDER BY iu.used_at)
                          FROM registration_invite_uses iu JOIN users x ON x.id = iu.user_id WHERE iu.invite_id = i.id), '[]'::json) AS used_by
         FROM registration_invites i LEFT JOIN users u ON u.id = i.created_by
         ORDER BY i.created_at DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    let now = Utc::now();
    let invites: Vec<Value> = rows
        .iter()
        .map(|r| {
            let expires: Option<DateTime<Utc>> = r.get("expires_at");
            let revoked: Option<DateTime<Utc>> = r.get("revoked_at");
            let (uses, max): (i32, i32) = (r.get("uses"), r.get("max_uses"));
            let status = if revoked.is_some() { "revoked" } else if expires.is_some_and(|e| e <= now) { "expired" } else if uses >= max { "used" } else { "active" };
            json!({
                "id": r.get::<Uuid, _>("id"),
                "code": pretty_code(&r.get::<String, _>("code")),
                "note": r.get::<Option<String>, _>("note"),
                "max_uses": max, "uses": uses, "status": status,
                "expires_at": expires, "created_at": r.get::<DateTime<Utc>, _>("created_at"),
                "creator": r.get::<Option<String>, _>("creator"),
                "used_by": r.get::<Value, _>("used_by"),
            })
        })
        .collect();
    Ok(Json(json!({ "invites": invites })))
}

#[derive(Deserialize)]
pub struct CreateInvite {
    pub note: Option<String>,
    pub max_uses: Option<i32>,
    pub expires_in_days: Option<i64>,
}

pub async fn create_invite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateInvite>,
) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let max_uses = body.max_uses.unwrap_or(1).clamp(1, 1000);
    let expires = body.expires_in_days.filter(|d| *d > 0).map(|d| Utc::now() + Duration::days(d.min(365)));
    let note = body.note.map(|n| n.trim().chars().take(100).collect::<String>()).filter(|n| !n.is_empty());
    // Collision improbable (60 bits) mais la contrainte UNIQUE tranche : on réessaie.
    for _ in 0..5 {
        let code = generate_code();
        let res = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO registration_invites (code, created_by, note, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (code) DO NOTHING RETURNING id",
        )
        .bind(&code).bind(claims.sub).bind(&note).bind(max_uses).bind(expires)
        .fetch_optional(&state.db)
        .await?;
        if let Some(id) = res {
            audit(&state, claims.sub, "create_invite", None, json!({ "invite_id": id, "max_uses": max_uses, "note": note })).await;
            return Ok(Json(json!({ "id": id, "code": pretty_code(&code), "max_uses": max_uses, "expires_at": expires })));
        }
    }
    Err(AppError::Internal(anyhow::anyhow!("génération du code d'invitation impossible")))
}

pub async fn revoke_invite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(invite_id): Path<Uuid>,
) -> Result<StatusCode> {
    require_site_admin(&state, &claims).await?;
    let done = sqlx::query("UPDATE registration_invites SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL")
        .bind(invite_id).execute(&state.db).await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("Invitation introuvable".into()));
    }
    audit(&state, claims.sub, "revoke_invite", None, json!({ "invite_id": invite_id })).await;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Réglages et journal ───────────────────────────────────────────────────

pub async fn get_settings(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    Ok(Json(json!({ "registration_mode": registration_mode(&state).await })))
}

#[derive(Deserialize)]
pub struct SettingsBody {
    pub registration_mode: String,
}

pub async fn put_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SettingsBody>,
) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    if !matches!(body.registration_mode.as_str(), "open" | "invite" | "closed") {
        return Err(AppError::BadRequest("Mode d'inscription inconnu (open, invite ou closed)".into()));
    }
    sqlx::query("INSERT INTO site_settings (key, value) VALUES ('registration_mode', $1) ON CONFLICT (key) DO UPDATE SET value=$1")
        .bind(&body.registration_mode).execute(&state.db).await?;
    audit(&state, claims.sub, "set_registration_mode", None, json!({ "mode": body.registration_mode })).await;
    Ok(Json(json!({ "registration_mode": body.registration_mode })))
}

pub async fn audit_log(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    require_site_admin(&state, &claims).await?;
    let rows = sqlx::query(
        "SELECT a.id, a.action, a.detail, a.created_at, adm.username AS admin_name, t.username AS target_name
         FROM admin_audit a LEFT JOIN users adm ON adm.id = a.admin_id LEFT JOIN users t ON t.id = a.target_user_id
         ORDER BY a.id DESC LIMIT 200",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({ "entries": rows.iter().map(|r| json!({
        "id": r.get::<i64, _>("id"), "action": r.get::<String, _>("action"),
        "detail": r.get::<Option<Value>, _>("detail"), "created_at": r.get::<DateTime<Utc>, _>("created_at"),
        "admin": r.get::<Option<String>, _>("admin_name"), "target": r.get::<Option<String>, _>("target_name"),
    })).collect::<Vec<_>>() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_codes() {
        assert_eq!(normalize_code(" abcd-efgh-jkmn "), "ABCDEFGHJKMN");
        assert_eq!(normalize_code("ab_cd"), "ABCD");
    }

    #[test]
    fn generated_codes_use_the_safe_alphabet() {
        for _ in 0..200 {
            let c = generate_code();
            assert_eq!(c.len(), CODE_LEN);
            assert!(c.bytes().all(|b| CODE_ALPHABET.contains(&b)));
            assert_eq!(normalize_code(&pretty_code(&c)), c);
        }
    }
}
