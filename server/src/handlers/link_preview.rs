//! Aperçu de lien (OpenGraph / Twitter cards / <title> / oEmbed YouTube).
//!
//! Les messages sont chiffrés : le serveur ne voit pas leur texte, c'est donc le CLIENT qui
//! demande l'aperçu d'une URL qu'il a lue en clair (`GET /og?url=`), et l'expéditeur d'un
//! message chiffré joint le résultat à son contenu chiffré. Toute la récupération passe par
//! `net_guard` (DNS filtré, redirections revalidées) ; la page est lue sur 512 Ko au plus.
//! L'image n'est jamais chargée directement par les lecteurs (fuite de leur IP) :
//! `GET /og/image?url=` la récupère, la vérifie dans ses octets (PNG/GIF/WebP/JPEG) et la sert.

use axum::{
    extract::{Query, State},
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    Extension, Json,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::AppError,
    handlers::{
        audit::{decode_entities, meta_tags},
        auth_v2, image_probe,
    },
    middleware::auth::Claims,
    net_guard,
    state::AppState,
};

const MAX_HTML: usize = 512 * 1024;
const MAX_IMAGE: usize = 3 * 1024 * 1024;
const TITLE_MAX: usize = 200;
const DESC_MAX: usize = 400;
const SITE_MAX: usize = 100;
const CACHE_TTL: u64 = 3600;
const MISS_TTL: u64 = 600;

#[derive(Deserialize)]
pub struct OgQuery {
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct OgMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
    pub url: String,
    /// Page déclarée « adulte » : son image n'est pas rendue.
    #[serde(default)]
    pub nsfw: bool,
}

/// Cible autorisée : http(s) public, ports 80/443, sans identifiants, ni nom local évident.
pub(crate) fn target_ok(u: &reqwest::Url) -> bool {
    if !net_guard::url_target_ok(u) || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    if !matches!(u.port(), None | Some(80) | Some(443)) {
        return false;
    }
    let h = u.host_str().unwrap_or("").to_ascii_lowercase();
    !(h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") || h.ends_with(".internal"))
}

fn parse_target(raw: &str) -> Option<reqwest::Url> {
    if raw.len() > 2048 {
        return None;
    }
    reqwest::Url::parse(raw.trim()).ok().filter(target_ok)
}

/// Texte d'affichage : espaces réduits, caractères de contrôle retirés, au plus `max`
/// caractères. Vide : None.
fn clip(s: &str, max: usize) -> Option<String> {
    let clean: String = s.chars().filter(|c| !c.is_control() || c.is_whitespace()).collect();
    let t = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        return None;
    }
    if t.chars().count() <= max {
        return Some(t);
    }
    let mut cut: String = t.chars().take(max - 1).collect();
    cut.push('…');
    Some(cut)
}

/// URL d'image absolue en http(s), résolue contre la page ; `javascript:`, `data:`… refusés.
fn image_url(raw: &str, base: &reqwest::Url) -> Option<String> {
    let u = base.join(raw.trim()).ok()?;
    (matches!(u.scheme(), "http" | "https") && u.as_str().len() <= 2000).then(|| u.to_string())
}

/// Métadonnées d'une page HTML déjà lue (fonction pure). `final_url` : adresse finale, base
/// des URL relatives. None si rien d'affichable.
pub(crate) fn parse_page(html: &str, final_url: &reqwest::Url, requested: &str) -> Option<OgMeta> {
    let m = meta_tags(html);
    let pick = |keys: &[&str]| keys.iter().find_map(|k| m.get(*k).cloned());
    let title = pick(&["og:title", "twitter:title"])
        .or_else(|| {
            let lower = html.to_ascii_lowercase(); // même longueur : les indices valent pour `html`
            let start = lower.find("<title")?;
            let s = lower[start..].find('>')? + start + 1;
            let e = lower[s..].find("</title")? + s;
            Some(decode_entities(html[s..e].trim()))
        })
        .and_then(|t| clip(&t, TITLE_MAX));
    let description = pick(&["og:description", "twitter:description", "description"]).and_then(|d| clip(&d, DESC_MAX));
    let mut image = pick(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"])
        .and_then(|raw| image_url(&raw, final_url));
    let site_name = pick(&["og:site_name", "application-name"]).and_then(|s| clip(&s, SITE_MAX));
    let nsfw = m.get("rating").is_some_and(|r| {
        let r = r.to_ascii_lowercase();
        r == "adult" || r == "mature" || r.starts_with("rta-5042")
    }) || m.contains_key("og:restrictions:age");
    if nsfw {
        image = None;
    }
    if title.is_none() && description.is_none() && image.is_none() {
        return None;
    }
    Some(OgMeta { title, description, image, site_name, url: requested.to_string(), nsfw })
}

/// oEmbed YouTube : la page HTML d'un serveur est souvent un écran de consentement.
fn oembed_endpoint(u: &reqwest::Url) -> Option<String> {
    let h = u.host_str()?.to_ascii_lowercase();
    let yt = matches!(h.as_str(), "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be");
    yt.then(|| format!("https://www.youtube.com/oembed?format=json&url={}", urlencoding::encode(u.as_str())))
}

fn parse_oembed(json: &str, requested: &str) -> Option<OgMeta> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str());
    let image = s("thumbnail_url")
        .and_then(|t| reqwest::Url::parse(t).ok())
        .filter(|u| u.scheme() == "https" && u.as_str().len() <= 2000)
        .map(|u| u.to_string());
    let title = s("title").and_then(|t| clip(t, TITLE_MAX))?;
    Some(OgMeta {
        title: Some(title),
        description: s("author_name").and_then(|a| clip(a, DESC_MAX)),
        image,
        site_name: Some("YouTube".into()),
        url: requested.to_string(),
        nsfw: false,
    })
}

