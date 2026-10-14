//! Recherche de GIF par le serveur, par ordre de préférence : GIPHY (`GIPHY_API_KEY`), KLIPY
//! (`KLIPY_API_KEY`, API compatible Tenor v2), sinon Wikimedia Commons, qui ne demande ni clé ni
//! compte (le bouton GIF n'est donc jamais mort).
//!
//! La clé reste sur le serveur : les clients (web, bureau, app mobile) appellent ces routes, le
//! fournisseur ne voit que le serveur (ni l'IP ni l'identité des utilisateurs). Seules les images
//! sont ensuite chargées depuis son CDN, avec des adresses nettoyées (sans paramètres de pistage).
//!
//! - Réponses en cache Redis (recherche 5 min, tendances 10 min).
//! - 60 requêtes par minute et par utilisateur.
//! - GIPHY : classement `GIPHY_RATING` (g|pg|pg-13|r, défaut pg-13).
//! - KLIPY : filtre `KLIPY_CONTENT_FILTER` (off|low|medium|high, défaut medium).

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

const GIPHY_BASE: &str = "https://api.giphy.com/v1/gifs";
const KLIPY_BASE: &str = "https://api.klipy.com/v2";
const COMMONS_API: &str = "https://commons.wikimedia.org/w/api.php";
const PAGE_SIZE: u32 = 24;
const MAX_QUERY_CHARS: usize = 100;
const RATE_PER_MINUTE: i64 = 60;
/// Wikimedia exige un User-Agent identifiable avec un contact.
const USER_AGENT: &str = "ForgeChat/1.0 (https://forgechat.heiphaistos.org)";

enum Provider {
    Giphy { key: String, rating: &'static str },
    Klipy { key: String, filter: &'static str },
    Commons,
}

/// Clé lue dans l'environnement, refusée si elle contient autre chose que [A-Za-z0-9_-].
fn cle(nom: &str) -> Option<String> {
    let k = std::env::var(nom).unwrap_or_default().trim().to_string();
    (!k.is_empty() && k.len() <= 128 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then_some(k)
}

fn provider() -> &'static Provider {
    static P: OnceLock<Provider> = OnceLock::new();
    P.get_or_init(|| {
        if let Some(key) = cle("GIPHY_API_KEY") {
            let rating = match std::env::var("GIPHY_RATING").unwrap_or_default().trim() {
                "g" => "g",
                "pg" => "pg",
                "r" => "r",
                _ => "pg-13",
            };
            Provider::Giphy { key, rating }
        } else if let Some(key) = cle("KLIPY_API_KEY") {
            let filter = match std::env::var("KLIPY_CONTENT_FILTER").unwrap_or_default().trim() {
                "off" => "off",
                "low" => "low",
                "high" => "high",
                _ => "medium",
            };
            Provider::Klipy { key, filter }
        } else {
            Provider::Commons
        }
    })
}

/// Image d'un CDN de GIF connu, en https, sans port ni identifiants ni paramètres. Seules ces
/// adresses sont renvoyées aux clients, qui appliquent la même liste avant d'afficher un GIF.
pub fn is_gif_media_url(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    if u.scheme() != "https" || u.port().is_some() || !u.username().is_empty() || u.password().is_some() || u.query().is_some() {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    let klipy = host.strip_prefix("static").and_then(|r| r.strip_suffix(".klipy.com")).is_some_and(|n| n.len() <= 2 && n.chars().all(|c| c.is_ascii_digit()));
    let host_ok = klipy
        || host == "i.giphy.com"
        || host.strip_prefix("media").and_then(|r| r.strip_suffix(".giphy.com")).is_some_and(|n| n.len() <= 1 && n.chars().all(|c| c.is_ascii_digit()))
        || host == "upload.wikimedia.org"
        || host == "thumb.wikimedia.org";
    let path = u.path().to_ascii_lowercase();
    host_ok && (path.ends_with(".gif") || path.ends_with(".webp")) && url.len() <= 500
}

/// Retire les paramètres (pistage GIPHY `cid`/`rid`, `utm_*` de Wikimedia) d'une adresse d'image.
fn sans_parametres(url: &str) -> Option<String> {
    let mut u = reqwest::Url::parse(url).ok()?;
    u.set_query(None);
    u.set_fragment(None);
    Some(u.to_string()).filter(|s| is_gif_media_url(s))
}

/// Jeton de page : un décalage (GIPHY, Wikimedia) ou un jeton opaque KLIPY (base64, ex. « Mg== »).
fn valid_pos(pos: &str) -> bool {
    !pos.is_empty() && pos.len() <= 64 && !pos.contains("..") && pos.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '=' | '+' | '/'))
}

fn titre(s: Option<&str>) -> String {
    s.unwrap_or("").chars().filter(|c| !c.is_control()).take(120).collect()
}

fn dim(v: &Value) -> u64 {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0).min(4096)
}

