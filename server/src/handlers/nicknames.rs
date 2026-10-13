//! Pseudos par serveur : le sien (PATCH /servers/:id/nickname) et celui d'un autre
//! membre (PATCH /servers/:id/members/:user_id/nickname, permission « Gérer les pseudos »).

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

const NICKNAME_MAX: usize = 32;

#[derive(Deserialize)]
pub struct NicknameBody {
    pub nickname: Option<String>,
}

/// Espaces retirés ; vide ou absent = retirer le pseudo. 32 caractères au plus,
/// aucun caractère de contrôle (retours à la ligne, etc.).
fn normalize_nickname(raw: Option<String>) -> Result<Option<String>> {
    let Some(nick) = raw.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) else {
        return Ok(None);
    };
    if nick.chars().count() > NICKNAME_MAX {
        return Err(AppError::BadRequest(format!("Surnom trop long (max {NICKNAME_MAX})")));
    }
    if nick.chars().any(char::is_control) {
        return Err(AppError::BadRequest("Surnom invalide".into()));
    }
    Ok(Some(nick))
}

/// Écrit le pseudo et le diffuse (MEMBER_NICKNAME_UPDATE). `false` si non membre.
async fn apply(state: &AppState, server_id: Uuid, user_id: Uuid, nickname: &Option<String>) -> Result<bool> {
    let done = sqlx::query("UPDATE server_members SET nickname=$1 WHERE user_id=$2 AND server_id=$3")
        .bind(nickname)
        .bind(user_id)
        .bind(server_id)
        .execute(&state.db)
        .await?
        .rows_affected() > 0;
    if done {
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "MEMBER_NICKNAME_UPDATE",
            "server_id": server_id,
            "user_id": user_id,
            "nickname": nickname,
        }).to_string()).await;
    }
    Ok(done)
}

pub async fn set_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<NicknameBody>,
) -> Result<Json<serde_json::Value>> {
    let nickname = normalize_nickname(body.nickname)?;
    apply(&state, server_id, claims.sub, &nickname).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Pseudo d'un autre membre : « Gérer les pseudos » (propriétaire et administrateurs
/// compris) et rang strictement supérieur ; le propriétaire n'est jamais une cible.
pub async fn set_member_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<NicknameBody>,
) -> Result<Json<serde_json::Value>> {
    let nickname = normalize_nickname(body.nickname)?;
    if user_id == claims.sub {
        apply(&state, server_id, user_id, &nickname).await?;
        return Ok(Json(serde_json::json!({ "ok": true })));
    }
    crate::handlers::servers::require_permission(&state, claims.sub, server_id, Permissions::MANAGE_NICKNAMES).await?;
    if crate::handlers::password_reset::over_limit(&state, &format!("nick_mod:{}", claims.sub), 30, 60).await {
        return Err(AppError::TooManyRequests);
    }
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_member {
        return Err(AppError::NotFound("Membre introuvable".into()));
    }
    crate::handlers::servers::require_outranks(&state, claims.sub, user_id, server_id).await?;

    if !apply(&state, server_id, user_id, &nickname).await? {
        return Err(AppError::NotFound("Membre introuvable".into()));
    }
    crate::handlers::audit::log_event(
        &state, server_id, "MEMBER_NICKNAME_CHANGE",
        Some(claims.sub),
        Some(user_id), None,
        Some(serde_json::json!({ "nickname": nickname })),
    ).await;
    Ok(Json(serde_json::json!({ "ok": true, "nickname": nickname })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nickname_rules() {
        assert_eq!(normalize_nickname(None).ok(), Some(None));
        assert_eq!(normalize_nickname(Some("   ".into())).ok(), Some(None));
        assert_eq!(normalize_nickname(Some("  Zoé ".into())).ok(), Some(Some("Zoé".into())));
        assert!(normalize_nickname(Some("é".repeat(32))).is_ok());
        assert!(normalize_nickname(Some("é".repeat(33))).is_err());
        assert!(normalize_nickname(Some("a\nb".into())).is_err());
        assert!(normalize_nickname(Some("a\u{7}b".into())).is_err());
    }

    #[test]
    fn manage_nicknames_bit_is_free() {
        assert_eq!(Permissions::MANAGE_NICKNAMES, 1 << 24);
        assert_ne!(Permissions::MANAGE_NICKNAMES, Permissions::RETIRED_PRIORITY_SPEAKER);
        assert_ne!(Permissions::ALL & Permissions::MANAGE_NICKNAMES, 0);
    }
}

#[cfg(test)]
mod db_tests;
