//! F8 (audit 2026-10-10) : `/uploads` n'est plus public. Hors dossiers publics (avatars,
//! bannières, icônes, emojis, autocollants, sons), un fichier n'est servi qu'avec
//! `?exp=<unix>&sig=<base64url(HMAC-SHA256(clé, "<chemin>|<exp>"))>` valide et non expiré,
//! sinon 404. La clé est dérivée de JWT_SECRET (HKDF, info "forgechat uploads v1").
//!
//! Le serveur signe les URL de pièces jointes au moment où il les sérialise, donc après le
//! contrôle d'accès de la route qui les renvoie (une URL signée = droit d'accès ~6 h).
use std::sync::OnceLock;

use axum::{extract::Request, http::StatusCode, middleware::Next, response::{IntoResponse, Response}};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::Mac;

use crate::crypto::{hkdf32, HmacSha256};

static KEY: OnceLock<[u8; 32]> = OnceLock::new();

/// Durée de validité : 6 h au moins (longues sessions), arrondie à l'heure suivante pour que
/// le cache du navigateur reconnaisse la même URL pendant une heure.
pub const TTL_SECS: i64 = 6 * 3600;

/// Sous-chemins de `/uploads/` servis sans signature (images de profil et de serveur,
/// emojis, autocollants, sons de soundboard, icônes de rôle).
const PUBLIC_PREFIXES: &[&str] = &[
    "avatars/", "banners/", "member_profiles/", "server-icons/", "server-banners/",
    "emojis/", "stickers/", "sounds/", "role-icon-",
];

pub fn init(jwt_secret: &str) {
    let _ = KEY.set(hkdf32(jwt_secret.as_bytes(), b"forgechat uploads v1"));
}

fn is_public(rel: &str) -> bool {
    PUBLIC_PREFIXES.iter().any(|p| rel.starts_with(p))
}

fn mac(key: &[u8; 32], path: &str, exp: i64) -> HmacSha256 {
    let mut m = HmacSha256::new_from_slice(key).expect("hmac");
    m.update(path.as_bytes());
    m.update(b"|");
    m.update(exp.to_string().as_bytes());
    m
}

fn sign_with(key: &[u8; 32], url: &str, now: i64) -> String {
    let Some(rel) = url.strip_prefix("/uploads/") else { return url.to_string() };
    if is_public(rel) || url.contains('?') {
        return url.to_string();
    }
    let exp = (now + TTL_SECS).div_euclid(3600) * 3600 + 3600;
    let sig = URL_SAFE_NO_PAD.encode(mac(key, url, exp).finalize().into_bytes());
    format!("{url}?exp={exp}&sig={sig}")
}

/// URL signée d'un fichier non public de `/uploads/` ; toute autre URL est rendue telle quelle.
pub fn sign_url(url: &str) -> String {
    match KEY.get() {
        Some(k) => sign_with(k, url, chrono::Utc::now().timestamp()),
        None => url.to_string(),
    }
}

pub fn sign_opt(url: Option<String>) -> Option<String> {
    url.map(|u| sign_url(&u))
}

/// `#[serde(serialize_with = ...)]` des champs d'URL de pièce jointe.
pub fn ser<S: serde::Serializer>(url: &str, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&sign_url(url))
}

pub fn ser_opt<S: serde::Serializer>(url: &Option<String>, s: S) -> Result<S::Ok, S::Error> {
    match url {
        Some(u) => s.serialize_some(&sign_url(u)),
        None => s.serialize_none(),
    }
}

fn verify_with(key: &[u8; 32], path: &str, query: Option<&str>, now: i64) -> bool {
    let Some(rel) = path.strip_prefix("/uploads/") else { return false };
    if is_public(rel) {
        return true;
    }
    let (mut exp, mut sig) = (None, None);
    for kv in query.unwrap_or("").split('&') {
        match kv.split_once('=') {
            Some(("exp", v)) => exp = v.parse::<i64>().ok(),
            Some(("sig", v)) => sig = URL_SAFE_NO_PAD.decode(v).ok(),
            _ => {}
        }
    }
    let (Some(exp), Some(sig)) = (exp, sig) else { return false };
    // Une échéance plus lointaine que la durée de validité n'a pas été émise par ce serveur.
    exp > now && exp <= now + TTL_SECS + 7200 && mac(key, path, exp).verify_slice(&sig).is_ok()
}

