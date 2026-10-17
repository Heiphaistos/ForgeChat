//! Actualités : le bot RSSDI d'un serveur dépose ici chaque nouvel article de ses flux RSS.
//! L'article est rangé (sans doublon par lien), publié dans le fil de forum du site si on lui en
//! indique un, et montré à tous les comptes sur la page « Actualités » quand le site est public.
//! Le contenu est public par nature (articles de presse) : pas de chiffrement de bout en bout ici.
use axum::{extract::{Path, Query, State}, http::HeaderMap, Extension, Json};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{bots::hash_bot_token, forum::ForumReply},
    middleware::auth::Claims,
    state::AppState,
};

/// Articles gardés par site : les plus anciens partent au-delà.
const KEEP_PER_SITE: i64 = 300;
/// Sites d'actualités par serveur, au plus.
const MAX_SITES_PER_SERVER: i64 = 200;

#[derive(Deserialize)]
pub struct NewsArticleIn {
    pub server_id: Uuid,
    /// Nom du site (le flux RSSDI), ex. « Presse Citron ».
    pub site: String,
    /// Rubrique de la page Actualités (le forum Discord/ForgeChat), ex. « Informatique ».
    pub category: String,
    /// false : le site reste dans les forums du serveur, sans apparaître sur la page publique.
    #[serde(default = "yes")]
    pub public: bool,
    /// Fil de forum du serveur où publier l'article (facultatif).
    pub post_id: Option<Uuid>,
    pub title: String,
    pub link: String,
    pub summary: Option<String>,
    pub image: Option<String>,
    /// Secondes Unix.
    pub published_at: Option<i64>,
}
fn yes() -> bool { true }

fn clip(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max { t.to_string() } else { format!("{}…", t.chars().take(max - 1).collect::<String>().trim_end()) }
}

/// Lien affichable et cliquable : http(s), sans espace ni guillemet, longueur bornée.
fn web_url(u: &str) -> Option<String> {
    let u = u.trim();
    let ok = (u.starts_with("https://") || u.starts_with("http://"))
        && u.len() <= 2000
        && !u.chars().any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>'));
    ok.then(|| u.to_string())
}

/// Adresse lue dans un flux : les flux échappent les « & » (`&amp;`), non décodée elle casse
/// (L'Express répondait 400 à `?auth=…&amp;`).
fn feed_url(u: &str) -> Option<String> {
    web_url(&crate::handlers::audit::decode_entities(u))
}

/// Texte d'un extrait de flux RSS (souvent du HTML) : balises retirées, entités décodées, blancs réduits.
fn html_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => { in_tag = true; out.push(' ') }
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let t = crate::handlers::audit::decode_entities(&out).split_whitespace().collect::<Vec<_>>().join(" ");
    // L'espace mis à la place d'une balise colle parfois à la ponctuation : « mot , » -> « mot, ».
    t.replace(" ,", ",").replace(" .", ".")
}

/// Première image https d'un extrait HTML (les flux mettent souvent l'illustration dans le résumé).
fn first_img(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let p = lower.find("<img")?;
    let e = p + lower[p..].find('>')?;
    crate::handlers::audit::tag_attrs(&html[p..e]).into_iter()
        .find(|(k, _)| k == "src")
        .and_then(|(_, v)| web_url(&crate::handlers::audit::decode_entities(&v)))
        .filter(|u| u.starts_with("https://"))
}

