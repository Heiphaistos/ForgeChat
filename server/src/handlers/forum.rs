use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

use super::e2e_channel::check_content;
use super::servers::require_member_and_channel;
use super::threads::CursorQuery;
use super::uploads::{attachments_by_owner, remove_upload_files, AttachmentOwner};

#[derive(Debug, Serialize, FromRow)]
pub struct ForumPost {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub title: String,
    pub content: Option<String>,
    pub creator_id: Uuid,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub locked: bool,
    pub reply_count: i32,
    pub last_reply_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Média d'une publication de salon média (`/uploads/<uuid>.<ext>`).
    pub media_url: Option<String>,
    /// Titre et contenu chiffrés ensemble ({t, title}) ; `title` vide, `content` NULL.
    pub enc: Option<serde_json::Value>,
    /// Tiré par l'appli : lie la publication et ses réponses (AAD).
    pub client_msg_id: Uuid,
    pub purged: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ForumReply {
    pub id: Uuid,
    pub post_id: Uuid,
    pub user_id: Uuid,
    pub content: Option<String>,
    pub edited_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
    pub purged: bool,
}

/// Champs de chiffrement d'une ligne `forum_posts` / `forum_replies` pour la réponse JSON.
fn e2e_fields(r: &sqlx::postgres::PgRow) -> serde_json::Value {
    use sqlx::Row;
    let enc: Option<serde_json::Value> = r.get("enc");
    let content: Option<String> = r.get("content");
    serde_json::json!({
        "unencrypted": enc.is_none() && content.is_some(),
        "enc": enc,
        "client_msg_id": r.get::<Option<Uuid>, _>("client_msg_id"),
        "purged": r.get::<bool, _>("purged"),
    })
}

fn merge(mut a: serde_json::Value, b: serde_json::Value) -> serde_json::Value {
    if let (Some(a), serde_json::Value::Object(b)) = (a.as_object_mut(), b) {
        a.extend(b);
    }
    a
}

#[derive(Debug, Deserialize)]
pub struct CreatePostReq {
    #[serde(default)]
    pub title: String,
    pub content: Option<String>,
    /// Publication chiffrée : {t: contenu, title: titre}.
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
    pub tags: Option<Vec<String>>,
    /// URL rendue par POST .../forum-uploads ; obligatoire dans un salon média.
    pub media_url: Option<String>,
}

/// Média d'un fichier téléversé par `forum_upload` : `/uploads/<uuid>.<ext image/vidéo>`.
fn is_valid_media_url(url: &str) -> bool {
    let Some((stem, ext)) = url.strip_prefix("/uploads/").and_then(|f| f.rsplit_once('.')) else { return false };
    stem.len() == 36 && Uuid::parse_str(stem).is_ok()
        && super::uploads::FORUM_EXTENSIONS.contains(&ext)
}

#[derive(Debug, Deserialize)]
pub struct CreateReplyReq {
    #[serde(default)]
    pub content: String,
    /// Le client joint des fichiers juste après : le texte peut alors être vide.
    #[serde(default)]
    pub has_attachments: bool,
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

pub async fn list_posts(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<CursorQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let default_sort: String = sqlx::query_scalar(
        "SELECT default_sort FROM channels WHERE id = $1"
    )
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;

    // Clé de tri figée (jamais issue de l'entrée utilisateur). Curseur composite
    // (épinglé, clé, id) aligné sur l'ORDER BY : aucun post sauté ni dupliqué.
    let (key, ckey) = if default_sort == "creation_date" {
        ("fp.created_at", "c.created_at")
    } else {
        ("COALESCE(fp.last_reply_at, fp.created_at)", "COALESCE(c.last_reply_at, c.created_at)")
    };

    let rows = sqlx::query(&format!(
        "SELECT fp.*, COALESCE(fp.webhook_display_name, u.username) as creator_username, NULLIF(COALESCE(fp.webhook_avatar_url, u.avatar), '') as creator_avatar
         FROM forum_posts fp
         JOIN users u ON u.id = fp.creator_id
         WHERE fp.channel_id = $1
           AND ($2::uuid IS NULL OR (fp.pinned, {key}, fp.id) <
                (SELECT c.pinned, {ckey}, c.id FROM forum_posts c WHERE c.id = $2 AND c.channel_id = $1))
         ORDER BY fp.pinned DESC, {key} DESC, fp.id DESC
         LIMIT $3"
    ))
    .bind(channel_id)
    .bind(q.before)
    .bind(q.limit())
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = rows.iter().map(|r| {
        use sqlx::Row;
        let post = serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "channel_id": r.get::<Uuid, _>("channel_id"),
            "title": r.get::<String, _>("title"),
            "content": r.get::<Option<String>, _>("content"),
            "creator_id": r.get::<Uuid, _>("creator_id"),
            "creator_username": r.get::<String, _>("creator_username"),
            "creator_avatar": r.get::<Option<String>, _>("creator_avatar"),
            "tags": r.get::<Vec<String>, _>("tags"),
            "pinned": r.get::<bool, _>("pinned"),
            "locked": r.get::<bool, _>("locked"),
            "reply_count": r.get::<i32, _>("reply_count"),
            "last_reply_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_reply_at"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "media_url": r.get::<Option<String>, _>("media_url"),
        });
        merge(post, e2e_fields(r))
    }).collect();

