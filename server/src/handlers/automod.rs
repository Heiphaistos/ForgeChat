//! AutoMod avancé. Le contenu est chiffré : le serveur n'agit que sur les
//! MÉTADONNÉES (débit d'envoi, vague d'arrivées, verrouillage). Mots interdits et
//! liens dangereux sont vérifiés par l'appli de l'expéditeur avant de chiffrer
//! (règles servies par GET /servers/:id/automod/rules).

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// Liste locale de domaines dangereux connus (traqueurs d'adresse IP, faux
/// Discord/Steam/Nitro). Aucun service payant : complétée par chaque serveur.
pub const BUILTIN_DANGEROUS_DOMAINS: &[&str] = &[
    "grabify.link", "iplogger.org", "iplogger.com", "iplogger.ru", "iplogger.co", "iplogger.info",
    "2no.co", "yip.su", "blasze.com", "blasze.tk", "ps3cfw.com", "bmwforum.co", "leancoding.co",
    "quickmessage.us", "spottyfly.com", "stopify.co", "freegiftcards.co", "joinmy.site",
    "curiouscat.club", "catsnthings.fun", "catsnthing.com", "screenshare.host", "imageshare.best",
    "headshot.monster", "gamingfun.me", "partpicker.shop", "sportshub.bar", "locations.quest",
    "lovebird.guru", "trulove.guru", "dateing.club", "otherhalf.life", "shrekis.life",
    "discord-nitro.gift", "discordnitro.gift", "discord-gift.com",
    "discordgift.site", "dlscord.com", "discorcl.com", "discordn.gift", "discord-app.net",
    "steamcommunlty.com", "steamcomminuty.com", "steancommunity.com", "steamcommunitty.com",
    "stearncommunity.com", "steamcornmunity.com",
];

#[derive(Serialize, Deserialize)]
pub struct AdvancedInput {
    pub rate_limit_count: i32,
    pub rate_limit_seconds: i32,
    pub raid_join_count: i32,
    pub raid_join_seconds: i32,
    pub block_dangerous_links: bool,
    pub blocked_domains: Vec<String>,
}

/// Domaine normalisé (minuscules, sans schéma ni chemin), ou None s'il est invalide.
pub fn clean_domain(d: &str) -> Option<String> {
    let d = d.trim().to_lowercase();
    let d = d.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
    let d = d.split(['/', '?', '#']).next()?.trim_end_matches('.');
    let ok = d.len() >= 3 && d.len() <= 253 && d.contains('.')
        && d.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.');
    ok.then(|| d.to_string())
}

/// Domaines refusés envoyés aux applis (vide si l'option est coupée).
pub fn dangerous_domains(block: bool, custom: &[String]) -> Vec<String> {
    if !block {
        return Vec::new();
    }
    BUILTIN_DANGEROUS_DOMAINS.iter().map(|d| d.to_string()).chain(custom.iter().cloned()).collect()
}

/// GET /servers/:id/automod/advanced — MANAGE_SERVER.
pub async fn get_advanced(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let r = sqlx::query(
        "SELECT rate_limit_count, rate_limit_seconds, raid_join_count, raid_join_seconds,
                block_dangerous_links, blocked_domains, lockdown, lockdown_reason
         FROM automod_rules WHERE server_id=$1"
    ).bind(server_id).fetch_optional(&state.db).await?;
    Ok(Json(match r {
        Some(r) => serde_json::json!({
            "rate_limit_count": r.get::<i32, _>("rate_limit_count"),
            "rate_limit_seconds": r.get::<i32, _>("rate_limit_seconds"),
            "raid_join_count": r.get::<i32, _>("raid_join_count"),
            "raid_join_seconds": r.get::<i32, _>("raid_join_seconds"),
            "block_dangerous_links": r.get::<bool, _>("block_dangerous_links"),
            "blocked_domains": r.get::<Vec<String>, _>("blocked_domains"),
            "lockdown": r.get::<bool, _>("lockdown"),
            "lockdown_reason": r.get::<Option<String>, _>("lockdown_reason"),
            "builtin_domains": BUILTIN_DANGEROUS_DOMAINS.len(),
        }),
        None => serde_json::json!({
            "rate_limit_count": 0, "rate_limit_seconds": 10, "raid_join_count": 0, "raid_join_seconds": 60,
            "block_dangerous_links": false, "blocked_domains": [], "lockdown": false, "lockdown_reason": null,
            "builtin_domains": BUILTIN_DANGEROUS_DOMAINS.len(),
        }),
    }))
}

