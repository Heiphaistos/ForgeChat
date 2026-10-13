//! Droits de création, modification et suppression des salons et catégories.
//!
//! `require_permission` accepte un masque « l'un OU l'autre » : MANAGE_CHANNELS
//! reste valable partout (rôles existants), les droits fins s'y ajoutent.

use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::effective_permissions,
    models::role::Permissions,
    state::AppState,
};

/// Refuse (403) toute lecture d'historique sans READ_HISTORY effectif sur le
/// salon : recherche, épingles, fils, forum, éditions, source d'un transfert.
pub async fn require_read_history(state: &AppState, user: Uuid, channel_id: Uuid) -> Result<()> {
    require_channel_perm(state, user, channel_id, Permissions::READ_HISTORY).await
}

/// Salons (de tous les serveurs de `user`) dont l'historique lui est fermé :
/// exclus de la recherche globale. Même calcul que
/// `effective_channel_permissions`, en lot (3 requêtes, quel que soit le nombre de salons).
pub async fn channels_without_history(state: &AppState, user: Uuid) -> Result<Vec<Uuid>> {
    use std::collections::{HashMap, HashSet};
    type Override = (Uuid, String, i64, i64);
    let channels: Vec<(Uuid, bool, i64, Option<Uuid>)> = sqlx::query_as(
        "WITH s AS (
           SELECT sm.server_id, (sm.is_owner OR fc_is_god(sm.user_id)) AS is_owner,
                  COALESCE((SELECT BIT_OR(r.permissions) FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                            WHERE mr.user_id = sm.user_id AND mr.server_id = sm.server_id), 0)
                  | COALESCE((SELECT permissions FROM roles WHERE server_id = sm.server_id AND is_everyone LIMIT 1), 0) AS base,
                  (SELECT id FROM roles WHERE server_id = sm.server_id AND is_everyone LIMIT 1) AS everyone
           FROM server_members sm WHERE sm.user_id = $1)
         SELECT c.id, s.is_owner, s.base, s.everyone FROM channels c JOIN s ON s.server_id = c.server_id",
    )
    .bind(user)
    .fetch_all(&state.db)
    .await?;
    let rows: Vec<(Uuid, Uuid, String, i64, i64)> = sqlx::query_as(
        "SELECT cp.channel_id, cp.target_id, cp.target_type, cp.allow, cp.deny
         FROM channel_permissions cp JOIN channels c ON c.id = cp.channel_id
         JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1",
    )
    .bind(user)
    .fetch_all(&state.db)
    .await?;
    let my_roles: HashSet<Uuid> =
        sqlx::query_scalar("SELECT role_id FROM member_roles WHERE user_id = $1")
            .bind(user)
            .fetch_all(&state.db)
            .await?
            .into_iter()
            .collect();
    let mut overrides: HashMap<Uuid, Vec<Override>> = HashMap::new();
    for (cid, target, kind, allow, deny) in rows {
        overrides
            .entry(cid)
            .or_default()
            .push((target, kind, allow, deny));
    }
    Ok(channels
        .into_iter()
        .filter(|(cid, is_owner, base, everyone)| {
            let ov = overrides.get(cid).map(Vec::as_slice).unwrap_or_default();
            let perms = crate::state::apply_channel_overrides(
                *base,
                *is_owner,
                user,
                Some(&my_roles),
                *everyone,
                ov,
            );
            perms & Permissions::READ_HISTORY == 0
        })
        .map(|(cid, ..)| cid)
        .collect())
}

