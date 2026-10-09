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
    let title = clip(&b.title, 300);
    let link = web_url(&b.link).ok_or_else(|| AppError::BadRequest("Lien d'article invalide".into()))?;
    if site.is_empty() || category.is_empty() || title.is_empty() {
        return Err(AppError::BadRequest("Site, rubrique et titre requis".into()));
    }
    let summary = b.summary.as_deref().map(|s| clip(s, 1200)).filter(|s| !s.is_empty());
    let image = b.image.as_deref().and_then(web_url).filter(|u| u.starts_with("https://"));
    let published = b.published_at
        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .filter(|d| *d <= chrono::Utc::now() + chrono::Duration::hours(1))
        .unwrap_or_else(chrono::Utc::now);

    let site_id: Uuid = sqlx::query_scalar(
        "INSERT INTO news_sites (server_id, name, category, public) VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_id, name) DO UPDATE SET category = EXCLUDED.category, public = EXCLUDED.public
         RETURNING id",
    ).bind(b.server_id).bind(&site).bind(&category).bind(b.public).fetch_one(&state.db).await?;

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
}
