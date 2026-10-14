//! Garde d'accès aux messages privés, partagée par le DM 1:1 (`open_dm`) et les
//! groupes (`create_group_dm`, `add_group_dm_member`).
//!
//! Avant : les groupes ne vérifiaient ni `dm_from_all` ni l'amitié, le blocage
//! n'était testé que dans un sens et une erreur SQL valait « pas bloqué »
//! (fail-open). Toute erreur DB remonte maintenant (fail-closed).

use sqlx::PgExecutor;
use uuid::Uuid;

use crate::error::{AppError, Result};

/// Décision pure : `from` peut-il écrire en privé à la cible ?
pub fn dm_decision(blocked: bool, dm_from_all: bool, is_friend: bool) -> Result<()> {
    if blocked || !(dm_from_all || is_friend) {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

/// Vérifie que `from` peut contacter `to` en privé : cible existante (404 sinon),
/// aucun blocage dans un sens comme dans l'autre, et `dm_from_all` ou amitié.
pub async fn ensure_can_dm<'e>(db: impl PgExecutor<'e>, from: Uuid, to: Uuid) -> Result<()> {
    let row: Option<(bool, bool, bool)> = sqlx::query_as(
        "SELECT
           EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)),
           COALESCE((SELECT dm_from_all FROM user_settings WHERE user_id=$2), TRUE),
           EXISTS(SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted')
         FROM users WHERE id=$2",
    )
    .bind(from)
    .bind(to)
    .fetch_optional(db)
    .await?;
    let (blocked, dm_from_all, is_friend) =
        row.ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;
    dm_decision(blocked, dm_from_all, is_friend)
}

#[cfg(test)]
mod tests {
    use super::dm_decision;

    #[test]
    fn decision() {
        assert!(dm_decision(false, true, false).is_ok());
        assert!(dm_decision(false, false, true).is_ok());
        assert!(dm_decision(false, false, false).is_err());
        // Le blocage l'emporte même entre amis acceptant tout le monde.
        assert!(dm_decision(true, true, true).is_err());
    }
}
