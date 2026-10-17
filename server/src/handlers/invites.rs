use axum::{extract::{ConnectInfo, Path, State}, Extension, Json};
use std::net::SocketAddr;
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

    // Absent : 7 jours (avant : permanente). `null` explicite : permanente, comme le propose l'appli web.
    let expires_at = body.expires_hours
        .unwrap_or(Some(crate::models::server::DEFAULT_INVITE_HOURS as f64))
        .filter(|h| h.is_finite())
        .map(|h| {
            // 30 min (0,5 h, option de l'appli web) à 7 jours : au-delà, quasi-permanente.
            Utc::now() + chrono::Duration::minutes((h.clamp(0.5, 168.0) * 60.0) as i64)
        });
    if let Some(uses) = body.max_uses {
        if !(1..=1000).contains(&uses) {
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
    crate::handlers::audit::log_event(&state, server_id, "INVITE_CREATE", Some(claims.sub), None, Some(&invite.code), None).await;

    Ok(Json(invite))
}

pub async fn get_invites(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<Invite>>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let invites = sqlx::query_as::<_, Invite>(
        "SELECT * FROM invites WHERE server_id=$1 ORDER BY created_at DESC LIMIT 500"
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
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>> {
    // Route publique : limite par IP (fail-closed) contre l'énumération des codes.
    crate::handlers::auth_v2::hit(&state, &format!("invite_info:{}", crate::privacy::client_key(&headers, &addr)), 60, 900).await?;
    let invite = sqlx::query_as::<_, Invite>(
        "SELECT * FROM invites WHERE code=$1"
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?;
    use sqlx::Row;
    // Adresse personnalisée (/invite/<adresse>) : aperçu du serveur, comme une invitation.
    let Some(invite) = invite else {
        let s = sqlx::query("SELECT id, name, icon, banner, description, member_count FROM servers WHERE vanity_url IS NOT NULL AND lower(vanity_url)=lower($1)")
            .bind(&code)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Invitation introuvable".into()))?;
        return Ok(Json(serde_json::json!({
            "code": code.to_lowercase(),
            "server": {
                "id": s.get::<Uuid, _>("id"),
                "name": s.get::<String, _>("name"),
                "icon": s.get::<Option<String>, _>("icon"),
                "banner": s.get::<Option<String>, _>("banner"),
                "description": s.get::<Option<String>, _>("description"),
                "member_count": s.get::<i32, _>("member_count"),
            }
        })));
    };

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
        "SELECT id, name, icon, banner, description, member_count FROM servers WHERE id=$1"
    )
    .bind(invite.server_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "code": invite.code,
        "server": {
            "id": server.get::<Uuid, _>("id"),
            "name": server.get::<String, _>("name"),
            "icon": server.get::<Option<String>, _>("icon"),
            "banner": server.get::<Option<String>, _>("banner"),
            "description": server.get::<Option<String>, _>("description"),
            "member_count": server.get::<i32, _>("member_count"),
        }
    })))
}
