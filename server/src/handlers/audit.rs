use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub action: String,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub target_id: Option<Uuid>,
    pub target_name: Option<String>,
    pub details: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub action: Option<String>,
    pub limit: Option<i64>,
}

pub async fn get_audit_log(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(q): Query<AuditQuery>,
) -> Result<Json<Vec<AuditEntry>>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;

    use sqlx::Row;
    let limit = q.limit.unwrap_or(50).min(200);

    let rows = if let Some(action) = &q.action {
        sqlx::query(
            "SELECT id, action, user_id, username, target_id, target_name, details, created_at
             FROM audit_log WHERE server_id=$1 AND action=$2
             ORDER BY created_at DESC LIMIT $3"
        )
        .bind(server_id).bind(action).bind(limit)
        .fetch_all(&state.db).await?
    } else {
        sqlx::query(
            "SELECT id, action, user_id, username, target_id, target_name, details, created_at
             FROM audit_log WHERE server_id=$1
             ORDER BY created_at DESC LIMIT $2"
        )
        .bind(server_id).bind(limit)
        .fetch_all(&state.db).await?
    };

    let entries = rows.iter().map(|r| AuditEntry {
        id: r.get("id"),
        action: r.get("action"),
        user_id: r.get("user_id"),
        username: r.get("username"),
        target_id: r.get("target_id"),
        target_name: r.get("target_name"),
        details: r.get("details"),
        created_at: r.get("created_at"),
    }).collect();

    Ok(Json(entries))
}

// Fonction utilitaire appelée par d'autres handlers pour logger un event
pub async fn log_event(
    state: &AppState,
    server_id: Uuid,
    action: &str,
    user_id: Option<Uuid>,
    username: Option<&str>,
    target_id: Option<Uuid>,
    target_name: Option<&str>,
    details: Option<serde_json::Value>,
) {
    let _ = sqlx::query(
        "INSERT INTO audit_log (server_id, action, user_id, username, target_id, target_name, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7)"
    )
    .bind(server_id)
    .bind(action)
    .bind(user_id)
    .bind(username)
    .bind(target_id)
    .bind(target_name)
    .bind(details)
    .execute(&state.db)
    .await;
}

// AutoMod
#[derive(Serialize, Deserialize)]
pub struct AutoModConfig {
    pub enabled: bool,
    pub word_filter: Vec<String>,
    pub action: String,
    pub log_channel_id: Option<Uuid>,
}

pub async fn get_automod(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<AutoModConfig>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT enabled, word_filter, action, log_channel_id FROM automod_rules WHERE server_id=$1"
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(r) = row {
        Ok(Json(AutoModConfig {
            enabled: r.get("enabled"),
            word_filter: r.get::<Vec<String>, _>("word_filter"),
            action: r.get("action"),
            log_channel_id: r.get("log_channel_id"),
        }))
    } else {
        Ok(Json(AutoModConfig {
            enabled: false,
            word_filter: vec![],
            action: "delete".into(),
            log_channel_id: None,
        }))
    }
}

pub async fn set_automod(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<AutoModConfig>,
) -> Result<Json<serde_json::Value>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    let valid_actions = ["delete", "warn", "kick", "ban"];
    if !valid_actions.contains(&body.action.as_str()) {
        return Err(AppError::BadRequest("Action invalide".into()));
    }
    sqlx::query(
        "INSERT INTO automod_rules (server_id, enabled, word_filter, action, log_channel_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (server_id) DO UPDATE
         SET enabled=$2, word_filter=$3, action=$4, log_channel_id=$5, updated_at=NOW()"
    )
    .bind(server_id)
    .bind(body.enabled)
    .bind(&body.word_filter)
    .bind(&body.action)
    .bind(body.log_channel_id)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// Server discovery
#[derive(Serialize)]
pub struct PublicServer {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub member_count: i32,
    pub invite_code: Option<String>,
}

pub async fn discover_servers(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
) -> Result<Json<Vec<PublicServer>>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, name, icon, description, member_count, invite_code
         FROM servers WHERE is_public=true ORDER BY member_count DESC LIMIT 100"
    )
    .fetch_all(&state.db)
    .await?;

    let servers = rows.iter().map(|r| PublicServer {
        id: r.get("id"),
        name: r.get("name"),
        icon: r.get("icon"),
        description: r.get("description"),
        member_count: r.get("member_count"),
        invite_code: r.get("invite_code"),
    }).collect();

    Ok(Json(servers))
}

// Réactions détaillées (qui a réagi)
#[derive(Deserialize)]
pub struct ReactionQuery {
    pub message_id: Uuid,
    pub emoji: String,
}

#[derive(Serialize)]
pub struct ReactionUser {
    pub user_id: Uuid,
    pub username: String,
    pub avatar: Option<String>,
}

#[derive(Serialize)]
pub struct ReactionDetail {
    pub emoji: String,
    pub count: i64,
    pub users: Vec<ReactionUser>,
}

pub async fn get_reaction_detail(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
    Query(q): Query<ReactionQuery>,
) -> Result<Json<ReactionDetail>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT r.user_id, u.username, u.avatar
         FROM reactions r
         JOIN users u ON u.id=r.user_id
         WHERE r.message_id=$1 AND r.emoji=$2
         LIMIT 100"
    )
    .bind(q.message_id)
    .bind(&q.emoji)
    .fetch_all(&state.db)
    .await?;

    let users: Vec<ReactionUser> = rows.iter().map(|r| ReactionUser {
        user_id: r.get("user_id"),
        username: r.get("username"),
        avatar: r.get("avatar"),
    }).collect();
    let count = users.len() as i64;

    Ok(Json(ReactionDetail { emoji: q.emoji, count, users }))
}

