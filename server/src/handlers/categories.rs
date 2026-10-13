//! Catégories façon Discord : renommer, réordonner, surcharges de permissions propres à
//! la catégorie et « Synchroniser les permissions » (recopie sur les salons enfants).
//!
//! Droit requis : `CAN_EDIT` (MANAGE_CHANNELS ou EDIT_CHANNELS, comme les salons). Une
//! catégorie réservée au staff (`staff_only`) est invisible des non-administrateurs :
//! seuls eux peuvent la modifier, et ses événements ne partent qu'aux administrateurs.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{
        channel_access::CAN_EDIT,
        channels::{
            check_override_bits, notify_permission_change, require_override_target,
            ChannelPermOverride,
        },
        servers::{effective_permissions, require_outranks, require_role_below},
    },
    middleware::auth::Claims,
    models::{
        channel::{clean_name, Category},
        role::Permissions,
    },
    state::AppState,
};

/// Catégories par réordonnancement (bien au-delà d'un serveur réel).
pub const REORDER_MAX: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow, serde::Serialize)]
pub struct Overwrite {
    pub target_id: Uuid,
    pub target_type: String,
    pub allow: i64,
    pub deny: i64,
}

/// Surcharges d'un salon synchronisé : celles de la catégorie. Une catégorie réservée au
/// staff garde TOUJOURS @everyone privé de VIEW_CHANNEL, même si la catégorie n'a aucune
/// surcharge (sinon synchroniser rendrait ses salons publics).
pub fn synced_overwrites(
    category: &[Overwrite],
    staff_only: bool,
    everyone: Option<Uuid>,
) -> Vec<Overwrite> {
    let mut out = category.to_vec();
    if let (true, Some(everyone)) = (staff_only, everyone) {
        match out.iter_mut().find(|o| o.target_id == everyone) {
            Some(o) => {
                o.deny |= Permissions::VIEW_CHANNEL;
                o.allow &= !Permissions::VIEW_CHANNEL;
            }
            None => out.push(Overwrite {
                target_id: everyone,
                target_type: "role".into(),
                allow: 0,
                deny: Permissions::VIEW_CHANNEL,
            }),
        }
    }
    out
}

/// Surcharges retirées, modifiées ou ajoutées entre `old` et `new` : l'acteur doit pouvoir
/// poser ou retirer chacune (mêmes règles qu'une surcharge de salon).
pub fn changed_overwrites<'a>(old: &'a [Overwrite], new: &'a [Overwrite]) -> Vec<&'a Overwrite> {
    let gone = old.iter().filter(|o| !new.contains(o));
    let added = new.iter().filter(|n| !old.contains(n));
    gone.chain(added).collect()
}

/// Liste de réordonnancement : 1 à REORDER_MAX identifiants, sans doublon.
pub fn check_reorder(ids: &[Uuid]) -> std::result::Result<(), &'static str> {
    if ids.is_empty() || ids.len() > REORDER_MAX {
        return Err("Liste de catégories : 1 à 500 éléments");
    }
    let unique: HashSet<&Uuid> = ids.iter().collect();
    if unique.len() != ids.len() {
        return Err("Catégorie en double");
    }
    Ok(())
}

fn is_admin(perms: i64) -> bool {
    perms & Permissions::ADMINISTRATOR != 0
}

/// Droit d'édition + catégorie de ce serveur ; renvoie `staff_only`. Une catégorie staff
/// est refusée (404, elle n'existe pas pour lui) à un non-administrateur.
async fn editable_category(
    state: &AppState,
    actor: Uuid,
    server_id: Uuid,
    category_id: Uuid,
) -> Result<bool> {
    let perms = effective_permissions(state, actor, server_id).await?;
    if perms & CAN_EDIT == 0 && !is_admin(perms) {
        return Err(AppError::Forbidden);
    }
    let staff_only: Option<bool> =
        sqlx::query_scalar("SELECT staff_only FROM categories WHERE id=$1 AND server_id=$2")
            .bind(category_id)
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?;
    match staff_only {
        Some(s) if !s || is_admin(perms) => Ok(s),
        _ => Err(AppError::NotFound("Catégorie introuvable".into())),
    }
}

