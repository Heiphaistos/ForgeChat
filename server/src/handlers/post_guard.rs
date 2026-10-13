//! Freins à la publication partagés : mode lent du salon et anti-spam
//! (5 messages / 3 s par auteur et salon). Utilisés par l'envoi normal, le
//! transfert et les bots ; le transfert contournait les deux.
//!
//! À appeler APRÈS l'AutoMod : un message refusé par le filtre ne doit pas
//! consommer le créneau du mode lent.

use chrono::Utc;
use redis::AsyncCommands;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    models::role::Permissions,
    state::AppState,
};

/// Le staff du salon (gestion des messages ou du salon) n'est pas soumis au mode lent.
const SLOWMODE_EXEMPT: i64 = Permissions::MANAGE_MESSAGES | Permissions::MANAGE_CHANNELS;

/// Secondes restantes avant de pouvoir reposter, `None` si c'est permis.
pub fn slowmode_remaining(delay: i32, last_post: Option<i64>, now: i64) -> Option<i64> {
    let delay = i64::from(delay);
    // `min` : une horloge qui recule n'impose jamais plus que le délai.
    let remaining = (delay - now.saturating_sub(last_post?)).min(delay);
    (remaining > 0).then_some(remaining)
}

/// Mode lent : refuse (429 + délai) si l'auteur a posté trop récemment, sinon
/// mémorise l'instant du message.
pub async fn check_slowmode(state: &AppState, user: Uuid, channel_id: Uuid) -> Result<()> {
    let delay: i32 = sqlx::query_scalar("SELECT slowmode_delay FROM channels WHERE id=$1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or(0);
    if delay <= 0 {
        return Ok(());
    }
    let exempt = state
        .effective_channel_permissions(user, channel_id)
        .await
        .is_some_and(|(_, p)| p & SLOWMODE_EXEMPT != 0);
    if exempt {
        return Ok(());
    }
    let key = format!("slowmode:{channel_id}:{user}");
    let now = Utc::now().timestamp();
    let mut redis = state.redis.lock().await;
    let last: Option<i64> = redis.get(&key).await.unwrap_or(None);
    if let Some(remaining) = slowmode_remaining(delay, last, now) {
        return Err(AppError::SlowMode(remaining));
    }
    let ttl = u64::try_from(delay).unwrap_or(0).saturating_add(5);
    let _: () = redis.set_ex(&key, now, ttl).await.unwrap_or(());
    Ok(())
}

/// Anti-spam atomique (UPSERT, sans course) : au plus 5 messages en 3 s.
pub async fn check_spam(db: &PgPool, user: Uuid, channel_id: Uuid) -> Result<()> {
    let count: i32 = sqlx::query_scalar(
        "INSERT INTO message_spam_track (user_id, channel_id, count, window_start)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (user_id, channel_id) DO UPDATE
         SET count = CASE
                 WHEN NOW() - message_spam_track.window_start >= INTERVAL '3 seconds' THEN 1
                 ELSE message_spam_track.count + 1
             END,
             window_start = CASE
                 WHEN NOW() - message_spam_track.window_start >= INTERVAL '3 seconds' THEN NOW()
                 ELSE message_spam_track.window_start
             END
         RETURNING count",
    )
    .bind(user)
    .bind(channel_id)
    .fetch_one(db)
    .await?;
    if count > 5 {
        return Err(AppError::TooManyRequests);
    }
    Ok(())
}

/// Édition (fils, forum) : refusée pendant un timeout, et le nouveau texte en
/// clair repasse par l'AutoMod (chiffré : appliqué par l'appli). Avant : une
/// réponse anodine pouvait être éditée vers un contenu filtré.
pub async fn check_edit(
    state: &AppState,
    server_id: Uuid,
    user: Uuid,
    plain: Option<&str>,
) -> Result<()> {
    crate::handlers::servers::require_not_timed_out(state, user, server_id).await?;
    if let Some(text) = plain {
        if let Some(err) = crate::handlers::audit::check_automod(state, server_id, user, text).await
        {
            return Err(err);
        }
    }
    Ok(())
}

/// Les deux freins, dans l'ordre d'un envoi de membre.
pub async fn throttle(state: &AppState, user: Uuid, channel_id: Uuid) -> Result<()> {
    check_slowmode(state, user, channel_id).await?;
    check_spam(&state.db, user, channel_id).await
}

#[cfg(test)]
mod tests {
    use super::slowmode_remaining;

    #[test]
    fn remaining() {
        assert_eq!(slowmode_remaining(10, None, 100), None);
        assert_eq!(slowmode_remaining(10, Some(95), 100), Some(5));
        assert_eq!(slowmode_remaining(10, Some(90), 100), None);
        assert_eq!(slowmode_remaining(0, Some(100), 100), None);
        // Horloge qui recule : jamais d'attente supérieure au délai.
        assert_eq!(slowmode_remaining(10, Some(200), 100), Some(10));
    }
}