    Ok(Json(result))
}

pub async fn create_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreatePostReq>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;
    crate::handlers::automod::check_rate(&state, server_id, claims.sub).await?;

    let is_timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    ).bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    if is_timed_out { return Err(AppError::Forbidden); }

    let has_enc = body.enc.as_ref().is_some_and(|v| !v.is_null());
    let title = body.title.trim().to_string();
    if (!has_enc && title.is_empty()) || title.chars().count() > 200 {
        return Err(AppError::BadRequest("Titre requis (max 200 chars)".into()));
    }

    let content_raw = body.content.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let content_str: Option<String> = content_raw.map(|s| {
        if s.chars().count() > 8000 { s.chars().take(8000).collect() } else { s.to_string() }
    });
    let has_text = !title.is_empty() || content_str.is_some();
    let enc = check_content(&state.db, channel_id, has_text, body.enc.as_ref(), body.client_msg_id, false).await?;

    let tags = body.tags.unwrap_or_default();

    let (require_tag, channel_type): (bool, String) = sqlx::query_as(
        "SELECT require_tag, type FROM channels WHERE id = $1"
    )
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;
    // Salon média : chaque publication porte une image ou une vidéo.
    let media_url = body.media_url.as_deref().map(str::trim).filter(|u| !u.is_empty());
    if media_url.is_some_and(|u| !is_valid_media_url(u)) {
        return Err(AppError::BadRequest("Média invalide".into()));
    }
    if channel_type == "media" && media_url.is_none() {
        return Err(AppError::BadRequest("Une publication de salon média exige une image ou une vidéo".into()));
    }
    if require_tag && tags.is_empty() {
        return Err(AppError::BadRequest("Ce canal exige au moins un tag".into()));
    }

    // Si l'admin a défini une liste de tags officiels pour ce canal, un post ne
    // peut plus utiliser de tag arbitraire -- seulement ceux de cette liste.
    let official_tags: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM forum_tags WHERE channel_id = $1"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;
    if !official_tags.is_empty() && tags.iter().any(|t| !official_tags.contains(t)) {
        return Err(AppError::BadRequest(
            "Seuls les tags officiels de ce canal sont autorisés".into(),
        ));
    }

    // Jamais vérifié sur ce chemin (comme reply_to_post plus bas) -- un post de forum
    // contournait entièrement le filtre AutoMod du serveur. Le contenu est optionnel
    // pour un post forum (titre seul valide), donc check seulement s'il y en a un.
    if let Some(ref c) = content_str {
        if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, c).await {
            return Err(err);
        }
    }

    let post = sqlx::query_as::<_, ForumPost>(
        "INSERT INTO forum_posts (channel_id, title, content, creator_id, tags, media_url, enc, client_msg_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, gen_random_uuid())) RETURNING *"
    )
    .bind(channel_id)
    .bind(&title)
    .bind(content_str.as_deref())
    .bind(claims.sub)
    .bind(&tags)
    .bind(media_url)
    .bind(&enc)
    .bind(body.client_msg_id)
    .fetch_one(&state.db)
    .await?;

    let event = serde_json::json!({ "type": "FORUM_POST_CREATE", "channel_id": channel_id, "post": post });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "post": post })))
}

