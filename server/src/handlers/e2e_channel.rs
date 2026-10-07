//! Salons de serveur chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §10).
//!
//! Même mécanisme que les MP (`e2e_conv`) avec `Conv::Channel` : membres
//! autorisés = membres du serveur qui voient le salon. Les droits changent à
//! beaucoup d'endroits (départ, exclusion, rôles, surcharges…) : plutôt que d'y
//! émettre des événements, l'ensemble autorisé est recalculé à la demande. Une
//! époque dont un détenteur a perdu l'accès est marquée `rotate_needed` au
//! prochain envoi (409 EPOCH_STALE), l'émetteur crée alors l'époque suivante.
//! Le texte en clair d'un utilisateur est toujours refusé (chiffrement
//! obligatoire), sauf commande de bot enregistrée.

use std::collections::HashSet;

use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::e2e_conv::{check_epoch, current_epoch, plaintext_refused, Conv, Enc, ServerEnvelope},
    state::{channel_audience_among, AppState},
};

/// Détenteurs connectés prévenus par une demande de clé.
const KEY_REQUEST_FANOUT: usize = 20;

/// Membres autorisés d'un salon : membres du serveur (hors bots) qui le voient.
pub async fn viewers(db: &PgPool, channel: Uuid) -> Result<Vec<Uuid>> {
    // ponytail: O(membres) à chaque appel ; mettre en cache par (salon, version des droits) si un très grand serveur le demande.
    let all: Vec<Uuid> = sqlx::query_scalar(
        "SELECT sm.user_id FROM server_members sm
         JOIN channels c ON c.server_id = sm.server_id
         JOIN users u ON u.id = sm.user_id
         WHERE c.id = $1 AND NOT u.is_bot",
    )
    .bind(channel)
    .fetch_all(db)
    .await?;
    Ok(channel_audience_among(db, channel, &all).await)
}

/// Un détenteur de l'époque ne voit plus le salon : il faut une nouvelle époque.
pub fn needs_rotation(holders: usize, still_viewing: usize) -> bool {
    still_viewing < holders
}

/// Époque courante d'un salon ; la marque périmée si un détenteur a perdu l'accès.
pub async fn channel_epoch(db: &PgPool, channel: Uuid) -> Result<Option<(i32, bool)>> {
    let cur = current_epoch(db, Conv::Channel(channel)).await?;
    let Some((epoch, false)) = cur else { return Ok(cur) };
    let holders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT member_id FROM conversation_keys WHERE conv_kind='channel' AND conv_id=$1 AND epoch=$2",
    )
    .bind(channel)
    .bind(epoch)
    .fetch_all(db)
    .await?;
    let still = channel_audience_among(db, channel, &holders).await;
    if !needs_rotation(holders.len(), still.len()) {
        return Ok(cur);
    }
    sqlx::query(
        "UPDATE conversation_epochs SET rotate_needed=TRUE, updated_at=NOW()
         WHERE conv_kind='channel' AND conv_id=$1 AND current_epoch=$2",
    )
    .bind(channel)
    .bind(epoch)
    .execute(db)
    .await?;
    Ok(Some((epoch, true)))
}

/// Commande de bot (`/nom args`) enregistrée sur ce serveur : destinée au bot,
/// donc lisible par lui, elle reste en clair (affichée « non chiffré »).
pub async fn is_bot_command(db: &PgPool, server_id: Uuid, content: &str) -> bool {
    let Some(name) = content.strip_prefix('/').and_then(|r| r.split_whitespace().next()) else { return false };
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bot_commands WHERE server_id=$1 AND name=$2)")
        .bind(server_id)
        .bind(name.to_lowercase())
        .fetch_one(db)
        .await
        .unwrap_or(false)
}

/// Contenu d'un envoi ou d'une édition dans un salon (message, fil, forum,
/// sondage, message programmé) : rend le chiffré validé (JSON), ou None sans
/// texte ; le texte en clair n'est permis qu'à une commande de bot (`exempt`).
pub async fn check_content(
    db: &PgPool,
    channel: Uuid,
    has_text: bool,
    enc: Option<&Value>,
    client_msg_id: Option<Uuid>,
    exempt: bool,
) -> Result<Option<Value>> {
    match enc.filter(|v| !v.is_null()) {
        Some(raw) => {
            if has_text {
                return Err(AppError::BadRequest("Contenu en clair et chiffré à la fois".into()));
            }
            if client_msg_id.is_none() {
                return Err(AppError::BadRequest("client_msg_id requis".into()));
            }
            let e = Enc::parse(raw)?;
            check_epoch(channel_epoch(db, channel).await?, e.epoch)?;
            Ok(Some(e.to_json()))
        }
        None if has_text && !exempt => Err(plaintext_refused()),
        None => Ok(None),
    }
}

