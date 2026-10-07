//! Journal d'audit : recherche et filtres (qui, action, période), pages par curseur.
//! L'export CSV/JSON est fait par l'appli à partir de ces pages.

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::Result,
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub action: String,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub target_id: Option<Uuid>,
    pub target_name: Option<String>,
    pub details: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub action: Option<String>,
    pub user_id: Option<Uuid>,
    /// Texte cherché dans l'auteur, la cible et l'action.
    pub q: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    /// Curseur : entrées strictement plus anciennes que cette date.
    pub before: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
}

fn like_pattern(q: &str) -> String {
    format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))
}

/// GET /servers/:server_id/audit — MANAGE_SERVER.
pub async fn get_audit_log(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Query(q): Query<AuditQuery>,
) -> Result<Json<Vec<AuditEntry>>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let search = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| like_pattern(&s.chars().take(100).collect::<String>()));
    let rows = sqlx::query(
        "SELECT a.id, a.action, a.user_id, COALESCE(a.username, u.username) AS username,
                a.target_id, a.target_name, a.details, a.created_at
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.server_id = $1
           AND ($2::TEXT IS NULL OR a.action = $2)
           AND ($3::UUID IS NULL OR a.user_id = $3)
           AND ($4::TIMESTAMPTZ IS NULL OR a.created_at >= $4)
           AND ($5::TIMESTAMPTZ IS NULL OR a.created_at <= $5)
           AND ($6::TIMESTAMPTZ IS NULL OR a.created_at < $6)
           AND ($7::TEXT IS NULL OR COALESCE(a.username, u.username, '') ILIKE $7
                OR COALESCE(a.target_name, '') ILIKE $7 OR a.action ILIKE $7)
         ORDER BY a.created_at DESC
         LIMIT $8"
    )
    .bind(server_id)
    .bind(q.action.as_deref().filter(|a| !a.is_empty()))
    .bind(q.user_id)
    .bind(q.from)
    .bind(q.to)
    .bind(q.before)
    .bind(search)
    .bind(q.limit.unwrap_or(50).clamp(1, 1000))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.iter().map(|r| AuditEntry {
        id: r.get("id"),
        action: r.get("action"),
        user_id: r.get("user_id"),
        username: r.get("username"),
        target_id: r.get("target_id"),
        target_name: r.get("target_name"),
        details: r.get("details"),
        created_at: r.get("created_at"),
    }).collect()))
}

/// GET /servers/:server_id/audit/facets — actions et auteurs présents (listes des filtres).
pub async fn get_audit_facets(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT action FROM audit_log WHERE server_id=$1 ORDER BY action LIMIT 200"
    ).bind(server_id).fetch_all(&state.db).await?;
    let users: Vec<serde_json::Value> = sqlx::query(
        "SELECT a.user_id, MAX(COALESCE(a.username, u.username)) AS username
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.server_id=$1 AND a.user_id IS NOT NULL GROUP BY a.user_id ORDER BY 2 LIMIT 500"
    ).bind(server_id).fetch_all(&state.db).await?.iter().map(|r| serde_json::json!({
        "user_id": r.get::<Uuid, _>("user_id"),
        "username": r.get::<Option<String>, _>("username"),
    })).collect();
    Ok(Json(serde_json::json!({ "actions": actions, "users": users })))
}

#[cfg(test)]
mod tests {
    #[test]
    fn like_is_escaped() {
        assert_eq!(super::like_pattern("50%_a\\"), "%50\\%\\_a\\\\%");
    }
}
