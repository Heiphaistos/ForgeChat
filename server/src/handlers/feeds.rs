use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, models::role::Permissions, state::AppState};

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ChannelFeed {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub name: String,
    pub feed_url: String,
    pub feed_type: String,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateFeedRequest {
    pub name: String,
    pub feed_url: String,
    pub feed_type: Option<String>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /servers/:server_id/channels/:channel_id/feeds
pub async fn list_channel_feeds(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ChannelFeed>>, AppError> {
    crate::handlers::servers::require_member(&state, claims.sub, server_id).await?;

    let feeds = sqlx::query_as::<_, ChannelFeed>(
        "SELECT id, server_id, channel_id, name, feed_url, feed_type,
                last_checked_at, enabled, created_at
         FROM channel_feeds
         WHERE channel_id = $1
         ORDER BY created_at ASC"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(feeds))
}

/// POST /servers/:server_id/channels/:channel_id/feeds
pub async fn create_channel_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateFeedRequest>,
) -> Result<Json<ChannelFeed>, AppError> {
    crate::handlers::servers::require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    // Validation basique
    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest("Nom invalide (1-100 chars)".into()));
    }

    let url = body.feed_url.trim().to_string();
    if url.is_empty() || url.len() > 2048 {
        return Err(AppError::BadRequest("URL invalide".into()));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::BadRequest("L'URL doit commencer par http:// ou https://".into()));
    }

    let feed_type = body.feed_type
        .as_deref()
        .map(|t| t.to_lowercase())
        .filter(|t| matches!(t.as_str(), "rss" | "youtube" | "reddit" | "github"))
        .unwrap_or_else(|| "rss".to_string());

    let feed = sqlx::query_as::<_, ChannelFeed>(
        "INSERT INTO channel_feeds (server_id, channel_id, name, feed_url, feed_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, server_id, channel_id, name, feed_url, feed_type,
                   last_checked_at, enabled, created_at"
    )
    .bind(server_id)
    .bind(channel_id)
    .bind(&name)
    .bind(&url)
    .bind(&feed_type)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    tracing::info!("Feed créé : {} ({}) sur canal {}", name, feed_type, channel_id);
    Ok(Json(feed))
}