pub async fn get_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
    Query(q): Query<CursorQuery>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let post_row = sqlx::query(
        "SELECT fp.*, COALESCE(fp.webhook_display_name, u.username) as creator_username, NULLIF(COALESCE(fp.webhook_avatar_url, u.avatar), '') as creator_avatar
         FROM forum_posts fp
         JOIN users u ON u.id = fp.creator_id
         WHERE fp.id = $1 AND fp.channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    // Page de réponses la plus récente (ou antérieure au curseur), en ordre chronologique.
    let mut reply_rows = sqlx::query(
        "SELECT fr.*, COALESCE(fr.webhook_display_name, u.username) AS username, NULLIF(COALESCE(fr.webhook_avatar_url, u.avatar), '') AS avatar, u.discriminator
         FROM forum_replies fr
         JOIN users u ON u.id = fr.user_id
         WHERE fr.post_id = $1
           AND ($2::uuid IS NULL OR (fr.created_at, fr.id) <
                (SELECT c.created_at, c.id FROM forum_replies c WHERE c.id = $2 AND c.post_id = $1))
         ORDER BY fr.created_at DESC, fr.id DESC
         LIMIT $3"
    )
    .bind(post_id)
    .bind(q.before)
    .bind(q.limit())
    .fetch_all(&state.db)
    .await?;
    reply_rows.reverse();

    use sqlx::Row;

    // Reactions groupees par reponse
    let reply_ids: Vec<Uuid> = reply_rows.iter().map(|r| r.get::<Uuid, _>("id")).collect();
    let reaction_rows = if reply_ids.is_empty() { vec![] } else {
        sqlx::query(
            "SELECT r.forum_reply_id, r.emoji, COUNT(*) as count, bool_or(r.user_id=$2) as me,
                    array_agg(u.username ORDER BY r.created_at) as users
             FROM forum_reply_reactions r JOIN users u ON u.id = r.user_id
             WHERE r.forum_reply_id = ANY($1)
             GROUP BY r.forum_reply_id, r.emoji"
        )
        .bind(&reply_ids).bind(claims.sub)
        .fetch_all(&state.db).await.unwrap_or_default()
    };
    let mut react_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &reaction_rows {
        let mid = r.get::<Uuid, _>("forum_reply_id");
        react_map.entry(mid).or_default().push(serde_json::json!({
            "emoji": r.get::<String, _>("emoji"),
            "count": r.get::<i64, _>("count"),
            "me": r.get::<bool, _>("me"),
            "users": r.get::<Vec<String>, _>("users"),
        }));
    }

    let mut att_map = attachments_by_owner(&state, AttachmentOwner::ForumReply, &reply_ids).await;

    let post = serde_json::json!({
        "id": post_row.get::<Uuid, _>("id"),
        "channel_id": post_row.get::<Uuid, _>("channel_id"),
        "title": post_row.get::<String, _>("title"),
        "content": post_row.get::<Option<String>, _>("content"),
        "creator_id": post_row.get::<Uuid, _>("creator_id"),
        "creator_username": post_row.get::<String, _>("creator_username"),
        "creator_avatar": post_row.get::<Option<String>, _>("creator_avatar"),
        "tags": post_row.get::<Vec<String>, _>("tags"),
        "pinned": post_row.get::<bool, _>("pinned"),
        "locked": post_row.get::<bool, _>("locked"),
        "reply_count": post_row.get::<i32, _>("reply_count"),
        "created_at": post_row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "media_url": post_row.get::<Option<String>, _>("media_url"),
    });
    let post = merge(post, e2e_fields(&post_row));

    let replies: Vec<serde_json::Value> = reply_rows.iter().map(|r| {
        merge(serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "post_id": r.get::<Uuid, _>("post_id"),
            "user_id": r.get::<Uuid, _>("user_id"),
            "content": r.get::<Option<String>, _>("content"),
            "edited_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("edited_at"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author": {
                "id": r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "discriminator": r.get::<String, _>("discriminator"),
            },
            "reactions": react_map.get(&r.get::<Uuid, _>("id")).cloned().unwrap_or_default(),
            "attachments": att_map.remove(&r.get::<Uuid, _>("id")).unwrap_or_default(),
        }), e2e_fields(r))
    }).collect();

    Ok(Json(serde_json::json!({ "post": post, "replies": replies })))
}

