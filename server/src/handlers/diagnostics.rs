//! Remontée automatique des erreurs des applis (web, Windows, Linux).
//!
//! `POST /api/diagnostics/report` est PUBLIC : une page blanche n'a pas de
//! session. Garde-fous : corps borné (route), champs tronqués, limite Redis par
//! IP, jetons retirés des textes, dédoublonnage par empreinte (même erreur =
//! `count + 1`). La lecture est réservée aux comptes de `FORGECHAT_ADMIN_USER_IDS`.

use axum::{
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::password_reset::{client_ip, over_limit},
    middleware::auth::{verify_token, Claims},
    state::AppState,
};

/// Taille maximale du corps de la requête (appliquée sur la route dans main.rs).
/// Un peu au-dessus de la somme des champs : le journal (200 000 car.) grossit
/// à l'échappement JSON.
pub const MAX_BODY_BYTES: usize = 320 * 1024;
const MAX_MESSAGE: usize = 2_000;
const MAX_STACK: usize = 20_000;
const MAX_LOG: usize = 200_000;
const MAX_SHORT: usize = 512;
const MAX_URL: usize = 2_000;
/// Rapports par IP et par heure.
const RATE_MAX: i64 = 30;
const RATE_WINDOW_SECS: i64 = 3600;
/// Rétention, appliquée par la boucle de maintenance de main.rs.
pub const RETENTION_DAYS: i32 = 30;

const KINDS: &[&str] = &[
    "js_error",
    "unhandled_rejection",
    "react_crash",
    "startup_failure",
    "desktop_log",
    "manual",
];

#[derive(Deserialize)]
pub struct ReportInput {
    pub platform: Option<String>,
    pub app_version: Option<String>,
    pub kind: String,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub log: Option<String>,
    pub user_agent: Option<String>,
    pub url: Option<String>,
}

/// Garde les `max` premiers caractères (coupe sur une frontière de caractère).
fn truncate_head(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…[tronqué]", &s[..i]),
        None => s.to_string(),
    }
}

/// Garde les `max` DERNIERS caractères : la fin d'un journal est la plus utile.
fn truncate_tail(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    let (i, _) = s.char_indices().nth(n - max).unwrap_or((0, ' '));
    format!("[tronqué]…{}", &s[i..])
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-._~+/%=".contains(c)
}

/// Remplace les secrets visibles (jetons Bearer, access/refresh_token, JWT,
/// mots de passe) par `[masqué]`. Les marqueurs sont ASCII : l'index en
/// minuscules ASCII a les mêmes positions d'octets que la chaîne d'origine.
pub fn scrub_secrets(s: &str) -> String {
    const MARKERS: &[&str] = &[
        "bearer ",
        "access_token",
        "refresh_token",
        "password",
        "token=",
        "eyj",
    ];
    const MASK: &str = "[masqué]";
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let rest = &lower[i..];
        let prev_is_token = s[..i].chars().next_back().is_some_and(is_token_char);
        let marker = MARKERS
            .iter()
            .find(|m| rest.starts_with(**m) && !(**m == "eyj" && prev_is_token));
        let Some(m) = marker else {
            let c = s[i..].chars().next().unwrap_or(' ');
            out.push(c);
            i += c.len_utf8();
            continue;
        };
        if *m == "eyj" {
            // Un JWT commence par « eyJ » (en-tête JSON en base64).
            let run: usize = s[i..].chars().take_while(|c| is_token_char(*c)).map(char::len_utf8).sum();
            if run >= 20 {
                out.push_str(MASK);
            } else {
                out.push_str(&s[i..i + run]);
            }
            i += run;
            continue;
        }
        out.push_str(&s[i..i + m.len()]);
        i += m.len();
        // Séparateurs : `=`, `:`, guillemets, espaces (JSON, en-têtes, URL).
        let sep: usize = s[i..]
            .chars()
            .take_while(|c| matches!(c, '=' | ':' | '"' | '\'' | ' '))
            .map(char::len_utf8)
            .sum();
        out.push_str(&s[i..i + sep]);
        i += sep;
        let run: usize = s[i..].chars().take_while(|c| is_token_char(*c)).map(char::len_utf8).sum();
        // « forgot-password » sans séparateur n'est pas un secret.
        if run > 0 && (sep > 0 || m.ends_with(['=', ' '])) {
            out.push_str(MASK);
            i += run;
        }
    }
    out
}