/// Membres connectés du serveur, séparés en (administrateurs, autres).
async fn connected_split(state: &AppState, server_id: Uuid) -> Result<(Vec<Uuid>, Vec<Uuid>)> {
    let connected: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
    if connected.is_empty() {
        return Ok((vec![], vec![]));
    }
    let rows: Vec<(Uuid, bool)> = sqlx::query_as(
        "SELECT sm.user_id,
                (sm.is_owner OR fc_is_god(sm.user_id)
                 OR EXISTS(SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                           WHERE mr.user_id = sm.user_id AND mr.server_id = sm.server_id AND r.permissions & $3 <> 0)
                 OR EXISTS(SELECT 1 FROM roles WHERE server_id = $1 AND is_everyone AND permissions & $3 <> 0))
         FROM server_members sm WHERE sm.server_id = $1 AND sm.user_id = ANY($2)",
    )
    .bind(server_id)
    .bind(&connected)
    .bind(Permissions::ADMINISTRATOR)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .fold((vec![], vec![]), |(mut a, mut o), (u, admin)| {
            if admin {
                a.push(u)
            } else {
                o.push(u)
            }
            (a, o)
        }))
}

/// Diffusion d'un événement de catégorie : tout le serveur, ou les administrateurs seuls.
async fn broadcast_category(
    state: &AppState,
    server_id: Uuid,
    staff_only: bool,
    event: Value,
) -> Result<()> {
    if !staff_only {
        state
            .broadcast_to_server_members(server_id, event.to_string())
            .await;
        return Ok(());
    }
    let (admins, _) = connected_split(state, server_id).await?;
    state.send_to_users(&admins, event.to_string()).await;
    Ok(())
}

// ─── Renommer ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenameCategory {
    pub name: String,
}

/// PATCH /servers/:server_id/categories/:category_id {name}
pub async fn rename_category(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RenameCategory>,
) -> Result<Json<Category>> {
    let staff_only = editable_category(&state, claims.sub, server_id, category_id).await?;
    let name = clean_name(&body.name).map_err(|e| AppError::BadRequest(e.into()))?;
    let cat = sqlx::query_as::<_, Category>(
        "UPDATE categories SET name=$3 WHERE id=$1 AND server_id=$2 RETURNING *",
    )
    .bind(category_id)
    .bind(server_id)
    .bind(name)
    .fetch_one(&state.db)
    .await?;
    let event = json!({
        "type": "CATEGORY_UPDATE",
        "server_id": server_id,
        "category": { "id": cat.id, "name": cat.name, "position": cat.position, "staff_only": cat.staff_only },
    });
    broadcast_category(&state, server_id, staff_only, event).await?;
    Ok(Json(cat))
}

// ─── Réordonner ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReorderCategories {
    pub category_ids: Vec<Uuid>,
}

