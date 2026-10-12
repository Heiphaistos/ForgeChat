//! Santé du serveur (audit 2026-10-12, améliorations n° 38 et 50).
//!
//! - `GET /api/status` : page d'état publique, sans compte. Seulement des états (`ok`,
//!   `degraded`, `down`, `off`), jamais de détail interne. Mise en cache 30 s (Redis).
//! - `GET /api/admin/health` : détail pour l'administrateur du site (latences, disque, version,
//!   connexions temps réel, erreurs serveur des 24 dernières heures).
use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use redis::AsyncCommands;
use serde_json::{json, Value};
use std::{net::SocketAddr, sync::OnceLock, time::{Duration, Instant}};

use crate::{error::Result, middleware::auth::Claims, state::AppState};

static STARTED: OnceLock<Instant> = OnceLock::new();

pub fn mark_started() {
    let _ = STARTED.set(Instant::now());
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Probe {
    Up(u128),
    Down,
    Off,
}

impl Probe {
    fn label(self) -> &'static str {
        match self {
            Probe::Up(ms) if ms > 1000 => "degraded",
            Probe::Up(_) => "ok",
            Probe::Down => "down",
            Probe::Off => "off",
        }
    }
    fn ms(self) -> Option<u128> {
        if let Probe::Up(ms) = self { Some(ms) } else { None }
    }
}

async fn timed<F: std::future::Future<Output = bool>>(f: F) -> Probe {
    let t = Instant::now();
    match tokio::time::timeout(Duration::from_secs(3), f).await {
        Ok(true) => Probe::Up(t.elapsed().as_millis()),
        _ => Probe::Down,
    }
}

async fn probe_db(state: &AppState) -> Probe {
    timed(async { sqlx::query("SELECT 1").execute(&state.db).await.is_ok() }).await
}

async fn probe_redis(state: &AppState) -> Probe {
    timed(async {
        let mut r = state.redis.lock().await;
        redis::cmd("PING").query_async::<_, String>(&mut *r).await.is_ok()
    })
    .await
}

async fn probe_livekit(state: &AppState) -> Probe {
    let Some(lk) = state.livekit.as_ref() else { return Probe::Off };
    let url = lk.internal_url.clone();
    timed(async move { state.http_client.get(&url).timeout(Duration::from_secs(3)).send().await.is_ok() }).await
}

fn email_state(state: &AppState) -> &'static str {
    if state.config.smtp_host.as_deref().is_some_and(|h| !h.is_empty()) || state.config.test_mailbox.is_some() { "ok" } else { "off" }
}

/// Octets libres et totaux du disque des fichiers envoyés.
fn disk(path: &str) -> Option<(u64, u64)> {
    let c = std::ffi::CString::new(path).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY : `c` est une chaîne C valide et `s` une structure possédée de la bonne taille.
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    let block = s.f_frsize as u64;
    Some((s.f_bavail as u64 * block, s.f_blocks as u64 * block))
}

/// État global : `down` si la base ou Redis tombent, `degraded` si un service secondaire flanche.
pub fn overall(db: Probe, redis: Probe, livekit: Probe) -> &'static str {
    if db == Probe::Down || redis == Probe::Down {
        "down"
    } else if livekit == Probe::Down || [db, redis, livekit].iter().any(|p| p.label() == "degraded") {
        "degraded"
    } else {
        "ok"
    }
}

/// GET /api/status — public.
pub async fn public_status(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    let ip = crate::privacy::client_key(&headers, &addr);
    if crate::handlers::password_reset::over_limit(&state, &format!("status_ip:{ip}"), 60, 60).await {
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "Trop de requêtes" })));
    }
    if let Ok(Some(cached)) = state.redis.lock().await.get::<_, Option<String>>("status:public").await {
        if let Ok(v) = serde_json::from_str::<Value>(&cached) {
            return (StatusCode::OK, Json(v));
        }
    }
    let (db, redis, livekit) = tokio::join!(probe_db(&state), probe_redis(&state), probe_livekit(&state));
    let body = json!({
        "status": overall(db, redis, livekit),
        "components": {
            "api": "ok",
            "database": db.label(),
            "realtime": redis.label(),
            "voice": livekit.label(),
            "email": email_state(&state),
        },
        "checked_at": chrono::Utc::now(),
    });
    let _: () = state.redis.lock().await.set_ex("status:public", body.to_string(), 30).await.unwrap_or(());
    (StatusCode::OK, Json(body))
}

/// GET /api/admin/health — administrateur du site.
pub async fn admin_health(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    crate::handlers::site_admin::require_site_admin(&state, &claims).await?;
    let (db, redis, livekit) = tokio::join!(probe_db(&state), probe_redis(&state), probe_livekit(&state));
    let (free, total) = disk(&state.config.upload_dir).unwrap_or((0, 0));
    let sockets = state.clients.read().await.len();
    Ok(Json(json!({
        "status": overall(db, redis, livekit),
        "version": crate::state::APP_VERSION,
        "uptime_secs": STARTED.get().map(|t| t.elapsed().as_secs()).unwrap_or(0),
        "database": { "state": db.label(), "ms": db.ms() },
        "redis": { "state": redis.label(), "ms": redis.ms() },
        "livekit": { "state": livekit.label(), "ms": livekit.ms() },
        "email": email_state(&state),
        "antivirus": if std::env::var("CLAMAV_ADDR").is_ok_and(|v| !v.trim().is_empty()) { "on" } else { "off" },
        "disk": { "free_bytes": free, "total_bytes": total },
        "connected_users": sockets,
    })))
}

/// Compte les réponses 5xx de l'API (alerte et tableau de bord, sans aucun détail de requête).
pub async fn count_server_errors(
    State(state): State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let resp = next.run(req).await;
    if resp.status().is_server_error() {
        tokio::spawn(async move { crate::security_events::record(&state, "server_error").await });
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overall_state() {
        assert_eq!(overall(Probe::Up(3), Probe::Up(1), Probe::Off), "ok");
        assert_eq!(overall(Probe::Up(3), Probe::Up(1), Probe::Down), "degraded");
        assert_eq!(overall(Probe::Up(1500), Probe::Up(1), Probe::Up(2)), "degraded");
        assert_eq!(overall(Probe::Down, Probe::Up(1), Probe::Up(2)), "down");
        assert!(disk("/").is_some_and(|(f, t)| t >= f && t > 0));
    }
}
