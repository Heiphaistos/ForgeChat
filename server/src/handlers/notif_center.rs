//! Centre de notifications : réglages par catégorie, vue d'ensemble des
//! exceptions par salon, remise à zéro et « mentions seulement partout ».
//! Hiérarchie (notify.rs et client) : salon > catégorie > serveur > défaut.

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CategoryOverride {
    pub category_id: Uuid,
    pub server_id: Uuid,
    pub level: String,
    /// Salons rangés aujourd'hui dans la catégorie : le client en déduit le
    /// niveau d'un salon sans recharger chaque serveur.
    pub channel_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ChannelException {
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub channel_name: String,
    pub level: String,
    pub muted: bool,
    pub muted_until: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize)]
pub struct NotifCenter {
    pub categories: Vec<CategoryOverride>,
    pub channels: Vec<ChannelException>,
}

pub async fn get_notif_center(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
) -> Result<Json<NotifCenter>> {
    let categories = sqlx::query_as::<_, CategoryOverride>(
        "SELECT ko.category_id, k.server_id, ko.level,
                COALESCE(ARRAY(SELECT c.id FROM channels c WHERE c.category_id = ko.category_id), '{}') AS channel_ids
         FROM notification_overrides_category ko
         JOIN categories k ON k.id = ko.category_id
         WHERE ko.user_id = $1"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    let channels = sqlx::query_as::<_, ChannelException>(
        "SELECT co.channel_id, c.server_id, c.name AS channel_name, co.level,
                (co.muted AND (co.muted_until IS NULL OR co.muted_until > NOW())) AS muted,
                CASE WHEN co.muted THEN co.muted_until END AS muted_until
         FROM notification_overrides_channel co
         JOIN channels c ON c.id = co.channel_id
         WHERE co.user_id = $1 AND c.server_id IS NOT NULL
         ORDER BY c.server_id, c.position"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(NotifCenter { categories, channels }))
}

#[derive(Debug, Deserialize)]
pub struct SetLevel {
    pub level: String,
}

const LEVELS: [&str; 4] = ["inherit", "all", "mentions", "nothing"];

pub async fn set_category_notif(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Path(category_id): Path<Uuid>,
    Json(body): Json<SetLevel>,
) -> Result<Json<serde_json::Value>> {
    if !LEVELS.contains(&body.level.as_str()) {
        return Err(AppError::BadRequest("level invalide".into()));
    }
    let server_id: Uuid = sqlx::query_scalar("SELECT server_id FROM categories WHERE id = $1")
        .bind(category_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::NotFound("Catégorie introuvable".into()))?;
    crate::handlers::servers::require_member(&state, claims.sub, server_id).await?;
    if body.level == "inherit" {
        sqlx::query("DELETE FROM notification_overrides_category WHERE user_id = $1 AND category_id = $2")
            .bind(claims.sub)
            .bind(category_id)
            .execute(&state.db)
            .await?;
    } else {
        sqlx::query(
            "INSERT INTO notification_overrides_category (user_id, category_id, level) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, category_id) DO UPDATE SET level = EXCLUDED.level"
        )
        .bind(claims.sub)
        .bind(category_id)
        .bind(&body.level)
        .execute(&state.db)
        .await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
pub struct ResetQuery {
    /// Absent : tous les serveurs.
    pub server_id: Option<Uuid>,
}

/// « Tout remettre par défaut » : supprime les réglages de serveur, de
/// catégorie et de salon (d'un serveur, ou de tous). Les MP ne sont pas touchés.
pub async fn reset_notif(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Query(q): Query<ResetQuery>,
) -> Result<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM notification_overrides_server WHERE user_id = $1 AND ($2::uuid IS NULL OR server_id = $2)")
        .bind(claims.sub)
        .bind(q.server_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "DELETE FROM notification_overrides_category ko USING categories k
         WHERE ko.user_id = $1 AND k.id = ko.category_id AND ($2::uuid IS NULL OR k.server_id = $2)"
    )
    .bind(claims.sub)
    .bind(q.server_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM notification_overrides_channel co USING channels c
         WHERE co.user_id = $1 AND c.id = co.channel_id AND c.server_id IS NOT NULL
           AND ($2::uuid IS NULL OR c.server_id = $2)"
    )
    .bind(claims.sub)
    .bind(q.server_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Réglage rapide « mentions seulement partout » (ou « rien partout ») : niveau
/// de chaque serveur, et les catégories ou salons réglés plus bavards repassent
/// sur « par défaut » pour que le choix vaille vraiment partout. Sourdines conservées.
pub async fn set_level_everywhere(
    Extension(claims): Extension<Claims>,
    State(state): State<AppState>,
    Json(body): Json<SetLevel>,
) -> Result<Json<serde_json::Value>> {
    let louder: &[&str] = match body.level.as_str() {
        "mentions" => &["all"],
        "nothing" => &["all", "mentions"],
        _ => return Err(AppError::BadRequest("level invalide".into())),
    };
    let louder: Vec<String> = louder.iter().map(|s| s.to_string()).collect();
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO notification_overrides_server (user_id, server_id, level)
         SELECT $1, server_id, $2 FROM server_members WHERE user_id = $1
         ON CONFLICT (user_id, server_id) DO UPDATE SET level = EXCLUDED.level"
    )
    .bind(claims.sub)
    .bind(&body.level)
    .execute(&mut *tx)
    .await?;
    sqlx::query("DELETE FROM notification_overrides_category WHERE user_id = $1 AND level = ANY($2)")
        .bind(claims.sub)
        .bind(&louder)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "UPDATE notification_overrides_channel co SET level = 'inherit' FROM channels c
         WHERE co.user_id = $1 AND co.level = ANY($2) AND c.id = co.channel_id AND c.server_id IS NOT NULL"
    )
    .bind(claims.sub)
    .bind(&louder)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
#[path = "notif_center_db_tests.rs"]
mod db_tests;