/// PUT /servers/:id/automod/advanced — MANAGE_SERVER.
pub async fn put_advanced(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(b): Json<AdvancedInput>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    if !(0..=100).contains(&b.rate_limit_count) || !(1..=300).contains(&b.rate_limit_seconds)
        || !(0..=500).contains(&b.raid_join_count) || !(5..=3600).contains(&b.raid_join_seconds)
    {
        return Err(AppError::BadRequest("Seuils hors limites".into()));
    }
    if b.blocked_domains.len() > 200 {
        return Err(AppError::BadRequest("200 domaines au plus".into()));
    }
    let mut domains: Vec<String> = b.blocked_domains.iter()
        .map(|d| clean_domain(d).ok_or_else(|| AppError::BadRequest(format!("Domaine invalide : {d}"))))
        .collect::<Result<_>>()?;
    domains.sort();
    domains.dedup();
    sqlx::query(
        "INSERT INTO automod_rules (server_id, rate_limit_count, rate_limit_seconds, raid_join_count, raid_join_seconds,
                                    block_dangerous_links, blocked_domains, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (server_id) DO UPDATE SET rate_limit_count=$2, rate_limit_seconds=$3, raid_join_count=$4,
             raid_join_seconds=$5, block_dangerous_links=$6, blocked_domains=$7, updated_at=NOW()"
    ).bind(server_id).bind(b.rate_limit_count).bind(b.rate_limit_seconds).bind(b.raid_join_count)
    .bind(b.raid_join_seconds).bind(b.block_dangerous_links).bind(&domains).execute(&state.db).await?;
    crate::handlers::audit::log_event(&state, server_id, "AUTOMOD_UPDATE", Some(claims.sub), None, None, None, None).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct LockdownInput {
    pub enabled: bool,
}

/// Staff : peut écrire pendant un verrouillage et le lever.
pub const STAFF: i64 = Permissions::MANAGE_MESSAGES | Permissions::MANAGE_SERVER | Permissions::KICK_MEMBERS;

async fn set_lockdown(state: &AppState, server_id: Uuid, on: bool, reason: Option<&str>, actor: Option<Uuid>) -> Result<bool> {
    let changed = sqlx::query(
        "INSERT INTO automod_rules (server_id, lockdown, lockdown_reason, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (server_id) DO UPDATE SET lockdown=$2, lockdown_reason=$3, updated_at=NOW()
         WHERE automod_rules.lockdown IS DISTINCT FROM $2"
    ).bind(server_id).bind(on).bind(reason).execute(&state.db).await?.rows_affected() > 0;
    if changed {
        crate::handlers::audit::log_event(state, server_id, if on { "LOCKDOWN_ON" } else { "LOCKDOWN_OFF" },
            actor, None, None, None, reason.map(|r| serde_json::json!({ "reason": r }))).await;
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "SERVER_LOCKDOWN", "server_id": server_id, "lockdown": on, "reason": reason,
        }).to_string()).await;
    }
    Ok(changed)
}

/// PUT /servers/:id/lockdown — verrouillage en un clic (staff) : plus personne
/// n'écrit, hors staff, et plus personne ne rejoint.
pub async fn put_lockdown(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(b): Json<LockdownInput>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, STAFF).await?;
    set_lockdown(&state, server_id, b.enabled, b.enabled.then_some("manual"), Some(claims.sub)).await?;
    Ok(Json(serde_json::json!({ "ok": true, "lockdown": b.enabled })))
}

pub async fn is_locked(state: &AppState, server_id: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar::<_, bool>("SELECT lockdown FROM automod_rules WHERE server_id=$1")
        .bind(server_id).fetch_optional(&state.db).await?.unwrap_or(false))
}

/// Après une arrivée : vague d'arrivées → verrouillage automatique.
pub async fn after_join(state: &AppState, server_id: Uuid) {
    let Ok(Some(r)) = sqlx::query(
        "SELECT raid_join_count, raid_join_seconds FROM automod_rules WHERE server_id=$1 AND raid_join_count > 0 AND NOT lockdown"
    ).bind(server_id).fetch_optional(&state.db).await else { return };
    let (count, secs): (i32, i32) = (r.get("raid_join_count"), r.get("raid_join_seconds"));
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_members WHERE server_id=$1 AND NOT is_owner AND joined_at > NOW() - $2 * INTERVAL '1 second'"
    ).bind(server_id).bind(secs as f64).fetch_one(&state.db).await.unwrap_or(0);
    if recent >= count as i64 {
        tracing::warn!("Anti-raid : {recent} arrivées en {secs} s sur {server_id}, verrouillage");
        let _ = set_lockdown(state, server_id, true, Some("raid"), None).await;
    }
}

/// Débit d'envoi (métadonnée) : au-delà de N messages en S secondes, refus.
pub async fn check_rate(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<()> {
    let Some(r) = sqlx::query(
        "SELECT rate_limit_count, rate_limit_seconds FROM automod_rules WHERE server_id=$1 AND enabled AND rate_limit_count > 0"
    ).bind(server_id).fetch_optional(&state.db).await? else { return Ok(()) };
    let (max, secs): (i32, i32) = (r.get("rate_limit_count"), r.get("rate_limit_seconds"));
    let key = format!("automod_rate:{server_id}:{user_id}");
    let mut redis = state.redis.lock().await;
    let n: i64 = redis::AsyncCommands::incr(&mut *redis, &key, 1).await.unwrap_or(1);
    if n == 1 {
        let _: () = redis::AsyncCommands::expire(&mut *redis, &key, secs as i64).await.unwrap_or(());
    }
    if n > max as i64 {
        return Err(AppError::TooManyRequestsMsg(format!("AutoMod : {max} messages en {secs} s au plus, ralentis")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domains() {
        assert_eq!(clean_domain(" HTTPS://www.Grabify.link/abc ").as_deref(), Some("grabify.link"));
        assert_eq!(clean_domain("exemple.fr.").as_deref(), Some("exemple.fr"));
        assert!(clean_domain("localhost").is_none());
        assert!(clean_domain("a b.fr").is_none());
        assert!(dangerous_domains(false, &["x.fr".into()]).is_empty());
        let all = dangerous_domains(true, &["x.fr".into()]);
        assert!(all.contains(&"x.fr".to_string()) && all.contains(&"grabify.link".to_string()));
        assert!(BUILTIN_DANGEROUS_DOMAINS.iter().all(|d| clean_domain(d).as_deref() == Some(*d)));
    }
}