/// Miniature d'une vidéo YouTube (le VPS est bloqué par YouTube : sa page n'est pas lisible d'ici).
fn youtube_thumb(link: &str) -> Option<String> {
    let rest = ["youtube.com/watch?v=", "youtube.com/shorts/", "youtu.be/"].iter()
        .find_map(|m| link.split_once(m).map(|(_, r)| r))?;
    let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    (id.len() == 11).then(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"))
}

/// POST /api/bot/news (Authorization: Bot <jeton du bot du serveur>).
pub async fn bot_post_news(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<NewsArticleIn>,
) -> Result<Json<serde_json::Value>> {
    let raw = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bot ")).ok_or(AppError::Unauthorized)?;
    let bot_id: Uuid = sqlx::query_scalar("SELECT bot_user_id FROM bot_tokens WHERE token_hash=$1 AND server_id=$2")
        .bind(hash_bot_token(raw)).bind(b.server_id).fetch_optional(&state.db).await?
        .ok_or(AppError::Unauthorized)?;

    let site = clip(&b.site, 80);
    let category = clip(&b.category, 60);
    let title = clip(&crate::handlers::audit::decode_entities(&b.title), 300);
    let link = feed_url(&b.link).ok_or_else(|| AppError::BadRequest("Lien d'article invalide".into()))?;
    if site.is_empty() || category.is_empty() || title.is_empty() {
        return Err(AppError::BadRequest("Site, rubrique et titre requis".into()));
    }
    let summary = b.summary.as_deref().map(|s| clip(&html_text(s), 1200)).filter(|s| !s.is_empty());
    let image = b.image.as_deref().and_then(feed_url).filter(|u| u.starts_with("https://"))
        .or_else(|| b.summary.as_deref().and_then(first_img))
        .or_else(|| youtube_thumb(&link));
    let published = b.published_at
        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .filter(|d| *d <= chrono::Utc::now() + chrono::Duration::hours(1))
        .unwrap_or_else(chrono::Utc::now);

    // « À la une » (tous les comptes) : réservé aux serveurs autorisés par l'administration du site ;
    // sinon le site reste dans les forums du serveur (public=false), sans erreur pour le bot.
    let allowed: bool = sqlx::query_scalar("SELECT news_public_allowed FROM servers WHERE id=$1")
        .bind(b.server_id).fetch_optional(&state.db).await?.unwrap_or(false);
    let public = b.public && allowed;
    // Quota de sites par serveur (la création seulement : un site déjà connu se met toujours à jour).
    let known: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM news_sites WHERE server_id=$1 AND name=$2)")
        .bind(b.server_id).bind(&site).fetch_one(&state.db).await?;
    if !known {
        let sites: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM news_sites WHERE server_id=$1")
            .bind(b.server_id).fetch_one(&state.db).await?;
        if sites >= MAX_SITES_PER_SERVER {
            return Err(AppError::BadRequest(format!("Limite de {MAX_SITES_PER_SERVER} sites d'actualités par serveur atteinte")));
        }
    }

    let site_id: Uuid = sqlx::query_scalar(
        "INSERT INTO news_sites (server_id, name, category, public) VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_id, name) DO UPDATE SET category = EXCLUDED.category, public = EXCLUDED.public
         RETURNING id",
    ).bind(b.server_id).bind(&site).bind(&category).bind(public).fetch_one(&state.db).await?;

    let inserted: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO news_articles (site_id, link, title, summary, image, published_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (site_id, link) DO NOTHING RETURNING id",
    ).bind(site_id).bind(&link).bind(&title).bind(&summary).bind(&image).bind(published).fetch_optional(&state.db).await?;
    if inserted.is_some() {
        sqlx::query(
            "DELETE FROM news_articles WHERE site_id = $1 AND id NOT IN
               (SELECT id FROM news_articles WHERE site_id = $1 ORDER BY published_at DESC LIMIT $2)",
        ).bind(site_id).bind(KEEP_PER_SITE).execute(&state.db).await?;
    }

    // Publication dans le fil du site (forum du serveur de ce bot uniquement). Un flux peut viser
    // plusieurs fils : l'article est rangé une fois, mais publié dans chaque fil qui ne l'a pas encore.
    let mut posted = false;
    if let Some(post_id) = b.post_id {
        let channel_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT p.channel_id FROM forum_posts p JOIN channels c ON c.id = p.channel_id
             WHERE p.id = $1 AND c.server_id = $2 AND NOT p.locked",
        ).bind(post_id).bind(b.server_id).fetch_optional(&state.db).await?;
        let channel_id = channel_id.ok_or(AppError::Forbidden)?;
        let already: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM forum_replies WHERE post_id = $1 AND strpos(content, $2) > 0)")
            .bind(post_id).bind(&link).fetch_one(&state.db).await?;
        if already {
            return Ok(Json(serde_json::json!({ "ok": true, "new": inserted.is_some(), "posted": false })));
        }
        let mut content = format!("**{title}**");
        if let Some(s) = &summary { content.push_str(&format!("\n{}", clip(s, 600))); }
        content.push_str(&format!("\n{link}"));
        let mut tx = state.db.begin().await?;
        let reply = sqlx::query_as::<_, ForumReply>(
            "INSERT INTO forum_replies (post_id, user_id, content) VALUES ($1, $2, $3) RETURNING *",
        ).bind(post_id).bind(bot_id).bind(&content).fetch_one(&mut *tx).await?;
        sqlx::query("UPDATE forum_posts SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = $1")
            .bind(post_id).execute(&mut *tx).await?;
        tx.commit().await?;
        let event = serde_json::json!({ "type": "FORUM_REPLY_CREATE", "channel_id": channel_id, "post_id": post_id, "reply": reply });
        state.broadcast_to_channel_members(channel_id, event.to_string()).await;
        posted = true;
    }
    Ok(Json(serde_json::json!({ "ok": true, "new": inserted.is_some(), "posted": posted })))
}

