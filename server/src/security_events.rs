//! Événements de sécurité et alertes (audit 2026-10-12, amélioration n° 16).
//!
//! Chaque événement incrémente un compteur Redis par heure (`secev:<type>:<heure>`, gardé 49 h),
//! sans aucune donnée personnelle : ni compte, ni IP. Toutes les 5 minutes, `check_alerts`
//! compare l'heure en cours aux seuils ; au premier dépassement de l'heure, une alerte part dans
//! les journaux (niveau erreur) et, si `SECURITY_ALERT_EMAIL` est défini, par e-mail.
//! Les 24 dernières heures sont lisibles dans Administration (`GET /api/admin/security-events`).
use axum::{extract::State, Extension, Json};
use redis::AsyncCommands;
use serde_json::{json, Value};

use crate::{error::Result, middleware::auth::Claims, state::AppState};

/// Type d'événement et seuil d'alerte par heure.
pub const KINDS: &[(&str, &str, i64)] = &[
    ("login_failed", "Connexions refusées (mauvais mot de passe)", 200),
    ("totp_failed", "Codes de double authentification refusés", 50),
    ("rate_limited", "Limites de débit atteintes (connexion, inscription)", 300),
    ("csp", "Violations CSP / Trusted Types (tentative d'injection ?)", 50),
    ("panic", "Comptes verrouillés en urgence", 5),
    ("new_device", "Connexions depuis un nouvel appareil", 500),
    ("server_error", "Erreurs serveur (réponses 5xx)", 50),
];

fn hour(now: i64) -> i64 {
    now / 3600
}

fn key(kind: &str, h: i64) -> String {
    format!("secev:{kind}:{h}")
}

/// Compte un événement (sans effet si le type est inconnu ou Redis indisponible).
pub async fn record(state: &AppState, kind: &str) {
    if !KINDS.iter().any(|(k, _, _)| *k == kind) {
        return;
    }
    let k = key(kind, hour(chrono::Utc::now().timestamp()));
    let mut redis = state.redis.lock().await;
    let n: i64 = redis.incr(&k, 1).await.unwrap_or(0);
    if n == 1 {
        let _: () = redis.expire(&k, 49 * 3600).await.unwrap_or(());
    }
}

async fn last_hours(state: &AppState, kind: &str, hours: i64) -> Vec<i64> {
    let now = hour(chrono::Utc::now().timestamp());
    let keys: Vec<String> = (0..hours).rev().map(|i| key(kind, now - i)).collect();
    let mut redis = state.redis.lock().await;
    let vals: Vec<Option<i64>> = redis.mget(&keys).await.unwrap_or_default();
    vals.into_iter().map(|v| v.unwrap_or(0)).collect()
}

/// Types dont l'heure en cours dépasse le seuil.
pub fn over_threshold(current: &[(&str, i64)]) -> Vec<String> {
    current
        .iter()
        .filter(|(kind, n)| KINDS.iter().any(|(k, _, max)| k == kind && n > max))
        .map(|(k, _)| k.to_string())
        .collect()
}

/// Vérifie les seuils ; une seule alerte par type et par heure.
pub async fn check_alerts(state: &AppState) {
    let h = hour(chrono::Utc::now().timestamp());
    let mut current = Vec::new();
    for (kind, _, _) in KINDS {
        let n = last_hours(state, kind, 1).await.first().copied().unwrap_or(0);
        current.push((*kind, n));
    }
    for kind in over_threshold(&current) {
        let first: bool = {
            let mut redis = state.redis.lock().await;
            redis::cmd("SET")
                .arg(format!("secalert:{kind}:{h}"))
                .arg(1)
                .arg("NX")
                .arg("EX")
                .arg(7200)
                .query_async::<_, Option<String>>(&mut *redis)
                .await
                .ok()
                .flatten()
                .is_some()
        };
        if !first {
            continue;
        }
        let n = current.iter().find(|(k, _)| *k == kind).map(|(_, n)| *n).unwrap_or(0);
        let label = KINDS.iter().find(|(k, _, _)| *k == kind).map(|(_, l, _)| *l).unwrap_or("");
        tracing::error!("ALERTE SÉCURITÉ : {label} — {n} cette heure-ci");
        if let Some(to) = std::env::var("SECURITY_ALERT_EMAIL").ok().filter(|s| s.contains('@')) {
            let html = format!(
                "<p><strong>Alerte de sécurité ForgeChat</strong></p><p>{label} : <strong>{n}</strong> \
                 depuis le début de l'heure (seuil dépassé).</p><p>Détail : Administration &gt; Sécurité.</p>"
            );
            if let Err(e) = crate::email::send_email(&state.config, &to, "[ForgeChat] Alerte de sécurité", html).await {
                tracing::warn!("Alerte de sécurité non envoyée par e-mail : {e}");
            }
        }
    }
}

/// GET /api/admin/security-events : 24 dernières heures par type (administrateur du site).
pub async fn admin_events(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Value>> {
    crate::handlers::site_admin::require_site_admin(&state, &claims).await?;
    let mut kinds = Vec::new();
    for (kind, label, threshold) in KINDS {
        let hours = last_hours(&state, kind, 24).await;
        kinds.push(json!({
            "kind": kind,
            "label": label,
            "threshold_per_hour": threshold,
            "hours": hours,
            "total_24h": hours.iter().sum::<i64>(),
        }));
    }
    Ok(Json(json!({ "kinds": kinds })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thresholds() {
        assert!(over_threshold(&[("login_failed", 200), ("csp", 10)]).is_empty());
        assert_eq!(over_threshold(&[("login_failed", 201), ("csp", 51)]), vec!["login_failed", "csp"]);
        assert!(over_threshold(&[("inconnu", 1_000_000)]).is_empty());
    }
}