// Toggle d une reaction sur une reponse de forum (meme pattern que les threads)
pub async fn toggle_reply_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id, emoji)): Path<(Uuid, Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    crate::handlers::servers::require_not_timed_out(&state, claims.sub, server_id).await?;

    let reply_ok: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM forum_replies fr JOIN forum_posts fp ON fp.id = fr.post_id
         WHERE fr.id=$1 AND fr.post_id=$2 AND fp.channel_id=$3)"
    ).bind(reply_id).bind(post_id).bind(channel_id).fetch_one(&state.db).await?;
    if !reply_ok { return Err(AppError::NotFound("Reponse introuvable".into())); }

    let emoji = emoji.trim().to_string();
    if emoji.is_empty() || emoji.chars().count() > 16 {
        return Err(AppError::BadRequest("Emoji invalide".into()));
    }

    let existing: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM forum_reply_reactions WHERE forum_reply_id=$1 AND user_id=$2 AND emoji=$3)"
    ).bind(reply_id).bind(claims.sub).bind(&emoji).fetch_one(&state.db).await?;

    let added = if existing {
        sqlx::query(
            "DELETE FROM forum_reply_reactions WHERE forum_reply_id=$1 AND user_id=$2 AND emoji=$3"
        ).bind(reply_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        false
    } else {
        sqlx::query(
            "INSERT INTO forum_reply_reactions (forum_reply_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
        ).bind(reply_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        true
    };

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM forum_reply_reactions WHERE forum_reply_id=$1 AND emoji=$2"
    ).bind(reply_id).bind(&emoji).fetch_one(&state.db).await?;

    let event = serde_json::json!({
        "type": "FORUM_REPLY_REACTION",
        "post_id": post_id,
        "channel_id": channel_id,
        "reply_id": reply_id,
        "emoji": emoji,
        "added": added,
        "count": count,
        "user_id": claims.sub,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "added": added, "count": count })))
}

pub async fn reply_to_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<CreateReplyReq>,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, false).await?;
    crate::handlers::automod::check_rate(&state, server_id, claims.sub).await?;

    let is_timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_timeouts WHERE server_id=$1 AND user_id=$2 AND expires_at > NOW())"
    ).bind(server_id).bind(claims.sub).fetch_one(&state.db).await?;
    if is_timed_out { return Err(AppError::Forbidden); }

    let content_raw = body.content.trim().to_string();
    let has_enc = body.enc.as_ref().is_some_and(|v| !v.is_null());
    if content_raw.is_empty() && !body.has_attachments && !has_enc {
        return Err(AppError::BadRequest("Réponse vide".into()));
    }
    if content_raw.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }
    let content = content_raw;
    let enc = check_content(&state.db, channel_id, !content.is_empty(), body.enc.as_ref(), body.client_msg_id, false).await?;

    // Jamais vérifié sur ce chemin -- une réponse de forum contournait entièrement le
    // filtre AutoMod du serveur. Fait avant d'ouvrir la transaction ci-dessous pour ne
    // pas garder le verrou FOR UPDATE plus longtemps que nécessaire.
    if !content.is_empty() {
        if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, &content).await {
            return Err(err);
        }
    }

    // Transaction avec SELECT FOR UPDATE pour éviter la race condition locked/INSERT
    let mut tx = state.db.begin().await?;

    let post_row = sqlx::query(
        "SELECT locked FROM forum_posts WHERE id = $1 AND channel_id = $2 FOR UPDATE"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    {
        use sqlx::Row;
        if post_row.get::<bool, _>("locked") {
            tx.rollback().await.ok();
            return Err(AppError::Forbidden);
        }
    }

    let reply = sqlx::query_as::<_, ForumReply>(
        "INSERT INTO forum_replies (post_id, user_id, content, enc, client_msg_id) VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(post_id)
    .bind(claims.sub)
    .bind(Some(&content).filter(|_| enc.is_none()))
    .bind(&enc)
    .bind(enc.as_ref().and(body.client_msg_id))
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE forum_posts SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = $1"
    )
    .bind(post_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let event = serde_json::json!({ "type": "FORUM_REPLY_CREATE", "channel_id": channel_id, "post_id": post_id, "reply": reply });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "reply": reply })))
}

