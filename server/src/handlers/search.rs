use axum::{
    extract::{Query, State},
    Extension, Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{Postgres, QueryBuilder};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

// ─── Filtres de recherche (façon Discord) ─────────────────────────────────────

#[derive(Debug, Default, PartialEq)]
pub enum Has {
    #[default]
    Any,
    File,
    Image,
    Link,
}

/// `from:alice in:général has:image before:2026-01-31 after:2025-12-01 texte libre`
#[derive(Debug, Default, PartialEq)]
pub struct Filters {
    pub text: String,
    pub from: Option<String>,
    pub in_name: Option<String>,
    pub has: Has,
    pub before: Option<NaiveDate>,
    pub after: Option<NaiveDate>,
}

impl Filters {
    pub fn parse(q: &str) -> Self {
        let mut f = Filters::default();
        let mut words = Vec::new();
        for w in q.split_whitespace() {
            let Some((k, v)) = w.split_once(':').filter(|(_, v)| !v.is_empty()) else {
                words.push(w);
                continue;
            };
            let v = v.trim_start_matches('#').trim_start_matches('@');
            match k.to_lowercase().as_str() {
                "from" | "de" => f.from = Some(v.to_string()),
                "in" | "dans" => f.in_name = Some(v.to_string()),
                "has" | "a" => {
                    f.has = match v.to_lowercase().as_str() {
                        "fichier" | "file" | "piece" | "pièce" => Has::File,
                        "image" | "img" => Has::Image,
                        "lien" | "link" => Has::Link,
                        _ => { words.push(w); continue }
                    }
                }
                "before" | "avant" => match NaiveDate::parse_from_str(v, "%Y-%m-%d") {
                    Ok(d) => f.before = Some(d),
                    Err(_) => words.push(w),
                },
                "after" | "apres" | "après" => match NaiveDate::parse_from_str(v, "%Y-%m-%d") {
                    Ok(d) => f.after = Some(d),
                    Err(_) => words.push(w),
                },
                _ => words.push(w), // « 12:30 » ou « http://… » restent du texte
            }
        }
        f.text = words.join(" ");
        f
    }

    fn has_filter(&self) -> bool {
        self.from.is_some() || self.in_name.is_some() || self.has != Has::Any || self.before.is_some() || self.after.is_some()
    }
}

/// Échappe `%`, `_` et `\` pour un motif LIKE/ILIKE.
pub fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// Curseur de pagination « created_at|id » (ordre décroissant, ex æquo départagés par id).
pub fn parse_cursor(s: &str) -> Option<(DateTime<Utc>, Uuid)> {
    let (ts, id) = s.split_once('|')?;
    Some((DateTime::parse_from_rfc3339(ts).ok()?.with_timezone(&Utc), Uuid::parse_str(id).ok()?))
}

pub fn make_cursor(ts: DateTime<Utc>, id: Uuid) -> String {
    format!("{}|{}", ts.to_rfc3339_opts(chrono::SecondsFormat::Micros, true), id)
}

/// Portée d'une recherche : partout (salons visibles, DM, groupes) ou un seul fil.
#[derive(Clone, Copy)]
enum Scope {
    All,
    Channel(Uuid),
    Dm(Uuid),
    Group(Uuid),
}

/// Colonnes propres à chaque source de messages.
struct Source {
    msg: &'static str,
    author: &'static str,
    place: &'static str,
    attach_fk: &'static str,
}

const CHANNELS: Source = Source { msg: "m", author: "u", place: "c.name", attach_fk: "message_id" };
const DMS: Source = Source { msg: "m", author: "u", place: "p.username", attach_fk: "dm_message_id" };
const GROUPS: Source = Source { msg: "m", author: "u", place: "gc.name", attach_fk: "group_dm_message_id" };

fn push_filters<'a>(
    qb: &mut QueryBuilder<'a, Postgres>,
    src: &Source,
    f: &Filters,
    cursor: Option<(DateTime<Utc>, Uuid)>,
) {
    let m = src.msg;
    if !f.text.is_empty() {
        // ILIKE sur la colonne brute : utilise l'index trigramme (049) quand il existe.
        qb.push(format!(" AND {m}.content ILIKE ")).push_bind(format!("%{}%", like_escape(&f.text)));
    }
    if let Some(from) = &f.from {
        qb.push(format!(" AND {}.username ILIKE ", src.author)).push_bind(like_escape(from));
    }
    if let Some(place) = &f.in_name {
        qb.push(format!(" AND {} ILIKE ", src.place)).push_bind(like_escape(place));
    }
    match f.has {
        Has::Any => {}
        Has::Link => { qb.push(format!(" AND {m}.content ~* 'https?://'")); }
        Has::File => { qb.push(format!(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.{} = {m}.id)", src.attach_fk)); }
        Has::Image => {
            qb.push(format!(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.{} = {m}.id AND a.content_type LIKE 'image/%')", src.attach_fk));
        }
    }
    if let Some(d) = f.before {
        qb.push(format!(" AND {m}.created_at < ")).push_bind(d.and_hms_opt(0, 0, 0).map(|t| t.and_utc()));
    }
    if let Some(d) = f.after.and_then(|d| d.succ_opt()) {
        qb.push(format!(" AND {m}.created_at >= ")).push_bind(d.and_hms_opt(0, 0, 0).map(|t| t.and_utc()));
    }
    if let Some((ts, id)) = cursor {
        qb.push(format!(" AND ({m}.created_at, {m}.id) < (")).push_bind(ts).push(", ").push_bind(id).push(")");
    }
}

/// Recherche de messages paginée, filtrage d'accès DANS le WHERE (jamais après
/// le LIMIT, qui pouvait rendre 0 résultat alors qu'il y en avait).
async fn search_messages(
    state: &AppState,
    uid: Uuid,
    scope: Scope,
    f: &Filters,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> Result<(Vec<serde_json::Value>, Option<String>)> {
    use sqlx::Row;
    let hidden: Vec<Uuid> = state.hidden_channels(uid, None, None).await?.into_iter().collect();
    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("SELECT * FROM (");
    let mut first = true;
    let mut union = |qb: &mut QueryBuilder<Postgres>| {
        if !first { qb.push(" UNION ALL "); }
        first = false;
    };

    if matches!(scope, Scope::All | Scope::Channel(_)) {
        union(&mut qb);
        qb.push(
            "(SELECT m.id, m.content, m.created_at,
                    COALESCE(m.webhook_display_name, u.username) AS author_username,
                    NULLIF(COALESCE(m.webhook_avatar_url, u.avatar), '') AS author_avatar,
                    'channel' AS kind, c.id AS channel_id, c.name AS channel_name, c.server_id
             FROM messages m
             JOIN users u ON u.id = m.user_id
             JOIN channels c ON c.id = m.channel_id
             JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = ",
        )
        .push_bind(uid)
        .push(" WHERE (m.expires_at IS NULL OR m.expires_at > NOW()) AND NOT (c.id = ANY(")
        .push_bind(hidden.clone())
        .push("))");
        if let Scope::Channel(cid) = scope {
            qb.push(" AND m.channel_id = ").push_bind(cid);
        }
        push_filters(&mut qb, &CHANNELS, f, cursor);
        qb.push(" ORDER BY m.created_at DESC, m.id DESC LIMIT ").push_bind(limit + 1).push(")");
    }
    if matches!(scope, Scope::All | Scope::Dm(_)) {
        union(&mut qb);
        qb.push(
            "(SELECT m.id, m.content, m.created_at, u.username AS author_username, u.avatar AS author_avatar,
                    'dm' AS kind, dc.id AS channel_id, p.username AS channel_name, NULL::uuid AS server_id
             FROM dm_messages m
             JOIN dm_channels dc ON dc.id = m.dm_channel_id
             JOIN users u ON u.id = m.sender_id
             JOIN users p ON p.id = CASE WHEN dc.user1_id = ",
        )
        .push_bind(uid)
        .push(" THEN dc.user2_id ELSE dc.user1_id END WHERE (dc.user1_id = ")
        .push_bind(uid)
        .push(" OR dc.user2_id = ")
        .push_bind(uid)
        .push(")");
        if let Scope::Dm(id) = scope {
            qb.push(" AND dc.id = ").push_bind(id);
        }
        push_filters(&mut qb, &DMS, f, cursor);
        qb.push(" ORDER BY m.created_at DESC, m.id DESC LIMIT ").push_bind(limit + 1).push(")");
    }
    if matches!(scope, Scope::All | Scope::Group(_)) {
        union(&mut qb);
        qb.push(
            "(SELECT m.id, m.content, m.created_at, u.username AS author_username, u.avatar AS author_avatar,
                    'group' AS kind, gc.id AS channel_id, gc.name AS channel_name, NULL::uuid AS server_id
             FROM group_dm_messages m
             JOIN group_dm_members gm ON gm.dm_id = m.dm_id AND gm.user_id = ",
        )
        .push_bind(uid)
        .push(
            " JOIN group_dm_channels gc ON gc.id = m.dm_id
             JOIN users u ON u.id = m.sender_id WHERE TRUE",
        );
        if let Scope::Group(id) = scope {
            qb.push(" AND m.dm_id = ").push_bind(id);
        }
        push_filters(&mut qb, &GROUPS, f, cursor);
        qb.push(" ORDER BY m.created_at DESC, m.id DESC LIMIT ").push_bind(limit + 1).push(")");
    }
    qb.push(") r ORDER BY r.created_at DESC, r.id DESC LIMIT ").push_bind(limit + 1);

    let rows = qb.build().fetch_all(&state.db).await?;
    let more = rows.len() as i64 > limit;
    let rows = &rows[..rows.len().min(limit as usize)];
    let next = if more {
        rows.last().map(|r| make_cursor(r.get("created_at"), r.get("id")))
    } else {
        None
    };
    let out = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "content": r.get::<Option<String>, _>("content"),
        "created_at": r.get::<DateTime<Utc>, _>("created_at"),
        "author_username": r.get::<String, _>("author_username"),
        "author_avatar": r.get::<Option<String>, _>("author_avatar"),
        "kind": r.get::<String, _>("kind"),
        "channel_id": r.get::<Uuid, _>("channel_id"),
        "channel_name": r.get::<String, _>("channel_name"),
        "server_id": r.get::<Option<Uuid>, _>("server_id"),
    })).collect();
    Ok((out, next))
}

/// GET /search?q=&cursor=&limit=&channel_id=|dm_id=|group_id=
/// Messages (salons visibles, DM et groupes de l'utilisateur) + utilisateurs et
/// salons sur la première page. `next_cursor` : page suivante, `null` à la fin.
pub async fn global_search(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let raw = params.get("q").map(|s| s.trim()).unwrap_or("");
    let f = Filters::parse(raw);
    if f.text.chars().count() < 2 && !f.has_filter() {
        return Err(AppError::BadRequest("Requête trop courte (min 2 caractères)".into()));
    }
    let uid: Uuid = claims.sub;
    let id_param = |k: &str| params.get(k).and_then(|s| Uuid::parse_str(s).ok());
    // L'appartenance est vérifiée par les jointures de la requête : un id
    // étranger ne renvoie simplement rien.
    let scope = if let Some(id) = id_param("channel_id") {
        Scope::Channel(id)
    } else if let Some(id) = id_param("dm_id") {
        Scope::Dm(id)
    } else if let Some(id) = id_param("group_id") {
        Scope::Group(id)
    } else {
        Scope::All
    };
    let cursor = params.get("cursor").and_then(|c| parse_cursor(c));
    let limit = params.get("limit").and_then(|l| l.parse::<i64>().ok()).unwrap_or(25).clamp(1, 50);

    let (messages, next_cursor) = search_messages(&state, uid, scope, &f, cursor, limit).await?;

    // Utilisateurs et salons : seulement pour la première page d'une recherche globale en texte libre.
    let mut users_json = Vec::new();
    let mut channels_json = Vec::new();
    if cursor.is_none() && matches!(scope, Scope::All) && f.text.chars().count() >= 2 {
        let pattern = format!("%{}%", like_escape(&f.text));
        let hidden: Vec<Uuid> = state.hidden_channels(uid, None, None).await?.into_iter().collect();
        let (users, channels) = tokio::try_join!(
            sqlx::query(
                "SELECT DISTINCT u.id, u.username, u.avatar, u.status
                 FROM users u
                 WHERE u.username ILIKE $2
                   AND (
                     EXISTS(SELECT 1 FROM friendships f
                            WHERE f.status='accepted'
                              AND ((f.user_id=$1 AND f.friend_id=u.id) OR (f.friend_id=$1 AND f.user_id=u.id)))
                     OR EXISTS(SELECT 1 FROM server_members sm1
                               JOIN server_members sm2 ON sm1.server_id=sm2.server_id
                               WHERE sm1.user_id=$1 AND sm2.user_id=u.id)
                   )
                 LIMIT 8"
            )
            .bind(uid)
            .bind(&pattern)
            .fetch_all(&state.db),
            sqlx::query(
                "SELECT c.id, c.name, c.type as channel_type, c.server_id, s.name as server_name
                 FROM channels c
                 JOIN servers s ON s.id = c.server_id
                 JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
                 WHERE c.name ILIKE $2 AND NOT (c.id = ANY($3))
                 ORDER BY c.name ASC
                 LIMIT 8"
            )
            .bind(uid)
            .bind(&pattern)
            .bind(&hidden)
            .fetch_all(&state.db),
        )?;
        users_json = users.iter().map(|r| serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "username": r.get::<String, _>("username"),
            "avatar": r.get::<Option<String>, _>("avatar"),
            "status": r.get::<String, _>("status"),
        })).collect();
        channels_json = channels.iter().map(|r| serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "type": r.get::<String, _>("channel_type"),
            "server_id": r.get::<Uuid, _>("server_id"),
            "server_name": r.get::<String, _>("server_name"),
        })).collect();
    }

    Ok(Json(serde_json::json!({
        "messages": messages,
        "next_cursor": next_cursor,
        "users": users_json,
        "channels": channels_json,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_filters_and_keeps_free_text() {
        let f = Filters::parse("from:@alice in:#général has:image before:2026-01-31 after:2025-12-01 bonne année");
        assert_eq!(f.text, "bonne année");
        assert_eq!(f.from.as_deref(), Some("alice"));
        assert_eq!(f.in_name.as_deref(), Some("général"));
        assert_eq!(f.has, Has::Image);
        assert_eq!(f.before, NaiveDate::from_ymd_opt(2026, 1, 31));
        assert_eq!(f.after, NaiveDate::from_ymd_opt(2025, 12, 1));
    }

    #[test]
    fn unknown_or_invalid_filters_stay_text() {
        let f = Filters::parse("rdv 12:30 has:truc before:demain https://x.fr");
        assert_eq!(f.text, "rdv 12:30 has:truc before:demain https://x.fr");
        assert!(!f.has_filter());
    }

    #[test]
    fn cursor_roundtrip() {
        let ts = Utc::now();
        let id = Uuid::new_v4();
        let (t2, i2) = parse_cursor(&make_cursor(ts, id)).unwrap();
        assert_eq!(i2, id);
        assert_eq!(t2.timestamp_micros(), ts.timestamp_micros());
        assert!(parse_cursor("n'importe quoi").is_none());
    }

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(like_escape(r"50%_a\b"), r"50\%\_a\\b");
    }
}
