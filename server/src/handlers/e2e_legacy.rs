//! Rechiffrement de l'ancien contenu en clair des salons de serveur
//! (docs/CHIFFREMENT-E2E.md §6). Le contenu des serveurs n'est JAMAIS purgé :
//! les applis le rechiffrent avec la clé du salon.
//! - l'auteur rechiffre ses anciens textes partout (`GET /e2e/legacy/channels`) ;
//! - à l'ouverture d'un salon, l'appli rechiffre ce que son utilisateur a le
//!   droit de rechiffrer (`GET /e2e/legacy/channels/:channel_id`) ;
//! - l'appli du propriétaire rechiffre tout le serveur (`GET /e2e/legacy/servers/:server_id`).
//!
//! Le serveur ne peut pas vérifier qu'un chiffré correspond au texte d'origine :
//! rechiffrer le texte d'AUTRUI est réservé au propriétaire du serveur et aux
//! modérateurs (ADMINISTRATOR ou MANAGE_MESSAGES), journalisé sans contenu, et
//! possible une seule fois (texte présent et `enc` NULL → `enc`). L'AAD garde
//! l'auteur d'origine (sinon les applis refusent de l'ouvrir).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{
        e2e_channel::channel_epoch,
        e2e_conv::{check_epoch, has_key, Enc},
    },
    middleware::auth::Claims,
    models::role::Permissions,
    state::{channel_audience_among, AppState},
};

/// Anciens contenus rechiffrables d'un salon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Message,
    ThreadMessage,
    ForumReply,
    ForumPost,
    /// Titre d'un fil (`{t}`, portée du fil, id client = `client_id` du fil).
    ThreadTitle,
    /// Question et options d'un sondage (`{t, o}`, portée du sondage).
    Poll,
}

impl Item {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "message" => Ok(Item::Message),
            "thread_message" => Ok(Item::ThreadMessage),
            "forum_reply" => Ok(Item::ForumReply),
            "forum_post" => Ok(Item::ForumPost),
            "thread_title" => Ok(Item::ThreadTitle),
            "poll" => Ok(Item::Poll),
            _ => Err(AppError::NotFound("Élément introuvable".into())),
        }
    }

    /// (salon, auteur) d'un ancien texte encore en clair, écrit par un humain hors webhook.
    fn lookup_sql(self) -> &'static str {
        match self {
            Item::Message => {
                "SELECT m.channel_id, m.user_id FROM messages m JOIN users u ON u.id = m.user_id
                 WHERE m.id=$1 AND m.enc IS NULL AND m.content IS NOT NULL AND m.type='default'
                   AND m.webhook_display_name IS NULL AND NOT u.is_bot"
            }
            Item::ThreadMessage => {
                "SELECT t.channel_id, tm.user_id FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
                 JOIN users u ON u.id = tm.user_id
                 WHERE tm.id=$1 AND tm.enc IS NULL AND tm.content IS NOT NULL AND tm.webhook_display_name IS NULL AND NOT u.is_bot"
            }
            Item::ForumReply => {
                "SELECT p.channel_id, r.user_id FROM forum_replies r JOIN forum_posts p ON p.id = r.post_id
                 JOIN users u ON u.id = r.user_id
                 WHERE r.id=$1 AND r.enc IS NULL AND r.content IS NOT NULL AND r.webhook_display_name IS NULL AND NOT u.is_bot"
            }
            Item::ForumPost => {
                "SELECT p.channel_id, p.creator_id FROM forum_posts p JOIN users u ON u.id = p.creator_id
                 WHERE p.id=$1 AND p.enc IS NULL AND (p.content IS NOT NULL OR p.title <> '')
                   AND p.webhook_display_name IS NULL AND NOT u.is_bot"
            }
            Item::ThreadTitle => {
                "SELECT t.channel_id, t.creator_id FROM threads t JOIN users u ON u.id = t.creator_id
                 WHERE t.id=$1 AND t.title_enc IS NULL AND t.title <> '' AND t.webhook_display_name IS NULL AND NOT u.is_bot"
            }
            Item::Poll => {
                "SELECT p.channel_id, p.creator_id FROM polls p JOIN users u ON u.id = p.creator_id
                 WHERE p.id=$1 AND p.enc IS NULL AND p.question <> '' AND NOT u.is_bot"
            }
        }
    }

    /// Remplace le clair par `enc` ($1), une seule fois (`enc` encore NULL).
    /// $2 = id client : nouveau pour un message, imposé pour une publication
    /// (`client_msg_id`) et un titre de fil (`client_id`), liés à l'AAD de leurs réponses.
    fn update_sql(self) -> &'static str {
        match self {
            Item::Message => "UPDATE messages SET enc=$1, client_msg_id=$2, content=NULL WHERE id=$3 AND enc IS NULL",
            Item::ThreadMessage => "UPDATE thread_messages SET enc=$1, client_msg_id=$2, content=NULL WHERE id=$3 AND enc IS NULL",
            Item::ForumReply => "UPDATE forum_replies SET enc=$1, client_msg_id=$2, content=NULL WHERE id=$3 AND enc IS NULL",
            Item::ForumPost => "UPDATE forum_posts SET enc=$1, content=NULL, title='' WHERE id=$3 AND enc IS NULL AND client_msg_id=$2",
            Item::ThreadTitle => "UPDATE threads SET title_enc=$1, title='' WHERE id=$3 AND title_enc IS NULL AND client_id=$2",
            Item::Poll => "UPDATE polls SET enc=$1, client_msg_id=$2, question='' WHERE id=$3 AND enc IS NULL",
        }
    }
}

