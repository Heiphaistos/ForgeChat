use axum::{extract::{Path, State}, Extension, Json};
use chrono::Utc;
use rand::Rng;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::{role::Permissions, server::{CreateInviteRequest, Invite}},
    state::AppState,
};

pub async fn create_invite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateInviteRequest>,
) -> Result<Json<Invite>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let code: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let expires_at = body.expires_hours.map(|h| {
        // Cap à 7 jours max pour éviter les invitations quasi-permanentes
        let h = h.clamp(1, 168);
        Utc::now() + chrono::Duration::hours(h)
    });
    if let Some(uses) = body.max_uses {
        if uses < 1 || uses > 1000 {
            return Err(AppError::BadRequest("max_uses doit être entre 1 et 1000".into()));
        }
    }

    let invite = sqlx::query_as::<_, Invite>(
        "INSERT INTO invites (code, server_id, creator_id, max_uses, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(&code)
    .bind(server_id)
    .bind(claims.sub)
    .bind(body.max_uses)
    .bind(expires_at)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(invite))
}

pub async fn get_invites(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Invite>>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let invites = sqlx::query_as::<_, Invite>(
        "SELECT * FROM invites WHERE server_id=$1 ORDER BY created_at DESC LIMIT 100"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(invites))
}

pub async fn delete_invite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, code)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let result = sqlx::query("DELETE FROM invites WHERE code=$1 AND server_id=$2")
        .bind(&code)
        .bind(server_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Invitation introuvable".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_invite_info(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let invite = sqlx::query_as::<_, Invite>(
        "SELECT * FROM invites WHERE code=$1"
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invitation introuvable".into()))?;

    if let Some(exp) = invite.expires_at {
        if exp < Utc::now() {
            return Err(AppError::BadRequest("Invitation expirée".into()));
        }
    }
    if let Some(max) = invite.max_uses {
        if invite.uses >= max {
            return Err(AppError::BadRequest("Invitation épuisée".into()));
        }
    }

    let server = sqlx::query(
        "SELECT id, name, icon, member_count FROM servers WHERE id=$1"
    )
    .bind(invite.server_id)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    Ok(Json(serde_json::json!({
        "code": invite.code,
        "server": {
            "id": server.get::<Uuid, _>("id"),
            "name": server.get::<String, _>("name"),
            "icon": server.get::<Option<String>, _>("icon"),
            "member_count": server.get::<i32, _>("member_count"),
        }
    })))
}