pub async fn update_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let post = sqlx::query(
        "SELECT creator_id FROM forum_posts WHERE id = $1 AND channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    use sqlx::Row;
    let creator_id = post.get::<Uuid, _>("creator_id");

    let content = body["content"].as_str();
    let pinned = body["pinned"].as_bool();
    let locked = body["locked"].as_bool();
    // Publication chiffrée : nouveau {t, title} chiffré, même `client_msg_id` (lié à l'AAD).
    let cmid: Option<Uuid> = sqlx::query_scalar("SELECT client_msg_id FROM forum_posts WHERE id=$1")
        .bind(post_id)
        .fetch_optional(&state.db)
        .await?;
    let enc = if content.is_some() || body.get("enc").is_some_and(|v| !v.is_null()) {
        check_content(&state.db, channel_id, content.is_some_and(|c| !c.trim().is_empty()), body.get("enc"), cmid, false).await?
    } else {
        None
    };

    // pin/lock réservé aux modérateurs
    if pinned.is_some() || locked.is_some() {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }
    // content : réservé au créateur indépendamment des autres champs
    if (content.is_some() || enc.is_some()) && creator_id != claims.sub {
        return Err(AppError::Forbidden);
    }

    // Chiffré : le titre et le contenu en clair disparaissent ; jamais de clair sur du chiffré.
    let done = sqlx::query(
        "UPDATE forum_posts SET
            pinned = COALESCE($2, pinned),
            locked = COALESCE($3, locked),
            content = CASE WHEN $6::jsonb IS NOT NULL THEN NULL ELSE COALESCE($4, content) END,
            title = CASE WHEN $6::jsonb IS NOT NULL THEN '' ELSE title END,
            enc = COALESCE($6, enc)
         WHERE id = $1 AND channel_id = $5 AND ($4::text IS NULL OR enc IS NULL)"
    )
    .bind(post_id)
    .bind(pinned)
    .bind(locked)
    .bind(content.filter(|_| enc.is_none()))
    .bind(channel_id)
    .bind(&enc)
    .execute(&state.db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::BadRequest(crate::handlers::e2e_conv::PLAINTEXT_REFUSED.into()));
    }

    let event = serde_json::json!({ "type": "FORUM_POST_UPDATE", "channel_id": channel_id, "post_id": post_id });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_post(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let row = sqlx::query(
        "SELECT creator_id FROM forum_posts WHERE id = $1 AND channel_id = $2"
    )
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Post introuvable".into()))?;

    use sqlx::Row;
    let creator_id = row.get::<Uuid, _>("creator_id");

    // Créateur ou modérateur MANAGE_MESSAGES peut supprimer
    if creator_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    // Fichiers joints aux réponses : récupérés avant la cascade pour les supprimer du disque.
    // ponytail: le média d'un salon média (media_url) reste sur le disque, comme les
    // fichiers de forum_upload cités dans le texte : rien ne garantit qu'un seul post
    // le référence. Ajouter un propriétaire au fichier si le disque le demande.
    let attachment_urls: Vec<String> = sqlx::query_scalar(
        "SELECT a.url FROM attachments a JOIN forum_replies fr ON fr.id = a.forum_reply_id WHERE fr.post_id = $1"
    )
    .bind(post_id)
    .fetch_all(&state.db)
    .await?;

    sqlx::query("DELETE FROM forum_posts WHERE id = $1 AND channel_id = $2")
        .bind(post_id)
        .bind(channel_id)
        .execute(&state.db)
        .await?;
    remove_upload_files(&state, attachment_urls);

    let event = serde_json::json!({ "type": "FORUM_POST_DELETE", "channel_id": channel_id, "post_id": post_id });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct EditReplyReq {
    #[serde(default)]
    pub content: String,
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

pub async fn edit_reply(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
    Json(body): Json<EditReplyReq>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let content = body.content.trim().to_string();
    if content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Contenu invalide (1-4000 caractères)".into()));
    }
    let existing: Option<Uuid> = sqlx::query_scalar("SELECT client_msg_id FROM forum_replies WHERE id=$1")
        .bind(reply_id)
        .fetch_optional(&state.db)
        .await?
        .flatten();
    let cmid = existing.or(body.client_msg_id);
    let enc = check_content(&state.db, channel_id, !content.is_empty(), body.enc.as_ref(), cmid, false).await?;
    if content.is_empty() && enc.is_none() {
        return Err(AppError::BadRequest("Contenu invalide (1-4000 caractères)".into()));
    }

    // Vérifier que la réponse appartient à ce post et à l'utilisateur
    let rows = sqlx::query(
        "UPDATE forum_replies SET content=$1, enc=$6, client_msg_id=COALESCE($7, client_msg_id), edited_at=NOW()
         WHERE id=$2 AND post_id=$3 AND user_id=$4
           AND post_id IN (SELECT id FROM forum_posts WHERE channel_id=$5)
           AND ($6::jsonb IS NOT NULL OR enc IS NULL)
         RETURNING id"
    )
    .bind(Some(&content).filter(|_| enc.is_none()))
    .bind(reply_id)
    .bind(post_id)
    .bind(claims.sub)
    .bind(channel_id)
    .bind(&enc)
    .bind(enc.as_ref().and(cmid))
    .execute(&state.db)
    .await?;

    if rows.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }

    let event = serde_json::json!({
        "type": "FORUM_REPLY_EDIT",
        "channel_id": channel_id,
        "post_id": post_id,
        "reply_id": reply_id,
        "content": if enc.is_some() { None } else { Some(content) },
        "enc": enc,
        "client_msg_id": enc.as_ref().and(cmid),
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_reply(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    // Créateur ou modérateur MANAGE_MESSAGES peut supprimer
    use sqlx::Row;
    // Le post doit appartenir au salon de l'URL : sinon un modérateur de SON
    // serveur supprimait les réponses de forum d'un autre serveur.
    let reply_row = sqlx::query(
        "SELECT fr.user_id FROM forum_replies fr JOIN forum_posts fp ON fp.id = fr.post_id
         WHERE fr.id=$1 AND fr.post_id=$2 AND fp.channel_id=$3"
    )
    .bind(reply_id)
    .bind(post_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Réponse introuvable".into()))?;

    let author_id: Uuid = reply_row.get("user_id");
    if author_id != claims.sub {
        use super::servers::require_permission;
        use crate::models::role::Permissions;
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    let attachment_urls: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM attachments WHERE forum_reply_id=$1"
    )
    .bind(reply_id)
    .fetch_all(&state.db)
    .await?;

    sqlx::query("DELETE FROM forum_replies WHERE id=$1 AND post_id=$2")
        .bind(reply_id)
        .bind(post_id)
        .execute(&state.db)
        .await?;
    remove_upload_files(&state, attachment_urls);

    // Décrémenter reply_count
    sqlx::query(
        "UPDATE forum_posts SET reply_count = GREATEST(0, reply_count - 1) WHERE id=$1"
    )
    .bind(post_id)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "FORUM_REPLY_DELETE",
        "channel_id": channel_id,
        "post_id": post_id,
        "reply_id": reply_id,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}


#[cfg(test)]
mod tests {
    use super::is_valid_media_url;

    #[test]
    fn media_urls() {
        let id = "0b6f3c2e-8d1a-4c5e-9f7a-1b2c3d4e5f60";
        assert!(is_valid_media_url(&format!("/uploads/{id}.png")));
        assert!(is_valid_media_url(&format!("/uploads/{id}.mp4")));
        assert!(!is_valid_media_url(&format!("/uploads/{id}.pdf")));
        assert!(!is_valid_media_url(&format!("/uploads/x/{id}.png")));
        assert!(!is_valid_media_url(&format!("https://evil.test/{id}.png")));
        assert!(!is_valid_media_url("/uploads/../secret.png"));
    }
}