/// Anciens textes en clair d'humains (hors bots, webhooks, flux, annonces suivies,
/// historique importé, messages système). Paramètres : $1 auteur (NULL : tous),
/// $2 salon, $3 serveur (NULL : partout), $4 curseur `id >`, $5 nombre.
const LEGACY_SQL: &str = "SELECT * FROM (
    (SELECT 'message' AS item, m.channel_id, m.id, m.user_id AS author_id, m.content, NULL::text AS title,
            NULL::uuid AS scope_id, NULL::jsonb AS options
     FROM messages m WHERE m.enc IS NULL AND m.content IS NOT NULL AND m.content <> '' AND m.type='default'
       AND m.webhook_display_name IS NULL AND {f:m.user_id:m.channel_id:m.id} ORDER BY m.id LIMIT $5)
    UNION ALL
    (SELECT 'thread_message', t.channel_id, tm.id, tm.user_id, tm.content, NULL, t.client_id, NULL
     FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
     WHERE tm.enc IS NULL AND tm.content IS NOT NULL AND tm.content <> '' AND tm.webhook_display_name IS NULL
       AND {f:tm.user_id:t.channel_id:tm.id} ORDER BY tm.id LIMIT $5)
    UNION ALL
    (SELECT 'forum_reply', p.channel_id, r.id, r.user_id, r.content, NULL, p.client_msg_id, NULL
     FROM forum_replies r JOIN forum_posts p ON p.id = r.post_id
     WHERE r.enc IS NULL AND r.content IS NOT NULL AND r.content <> '' AND r.webhook_display_name IS NULL
       AND {f:r.user_id:p.channel_id:r.id} ORDER BY r.id LIMIT $5)
    UNION ALL
    (SELECT 'forum_post', p.channel_id, p.id, p.creator_id, COALESCE(p.content, ''), p.title, p.client_msg_id, NULL
     FROM forum_posts p WHERE p.enc IS NULL AND (p.content IS NOT NULL OR p.title <> '')
       AND p.webhook_display_name IS NULL AND {f:p.creator_id:p.channel_id:p.id} ORDER BY p.id LIMIT $5)
    UNION ALL
    (SELECT 'thread_title', t.channel_id, t.id, t.creator_id, t.title, NULL, t.client_id, NULL
     FROM threads t WHERE t.title_enc IS NULL AND t.title <> '' AND t.webhook_display_name IS NULL
       AND {f:t.creator_id:t.channel_id:t.id} ORDER BY t.id LIMIT $5)
    UNION ALL
    (SELECT 'poll', p.channel_id, p.id, p.creator_id, p.question, NULL, NULL,
            (SELECT jsonb_agg(o.text ORDER BY o.position, o.id) FROM poll_options o WHERE o.poll_id = p.id)
     FROM polls p WHERE p.enc IS NULL AND p.question <> '' AND {f:p.creator_id:p.channel_id:p.id} ORDER BY p.id LIMIT $5)
) x ORDER BY id LIMIT $5";

/// Filtre commun d'une branche : auteur humain, portée, curseur.
fn legacy_sql() -> String {
    let mut out = String::new();
    let mut rest = LEGACY_SQL;
    while let Some(i) = rest.find("{f:") {
        let j = i + rest[i..].find('}').expect("filtre fermé");
        let cols: Vec<&str> = rest[i + 3..j].split(':').collect();
        let (author, chan, id) = (cols[0], cols[1], cols[2]);
        out.push_str(&rest[..i]);
        out.push_str(&format!(
            "{author} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id = {author} AND u.is_bot)
             AND ($1::uuid IS NULL OR {author} = $1) AND ($2::uuid IS NULL OR {chan} = $2)
             AND ($3::uuid IS NULL OR {chan} IN (SELECT c.id FROM channels c WHERE c.server_id = $3))
             AND ($4::uuid IS NULL OR {id} > $4)"
        ));
        rest = &rest[j + 1..];
    }
    out.push_str(rest);
    out
}