/// Réponse GIPHY → liste réduite et validée.
pub fn normalize_giphy(resp: &Value, offset: u32) -> Value {
    let items: Vec<Value> = resp["data"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    let img = &r["images"];
                    let url = sans_parametres(img["original"]["url"].as_str().or_else(|| img["downsized"]["url"].as_str())?)?;
                    let preview = ["fixed_width_small", "fixed_width", "preview_gif"]
                        .iter()
                        .find_map(|f| img[*f]["url"].as_str().and_then(sans_parametres))
                        .unwrap_or_else(|| url.clone());
                    Some(json!({
                        "id": r["id"].as_str().unwrap_or("").chars().take(64).collect::<String>(),
                        "title": titre(r["title"].as_str()),
                        "url": url,
                        "preview": preview,
                        "width": dim(&img["original"]["width"]),
                        "height": dim(&img["original"]["height"]),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    let count = resp["pagination"]["count"].as_u64().unwrap_or(0) as u32;
    let total = resp["pagination"]["total_count"].as_u64().unwrap_or(0) as u32;
    let next = offset + count;
    let next = (count > 0 && next < total && next < 4999).then(|| next.to_string());
    json!({ "results": items, "next": next })
}

/// Réponse KLIPY (format Tenor v2) → liste réduite et validée.
pub fn normalize_klipy(resp: &Value) -> Value {
    let items: Vec<Value> = resp["results"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|r| {
                    let gif = &r["media_formats"]["gif"];
                    let url = sans_parametres(gif["url"].as_str()?)?;
                    let preview = ["tinygif", "nanogif", "gif"]
                        .iter()
                        .find_map(|f| r["media_formats"][*f]["url"].as_str().and_then(sans_parametres))
                        .unwrap_or_else(|| url.clone());
                    let dims = gif["dims"].as_array();
                    let d = |i: usize| dims.and_then(|v| v.get(i)).map(dim).unwrap_or(0);
                    Some(json!({
                        "id": r["id"].as_str().unwrap_or("").chars().take(64).collect::<String>(),
                        "title": titre(r["content_description"].as_str().or_else(|| r["title"].as_str())),
                        "url": url,
                        "preview": preview,
                        "width": d(0),
                        "height": d(1),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    let next = resp["next"].as_str().filter(|p| *p != "0" && valid_pos(p));
    json!({ "results": items, "next": next })
}

/// Réponse de l'API de Wikimedia Commons (generator=search + imageinfo) → liste réduite et validée.
pub fn normalize_commons(resp: &Value) -> Value {
    let mut pages: Vec<&Value> = resp["query"]["pages"].as_object().map(|o| o.values().collect()).unwrap_or_default();
    pages.sort_by_key(|p| p["index"].as_u64().unwrap_or(u64::MAX));
    let items: Vec<Value> = pages
        .into_iter()
        .filter_map(|p| {
            let info = p["imageinfo"].get(0)?;
            if info["mime"].as_str() != Some("image/gif") {
                return None;
            }
            let url = sans_parametres(info["url"].as_str()?)?;
            let preview = info["thumburl"].as_str().and_then(sans_parametres).unwrap_or_else(|| url.clone());
            let nom = p["title"].as_str().unwrap_or("").trim_start_matches("File:").trim_end_matches(".gif");
            Some(json!({
                "id": p["pageid"].as_u64().unwrap_or(0).to_string(),
                "title": titre(Some(nom)),
                "url": url,
                "preview": preview,
                "width": dim(&info["width"]),
                "height": dim(&info["height"]),
            }))
        })
        .collect();
    let next = resp["continue"]["gsroffset"].as_u64().filter(|n| *n < 9999).map(|n| n.to_string());
    json!({ "results": items, "next": next })
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/// GET /api/gifs/status — toujours activé (Wikimedia sans clé en repli).
pub async fn status() -> Json<Value> {
    Json(match provider() {
        Provider::Giphy { .. } => json!({ "enabled": true, "provider": "giphy", "search_placeholder": "Rechercher sur GIPHY", "attribution": "Powered by GIPHY" }),
        // « Search KLIPY » : seule mention exigée par KLIPY dans le champ de recherche.
        Provider::Klipy { .. } => json!({ "enabled": true, "provider": "klipy", "search_placeholder": "Search KLIPY", "attribution": "Powered by KLIPY" }),
        Provider::Commons => json!({ "enabled": true, "provider": "wikimedia", "search_placeholder": "Rechercher un GIF", "attribution": "GIF de Wikimedia Commons" }),
    })
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
    fetch(&state, &claims, Some(&q), params.pos.as_deref(), 300).await
}

/// GET /api/gifs/trending?pos=…
pub async fn trending(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<SearchQuery>,
) -> Result<Json<Value>> {
    fetch(&state, &claims, None, params.pos.as_deref(), 600).await
}

async fn fetch(state: &AppState, claims: &Claims, q: Option<&str>, pos: Option<&str>, ttl: u64) -> Result<Json<Value>> {
    use redis::AsyncCommands;
    let pos = pos.filter(|p| !p.is_empty());
    if pos.is_some_and(|p| !valid_pos(p)) {
        return Err(AppError::BadRequest("Pagination invalide".into()));
    }
    let offset: u32 = pos.and_then(|p| p.parse().ok()).unwrap_or(0);
    let prov = provider();
    if !matches!(prov, Provider::Klipy { .. }) && pos.is_some_and(|p| !p.chars().all(|c| c.is_ascii_digit()) || p.len() > 6) {
        return Err(AppError::BadRequest("Pagination invalide".into()));
    }

    crate::handlers::auth_v2::hit(state, &format!("gifs_rl:{}", claims.sub), RATE_PER_MINUTE, 60).await?;

    let nom = match prov { Provider::Giphy { .. } => "giphy", Provider::Klipy { .. } => "klipy", Provider::Commons => "commons" };
    let cache_key = format!("gifs2:{nom}:{}:{}", q.unwrap_or("").to_lowercase(), pos.unwrap_or("0"));
    {
        let mut redis = state.redis.lock().await;
        let cached: Option<String> = redis.get(&cache_key).await.unwrap_or(None);
        if let Some(v) = cached.and_then(|c| serde_json::from_str::<Value>(&c).ok()) {
            return Ok(Json(v));
        }
    }

    let url = match prov {
        Provider::Giphy { key, rating } => {
            let mut u = reqwest::Url::parse(&format!("{GIPHY_BASE}/{}", if q.is_some() { "search" } else { "trending" }))
                .map_err(|e| AppError::Internal(e.into()))?;
            {
                let mut qp = u.query_pairs_mut();
                qp.append_pair("api_key", key).append_pair("limit", &PAGE_SIZE.to_string()).append_pair("offset", &offset.to_string())
                    .append_pair("rating", rating).append_pair("bundle", "messaging_non_clips");
                if let Some(q) = q {
                    qp.append_pair("q", q).append_pair("lang", "fr");
                }
            }
            u
        }
        Provider::Klipy { key, filter } => {
            let mut u = reqwest::Url::parse(&format!("{KLIPY_BASE}/{}", if q.is_some() { "search" } else { "featured" }))
                .map_err(|e| AppError::Internal(e.into()))?;
            {
                let mut qp = u.query_pairs_mut();
                qp.append_pair("key", key).append_pair("limit", &PAGE_SIZE.to_string())
                    .append_pair("media_filter", "gif,tinygif").append_pair("contentfilter", filter).append_pair("locale", "fr_FR");
                if let Some(q) = q {
                    qp.append_pair("q", q);
                }
                if let Some(p) = pos {
                    qp.append_pair("pos", p);
                }
            }
            u
        }
        Provider::Commons => {
            let mut u = reqwest::Url::parse(COMMONS_API).map_err(|e| AppError::Internal(e.into()))?;
            u.query_pairs_mut()
                .append_pair("action", "query").append_pair("format", "json").append_pair("generator", "search")
                .append_pair("gsrnamespace", "6")
                // Sans recherche : GIF animés de la catégorie « Animated GIF files » (pas de tendances chez Wikimedia).
                .append_pair("gsrsearch", &format!("{} filemime:image/gif", q.unwrap_or("incategory:Animated_GIF_files")))
                .append_pair("gsrlimit", &PAGE_SIZE.to_string()).append_pair("gsroffset", &offset.to_string())
                .append_pair("prop", "imageinfo").append_pair("iiprop", "url|size|mime").append_pair("iiurlwidth", "220");
            u
        }
    };

    let resp = state.http_client.get(url).header(reqwest::header::USER_AGENT, USER_AGENT).timeout(Duration::from_secs(8)).send().await.map_err(|e| {
        tracing::warn!("GIF ({nom}) injoignable : {e}");
        AppError::BadRequest("GIF indisponibles pour le moment".into())
    })?;
    if !resp.status().is_success() {
        tracing::warn!("GIF ({nom}) a répondu {}", resp.status());
        return Err(AppError::BadRequest("GIF indisponibles pour le moment".into()));
    }
    let body: Value = crate::net_guard::read_capped(resp, 4 * 1024 * 1024)
        .await
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| AppError::BadRequest("Réponse GIF invalide".into()))?;
    let out = match prov {
        Provider::Giphy { .. } => normalize_giphy(&body, offset),
        Provider::Klipy { .. } => normalize_klipy(&body),
        Provider::Commons => normalize_commons(&body),
    };

    let mut redis = state.redis.lock().await;
    let _: () = redis.set_ex(&cache_key, out.to_string(), ttl).await.unwrap_or(());
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_gif_cdns() {
        assert!(is_gif_media_url("https://media2.giphy.com/media/abc123/giphy.gif"));
        assert!(is_gif_media_url("https://i.giphy.com/media/abc123/200w.webp"));
        assert!(is_gif_media_url("https://upload.wikimedia.org/wikipedia/commons/8/8f/Chat.gif"));
        assert!(is_gif_media_url("https://static.klipy.com/ii/abc/def/hello.gif"));
        assert!(is_gif_media_url("https://static2.klipy.com/x.webp"));
        assert!(!is_gif_media_url("https://api.klipy.com/x.gif"));
        assert!(!is_gif_media_url("https://static.klipy.com.evil.example/x.gif"));
        assert!(!is_gif_media_url("https://media2.giphy.com/media/abc/giphy.gif?cid=x"));
        assert!(!is_gif_media_url("http://media.giphy.com/media/abc/giphy.gif"));
        assert!(!is_gif_media_url("https://media.giphy.com.evil.example/x.gif"));
        assert!(!is_gif_media_url("https://media12.giphy.com/x.gif"));
        assert!(!is_gif_media_url("https://evil.example/upload.wikimedia.org/x.gif"));
        assert!(!is_gif_media_url("https://upload.wikimedia.org/x.svg"));
        assert!(!is_gif_media_url("https://user@i.giphy.com/x.gif"));
        assert!(!is_gif_media_url("https://i.giphy.com:8443/x.gif"));
        assert!(!is_gif_media_url("javascript:alert(1)"));
    }

    #[test]
    fn giphy_is_normalized_without_tracking() {
        let resp = json!({
            "data": [
                { "id": "abc", "title": "Coucou GIF", "images": {
                    "original": { "url": "https://media3.giphy.com/media/abc/giphy.gif?cid=1&rid=giphy.gif&ct=g", "width": "480", "height": "270" },
                    "fixed_width_small": { "url": "https://media3.giphy.com/media/abc/100w.gif?cid=1" } } },
                { "id": "evil", "images": { "original": { "url": "https://evil.example/x.gif" } } }
            ],
            "pagination": { "total_count": 100, "count": 2, "offset": 0 }
        });
        let out = normalize_giphy(&resp, 0);
        let items = out["results"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["url"], "https://media3.giphy.com/media/abc/giphy.gif");
        assert_eq!(items[0]["preview"], "https://media3.giphy.com/media/abc/100w.gif");
        assert_eq!(items[0]["width"], 480);
        assert_eq!(out["next"], "2");
        let fin = normalize_giphy(&json!({ "data": [], "pagination": { "total_count": 2, "count": 0 } }), 2);
        assert!(fin["next"].is_null());
    }

    #[test]
    fn klipy_is_normalized() {
        let resp = json!({
            "results": [
                { "id": "1", "content_description": "Hello", "media_formats": {
                    "gif": { "url": "https://static.klipy.com/a/hello.gif", "dims": [480, 270] },
                    "tinygif": { "url": "https://static1.klipy.com/a/hello-tiny.gif" } } },
                { "id": "2", "media_formats": { "gif": { "url": "https://evil.example/x.gif" } } }
            ],
            "next": "Mg=="
        });
        let out = normalize_klipy(&resp);
        let items = out["results"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["preview"], "https://static1.klipy.com/a/hello-tiny.gif");
        assert_eq!(items[0]["width"], 480);
        assert_eq!(out["next"], "Mg==");
        assert!(normalize_klipy(&json!({ "results": [], "next": "a&key=x" }))["next"].is_null());
    }

    #[test]
    fn commons_keeps_animated_gifs_only() {
        let resp = json!({
            "continue": { "gsroffset": 24 },
            "query": { "pages": {
                "2": { "pageid": 2, "index": 2, "title": "File:Chat qui saute.gif", "imageinfo": [{ "mime": "image/gif",
                    "url": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Chat_qui_saute.gif", "width": 300, "height": 200,
                    "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Chat_qui_saute.gif/220px-Chat_qui_saute.gif?utm_source=x" }] },
                "1": { "pageid": 1, "index": 1, "title": "File:Schema.png", "imageinfo": [{ "mime": "image/png", "url": "https://upload.wikimedia.org/a.png" }] }
            } }
        });
        let out = normalize_commons(&resp);
        let items = out["results"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["title"], "Chat qui saute");
        assert_eq!(items[0]["preview"], "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Chat_qui_saute.gif/220px-Chat_qui_saute.gif");
        assert_eq!(out["next"], "24");
    }

    #[test]
    fn pagination_token_is_restricted() {
        assert!(valid_pos("48"));
        assert!(valid_pos("Mg=="));
        assert!(!valid_pos("a&key=x"));
        assert!(!valid_pos("../a"));
        assert!(!valid_pos(&"a".repeat(65)));
    }
}
