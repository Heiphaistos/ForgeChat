//! Super réactions : réaction animée comptée à part des réactions normales,
//! limitée à `SUPER_REACTIONS_PER_DAY` par utilisateur sur 24 h glissantes.
//! Diffusées avec les mêmes événements que les réactions (REACTION_ADD /
//! REACTION_REMOVE) portant `is_super: true`.

use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::messages::require_can_react,
    handlers::servers::require_member_and_channel,
    middleware::auth::Claims,
    state::AppState,
};

pub const SUPER_REACTIONS_PER_DAY: i64 = 10;

/// Crédits restants après `used` super réactions sur les dernières 24 h.
pub fn remaining(used: i64) -> i64 {
    (SUPER_REACTIONS_PER_DAY - used).max(0)
}

async fn used_last_24h<'e, E: sqlx::PgExecutor<'e>>(db: E, user_id: Uuid) -> Result<i64> {
    Ok(sqlx::query_scalar(
        "SELECT COUNT(*) FROM super_reaction_uses WHERE user_id=$1 AND used_at > NOW() - INTERVAL '24 hours'"
    ).bind(user_id).fetch_one(db).await?)
}

/// GET /users/me/super-reactions — quota restant, pour l'afficher avant de réagir.
pub async fn get_quota(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    let used = used_last_24h(&state.db, claims.sub).await?;
    Ok(Json(serde_json::json!({ "limit": SUPER_REACTIONS_PER_DAY, "remaining": remaining(used) })))
}

/// PUT /servers/:server_id/channels/:channel_id/messages/:msg_id/super-reactions/:emoji
pub async fn add_super_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_can_react(&state, claims.sub, server_id, channel_id, message_id, &emoji).await?;

    let mut tx = state.db.begin().await?;
    // Verrou sur la ligne du compte : deux requêtes simultanées ne peuvent pas
    // toutes deux passer sous la limite.
    sqlx::query("SELECT 1 FROM users WHERE id=$1 FOR UPDATE").bind(claims.sub).execute(&mut *tx).await?;
    let used = used_last_24h(&mut *tx, claims.sub).await?;
    if remaining(used) == 0 {
        return Err(AppError::TooManyRequestsMsg(format!(
            "Limite atteinte : {SUPER_REACTIONS_PER_DAY} super réactions par 24 h"
        )));
    }
    let inserted = sqlx::query(
        "INSERT INTO reactions (message_id, user_id, emoji, is_super) VALUES ($1, $2, $3, TRUE)
         ON CONFLICT DO NOTHING"
    ).bind(message_id).bind(claims.sub).bind(&emoji).execute(&mut *tx).await?.rows_affected();
    // Déjà posée : rien à débiter ni à diffuser.
    if inserted == 0 {
        tx.commit().await?;
        return Ok(Json(serde_json::json!({ "ok": true, "remaining": remaining(used) })));
    }
    sqlx::query("INSERT INTO super_reaction_uses (user_id) VALUES ($1)").bind(claims.sub).execute(&mut *tx).await?;
    tx.commit().await?;

    state.broadcast_to_channel_members(channel_id, serde_json::json!({
        "type": "REACTION_ADD",
        "message_id": message_id,
        "channel_id": channel_id,
        "user_id": claims.sub,
        "emoji": emoji,
        "is_super": true,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true, "remaining": remaining(used + 1) })))
}

/// DELETE /servers/:server_id/channels/:channel_id/messages/:msg_id/super-reactions/:emoji
/// Retirer ne rend pas le crédit (journal séparé).
pub async fn remove_super_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    if emoji.is_empty() || emoji.chars().count() > 64 {
        return Err(AppError::BadRequest("Emoji invalide (1-64 chars)".into()));
    }
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    // La jointure sur messages garantit que le message est bien dans ce salon.
    let deleted = sqlx::query(
        "DELETE FROM reactions r USING messages m
         WHERE r.message_id=$1 AND r.user_id=$2 AND r.emoji=$3 AND r.is_super
           AND m.id = r.message_id AND m.channel_id=$4"
    ).bind(message_id).bind(claims.sub).bind(&emoji).bind(channel_id).execute(&state.db).await?.rows_affected();

    if deleted > 0 {
        state.broadcast_to_channel_members(channel_id, serde_json::json!({
            "type": "REACTION_REMOVE",
            "message_id": message_id,
            "channel_id": channel_id,
            "user_id": claims.sub,
            "emoji": emoji,
            "is_super": true,
        }).to_string()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_decroit_puis_plafonne_a_zero() {
        assert_eq!(remaining(0), SUPER_REACTIONS_PER_DAY);
        assert_eq!(remaining(SUPER_REACTIONS_PER_DAY - 1), 1);
        assert_eq!(remaining(SUPER_REACTIONS_PER_DAY), 0);
        assert_eq!(remaining(SUPER_REACTIONS_PER_DAY + 5), 0);
    }
}