/// Métadonnées d'une page publique (aussi utilisé par les Actualités).
pub(crate) async fn fetch_og(state: &AppState, url: &str) -> Option<OgMeta> {
    let target = parse_target(url)?;
    if let Some(ep) = oembed_endpoint(&target) {
        if let Ok(r) = state.public_http.get(&ep).timeout(std::time::Duration::from_secs(5)).send().await {
            if r.status().is_success() {
                let body = net_guard::read_prefix(r, 64 * 1024).await?;
                if let Some(o) = parse_oembed(&String::from_utf8_lossy(&body), url) {
                    return Some(o);
                }
            }
        }
    }
    let resp = state.public_http.get(target)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.5")
        .timeout(std::time::Duration::from_secs(6))
        .send().await.ok()?;
    let final_url = resp.url().clone();
    if !resp.status().is_success() || !target_ok(&final_url) {
        return None;
    }
    let ct = resp.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if !ct.contains("text/html") && !ct.contains("application/xhtml") {
        return None; // fichier, image, PDF… : pas d'aperçu
    }
    let bytes = net_guard::read_prefix(resp, MAX_HTML).await?;
    parse_page(&String::from_utf8_lossy(&bytes), &final_url, url)
}

fn cache_key(prefix: &str, url: &str) -> String {
    let d = Sha256::digest(url.as_bytes());
    format!("{prefix}:{}", d.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// GET /api/og?url= : aperçu d'une URL lue en clair par le client. 404 : rien à afficher.
pub async fn og_preview(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<OgQuery>,
) -> Result<Json<OgMeta>, AppError> {
    auth_v2::hit(&state, &format!("og:{}", claims.sub), 30, 60).await?;
    if parse_target(&q.url).is_none() {
        return Err(AppError::BadRequest("URL invalide ou non autorisée".into()));
    }
    let key = cache_key("og:v1", &q.url);
    // Cache facultatif : une panne Redis ne bloque pas l'aperçu (la limite ci-dessus, si).
    let cached: Option<String> = state.redis.lock().await.get(&key).await.unwrap_or(None);
    let meta = match cached {
        Some(c) => serde_json::from_str::<Option<OgMeta>>(&c).ok().flatten(),
        None => {
            let m = fetch_og(&state, &q.url).await;
            let ttl = if m.is_some() { CACHE_TTL } else { MISS_TTL };
            if let Ok(js) = serde_json::to_string(&m) {
                let _: Result<(), _> = state.redis.lock().await.set_ex(&key, js, ttl).await;
            }
            m
        }
    };
    meta.map(Json).ok_or_else(|| AppError::NotFound("Aucune métadonnée".into()))
}

/// GET /api/og/image?url= : image d'aperçu servie par le serveur (l'IP du lecteur n'est jamais
/// donnée au site du lien). Format lu dans les octets, 3 Mo et 4096 px au plus.
pub async fn og_image(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<OgQuery>,
) -> Result<Response, AppError> {
    auth_v2::hit(&state, &format!("ogimg:{}", claims.sub), 120, 60).await?;
    let target = parse_target(&q.url).ok_or_else(|| AppError::BadRequest("URL invalide ou non autorisée".into()))?;
    let not_found = || AppError::NotFound("Image indisponible".into());
    let resp = state.public_http.get(target)
        .header("Accept", "image/*")
        .timeout(std::time::Duration::from_secs(6))
        .send().await.map_err(|_| not_found())?;
    if !resp.status().is_success() || !target_ok(resp.url()) {
        return Err(not_found());
    }
    let bytes = net_guard::read_capped(resp, MAX_IMAGE).await.ok_or_else(not_found)?;
    let (probe, _) = image_probe::probe(&bytes).map_err(|_| not_found())?;
    let mime = match probe.ext {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    let mut r = bytes.into_response();
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=86400"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    #[test]
    fn parses_open_graph_twitter_and_title() {
        let html = r#"<html><head><title> Titre &amp; page </title>
            <meta property="og:title" content="OG &#8217;titre">
            <meta name="twitter:description" content="  Résumé&nbsp;court  ">
            <meta property="og:image" content="/img/a.png"><meta property="og:site_name" content="Site"></head></html>"#;
        let m = parse_page(html, &u("https://ex.fr/dir/page"), "https://ex.fr/dir/page").unwrap();
        assert_eq!(m.title.as_deref(), Some("OG ’titre"));
        assert_eq!(m.description.as_deref(), Some("Résumé court"));
        assert_eq!(m.image.as_deref(), Some("https://ex.fr/img/a.png"));
        assert_eq!(m.site_name.as_deref(), Some("Site"));
        // Sans OG : <title> (balise en majuscules, entités décodées) et rien d'autre.
        let m = parse_page("<HEAD><TITLE>Un &amp; deux</TITLE>", &u("https://ex.fr/"), "https://ex.fr/").unwrap();
        assert_eq!((m.title.as_deref(), m.image), (Some("Un & deux"), None));
        assert!(parse_page("<p>rien</p>", &u("https://ex.fr/"), "x").is_none());
    }

    #[test]
    fn refuses_script_schemes_and_clips_lengths() {
        let long = "é".repeat(5000);
        let html = format!(
            r#"<meta property="og:title" content="{long}"><meta property="og:description" content="{long}">
               <meta property="og:image" content="javascript:alert(1)">"#
        );
        let m = parse_page(&html, &u("https://ex.fr/"), "x").unwrap();
        assert_eq!(m.title.unwrap().chars().count(), TITLE_MAX);
        assert_eq!(m.description.unwrap().chars().count(), DESC_MAX);
        assert_eq!(m.image, None);
        for bad in ["data:image/png;base64,AAAA", "ftp://x.fr/a.png", "file:///etc/passwd"] {
            assert_eq!(image_url(bad, &u("https://ex.fr/")), None, "{bad}");
        }
        assert_eq!(image_url("//cdn.fr/a.jpg", &u("https://ex.fr/")).as_deref(), Some("https://cdn.fr/a.jpg"));
        assert_eq!(clip("a\u{0}b\n  c", 50).as_deref(), Some("ab c"));
    }

    #[test]
    fn adult_pages_lose_their_image() {
        let html = r#"<meta property="og:title" content="T"><meta property="og:image" content="https://a.fr/i.jpg"><meta name="rating" content="adult">"#;
        let m = parse_page(html, &u("https://a.fr/"), "x").unwrap();
        assert!(m.nsfw && m.image.is_none());
    }

    #[test]
    fn oembed_youtube() {
        let ep = oembed_endpoint(&u("https://youtu.be/abc")).unwrap();
        assert!(ep.starts_with("https://www.youtube.com/oembed?") && ep.contains("youtu.be%2Fabc"));
        assert!(oembed_endpoint(&u("https://youtube.com.evil.io/x")).is_none());
        let m = parse_oembed(r#"{"title":"Vidéo","author_name":"Chaîne","thumbnail_url":"https://i.ytimg.com/vi/a/hq.jpg"}"#, "https://youtu.be/abc").unwrap();
        assert_eq!((m.title.as_deref(), m.description.as_deref()), (Some("Vidéo"), Some("Chaîne")));
        let m = parse_oembed(r#"{"title":"V","thumbnail_url":"javascript:1"}"#, "x").unwrap();
        assert_eq!(m.image, None);
        assert!(parse_oembed("pas du json", "x").is_none());
    }

    #[test]
    fn ssrf_targets_refused() {
        for bad in [
            "http://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://10.0.0.5/",
            "http://localhost/", "http://x.internal/", "http://nas.local/", "https://user:pw@example.com/",
            "https://example.com:8443/", "http://example.com:22/", "javascript:alert(1)", "ftp://example.com/",
            "http://2130706433/", "http://[::ffff:127.0.0.1]/", "http://metadata.google.internal/",
        ] {
            assert!(parse_target(bad).is_none(), "{bad} devrait être refusée");
        }
        for ok in ["https://example.com/a?b=1", "http://example.com/", "https://example.com:443/x"] {
            assert!(parse_target(ok).is_some(), "{ok}");
        }
    }

    #[tokio::test]
    async fn redirect_to_private_ip_refused() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf).await;
            let _ = s.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        });
        let c = net_guard::public_client(3, "test").build().unwrap();
        // Le serveur de test est lui-même en boucle locale (IP littérale, hors résolveur) :
        // seule la redirection vers l'adresse de métadonnées doit être refusée.
        assert!(c.get(format!("http://{addr}/")).send().await.is_err());
    }
}
