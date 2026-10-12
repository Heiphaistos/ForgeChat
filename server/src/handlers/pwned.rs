//! Mots de passe ayant fuité (audit 2026-10-12, amélioration n° 6).
//!
//! Le mot de passe ne quitte jamais l'appareil (dérivation côté client) : c'est l'appli qui calcule
//! son SHA-1 et ne demande ici que les 5 premiers caractères hexadécimaux (k-anonymat de
//! Have I Been Pwned). Le serveur relaie la requête (la CSP de l'appli n'autorise que notre
//! origine), avec remplissage (`Add-Padding`) et cache Redis de 24 h ; l'appli compare elle-même
//! la suite de l'empreinte. Ni HIBP ni ce serveur n'apprennent le mot de passe.
use axum::{
    extract::{ConnectInfo, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
};
use redis::AsyncCommands;
use std::net::SocketAddr;

use crate::{
    error::{AppError, Result},
    handlers::auth_v2::hit,
    state::AppState,
};

const CACHE_SECS: u64 = 86_400;

/// Préfixe valide : exactement 5 caractères hexadécimaux (rendu en majuscules).
pub fn normalize_prefix(p: &str) -> Option<String> {
    (p.len() == 5 && p.bytes().all(|c| c.is_ascii_hexdigit())).then(|| p.to_ascii_uppercase())
}

/// Garde les lignes `SUFFIXE:compte` réelles (le remplissage de HIBP a un compte de 0).
pub fn compact(body: &str) -> String {
    body.lines()
        .filter_map(|l| {
            let (suffix, count) = l.trim().split_once(':')?;
            let n: u64 = count.trim().parse().ok()?;
            (n > 0 && suffix.len() == 35 && suffix.bytes().all(|c| c.is_ascii_hexdigit())).then(|| format!("{suffix}:{n}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// GET /api/auth/pwned-range/:prefix — sans compte (inscription), limité par IP.
pub async fn range(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(prefix): Path<String>,
) -> Result<impl IntoResponse> {
    let prefix = normalize_prefix(&prefix).ok_or_else(|| AppError::BadRequest("Préfixe invalide".into()))?;
    hit(&state, &format!("pwned_ip:{}", crate::privacy::client_key(&headers, &addr)), 30, 900).await?;
    let key = format!("pwned:{prefix}");
    let cached: Option<String> = state.redis.lock().await.get(&key).await.unwrap_or(None);
    let body = match cached {
        Some(b) => b,
        None => {
            let resp = state
                .http_client
                .get(format!("https://api.pwnedpasswords.com/range/{prefix}"))
                .header("Add-Padding", "true")
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await
                .map_err(|_| AppError::Unavailable("Vérification indisponible".into()))?;
            if !resp.status().is_success() {
                return Err(AppError::Unavailable("Vérification indisponible".into()));
            }
            let text = resp.text().await.map_err(|_| AppError::Unavailable("Vérification indisponible".into()))?;
            let out = compact(&text);
            let _: () = state.redis.lock().await.set_ex(&key, &out, CACHE_SECS).await.unwrap_or(());
            out
        }
    };
    Ok((StatusCode::OK, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")], body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_and_body() {
        assert_eq!(normalize_prefix("5baa6").as_deref(), Some("5BAA6"));
        assert!(normalize_prefix("5BAA").is_none() && normalize_prefix("5BAG6").is_none() && normalize_prefix("../x1").is_none());
        let body = "1E4C9B93F3F0682250B6CF8331B7EE68FD8:10434004\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\r\nZZ:3\r\n";
        assert_eq!(compact(body), "1E4C9B93F3F0682250B6CF8331B7EE68FD8:10434004");
    }
}
