//! Annuaire des serveurs publics (GET /explore) : catégories, étiquettes,
//! recherche, tri (membres, activité, récents) et page de présentation.
//! L'activité est un COMPTE de messages des 7 derniers jours, jamais leur contenu.

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub const CATEGORIES: &[&str] = &["gaming", "community", "tech", "music", "education", "arts", "18plus"];

#[derive(Deserialize)]
pub struct DirectoryQuery {
    pub category: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
    /// members (défaut) | activity | recent | alpha
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Étiquettes d'annuaire : 5 au plus, 2 à 24 caractères, minuscules, lettres/chiffres/espace/tiret.
pub fn clean_tags(tags: &[String]) -> std::result::Result<Vec<String>, String> {
    if tags.len() > 5 {
        return Err("5 étiquettes au plus".into());
    }
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim().to_lowercase();
        let n = t.chars().count();
        if !(2..=24).contains(&n) || !t.chars().all(|c| c.is_alphanumeric() || c == '-' || c == ' ') {
            return Err(format!("Étiquette invalide : {t}"));
        }
        if !out.contains(&t) {
            out.push(t);
        }
    }
    Ok(out)
}

const SELECT: &str = "SELECT s.id, s.name, s.icon, s.banner, s.description, s.member_count, s.invite_code,
        s.server_category, s.discovery_tags, s.created_at, s.vanity_url,
        (SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id
          WHERE c.server_id = s.id AND m.created_at > NOW() - INTERVAL '7 days') AS activity,
        (SELECT COUNT(*) FROM server_members sm JOIN users u ON u.id = sm.user_id
          WHERE sm.server_id = s.id AND u.status NOT IN ('offline', 'invisible')) AS online_count
    FROM servers s";

fn server_json(r: &sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "icon": r.get::<Option<String>, _>("icon"),
        "banner": r.get::<Option<String>, _>("banner"),
        "description": r.get::<Option<String>, _>("description"),
        "member_count": r.get::<i32, _>("member_count"),
        "invite_code": r.get::<Option<String>, _>("invite_code"),
        "category": r.get::<Option<String>, _>("server_category"),
        "tags": r.get::<Vec<String>, _>("discovery_tags"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "vanity_url": r.get::<Option<String>, _>("vanity_url"),
        "activity": r.get::<i64, _>("activity"),
        "online_count": r.get::<i64, _>("online_count"),
    })
}

/// GET /explore — serveurs publics filtrés et triés.
pub async fn discover_servers(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
    Query(q): Query<DirectoryQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let category = q.category.filter(|c| c != "all" && CATEGORIES.contains(&c.as_str()));
    let tag = q.tag.map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty());
    let search = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| {
        let s: String = s.chars().take(100).collect();
        format!("%{}%", s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))
    });
    // Liste fermée : aucune entrée utilisateur dans la clause ORDER BY.
    let order = match q.sort.as_deref() {
        Some("activity") => "activity DESC, member_count DESC",
        Some("recent") => "created_at DESC",
        Some("alpha") => "lower(name)",
        _ => "member_count DESC, activity DESC",
    };
    let sql = format!(
        "SELECT * FROM ({SELECT}
          WHERE s.is_public
            AND ($1::TEXT IS NULL OR s.server_category = $1)
            AND ($2::TEXT IS NULL OR $2 = ANY(s.discovery_tags))
            AND ($3::TEXT IS NULL OR s.name ILIKE $3 OR s.description ILIKE $3
                 OR EXISTS(SELECT 1 FROM unnest(s.discovery_tags) t WHERE t ILIKE $3))) x
         ORDER BY {order} LIMIT $4 OFFSET $5"
    );
    let rows = sqlx::query(&sql)
        .bind(category)
        .bind(tag)
        .bind(search)
        .bind(q.limit.unwrap_or(60).clamp(1, 100))
        .bind(q.offset.unwrap_or(0).clamp(0, 10_000))
        .fetch_all(&state.db)
        .await?;
    Ok(Json(rows.iter().map(server_json).collect()))
}

/// GET /explore/:server_id — page de présentation d'un serveur public.
pub async fn server_profile(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let r = sqlx::query(&format!("{SELECT} WHERE s.id = $1 AND s.is_public"))
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))?;
    let (channels, events): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM channels WHERE server_id=$1),
                (SELECT COUNT(*) FROM server_events WHERE server_id=$1 AND start_time > NOW())"
    ).bind(server_id).fetch_one(&state.db).await?;
    let mut v = server_json(&r);
    v["channel_count"] = channels.into();
    v["upcoming_events"] = events.into();
    Ok(Json(v))
}

#[cfg(test)]
mod tests {
    #[test]
    fn tags() {
        let t = super::clean_tags(&[" Jeux-Vidéo ".into(), "jeux-vidéo".into(), "fr".into()]).unwrap();
        assert_eq!(t, ["jeux-vidéo", "fr"]);
        assert!(super::clean_tags(&["a".into()]).is_err());
        assert!(super::clean_tags(&["<script>".into()]).is_err());
        assert!(super::clean_tags(&vec!["ab".to_string(); 6]).is_err());
    }
}
