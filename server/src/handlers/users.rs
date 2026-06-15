use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    models::user::{UpdateProfileRequest, UserPublic},
    state::AppState,
};

pub async fn get_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPublic>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    Ok(Json(user.into()))
}

pub async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<UserPublic>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id=$1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    Ok(Json(user.into()))
}

pub async fn update_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserPublic>> {
    if let Some(ref username) = body.username {
        if username.len() < 2 || username.len() > 32 {
            return Err(AppError::BadRequest("Nom 2-32 chars".into()));
        }
    }

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "UPDATE users SET
            username = COALESCE($2, username),
            bio = COALESCE($3, bio),
            custom_status = COALESCE($4, custom_status),
            status = COALESCE($5, status),
            updated_at = NOW()
         WHERE id=$1 RETURNING *"
    )
    .bind(claims.sub)
    .bind(body.username)
    .bind(body.bio)
    .bind(body.custom_status)
    .bind(body.status)
    .fetch_one(&state.db)
    .await?;

    // Broadcast mise à jour statut
    let event = serde_json::json!({
        "type": "USER_UPDATE",
        "user": UserPublic::from(user.clone())
    });
    state.broadcast_to_user(claims.sub, event.to_string()).await;

    Ok(Json(user.into()))
}

pub async fn search_users(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<UserPublic>>> {
    let query = params.get("q").cloned().unwrap_or_default();
    if query.len() < 2 {
        return Ok(Json(vec![]));
    }

    let pattern = format!("%{}%", query.to_lowercase());
    let users = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE LOWER(username) LIKE $1 AND id != $2 LIMIT 20"
    )
    .bind(&pattern)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();

    Ok(Json(users))
}