/// DELETE /servers/:server_id/feeds/:feed_id
pub async fn delete_channel_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, feed_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::handlers::servers::require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    let rows = sqlx::query(
        "DELETE FROM channel_feeds WHERE id = $1 AND server_id = $2"
    )
    .bind(feed_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::NotFound("feed not found".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// PATCH /servers/:server_id/feeds/:feed_id/toggle
pub async fn toggle_channel_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, feed_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::handlers::servers::require_permission(&state, claims.sub, server_id, Permissions::MANAGE_CHANNELS).await?;

    let rows = sqlx::query(
        "UPDATE channel_feeds SET enabled = NOT enabled WHERE id = $1 AND server_id = $2"
    )
    .bind(feed_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::NotFound("feed not found".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// Polling RSS — appelé depuis main.rs
// ---------------------------------------------------------------------------

/// Struct interne pour le polling — on a besoin de last_item_guid
struct FeedRow {
    id: Uuid,
    channel_id: Uuid,
    server_id: Uuid,
    name: String,
    feed_url: String,
}

pub async fn poll_rss_feeds(state: &AppState) {
    use sqlx::Row;

    let rows = match sqlx::query(
        "SELECT id, channel_id, server_id, name, feed_url, last_item_guid
         FROM channel_feeds WHERE enabled = true"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("poll_rss_feeds: erreur SELECT feeds: {}", e);
            return;
        }
    };

    for row in &rows {
        let feed = FeedRow {
            id: row.get("id"),
            channel_id: row.get("channel_id"),
            server_id: row.get("server_id"),
            name: row.get("name"),
            feed_url: row.get("feed_url"),
        };
        let last_guid: Option<String> = row.try_get("last_item_guid").ok().flatten();

        if let Err(e) = process_feed(state, &feed, last_guid).await {
            tracing::warn!("Erreur feed {} ({}): {}", feed.name, feed.feed_url, e);
        }
    }
}

async fn process_feed(state: &AppState, feed: &FeedRow, last_guid: Option<String>) -> anyhow::Result<()> {
    // Fetch avec timeout 10s
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("ForgeChat-RSS/2.3")
        .build()?;

    let resp = client.get(&feed.feed_url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("HTTP {}", resp.status());
    }
    let xml = resp.text().await?;

    // Parsing XML simplifié — extrait le premier <item> ou <entry>
    if let Some((guid, title, link)) = parse_first_item(&xml) {
        // Si même guid que le dernier connu → pas de nouveau contenu
        if last_guid.as_deref() == Some(guid.as_str()) {
            // Mise à jour last_checked_at uniquement
            let _ = sqlx::query(
                "UPDATE channel_feeds SET last_checked_at = NOW() WHERE id = $1"
            )
            .bind(feed.id)
            .execute(&state.db)
            .await;
            return Ok(());
        }

        // Nouveau contenu — poster le message dans le canal
        let content = format!("🔔 **{}** — {}\n{}", feed.name, title, link);
        post_feed_message(state, feed, &content).await;

        // Mettre à jour last_item_guid + last_checked_at
        let _ = sqlx::query(
            "UPDATE channel_feeds SET last_item_guid = $1, last_checked_at = NOW() WHERE id = $2"
        )
        .bind(&guid)
        .bind(feed.id)
        .execute(&state.db)
        .await;
    } else {
        // Pas d'item parsé — on met juste à jour le timestamp
        let _ = sqlx::query(
            "UPDATE channel_feeds SET last_checked_at = NOW() WHERE id = $1"
        )
        .bind(feed.id)
        .execute(&state.db)
        .await;
    }

    Ok(())
}

/// Parse le premier <item> (RSS 2.0) ou <entry> (Atom) du XML.
/// Retourne (guid, title, link) si trouvé.
fn parse_first_item(xml: &str) -> Option<(String, String, String)> {
    // Cherche d'abord un <item> (RSS 2.0), sinon un <entry> (Atom)
    let item_start = xml.find("<item>").or_else(|| xml.find("<entry>"))?;
    let item_tag = if xml[item_start..].starts_with("<item>") { "item" } else { "entry" };
    let end_tag = format!("</{}>", item_tag);
    let item_end = xml[item_start..].find(end_tag.as_str())? + item_start;
    let item = &xml[item_start..item_end];

    let title = extract_tag(item, "title")
        .unwrap_or_else(|| "Nouveau contenu".to_string());

    // Pour le lien : Atom utilise <link href="..."/> ou <link>url</link>
    let link = extract_attr(item, "link", "href")
        .or_else(|| extract_tag(item, "link"))
        .unwrap_or_default();

    // GUID : <guid>, <id> (Atom), ou l'URL si absent
    let guid = extract_tag(item, "guid")
        .or_else(|| extract_tag(item, "id"))
        .unwrap_or_else(|| link.clone());

    if guid.is_empty() && link.is_empty() {
        return None;
    }

    Some((guid, clean_html(&title), link))
}

/// Extrait le contenu texte d'un tag XML simple : <tag>contenu</tag>
fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    // Cherche aussi les variantes avec namespace : <dc:tag> → ignorer, on reste sur le tag exact
    let start = xml.find(open.as_str())?;
    let content_start = start + open.len();
    let end = xml[content_start..].find(close.as_str())?;
    let content = xml[content_start..content_start + end].trim();
    if content.is_empty() {
        None
    } else {
        // Enlever CDATA si présent
        let cleaned = if content.starts_with("<![CDATA[") && content.ends_with("]]>") {
            content[9..content.len() - 3].to_string()
        } else {
            content.to_string()
        };
        Some(cleaned)
    }
}

/// Extrait la valeur d'un attribut dans un tag auto-fermant ou ouvrant.
/// Exemple : <link href="url"/> → extract_attr(xml, "link", "href") → Some("url")
fn extract_attr(xml: &str, tag: &str, attr: &str) -> Option<String> {
    let tag_open = format!("<{}", tag);
    let start = xml.find(tag_open.as_str())?;
    let end = xml[start..].find('>')?;
    let tag_content = &xml[start..start + end + 1];

    let attr_pattern = format!("{}=\"", attr);
    let attr_start = tag_content.find(attr_pattern.as_str())?;
    let value_start = attr_start + attr_pattern.len();
    let value_end = tag_content[value_start..].find('"')?;
    let value = tag_content[value_start..value_start + value_end].to_string();
    if value.is_empty() { None } else { Some(value) }
}

/// Supprime les balises HTML basiques d'un titre
fn clean_html(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    // Décoder quelques entités HTML basiques
    result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Insère un message de feed dans le canal et le broadcast via WS
async fn post_feed_message(state: &AppState, feed: &FeedRow, content: &str) {
    // On récupère l'owner du serveur pour user_id du message
    use sqlx::Row;
    let owner_id: Option<Uuid> = sqlx::query(
        "SELECT owner_id FROM servers WHERE id = $1"
    )
    .bind(feed.server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .map(|r| r.get("owner_id"));

    let Some(owner_id) = owner_id else {
        tracing::warn!("post_feed_message: serveur {} introuvable", feed.server_id);
        return;
    };

    let msg_id = Uuid::new_v4();
    let now = Utc::now();

    let result = sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, type)
         VALUES ($1, $2, $3, $4, 'feed')"
    )
    .bind(msg_id)
    .bind(feed.channel_id)
    .bind(owner_id)
    .bind(content)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("post_feed_message INSERT error: {}", e);
        return;
    }

    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "channel_id": feed.channel_id,
        "message": {
            "id": msg_id,
            "channel_id": feed.channel_id,
            "content": content,
            "author_username": format!("RSS: {}", feed.name),
            "type": "feed",
            "created_at": now,
        }
    });
    state.broadcast_to_channel_members(feed.channel_id, event.to_string()).await;
}
