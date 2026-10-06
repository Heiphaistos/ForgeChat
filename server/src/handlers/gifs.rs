//! Recherche de GIF par le serveur (KLIPY, API compatible Tenor v2).
//!
//! L'API Tenor a fermé le 30/06/2026 ; le sélecteur GIF du web l'appelait
//! directement avec une clé intégrée au client. Ici, la clé reste sur le
//! serveur (`KLIPY_API_KEY`) : les clients (web, app mobile) appellent ces
//! routes, KLIPY ne voit que le serveur (ni l'IP ni l'identité des
//! utilisateurs). Seules les images sont ensuite chargées depuis le CDN KLIPY.
//!
//! - Désactivé sans `KLIPY_API_KEY` : `/gifs/status` répond `enabled: false`.
//! - Réponses mises en cache dans Redis (recherche 5 min, tendances 10 min) :
//!   la clé de test KLIPY est limitée à 100 requêtes par heure.
//! - 60 requêtes par minute et par utilisateur.
//! - Filtre de contenu `KLIPY_CONTENT_FILTER` (off|low|medium|high, défaut medium).

use std::sync::OnceLock;
use std::time::Duration;

use axum::{
    extract::{Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

const KLIPY_BASE: &str = "https://api.klipy.com/v2";
const PAGE_SIZE: u32 = 24;
const MAX_QUERY_CHARS: usize = 100;
const RATE_PER_MINUTE: i64 = 60;

struct GifConfig {
    key: String,
    content_filter: &'static str,
    base: String,
}

fn config() -> Option<&'static GifConfig> {
    static CFG: OnceLock<Option<GifConfig>> = OnceLock::new();
    CFG.get_or_init(|| {
        let key = std::env::var("KLIPY_API_KEY").ok()?.trim().to_string();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return None;
        }
        let content_filter = match std::env::var("KLIPY_CONTENT_FILTER").unwrap_or_default().trim() {
            "off" => "off",
            "low" => "low",
            "high" => "high",
            _ => "medium",
        };
        // Tests locaux uniquement : un binaire de production parle toujours à KLIPY.
        #[cfg(debug_assertions)]
        let base = std::env::var("KLIPY_BASE_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| KLIPY_BASE.into());
        #[cfg(not(debug_assertions))]
        let base = KLIPY_BASE.to_string();
        Some(GifConfig { key, content_filter, base })
    })
    .as_ref()
}

/// Image servie par le CDN KLIPY, en https (jamais une autre adresse).
pub fn is_klipy_media_url(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    if u.scheme() != "https" || u.port().is_some() || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    let Some(prefix) = host.strip_suffix(".klipy.com") else { return false };
    let num = prefix.strip_prefix("static").unwrap_or("x");
    num.chars().all(|c| c.is_ascii_digit()) && num.len() <= 2 && url.len() <= 500
}

fn valid_pos(pos: &str) -> bool {
    pos.len() <= 64 && pos.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Réponse KLIPY (format Tenor v2) → liste réduite et validée.
pub fn normalize(resp: &Value) -> Value {
    let items: Vec<Value> = resp["results"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    let gif = &r["media_formats"]["gif"];
                    let url = gif["url"].as_str()?;
                    if !is_klipy_media_url(url) {
                        return None;
                    }
                    let preview = ["tinygif", "nanogif", "gif"]
                        .iter()
                        .filter_map(|f| r["media_formats"][*f]["url"].as_str())
                        .find(|u| is_klipy_media_url(u))
                        .unwrap_or(url);
                    let dims = gif["dims"].as_array();
                    let dim = |i: usize| dims.and_then(|d| d.get(i)).and_then(Value::as_u64).unwrap_or(0).min(4096);
                    let title: String = r["content_description"]
                        .as_str()
                        .or_else(|| r["title"].as_str())
                        .unwrap_or("")
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(120)
                        .collect();
                    Some(json!({
                        "id": r["id"].as_str().unwrap_or("").chars().take(64).collect::<String>(),
                        "title": title,
                        "url": url,
                        "preview": preview,
                        "width": dim(0),
                        "height": dim(1),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    let next = resp["next"].as_str().filter(|p| !p.is_empty() && *p != "0" && valid_pos(p));
    json!({ "results": items, "next": next })
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/// GET /api/gifs/status
pub async fn status() -> Json<Value> {
    Json(json!({ "enabled": config().is_some(), "provider": "klipy", "search_placeholder": "Search KLIPY" }))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub pos: Option<String>,
}

/// GET /api/gifs/search?q=…&pos=…
pub async fn search(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<Value>> {
    let q: String = params.q.unwrap_or_default().trim().chars().filter(|c| !c.is_control()).take(MAX_QUERY_CHARS).collect();
    if q.is_empty() {
        return Err(AppError::BadRequest("Recherche vide".into()));
    }
    fetch(&state, &claims, "search", Some(&q), params.pos.as_deref(), 300).await
}

/// GET /api/gifs/trending?pos=…
pub async fn trending(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<Value>> {
    fetch(&state, &claims, "featured", None, params.pos.as_deref(), 600).await
}

async fn fetch(state: &AppState, claims: &Claims, kind: &str, q: Option<&str>, pos: Option<&str>, ttl: u64) -> Result<Json<Value>> {
    use redis::AsyncCommands;
    let cfg = config().ok_or_else(|| AppError::BadRequest("GIF non configurés sur ce serveur".into()))?;
    let pos = pos.filter(|p| !p.is_empty());
    if pos.is_some_and(|p| !valid_pos(p)) {
        return Err(AppError::BadRequest("Pagination invalide".into()));
    }

    {
        let key = format!("gifs_rl:{}", claims.sub);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&key, 1i64).await.unwrap_or(0);
        if count == 1 {
            let _: () = redis.expire(&key, 60).await.unwrap_or(());
        }
        if count > RATE_PER_MINUTE {
            return Err(AppError::TooManyRequests);
        }
    }

    let cache_key = format!("gifs:{kind}:{}:{}", q.unwrap_or("").to_lowercase(), pos.unwrap_or(""));
    {
        let mut redis = state.redis.lock().await;
        let cached: Option<String> = redis.get(&cache_key).await.unwrap_or(None);
        if let Some(v) = cached.and_then(|c| serde_json::from_str::<Value>(&c).ok()) {
            return Ok(Json(v));
        }
    }

    let mut url = reqwest::Url::parse(&format!("{}/{kind}", cfg.base)).map_err(|e| AppError::Internal(e.into()))?;
    {
        let mut qp = url.query_pairs_mut();
        qp.append_pair("key", &cfg.key)
            .append_pair("limit", &PAGE_SIZE.to_string())
            .append_pair("media_filter", "gif,tinygif")
            .append_pair("contentfilter", cfg.content_filter);
        if let Some(q) = q {
            qp.append_pair("q", q);
        }
        if let Some(p) = pos {
            qp.append_pair("pos", p);
        }
    }
    let resp = state
        .http_client
        .get(url)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("KLIPY injoignable : {e}");
            AppError::BadRequest("GIF indisponibles pour le moment".into())
        })?;
    if !resp.status().is_success() {
        tracing::warn!("KLIPY a répondu {}", resp.status());
        return Err(AppError::BadRequest("GIF indisponibles pour le moment".into()));
    }
    let body: Value = resp.json().await.map_err(|_| AppError::BadRequest("Réponse GIF invalide".into()))?;
    let out = normalize(&body);

    let mut redis = state.redis.lock().await;
    let _: () = redis.set_ex(&cache_key, out.to_string(), ttl).await.unwrap_or(());
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_klipy_cdn_urls() {
        assert!(is_klipy_media_url("https://static.klipy.com/ii/abc/def/hello.gif"));
        assert!(is_klipy_media_url("https://static2.klipy.com/x.gif"));
        assert!(!is_klipy_media_url("http://static.klipy.com/x.gif"));
        assert!(!is_klipy_media_url("https://static.klipy.com.evil.example/x.gif"));
        assert!(!is_klipy_media_url("https://evil.example/static.klipy.com/x.gif"));
        assert!(!is_klipy_media_url("https://api.klipy.com/x.gif"));
        assert!(!is_klipy_media_url("https://static.klipy.com:8443/x.gif"));
        assert!(!is_klipy_media_url("https://user@static.klipy.com/x.gif"));
        assert!(!is_klipy_media_url("javascript:alert(1)"));
    }

    #[test]
    fn normalize_keeps_valid_items_only() {
        let resp = json!({
            "results": [
                { "id": "1", "content_description": "Hello", "media_formats": {
                    "gif": { "url": "https://static.klipy.com/a/hello.gif", "dims": [480, 270] },
                    "tinygif": { "url": "https://static1.klipy.com/a/hello-tiny.gif", "dims": [220, 124] } } },
                { "id": "2", "title": "evil", "media_formats": { "gif": { "url": "https://evil.example/x.gif" } } },
                { "id": "3", "title": "no gif", "media_formats": {} }
            ],
            "next": "CAgQ.48"
        });
        let out = normalize(&resp);
        let items = out["results"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["url"], "https://static.klipy.com/a/hello.gif");
        assert_eq!(items[0]["preview"], "https://static1.klipy.com/a/hello-tiny.gif");
        assert_eq!(items[0]["width"], 480);
        assert_eq!(items[0]["title"], "Hello");
        assert_eq!(out["next"], "CAgQ.48");
        assert!(normalize(&json!({ "results": [], "next": "../x" }))["next"].is_null());
        assert!(normalize(&json!({}))["results"].as_array().unwrap().is_empty());
    }

    #[test]
    fn pagination_token_is_restricted() {
        assert!(valid_pos("CAgQ.48"));
        assert!(!valid_pos("a&key=x"));
        assert!(!valid_pos(&"a".repeat(65)));
    }
}