/// Champs de réponse propres aux salons : clé de récupération du serveur et
/// époques qui n'y sont pas encore enveloppées.
pub async fn extend_keys(db: &PgPool, channel: Uuid, me: Uuid, out: &mut Value) -> Result<()> {
    let key: Option<(Uuid, String, String)> = sqlx::query_as(
        "SELECT sk.server_id, sk.public_key, sk.fingerprint FROM server_keys sk
         JOIN channels c ON c.server_id = sk.server_id WHERE c.id=$1",
    )
    .bind(channel)
    .fetch_optional(db)
    .await?;
    let Some((server_id, public, fp)) = key else {
        out["server_key"] = Value::Null;
        out["server_missing"] = json!([]);
        return Ok(());
    };
    let server_missing: Vec<i32> = sqlx::query_scalar(
        "SELECT ck.epoch FROM conversation_keys ck
         WHERE ck.conv_kind='channel' AND ck.conv_id=$1 AND ck.member_id=$2 AND NOT EXISTS(
             SELECT 1 FROM server_epoch_keys s WHERE s.channel_id=$1 AND s.epoch=ck.epoch AND s.server_fp=$3)
         ORDER BY ck.epoch",
    )
    .bind(channel)
    .bind(me)
    .bind(&fp)
    .fetch_all(db)
    .await?;
    out["server_key"] = json!({ "server_id": server_id, "public": public, "fingerprint": fp });
    out["server_missing"] = json!(server_missing);
    Ok(())
}

/// Clé de récupération du serveur d'un salon : (empreinte) si elle existe.
async fn server_fp(db: &PgPool, channel: Uuid) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT sk.fingerprint FROM server_keys sk JOIN channels c ON c.server_id = sk.server_id WHERE c.id=$1",
    )
    .bind(channel)
    .fetch_optional(db)
    .await?)
}

/// Nouvelle époque d'un salon : enveloppe pour la clé du serveur exigée dès qu'elle existe.
pub async fn require_server_envelope(db: &PgPool, channel: Uuid, se: Option<&ServerEnvelope>) -> Result<()> {
    match (server_fp(db, channel).await?, se) {
        (None, _) => Ok(()),
        (Some(fp), Some(se)) if se.server_fp == fp => Ok(()),
        _ => Err(AppError::Conflict("SERVER_KEY_REQUIRED".into())),
    }
}

/// Range l'enveloppe d'une époque pour la clé du serveur (remplacée seulement si
/// elle visait une autre clé de serveur).
pub async fn store_server_envelope(
    tx: &mut Transaction<'_, Postgres>,
    channel: Uuid,
    epoch: i32,
    user: Uuid,
    my_pub: &str,
    se: &ServerEnvelope,
) -> Result<()> {
    se.wrapped.validate()?;
    let fp: Option<String> = sqlx::query_scalar(
        "SELECT sk.fingerprint FROM server_keys sk JOIN channels c ON c.server_id = sk.server_id WHERE c.id=$1",
    )
    .bind(channel)
    .fetch_optional(&mut **tx)
    .await?;
    match fp {
        Some(fp) if fp == se.server_fp => {}
        Some(_) => return Err(AppError::Conflict("SERVER_KEY_CHANGED".into())),
        None => return Err(AppError::BadRequest("NO_SERVER_KEY".into())),
    }
    sqlx::query(
        "INSERT INTO server_epoch_keys (channel_id, epoch, server_fp, wrapped, wrapped_by, wrapped_by_pub)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (channel_id, epoch) DO UPDATE
           SET server_fp=EXCLUDED.server_fp, wrapped=EXCLUDED.wrapped, wrapped_by=EXCLUDED.wrapped_by,
               wrapped_by_pub=EXCLUDED.wrapped_by_pub, created_at=NOW()
         WHERE server_epoch_keys.server_fp <> EXCLUDED.server_fp",
    )
    .bind(channel)
    .bind(epoch)
    .bind(&se.server_fp)
    .bind(se.wrapped.to_json())
    .bind(user)
    .bind(my_pub)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Quelques détenteurs connectés d'une clé du salon, qui le voient encore.
pub async fn key_holders_online(state: &AppState, channel: Uuid, me: Uuid) -> Result<Vec<Uuid>> {
    let connected: HashSet<Uuid> = state.clients.read().await.keys().copied().collect();
    let holders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT member_id FROM conversation_keys WHERE conv_kind='channel' AND conv_id=$1 AND member_id <> $2",
    )
    .bind(channel)
    .bind(me)
    .fetch_all(&state.db)
    .await?;
    let online: Vec<Uuid> = holders.into_iter().filter(|u| connected.contains(u)).collect();
    let mut asked = channel_audience_among(&state.db, channel, &online).await;
    asked.truncate(KEY_REQUEST_FANOUT);
    Ok(asked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_when_a_holder_lost_access() {
        assert!(!needs_rotation(3, 3));
        assert!(needs_rotation(3, 2));
        assert!(!needs_rotation(0, 0));
    }
}