/// Où chercher et pour quel auteur.
#[derive(Clone, Copy, Debug, Default)]
pub struct Filter {
    pub author: Option<Uuid>,
    pub channel: Option<Uuid>,
    pub server: Option<Uuid>,
    pub after: Option<Uuid>,
}

type Row = (String, Uuid, Uuid, Uuid, String, Option<String>, Option<Uuid>, Option<Value>);

pub async fn legacy_items(db: &PgPool, f: Filter, limit: i64) -> Result<Vec<Value>> {
    // ponytail: `$n IS NULL OR …` empêche parfois l'index partiel ; requêtes spécialisées si un grand serveur rame.
    let rows: Vec<Row> = sqlx::query_as(&legacy_sql())
        .bind(f.author)
        .bind(f.channel)
        .bind(f.server)
        .bind(f.after)
        .bind(limit)
        .fetch_all(db)
        .await?;
    Ok(rows
        .into_iter()
        .map(|(item, channel, id, author, content, title, scope, options)| {
            json!({
                "conv_kind": "channel", "conv_id": channel, "item": item, "id": id, "author_id": author,
                "content": content, "title": title, "scope_id": scope, "options": options,
            })
        })
        .collect())
}

/// Propriétaire, ADMINISTRATOR ou MANAGE_MESSAGES (même calcul que
/// `servers::require_permission`, sur la base seule pour les tests).
pub async fn is_moderator(db: &PgPool, user: Uuid, server: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT sm.is_owner OR ((
             COALESCE((SELECT BIT_OR(r.permissions) FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                       WHERE mr.user_id = $1 AND mr.server_id = $2), 0)
             | COALESCE((SELECT permissions FROM roles WHERE server_id = $2 AND is_everyone), 0)
         ) & ($3 | $4)) <> 0
         FROM server_members sm WHERE sm.user_id = $1 AND sm.server_id = $2",
    )
    .bind(user)
    .bind(server)
    .bind(Permissions::ADMINISTRATOR)
    .bind(Permissions::MANAGE_MESSAGES)
    .fetch_optional(db)
    .await?
    .unwrap_or(false))
}

async fn server_of(db: &PgPool, channel: Uuid) -> Result<Uuid> {
    sqlx::query_scalar::<_, Option<Uuid>>("SELECT server_id FROM channels WHERE id=$1")
        .bind(channel)
        .fetch_optional(db)
        .await?
        .flatten()
        .ok_or_else(|| AppError::NotFound("Salon introuvable".into()))
}

/// Mes anciens textes, dans les salons que je vois encore (un ancien membre ne récupère rien).
pub async fn my_items(db: &PgPool, user: Uuid, limit: i64) -> Result<Vec<Value>> {
    if !has_key(db, user).await? {
        return Ok(vec![]);
    }
    let items = legacy_items(db, Filter { author: Some(user), ..Default::default() }, limit).await?;
    let mut visible: HashMap<Uuid, bool> = HashMap::new();
    let mut out = Vec::with_capacity(items.len());
    for it in items {
        let Some(channel) = it["conv_id"].as_str().and_then(|s| s.parse::<Uuid>().ok()) else { continue };
        let ok = match visible.get(&channel) {
            Some(v) => *v,
            None => {
                let v = !channel_audience_among(db, channel, &[user]).await.is_empty();
                visible.insert(channel, v);
                v
            }
        };
        if ok {
            out.push(it);
        }
    }
    Ok(out)
}

/// Anciens textes d'un salon que `user` peut rechiffrer : tous s'il modère, sinon les siens.
pub async fn channel_items(db: &PgPool, user: Uuid, channel: Uuid, after: Option<Uuid>, limit: i64) -> Result<Vec<Value>> {
    if channel_audience_among(db, channel, &[user]).await.is_empty() {
        return Err(AppError::Forbidden);
    }
    if !has_key(db, user).await? {
        return Ok(vec![]);
    }
    let author = if is_moderator(db, user, server_of(db, channel).await?).await? { None } else { Some(user) };
    legacy_items(db, Filter { author, channel: Some(channel), after, ..Default::default() }, limit).await
}

/// Tous les anciens textes d'un serveur : propriétaire seulement.
pub async fn server_items(db: &PgPool, user: Uuid, server: Uuid, after: Option<Uuid>, limit: i64) -> Result<Vec<Value>> {
    let owner: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id=$1 AND owner_id=$2)")
        .bind(server)
        .bind(user)
        .fetch_one(db)
        .await?;
    if !owner {
        return Err(AppError::Forbidden);
    }
    legacy_items(db, Filter { server: Some(server), after, ..Default::default() }, limit).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptItemBody {
    enc: Value,
    client_msg_id: Uuid,
}