/// Permission effective `perm` sur le salon (rôles, @everyone, surcharges), 403 sinon.
pub async fn require_channel_perm(
    state: &AppState,
    user: Uuid,
    channel_id: Uuid,
    perm: i64,
) -> Result<()> {
    match state.effective_channel_permissions(user, channel_id).await {
        Some((_, p)) if p & perm != 0 => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

/// Créer un salon ou une catégorie.
pub const CAN_CREATE: i64 = Permissions::MANAGE_CHANNELS | Permissions::CREATE_CHANNELS;
/// Modifier un salon (nom, réglages, ordre, surcharges, tags, flux, webhook…).
pub const CAN_EDIT: i64 = Permissions::MANAGE_CHANNELS | Permissions::EDIT_CHANNELS;

const PROTECTED_MSG: &str = "Créé par le propriétaire du serveur : seuls le propriétaire \
     ou un administrateur peuvent le supprimer.";
const DENIED_MSG: &str = "Vous n'avez pas le droit de supprimer ce salon ou cette catégorie \
     (droit « Supprimer tous les salons », ou « Supprimer ses propres salons » pour ceux que vous avez créés).";

/// Règle pure de suppression. `perms` = `effective_permissions` (i64::MAX pour
/// le propriétaire ou un administrateur). Renvoie le motif du refus.
///
/// 1. propriétaire / ADMINISTRATOR : toujours ;
/// 2. créé par le propriétaire du serveur : refusé à tous les autres ;
/// 3. MANAGE_CHANNELS ou DELETE_CHANNELS : oui ;
/// 4. DELETE_OWN_CHANNELS : seulement si `created_by == user`.
pub fn deletion_refusal(perms: i64, user: Uuid, server_owner: Uuid, created_by: Option<Uuid>) -> Option<&'static str> {
    if perms & Permissions::ADMINISTRATOR != 0 {
        return None;
    }
    if created_by == Some(server_owner) {
        return Some(PROTECTED_MSG);
    }
    if perms & (Permissions::MANAGE_CHANNELS | Permissions::DELETE_CHANNELS) != 0 {
        return None;
    }
    if perms & Permissions::DELETE_OWN_CHANNELS != 0 && created_by == Some(user) {
        return None;
    }
    Some(DENIED_MSG)
}

/// Contexte de suppression d'un acteur sur un serveur : (permissions, propriétaire).
pub async fn deletion_context(state: &AppState, user: Uuid, server_id: Uuid) -> Result<(i64, Uuid)> {
    let perms = effective_permissions(state, user, server_id).await?;
    if perms == 0 {
        return Err(AppError::Forbidden);
    }
    let owner: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))?;
    Ok((perms, owner))
}

pub fn check_deletion(ctx: (i64, Uuid), user: Uuid, created_by: Option<Uuid>) -> Result<()> {
    match deletion_refusal(ctx.0, user, ctx.1, created_by) {
        None => Ok(()),
        Some(m) => Err(AppError::ForbiddenMsg(m.into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletion_rule() {
        let (owner, me, other) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let admin = i64::MAX;
        let del_all = Permissions::DELETE_CHANNELS;
        let manage = Permissions::MANAGE_CHANNELS;
        let own = Permissions::DELETE_OWN_CHANNELS;

        // Propriétaire / administrateur : tout, y compris les salons protégés.
        assert!(deletion_refusal(admin, me, owner, Some(owner)).is_none());
        assert!(deletion_refusal(Permissions::ADMINISTRATOR, me, owner, Some(owner)).is_none());
        // Salon du propriétaire : jamais via DELETE_CHANNELS ni MANAGE_CHANNELS.
        assert_eq!(deletion_refusal(del_all, me, owner, Some(owner)), Some(PROTECTED_MSG));
        assert_eq!(deletion_refusal(manage, me, owner, Some(owner)), Some(PROTECTED_MSG));
        // Suppression générale.
        assert!(deletion_refusal(del_all, me, owner, Some(other)).is_none());
        assert!(deletion_refusal(manage, me, owner, None).is_none());
        // Ses propres salons seulement.
        assert!(deletion_refusal(own, me, owner, Some(me)).is_none());
        assert_eq!(deletion_refusal(own, me, owner, Some(other)), Some(DENIED_MSG));
        assert_eq!(deletion_refusal(own, me, owner, None), Some(DENIED_MSG));
        // Création / modification ne donnent pas la suppression.
        assert!(deletion_refusal(Permissions::CREATE_CHANNELS | Permissions::EDIT_CHANNELS, me, owner, Some(me)).is_some());
        assert!(deletion_refusal(0, me, owner, Some(me)).is_some());
    }
}