/// Complète les articles sans image ou sans résumé avec les métadonnées de leur page (une tentative
/// par article, les plus récents d'abord). Les flux RSS ne fournissent souvent ni l'un ni l'autre.
pub async fn enrich_batch(state: &AppState) {
    use futures_util::StreamExt;
    use sqlx::Row;
    let Ok(rows) = sqlx::query(
        "SELECT id, link FROM news_articles WHERE NOT og_checked AND (image IS NULL OR summary IS NULL)
         ORDER BY published_at DESC LIMIT 80",
    ).fetch_all(&state.db).await else { return };
    // 8 pages lues en parallèle : un site lent ne bloque plus toute la file.
    futures_util::stream::iter(rows).for_each_concurrent(8, |r| async move {
        let id: Uuid = r.get("id");
        let link: String = r.get("link");
        let og = match youtube_thumb(&link) {
            Some(_) => None,
            None => crate::handlers::link_preview::fetch_og(state, &link).await,
        };
        let image = og.as_ref().and_then(|o| o.image.clone()).filter(|u| u.len() <= 2000).or_else(|| youtube_thumb(&link));
        let summary = og.as_ref().and_then(|o| o.description.as_deref()).map(|d| clip(&html_text(d), 600)).filter(|d| !d.is_empty());
        let _ = sqlx::query(
            "UPDATE news_articles SET image = COALESCE(image, $2), summary = COALESCE(summary, $3), og_checked = TRUE WHERE id = $1",
        ).bind(id).bind(image).bind(summary).execute(&state.db).await;
    }).await;
    // Les articles qui ont déjà tout n'ont rien à chercher.
    let _ = sqlx::query("UPDATE news_articles SET og_checked = TRUE WHERE NOT og_checked AND image IS NOT NULL AND summary IS NOT NULL")
        .execute(&state.db).await;
}