fn clean(s: Option<&str>, max: usize) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| scrub_secrets(&truncate_head(s, max)))
}

/// Plateforme : mot court en minuscules, sinon « other ».
fn normalize_platform(p: Option<&str>) -> String {
    let p = p.unwrap_or("").trim().to_ascii_lowercase();
    if !p.is_empty() && p.len() <= 16 && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        p
    } else {
        "other".into()
    }
}

/// Utilisateur connecté si un jeton valide accompagne le rapport (facultatif).
fn optional_user(state: &AppState, headers: &HeaderMap) -> Option<Uuid> {
    let token = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(';').find_map(|p| p.trim().strip_prefix("access_token=").map(str::to_string)))
        .or_else(|| {
            headers
                .get("Authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(str::to_string)
        })?;
    verify_token(&token, &state.config.jwt_secret, &state.config.jwt_issuer).map(|c| c.sub)
}

fn fingerprint(parts: &[&str]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for p in parts {
        h.update(p.as_bytes());
        h.update([0u8]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// POST /api/diagnostics/report — public, 204.
pub async fn submit_report(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<ReportInput>,
) -> Result<StatusCode> {
    if !KINDS.contains(&body.kind.as_str()) {
        return Err(AppError::BadRequest("Type de rapport invalide".into()));
    }
    let ip = client_ip(&headers, &addr);
    if over_limit(&state, &format!("diag_ip:{ip}"), RATE_MAX, RATE_WINDOW_SECS).await {
        return Err(AppError::TooManyRequests);
    }

    let platform = normalize_platform(body.platform.as_deref());
    let version = clean(body.app_version.as_deref(), 64);
    let message = clean(body.message.as_deref(), MAX_MESSAGE).unwrap_or_default();
    let stack = clean(body.stack.as_deref(), MAX_STACK);
    let log = body
        .log
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| scrub_secrets(&truncate_tail(s, MAX_LOG)));
    let header_ua = headers.get("user-agent").and_then(|v| v.to_str().ok());
    let user_agent = clean(body.user_agent.as_deref().or(header_ua), MAX_SHORT);
    // Jamais de query string ni de fragment : ils portent parfois des jetons.
    let url = clean(body.url.as_deref().map(|u| u.split(['?', '#']).next().unwrap_or("")), MAX_URL);
    let user_id = optional_user(&state, &headers);

    // Même erreur = même empreinte. Un signalement manuel reste toujours distinct.
    let unique = if body.kind == "manual" { Uuid::new_v4().to_string() } else { String::new() };
    let stack_head: String = stack.as_deref().unwrap_or("").chars().take(2_000).collect();
    let fp = fingerprint(&[
        &platform,
        &body.kind,
        version.as_deref().unwrap_or(""),
        &message,
        &stack_head,
        &unique,
    ]);

    sqlx::query(
        "INSERT INTO client_reports
            (user_id, platform, app_version, kind, message, stack, log, user_agent, url, fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (fingerprint) DO UPDATE SET
            count = client_reports.count + 1,
            last_seen = NOW(),
            log = COALESCE(EXCLUDED.log, client_reports.log),
            user_id = COALESCE(EXCLUDED.user_id, client_reports.user_id)",
    )
    .bind(user_id)
    .bind(&platform)
    .bind(&version)
    .bind(&body.kind)
    .bind(&message)
    .bind(&stack)
    .bind(&log)
    .bind(&user_agent)
    .bind(&url)
    .bind(&fp)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Comptes autorisés : `FORGECHAT_ADMIN_USER_IDS` (UUID séparés par des
/// virgules). Absente ou vide = personne.
fn is_admin(user_id: Uuid) -> bool {
    std::env::var("FORGECHAT_ADMIN_USER_IDS")
        .map(|v| v.split(',').any(|s| s.trim().parse::<Uuid>().ok() == Some(user_id)))
        .unwrap_or(false)
}

fn require_admin(claims: &Claims) -> Result<()> {
    if is_admin(claims.sub) { Ok(()) } else { Err(AppError::Forbidden) }
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub platform: Option<String>,
    pub kind: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReportSummary {
    pub id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    pub user_id: Option<Uuid>,
    pub platform: String,
    pub app_version: Option<String>,
    pub kind: String,
    pub message: String,
    pub count: i32,
    pub has_log: bool,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ReportDetail {
    pub id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub platform: String,
    pub app_version: Option<String>,
    pub kind: String,
    pub message: String,
    pub stack: Option<String>,
    pub log: Option<String>,
    pub user_agent: Option<String>,
    pub url: Option<String>,
    pub count: i32,
}

/// GET /api/admin/diagnostics?limit&offset&platform&kind
pub async fn list_reports(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<ListQuery>,
) -> Result<Json<serde_json::Value>> {
    require_admin(&claims)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);
    let platform = q.platform.filter(|s| !s.is_empty());
    let kind = q.kind.filter(|s| !s.is_empty());
    let items: Vec<ReportSummary> = sqlx::query_as(
        "SELECT id, created_at, last_seen, user_id, platform, app_version, kind,
                LEFT(message, 300) AS message, count, (log IS NOT NULL) AS has_log
         FROM client_reports
         WHERE ($1::text IS NULL OR platform = $1) AND ($2::text IS NULL OR kind = $2)
         ORDER BY last_seen DESC
         LIMIT $3 OFFSET $4",
    )
    .bind(&platform)
    .bind(&kind)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM client_reports
         WHERE ($1::text IS NULL OR platform = $1) AND ($2::text IS NULL OR kind = $2)",
    )
    .bind(&platform)
    .bind(&kind)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "items": items, "total": total })))
}

/// GET /api/admin/diagnostics/:id
pub async fn get_report(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<ReportDetail>> {
    require_admin(&claims)?;
    let report: Option<ReportDetail> = sqlx::query_as(
        "SELECT r.id, r.created_at, r.last_seen, r.user_id, u.username, r.platform, r.app_version,
                r.kind, r.message, r.stack, r.log, r.user_agent, r.url, r.count
         FROM client_reports r LEFT JOIN users u ON u.id = r.user_id
         WHERE r.id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    report.map(Json).ok_or_else(|| AppError::NotFound("Rapport introuvable".into()))
}

/// DELETE /api/admin/diagnostics/:id
pub async fn delete_report(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode> {
    require_admin(&claims)?;
    let res = sqlx::query("DELETE FROM client_reports WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Rapport introuvable".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Purge des rapports plus vieux que la rétention (boucle de maintenance).
pub async fn purge_old(state: &AppState) {
    if let Err(e) = sqlx::query("DELETE FROM client_reports WHERE last_seen < NOW() - make_interval(days => $1)")
        .bind(RETENTION_DAYS)
        .execute(&state.db)
        .await
    {
        tracing::warn!("Purge des rapports d'erreurs : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masque_les_jetons() {
        let s = scrub_secrets("Authorization: Bearer abc.def-ghi fin");
        assert_eq!(s, "Authorization: Bearer [masqué] fin");
        let s = scrub_secrets("GET /ws?access_token=XYZ123&x=1");
        assert_eq!(s, "GET /ws?access_token=[masqué]&x=1");
        let s = scrub_secrets(r#"{"refresh_token":"r3fr3sh","ok":1}"#);
        assert_eq!(s, r#"{"refresh_token":"[masqué]","ok":1}"#);
        let s = scrub_secrets(r#"{"password": "hunter2"}"#);
        assert_eq!(s, r#"{"password": "[masqué]"}"#);
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig";
        assert_eq!(scrub_secrets(&format!("jeton {jwt} ici")), "jeton [masqué] ici");
        // Texte ordinaire (et accents) intact.
        assert_eq!(scrub_secrets("Échec : réseau coupé"), "Échec : réseau coupé");
        assert_eq!(scrub_secrets("Chargement échoué"), "Chargement échoué");
        assert_eq!(scrub_secrets("/api/auth/forgot-password/x"), "/api/auth/forgot-password/x");
    }

    #[test]
    fn tronque_sur_les_caracteres() {
        assert_eq!(truncate_head("ééééé", 3), "ééé…[tronqué]");
        assert_eq!(truncate_head("abc", 3), "abc");
        assert_eq!(truncate_tail("abcdéf", 2), "[tronqué]…éf");
        assert_eq!(truncate_tail("ab", 5), "ab");
        let long = "x".repeat(MAX_MESSAGE + 50);
        assert!(clean(Some(&long), MAX_MESSAGE).unwrap().chars().count() <= MAX_MESSAGE + 20);
    }

    #[test]
    fn plateforme_normalisee() {
        assert_eq!(normalize_platform(Some("Linux")), "linux");
        assert_eq!(normalize_platform(Some("<script>")), "other");
        assert_eq!(normalize_platform(None), "other");
    }
}