/// PATCH /servers/:server_id/categories/reorder {category_ids} — position = rang dans la liste.
pub async fn reorder_categories(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReorderCategories>,
) -> Result<Json<Value>> {
    let perms = effective_permissions(&state, claims.sub, server_id).await?;
    if perms & CAN_EDIT == 0 && !is_admin(perms) {
        return Err(AppError::Forbidden);
    }
    check_reorder(&body.category_ids).map_err(|e| AppError::BadRequest(e.into()))?;
    let found: Vec<(Uuid, bool)> =
        sqlx::query_as("SELECT id, staff_only FROM categories WHERE server_id=$1 AND id = ANY($2)")
            .bind(server_id)
            .bind(&body.category_ids)
            .fetch_all(&state.db)
            .await?;
    let staff: HashSet<Uuid> = found
        .iter()
        .filter(|(_, s)| *s)
        .map(|(id, _)| *id)
        .collect();
    // Catégorie d'un autre serveur, inconnue, ou staff pour un non-administrateur : refus global.
    if found.len() != body.category_ids.len() || (!staff.is_empty() && !is_admin(perms)) {
        return Err(AppError::BadRequest(
            "Catégorie invalide pour ce serveur".into(),
        ));
    }
    let positions: Vec<i32> = (0..body.category_ids.len() as i32).collect();
    sqlx::query(
        "UPDATE categories SET position = v.pos
         FROM (SELECT UNNEST($1::uuid[]) AS id, UNNEST($2::int[]) AS pos) AS v
         WHERE categories.id = v.id AND categories.server_id = $3",
    )
    .bind(&body.category_ids)
    .bind(&positions)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    let all: Vec<Value> = body
        .category_ids
        .iter()
        .zip(&positions)
        .map(|(id, p)| json!({ "id": id, "position": p }))
        .collect();
    let event = |positions: Vec<Value>| {
        json!({ "type": "CATEGORIES_REORDER", "server_id": server_id, "positions": positions })
            .to_string()
    };
    if staff.is_empty() {
        state
            .broadcast_to_server_members(server_id, event(all.clone()))
            .await;
    } else {
        // Les non-administrateurs ne reçoivent pas les catégories staff (ni leur existence).
        let public: Vec<Value> = body
            .category_ids
            .iter()
            .zip(&positions)
            .filter(|(id, _)| !staff.contains(id))
            .map(|(id, p)| json!({ "id": id, "position": p }))
            .collect();
        let (admins, others) = connected_split(&state, server_id).await?;
        state.send_to_users(&admins, event(all.clone())).await;
        state.send_to_users(&others, event(public)).await;
    }
    Ok(Json(json!({ "ok": true, "positions": all })))
}

// ─── Surcharges de la catégorie ──────────────────────────────────────────────

async fn category_overwrites(state: &AppState, category_id: Uuid) -> Result<Vec<Overwrite>> {
    Ok(sqlx::query_as(
        "SELECT target_id, target_type, allow, deny FROM category_permissions WHERE category_id=$1",
    )
    .bind(category_id)
    .fetch_all(&state.db)
    .await?)
}

/// GET /servers/:server_id/categories/:category_id/permissions
pub async fn get_category_permissions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<Overwrite>>> {
    editable_category(&state, claims.sub, server_id, category_id).await?;
    Ok(Json(category_overwrites(&state, category_id).await?))
}

/// PUT /servers/:server_id/categories/:category_id/permissions/:target_id {target_type, allow, deny}
/// Bits bornés aux permissions de l'acteur sur le serveur, cible strictement sous lui.
pub async fn put_category_permission(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id, target_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<ChannelPermOverride>,
) -> Result<Json<Value>> {
    let staff_only = editable_category(&state, claims.sub, server_id, category_id).await?;
    if !["role", "member"].contains(&body.target_type.as_str()) {
        return Err(AppError::BadRequest(
            "target_type invalide (role|member)".into(),
        ));
    }
    let actor = effective_permissions(&state, claims.sub, server_id).await?;
    let (allow, deny) = check_override_bits(actor, body.allow, body.deny)?;
    require_override_target(&state, claims.sub, server_id, target_id, &body.target_type).await?;
    sqlx::query(
        "INSERT INTO category_permissions (category_id, target_id, target_type, allow, deny)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (category_id, target_id) DO UPDATE
         SET allow=EXCLUDED.allow, deny=EXCLUDED.deny, target_type=EXCLUDED.target_type",
    )
    .bind(category_id)
    .bind(target_id)
    .bind(&body.target_type)
    .bind(allow)
    .bind(deny)
    .execute(&state.db)
    .await?;
    let event = json!({ "type": "CATEGORY_PERMISSION_UPDATE", "server_id": server_id, "category_id": category_id });
    broadcast_category(&state, server_id, staff_only, event).await?;
    Ok(Json(json!({ "ok": true, "allow": allow, "deny": deny })))
}