/// Rechiffre un ancien texte : par son auteur, ou par le propriétaire / un modérateur.
pub async fn encrypt_item(db: &PgPool, user: Uuid, item: Item, id: Uuid, body: EncryptItemBody) -> Result<()> {
    let (channel, author): (Uuid, Uuid) = sqlx::query_as(item.lookup_sql())
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::Conflict("NOT_LEGACY".into()))?;
    if channel_audience_among(db, channel, &[user]).await.is_empty() {
        return Err(AppError::Forbidden);
    }
    if author != user && !is_moderator(db, user, server_of(db, channel).await?).await? {
        return Err(AppError::Forbidden);
    }
    let enc = Enc::parse(&body.enc)?;
    check_epoch(channel_epoch(db, channel).await?, enc.epoch)?;
    let mut tx = db.begin().await?;
    let done = sqlx::query(item.update_sql()).bind(enc.to_json()).bind(body.client_msg_id).bind(id).execute(&mut *tx).await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("NOT_LEGACY".into()));
    }
    // Copies du texte ailleurs : historique des éditions, enregistrés, options et aperçu d'un sondage.
    let extra: &[&str] = match item {
        Item::Message => &[
            "DELETE FROM message_edits WHERE message_id=$1",
            "UPDATE saved_messages SET content=NULL WHERE message_id=$1",
        ],
        Item::Poll => &[
            "UPDATE poll_options SET text='' WHERE poll_id=$1",
            "UPDATE messages SET content=NULL WHERE poll_id=$1 AND type='poll'",
        ],
        _ => &[],
    };
    for sql in extra {
        sqlx::query(sql).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    if author != user {
        // Journal sans contenu : qui a remplacé le texte de qui.
        tracing::info!(target: "e2e_audit", actor = %user, author = %author, channel = %channel, item = ?item, id = %id,
            "Ancien texte d'un autre membre rechiffré");
    }
    Ok(())
}

// ─── Routes ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LegacyQuery {
    limit: Option<i64>,
    after: Option<Uuid>,
}

impl LegacyQuery {
    fn limit(&self) -> i64 {
        self.limit.unwrap_or(50).clamp(1, 100)
    }
}

/// GET /e2e/legacy/channels — mes anciens textes de salon à rechiffrer.
pub async fn my_legacy_items(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<LegacyQuery>,
) -> Result<Json<Value>> {
    Ok(Json(json!(my_items(&state.db, claims.sub, q.limit()).await?)))
}

/// GET /e2e/legacy/channels/:channel_id?after= — à l'ouverture d'un salon.
pub async fn channel_legacy_items(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel): Path<Uuid>,
    Query(q): Query<LegacyQuery>,
) -> Result<Json<Value>> {
    Ok(Json(json!(channel_items(&state.db, claims.sub, channel, q.after, q.limit()).await?)))
}

/// GET /e2e/legacy/servers/:server_id?after= — tout le serveur, pour son propriétaire.
pub async fn server_legacy_items(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server): Path<Uuid>,
    Query(q): Query<LegacyQuery>,
) -> Result<Json<Value>> {
    Ok(Json(json!(server_items(&state.db, claims.sub, server, q.after, q.limit()).await?)))
}

/// PUT /e2e/legacy/channel/:item/:id {enc, client_msg_id}
pub async fn encrypt_legacy_item(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((item, id)): Path<(String, Uuid)>,
    Json(body): Json<EncryptItemBody>,
) -> Result<Json<Value>> {
    encrypt_item(&state.db, claims.sub, Item::parse(&item)?, id, body).await?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items() {
        assert_eq!(Item::parse("forum_post").unwrap(), Item::ForumPost);
        assert_eq!(Item::parse("thread_title").unwrap(), Item::ThreadTitle);
        assert_eq!(Item::parse("poll").unwrap(), Item::Poll);
        assert!(Item::parse("dm").is_err());
    }

    #[test]
    fn every_branch_is_filtered() {
        let sql = legacy_sql();
        assert!(!sql.contains("{f:"));
        // Une branche sans filtre d'auteur humain ou de portée laisserait fuiter d'autres salons.
        assert_eq!(sql.matches("$3::uuid IS NULL").count(), 6);
        assert_eq!(sql.matches("u.is_bot").count(), 6);
    }

    #[test]
    fn once_only() {
        for it in [Item::Message, Item::ThreadMessage, Item::ForumReply, Item::ForumPost, Item::ThreadTitle, Item::Poll] {
            assert!(it.update_sql().contains("IS NULL"), "{it:?}");
            assert!(it.lookup_sql().contains("is_bot"), "{it:?}");
        }
    }
}