/// GET /api/news : sites publics, avec la date et le titre de leur dernier article.
pub async fn list_sites(State(state): State<AppState>, Extension(_c): Extension<Claims>) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT * FROM (
           SELECT DISTINCT ON (lower(s.name)) s.id, s.name, s.category, a.title AS last_title, a.published_at AS last_at,
                  (SELECT count(*) FROM news_articles x WHERE x.site_id = s.id AND x.published_at > NOW() - INTERVAL '24 hours') AS today
           FROM news_sites s
           LEFT JOIN LATERAL (SELECT title, published_at FROM news_articles WHERE site_id = s.id ORDER BY published_at DESC LIMIT 1) a ON TRUE
           WHERE s.public AND a.title IS NOT NULL
           -- Un même site relayé par plusieurs serveurs n'apparaît qu'une fois (le plus récent).
           ORDER BY lower(s.name), a.published_at DESC
         ) t ORDER BY category, last_at DESC",
    ).fetch_all(&state.db).await?;
    let sites: Vec<_> = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "category": r.get::<String, _>("category"),
        "last_title": r.get::<Option<String>, _>("last_title"),
        "last_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_at"),
        "today": r.get::<i64, _>("today"),
    })).collect();
    Ok(Json(serde_json::json!({ "sites": sites })))
}

#[derive(Deserialize)]
pub struct ArticlesQuery {
    /// Pagination : articles publiés avant cette date (RFC 3339).
    pub before: Option<chrono::DateTime<chrono::Utc>>,
}

/// GET /api/news/sites/:id/articles : derniers articles d'un site public (30 par page).
pub async fn list_articles(
    State(state): State<AppState>,
    Extension(_c): Extension<Claims>,
    Path(site_id): Path<Uuid>,
    Query(q): Query<ArticlesQuery>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let public: bool = sqlx::query_scalar("SELECT public FROM news_sites WHERE id = $1")
        .bind(site_id).fetch_optional(&state.db).await?.unwrap_or(false);
    if !public {
        return Err(AppError::NotFound("Site introuvable".into()));
    }
    let rows = sqlx::query(
        "SELECT id, title, link, summary, image, published_at FROM news_articles
         WHERE site_id = $1 AND ($2::timestamptz IS NULL OR published_at < $2)
         ORDER BY published_at DESC LIMIT 30",
    ).bind(site_id).bind(q.before).fetch_all(&state.db).await?;
    let articles: Vec<_> = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "title": r.get::<String, _>("title"),
        "link": r.get::<String, _>("link"),
        "summary": r.get::<Option<String>, _>("summary"),
        "image": r.get::<Option<String>, _>("image"),
        "published_at": r.get::<chrono::DateTime<chrono::Utc>, _>("published_at"),
    })).collect();
    Ok(Json(serde_json::json!({ "articles": articles })))
}

#[derive(Deserialize)]
pub struct LatestQuery {
    /// Rubrique exacte (nom du forum) ; absente = toutes.
    pub category: Option<String>,
    /// Recherche dans le titre et le résumé.
    pub q: Option<String>,
    pub before: Option<chrono::DateTime<chrono::Utc>>,
}

/// GET /api/news/latest : « À la une » — derniers articles de tous les sites publics (40 par page).
pub async fn list_latest(
    State(state): State<AppState>,
    Extension(_c): Extension<Claims>,
    Query(q): Query<LatestQuery>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let pattern = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| {
        let esc: String = s.chars().take(80).flat_map(|c| match c { '%' | '_' | '\\' => vec!['\\', c], c => vec![c] }).collect();
        format!("%{esc}%")
    });
    let rows = sqlx::query(
        "SELECT a.id, a.title, a.link, a.summary, a.image, a.published_at, s.id AS site_id, s.name AS site, s.category
         FROM news_articles a JOIN news_sites s ON s.id = a.site_id
         WHERE s.public
           AND ($1::text IS NULL OR s.category = $1)
           AND ($2::text IS NULL OR a.title ILIKE $2 OR a.summary ILIKE $2)
           AND ($3::timestamptz IS NULL OR a.published_at < $3)
         ORDER BY a.published_at DESC LIMIT 40",
    ).bind(q.category.as_deref()).bind(pattern).bind(q.before).fetch_all(&state.db).await?;
    let articles: Vec<_> = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "title": r.get::<String, _>("title"),
        "link": r.get::<String, _>("link"),
        "summary": r.get::<Option<String>, _>("summary"),
        "image": r.get::<Option<String>, _>("image"),
        "published_at": r.get::<chrono::DateTime<chrono::Utc>, _>("published_at"),
        "site_id": r.get::<Uuid, _>("site_id"),
        "site": r.get::<String, _>("site"),
        "category": r.get::<String, _>("category"),
    })).collect();
    Ok(Json(serde_json::json!({ "articles": articles })))
}