/// DELETE /servers/:server_id/categories/:category_id/permissions/:target_id
pub async fn delete_category_permission(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id, target_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let staff_only = editable_category(&state, claims.sub, server_id, category_id).await?;
    let existing: Option<(String, i64, i64)> =
        sqlx::query_as("SELECT target_type, allow, deny FROM category_permissions WHERE category_id=$1 AND target_id=$2")
            .bind(category_id)
            .bind(target_id)
            .fetch_optional(&state.db)
            .await?;
    let Some((target_type, allow, deny)) = existing else {
        return Ok(Json(json!({ "ok": true })));
    };
    // Retirer un refus revient à accorder : mêmes règles que pour la poser.
    let actor = effective_permissions(&state, claims.sub, server_id).await?;
    let mask = Permissions::ALL & !Permissions::ADMINISTRATOR;
    check_override_bits(actor, allow & mask, deny & mask)?;
    require_override_target(&state, claims.sub, server_id, target_id, &target_type).await?;
    sqlx::query("DELETE FROM category_permissions WHERE category_id=$1 AND target_id=$2")
        .bind(category_id)
        .bind(target_id)
        .execute(&state.db)
        .await?;
    let event = json!({ "type": "CATEGORY_PERMISSION_UPDATE", "server_id": server_id, "category_id": category_id });
    broadcast_category(&state, server_id, staff_only, event).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Cible d'une surcharge touchée par la synchronisation : strictement sous l'acteur.
/// Rôle supprimé ou ancien membre : surcharge orpheline, son retrait est libre.
async fn require_sync_target(
    state: &AppState,
    actor: Uuid,
    server_id: Uuid,
    o: &Overwrite,
) -> Result<()> {
    if o.target_type == "role" {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM roles WHERE id=$1 AND server_id=$2)")
                .bind(o.target_id)
                .bind(server_id)
                .fetch_one(&state.db)
                .await?;
        return if exists {
            require_role_below(state, actor, o.target_id, server_id).await
        } else {
            Ok(())
        };
    }
    let member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)",
    )
    .bind(server_id)
    .bind(o.target_id)
    .fetch_one(&state.db)
    .await?;
    if member && o.target_id != actor {
        require_outranks(state, actor, o.target_id, server_id).await?;
    }
    Ok(())
}

/// POST /servers/:server_id/categories/:category_id/sync-permissions
/// Remplace les surcharges de chaque salon de la catégorie par celles de la catégorie.
/// Tout ou rien : une seule surcharge que l'acteur ne pourrait pas poser/retirer sur un
/// seul salon (salon masqué pour lui compris) refuse l'ensemble.
pub async fn sync_category_permissions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, category_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>> {
    let staff_only = editable_category(&state, claims.sub, server_id, category_id).await?;
    let everyone: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM roles WHERE server_id=$1 AND is_everyone LIMIT 1")
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?;
    let new = synced_overwrites(
        &category_overwrites(&state, category_id).await?,
        staff_only,
        everyone,
    );
    let channels: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM channels WHERE category_id=$1 AND server_id=$2")
            .bind(category_id)
            .bind(server_id)
            .fetch_all(&state.db)
            .await?;

    let mask = Permissions::ALL & !Permissions::ADMINISTRATOR;
    let mut checked: HashSet<Uuid> = HashSet::new();
    for &channel_id in &channels {
        let old: Vec<Overwrite> =
            sqlx::query_as("SELECT target_id, target_type, allow, deny FROM channel_permissions WHERE channel_id=$1")
                .bind(channel_id)
                .fetch_all(&state.db)
                .await?;
        let actor = state
            .effective_channel_permissions(claims.sub, channel_id)
            .await
            .map(|(_, p)| p)
            .ok_or(AppError::Forbidden)?;
        for o in changed_overwrites(&old, &new) {
            check_override_bits(actor, o.allow & mask, o.deny & mask)?;
            if checked.insert(o.target_id) {
                require_sync_target(&state, claims.sub, server_id, o).await?;
            }
        }
    }

    let mut audiences = Vec::with_capacity(channels.len());
    for &c in &channels {
        audiences.push(state.channel_audience(c).await);
    }
    // Paires (salon, surcharge) à insérer, en tableaux parallèles pour un seul INSERT.
    let (mut ch, mut tid, mut tty, mut al, mut de) = (vec![], vec![], vec![], vec![], vec![]);
    for &c in &channels {
        for o in &new {
            ch.push(c);
            tid.push(o.target_id);
            tty.push(o.target_type.clone());
            al.push(o.allow);
            de.push(o.deny);
        }
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM channel_permissions WHERE channel_id = ANY($1)")
        .bind(&channels)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
         SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::varchar[], $4::bigint[], $5::bigint[])",
    )
    .bind(&ch)
    .bind(&tid)
    .bind(&tty)
    .bind(&al)
    .bind(&de)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    for (c, before) in channels.iter().zip(audiences) {
        notify_permission_change(&state, *c, server_id, before).await;
    }
    Ok(Json(json!({ "ok": true, "synced_channel_ids": channels })))
}