// Nickname serveur
#[derive(Deserialize)]
pub struct NicknameBody {
    pub nickname: Option<String>,
}

pub async fn set_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<NicknameBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if let Some(ref nick) = body.nickname {
        if nick.len() > 32 {
            return Err(AppError::BadRequest("Surnom trop long (max 32)".into()));
        }
    }
    sqlx::query("UPDATE server_members SET nickname=$1 WHERE user_id=$2 AND server_id=$3")
        .bind(body.nickname)
        .bind(claims.sub)
        .bind(server_id)
        .execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// DM read receipts
pub async fn mark_dm_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query(
        "INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at=NOW()"
    )
    .bind(dm_id).bind(claims.sub).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_dm_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT user_id, last_read_at FROM dm_read_receipts WHERE dm_id=$1"
    )
    .bind(dm_id).fetch_all(&state.db).await?;
    let list: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "user_id": r.get::<Uuid, _>("user_id"),
        "last_read_at": r.get::<DateTime<Utc>, _>("last_read_at"),
    })).collect();
    Ok(Json(list))
}

// OG preview (scraping basique)
#[derive(Deserialize)]
pub struct OgQuery {
    pub url: String,
}

#[derive(Serialize)]
pub struct OgMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
    pub url: String,
}

/// Vérifie qu'une URL n'est pas une adresse privée/locale (protection SSRF)
fn is_ssrf_safe_url(url: &str) -> bool {
    use std::net::IpAddr;

    // Doit commencer par https:// uniquement (pas http:// — pas de redirections non chiffrées)
    if !url.starts_with("https://") {
        return false;
    }

    // Extraire l'hôte
    let without_scheme = &url["https://".len()..];
    let host = without_scheme.split('/').next().unwrap_or("");
    // Retirer le port éventuel
    let host = host.split(':').next().unwrap_or("");

    if host.is_empty() {
        return false;
    }

    // Bloquer les hostnames locaux évidents
    let blocked_hosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0",
        "metadata.google.internal", "169.254.169.254"];
    for bh in &blocked_hosts {
        if host.eq_ignore_ascii_case(bh) {
            return false;
        }
    }

    // Bloquer les domaines .local et .internal
    let lh = host.to_lowercase();
    if lh.ends_with(".local") || lh.ends_with(".internal") || lh.ends_with(".localhost") {
        return false;
    }

    // Bloquer les IPs privées / loopback
    if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                if v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_unspecified()
                {
                    return false;
                }
            }
            IpAddr::V6(v6) => {
                if v6.is_loopback() || v6.is_unspecified() {
                    return false;
                }
            }
        }
    }

    true
}

pub async fn og_preview(
    _state: State<AppState>,
    _claims: Extension<Claims>,
    Query(q): Query<OgQuery>,
) -> Result<Json<OgMeta>, AppError> {
    // Validation URL anti-SSRF
    if !is_ssrf_safe_url(&q.url) {
        return Err(AppError::BadRequest("URL invalide ou non autorisée".into()));
    }

    // Fetch via reqwest (timeout strict, pas de redirections vers IPs privées)
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("ForgeChat/2.3.0 (+https://forgechat.heiphaistos.org)")
        .build()
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let resp = client.get(&q.url).send().await.map_err(|_| AppError::NotFound("URL inaccessible".into()))?;

    // Vérifier que la réponse finale ne redirige pas vers une IP privée
    let final_url = resp.url().to_string();
    if !is_ssrf_safe_url(&final_url) {
        return Err(AppError::BadRequest("Redirection vers URL non autorisée".into()));
    }
    let html = resp.text().await.map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    // Parse OG tags avec regex simple
    fn extract_meta(html: &str, property: &str) -> Option<String> {
        let needle = format!("property=\"{}\"", property);
        let pos = html.find(&needle)?;
        let after = &html[pos..];
        let content_pos = after.find("content=\"")?;
        let start = content_pos + 9;
        let slice = &after[start..];
        let end = slice.find('"')?;
        let val = slice[..end].trim().to_string();
        if val.is_empty() { None } else { Some(val) }
    }

    fn extract_title(html: &str) -> Option<String> {
        let start = html.find("<title")?;
        let after = &html[start..];
        let content_start = after.find('>')?;
        let slice = &after[content_start + 1..];
        let end = slice.find("</title")?;
        let val = slice[..end].trim().to_string();
        if val.is_empty() { None } else { Some(val) }
    }

    let title = extract_meta(&html, "og:title")
        .or_else(|| extract_meta(&html, "twitter:title"))
        .or_else(|| extract_title(&html));
    let description = extract_meta(&html, "og:description")
        .or_else(|| extract_meta(&html, "twitter:description"));
    let image = extract_meta(&html, "og:image")
        .or_else(|| extract_meta(&html, "twitter:image"));
    let site_name = extract_meta(&html, "og:site_name");

    if title.is_none() && description.is_none() {
        return Err(AppError::NotFound("Aucune métadonnée".into()));
    }

    Ok(Json(OgMeta { title, description, image, site_name, url: q.url }))
}

async fn _check_manage(user_id: Uuid, server_id: Uuid, state: &AppState) -> Result<(), AppError> {
    use crate::handlers::servers::require_permission;
    use crate::models::role::Permissions;
    // Déléguer à require_permission qui gère owner + ADMINISTRATOR + MANAGE_SERVER
    require_permission(state, user_id, server_id, Permissions::MANAGE_SERVER).await
}