// ─── Préférences de la page Actualités (synchronisées entre appareils) ──────
// Même principe que la disposition des serveurs (user_settings::put_server_layout) : forme libre
// côté client ({ theme, pins, order, muted, folded }), objet JSON borné à 16 Ko, jamais interprété ici.

const MAX_NEWS_PREFS_BYTES: usize = 16 * 1024;

fn valid_news_prefs(v: &serde_json::Value) -> bool {
    v.is_object() && v.to_string().len() <= MAX_NEWS_PREFS_BYTES
}

pub async fn get_news_prefs(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    let prefs: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT prefs FROM user_news_prefs WHERE user_id = $1")
            .bind(claims.sub)
            .fetch_optional(&state.db)
            .await?;
    Ok(Json(prefs.unwrap_or(serde_json::Value::Null)))
}

pub async fn put_news_prefs(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    if !valid_news_prefs(&body) {
        return Err(AppError::BadRequest("Préférences invalides ou trop grandes".into()));
    }
    sqlx::query(
        "INSERT INTO user_news_prefs (user_id, prefs) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()",
    )
    .bind(claims.sub)
    .bind(&body)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    #[test]
    fn urls_and_clipping() {
        assert_eq!(super::web_url(" https://a.fr/x?y=1 ").as_deref(), Some("https://a.fr/x?y=1"));
        assert!(super::web_url("javascript:alert(1)").is_none());
        assert!(super::web_url("https://a.fr/\"><script>").is_none());
        assert_eq!(super::clip("abcdef", 4), "abc…");
        assert_eq!(super::clip("  abc ", 4), "abc");
    }

    #[test]
    fn rss_html_and_images() {
        let h = r#"<p>Le <a href="https://fr.wikipedia.org/wiki/DNS">serveur DNS</a>, c&#39;est&nbsp;clé.</p><img height=100 src="https://img.fr/a.jpg?x=1&amp;y=2">"#;
        assert_eq!(super::html_text(h), "Le serveur DNS, c'est clé.");
        assert_eq!(super::first_img(h).as_deref(), Some("https://img.fr/a.jpg?x=1&y=2"));
        assert!(super::first_img(r#"<img src="http://x.fr/a.jpg">"#).is_none());
        assert_eq!(super::feed_url("https://www.lexpress.fr/r/a.jpg?auth=ab&amp;w=1").as_deref(), Some("https://www.lexpress.fr/r/a.jpg?auth=ab&w=1"));
        assert_eq!(super::youtube_thumb("https://www.youtube.com/shorts/0oudvTK55rA").as_deref(), Some("https://i.ytimg.com/vi/0oudvTK55rA/hqdefault.jpg"));
        assert_eq!(super::youtube_thumb("https://www.youtube.com/watch?v=fICk_d6lnKU&t=3").as_deref(), Some("https://i.ytimg.com/vi/fICk_d6lnKU/hqdefault.jpg"));
        assert!(super::youtube_thumb("https://www.numerama.com/x").is_none());
    }

    #[test]
    fn news_prefs_bounds() {
        use serde_json::json;
        assert!(super::valid_news_prefs(&json!({ "theme": 6, "pins": ["c:securite"], "muted": [], "folded": { "g:tech": true } })));
        assert!(!super::valid_news_prefs(&json!([1, 2])));
        assert!(!super::valid_news_prefs(&json!("x")));
        assert!(!super::valid_news_prefs(&serde_json::Value::Null));
        assert!(!super::valid_news_prefs(&json!({ "order": vec!["x".repeat(100); 200] })));
    }
}