/// Nouveau salon dans une catégorie : il hérite de ses surcharges (salon « synchronisé »).
/// Une surcharge déjà posée (refus @everyone d'une catégorie staff) est conservée.
pub async fn inherit_category_overwrites(
    db: &sqlx::PgPool,
    channel_id: Uuid,
    category_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
         SELECT $1, target_id, target_type, allow, deny FROM category_permissions WHERE category_id=$2
         ON CONFLICT (channel_id, target_id) DO NOTHING",
    )
    .bind(channel_id)
    .bind(category_id)
    .execute(db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ow(target: Uuid, allow: i64, deny: i64) -> Overwrite {
        Overwrite {
            target_id: target,
            target_type: "role".into(),
            allow,
            deny,
        }
    }

    #[test]
    fn staff_category_stays_private() {
        let everyone = Uuid::new_v4();
        let mods = Uuid::new_v4();
        // Catégorie staff sans surcharge : @everyone refusé quand même.
        let out = synced_overwrites(&[], true, Some(everyone));
        assert_eq!(out, vec![ow(everyone, 0, Permissions::VIEW_CHANNEL)]);
        // Une surcharge @everyone qui accordait la vue est corrigée.
        let out = synced_overwrites(
            &[
                ow(
                    everyone,
                    Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES,
                    0,
                ),
                ow(mods, 1, 0),
            ],
            true,
            Some(everyone),
        );
        assert_eq!(
            out[0],
            ow(
                everyone,
                Permissions::SEND_MESSAGES,
                Permissions::VIEW_CHANNEL
            )
        );
        assert_eq!(out[1], ow(mods, 1, 0));
        // Catégorie ordinaire : copie exacte.
        let cat = vec![ow(mods, 1, 2)];
        assert_eq!(synced_overwrites(&cat, false, Some(everyone)), cat);
    }

    #[test]
    fn changes_cover_removed_modified_added() {
        let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        let old = vec![ow(a, 1, 0), ow(b, 2, 0)];
        let new = vec![ow(a, 1, 0), ow(b, 4, 0), ow(c, 0, 8)];
        let ch = changed_overwrites(&old, &new);
        // a identique : pas de vérification ; b retiré puis reposé ; c ajouté.
        assert_eq!(ch, vec![&ow(b, 2, 0), &ow(b, 4, 0), &ow(c, 0, 8)]);
        assert!(changed_overwrites(&old, &old).is_empty());
    }

    #[test]
    fn reorder_bounds() {
        let id = Uuid::new_v4();
        assert!(check_reorder(&[]).is_err());
        assert!(check_reorder(&[id, id]).is_err());
        assert!(check_reorder(&[id, Uuid::new_v4()]).is_ok());
        let many: Vec<Uuid> = (0..=REORDER_MAX).map(|_| Uuid::new_v4()).collect();
        assert!(check_reorder(&many).is_err());
        assert!(check_reorder(&many[..REORDER_MAX]).is_ok());
    }
}

#[cfg(test)]
#[path = "discord_features_db_tests.rs"]
mod db_tests;
