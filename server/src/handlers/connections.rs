//! Comptes connectés sur le profil public (audit C12) : masqués par défaut, le titulaire
//! choisit compte par compte ce qui apparaît dans GET /users/:id/profile.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::user_settings::ConnectedAccount,
    middleware::auth::Claims,
    state::AppState,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisibilityBody {
    pub visible: bool,
}

/// PATCH /user/connected-accounts/:platform {visible} → le compte mis à jour.
pub async fn set_visibility(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(platform): Path<String>,
    Json(body): Json<VisibilityBody>,
) -> Result<Json<ConnectedAccount>> {
    let acc = sqlx::query_as::<_, ConnectedAccount>(
        "UPDATE connected_accounts SET visible=$3 WHERE user_id=$1 AND platform=$2
         RETURNING id, platform, platform_username, platform_url, verified, visible",
    )
    .bind(claims.sub)
    .bind(&platform)
    .bind(body.visible)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Compte connecté introuvable".into()))?;
    Ok(Json(acc))
}

/// Compte connecté tel qu'exposé sur un profil public (sans identifiant interne).
#[derive(Serialize, sqlx::FromRow)]
pub struct PublicConnection {
    pub platform: String,
    pub platform_username: String,
    pub platform_url: Option<String>,
    pub verified: bool,
}

/// Comptes que `user_id` a rendus visibles.
pub async fn visible_connections(db: &PgPool, user_id: Uuid) -> Result<Vec<PublicConnection>> {
    Ok(sqlx::query_as(
        "SELECT platform, platform_username, platform_url, verified
         FROM connected_accounts WHERE user_id=$1 AND visible ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(db)
    .await?)
}