/// Garde placée devant `ServeDir` (monté sur `/uploads`, qui retire le préfixe).
pub async fn guard(req: Request, next: Next) -> Response {
    let path = format!("/uploads{}", req.uri().path());
    let ok = KEY.get().is_some_and(|k| verify_with(k, &path, req.uri().query(), chrono::Utc::now().timestamp()));
    if !ok {
        return StatusCode::NOT_FOUND.into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const K: [u8; 32] = [7; 32];

    fn split(u: &str) -> (&str, Option<&str>) {
        match u.split_once('?') {
            Some((p, q)) => (p, Some(q)),
            None => (u, None),
        }
    }

    #[test]
    fn signed_urls() {
        let now = 1_800_000_000;
        let url = "/uploads/0b6f3c2e-8d1a-4c5e-9f7a-1b2c3d4e5f60.enc";
        let signed = sign_with(&K, url, now);
        let (p, q) = split(&signed);
        assert_eq!(p, url);
        assert!(verify_with(&K, p, q, now), "signée = servie");
        assert!(verify_with(&K, p, q, now + TTL_SECS), "valable au moins 6 h");
        assert!(!verify_with(&K, p, q, now + TTL_SECS + 3601), "expirée");
        assert!(!verify_with(&K, p, None, now), "non signée");
        assert!(!verify_with(&[8; 32], p, q, now), "autre clé");
        assert!(!verify_with(&K, "/uploads/autre.enc", q, now), "signature d'un autre fichier");
        let exp: i64 = q.unwrap().split('&').next().unwrap()[4..].parse().unwrap();
        let forged = format!("exp={}&{}", exp + 3600, q.unwrap().split('&').nth(1).unwrap());
        assert!(!verify_with(&K, p, Some(&forged), now), "échéance modifiée");
        // Mêmes URL pendant une heure (cache).
        assert_eq!(signed, sign_with(&K, url, now + 1));
        // Dossiers publics : pas de signature.
        for public in ["/uploads/avatars/a.png", "/uploads/emojis/e.gif", "/uploads/role-icon-x.png", "/uploads/sounds/s.mp3"] {
            assert_eq!(sign_with(&K, public, now), public);
            assert!(verify_with(&K, public, None, now));
        }
        assert_eq!(sign_with(&K, "https://ailleurs/x.png", now), "https://ailleurs/x.png");
        assert_eq!(sign_with(&K, &signed, now), signed, "jamais signée deux fois");
    }

    /// Garde devant ServeDir, comme dans main.rs : 404 sans signature, 200 signée, 404 expirée,
    /// 200 sans signature pour un dossier public.
    #[tokio::test]
    async fn guard_in_front_of_serve_dir() {
        use tower::Service;
        let dir = std::env::temp_dir().join(format!("fc-upl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("avatars")).unwrap();
        std::fs::write(dir.join("f.enc"), b"blob").unwrap();
        std::fs::write(dir.join("avatars/a.png"), b"png").unwrap();
        init("secret-de-test-assez-long-pour-demarrer-0123456789");
        let app = axum::Router::new().nest_service(
            "/uploads",
            tower::ServiceBuilder::new()
                .layer(axum::middleware::from_fn(guard))
                .service(tower_http::services::ServeDir::new(&dir)),
        );
        let get = |uri: String| {
            let mut app = app.clone();
            async move {
                // Router est toujours prêt (poll_ready immédiat).
                app.call(axum::http::Request::get(uri).body(axum::body::Body::empty()).unwrap())
                    .await
                    .unwrap()
                    .status()
            }
        };
        let now = chrono::Utc::now().timestamp();
        let key = KEY.get().unwrap();
        assert_eq!(get("/uploads/f.enc".into()).await, StatusCode::NOT_FOUND);
        assert_eq!(get(sign_url("/uploads/f.enc")).await, StatusCode::OK);
        assert_eq!(get(sign_with(key, "/uploads/f.enc", now - 8 * 3600)).await, StatusCode::NOT_FOUND);
        assert_eq!(get("/uploads/avatars/a.png".into()).await, StatusCode::OK);
        assert_eq!(get(sign_url("/uploads/absent.enc")).await, StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
