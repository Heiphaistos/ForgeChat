//! « Marquer comme non lu » (Discord) : la position de lecture recule juste avant un
//! message donné, ce message et les suivants redeviennent non lus. Salons de serveur
//! (`last_read`) et conversations privées, 1:1 ou de groupe (`dm_read_receipts`).
//!
//! Contrairement à `reads::mark_channel_read` (GREATEST, jamais de recul), la position est
//! ici imposée : c'est le but. Les autres sessions de l'utilisateur reçoivent READ_STATE_UPDATE.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::reads::broadcast_read_state,
    middleware::auth::Claims,
    state::AppState,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarkUnreadBody {
    /// Premier message à rendre non lu.
    pub message_id: Uuid,
}

/// Position de lecture qui rend `created_at` non lu : les compteurs comptent
/// `created_at > read_at`, on recule donc d'une microseconde (précision de TIMESTAMPTZ).
pub fn read_at_before(created_at: DateTime<Utc>) -> DateTime<Utc> {
    created_at - Duration::microseconds(1)
}

/// POST /channels/:channel_id/unread {message_id}
/// → {ok, read_at, count, mention_count}
pub async fn mark_channel_unread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<MarkUnreadBody>,
) -> Result<Json<Value>> {
    let server_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT c.server_id FROM channels c
         JOIN server_members sm ON sm.server_id = c.server_id
         WHERE c.id = $1 AND sm.user_id = $2",
    )
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .flatten();
    let Some(server_id) = server_id else {
        return Err(AppError::Forbidden);
    };
    // Salon masqué (VIEW_CHANNEL refusé) : il n'existe pas pour ce membre.
    if state
        .hidden_channels(claims.sub, Some(server_id), Some(channel_id))
        .await?
        .contains(&channel_id)
    {
        return Err(AppError::Forbidden);
    }
    let created_at: DateTime<Utc> =
        sqlx::query_scalar("SELECT created_at FROM messages WHERE id=$1 AND channel_id=$2")
            .bind(body.message_id)
            .bind(channel_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;
    let read_at = read_at_before(created_at);
    sqlx::query(
        "INSERT INTO last_read (user_id, channel_id, read_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET read_at = EXCLUDED.read_at",
    )
    .bind(claims.sub)
    .bind(channel_id)
    .bind(read_at)
    .execute(&state.db)
    .await?;
    // Mêmes règles que get_unread_counts (messages des autres, non expirés).
    let (count, mention_count): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(mm.message_id) FROM messages m
         LEFT JOIN message_mentions mm ON mm.message_id = m.id AND mm.user_id = $2
         WHERE m.channel_id = $1 AND m.user_id != $2 AND m.created_at > $3
           AND (m.expires_at IS NULL OR m.expires_at > NOW())",
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(read_at)
    .fetch_one(&state.db)
    .await?;
    let out = json!({
        "channel_id": channel_id,
        "server_id": server_id,
        "message_id": body.message_id,
        "read_at": read_at,
        "unread": true,
        "count": count,
        "mention_count": mention_count,
    });
    broadcast_read_state(&state, claims.sub, out.clone()).await;
    Ok(Json(
        json!({ "ok": true, "read_at": read_at, "count": count, "mention_count": mention_count }),
    ))
}

/// POST /dms/:dm_id/unread {message_id} — MP 1:1 ou groupe (même identifiant d'espace).
/// → {ok, read_at, count, mention_count} ; tout MP non lu compte comme mention (Discord).
pub async fn mark_dm_unread(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<MarkUnreadBody>,
) -> Result<Json<Value>> {
    // Le message doit appartenir à CETTE conversation, dont l'utilisateur est membre.
    let created_at: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT m.created_at FROM dm_messages m JOIN dm_channels d ON d.id = m.dm_channel_id
         WHERE m.id = $1 AND d.id = $2 AND (d.user1_id = $3 OR d.user2_id = $3)
         UNION ALL
         SELECT m.created_at FROM group_dm_messages m JOIN group_dm_members g ON g.dm_id = m.dm_id AND g.user_id = $3
         WHERE m.id = $1 AND m.dm_id = $2
         LIMIT 1",
    )
    .bind(body.message_id)
    .bind(dm_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;
    // Même réponse que la conversation soit inconnue ou étrangère : pas d'énumération.
    let created_at = created_at.ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;
    let read_at = read_at_before(created_at);
    sqlx::query(
        "INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at) VALUES ($1, $2, $3)
         ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at",
    )
    .bind(dm_id)
    .bind(claims.sub)
    .bind(read_at)
    .execute(&state.db)
    .await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM dm_messages WHERE dm_channel_id = $1 AND sender_id != $2 AND created_at > $3)
              + (SELECT COUNT(*) FROM group_dm_messages WHERE dm_id = $1 AND sender_id != $2 AND created_at > $3)",
    )
    .bind(dm_id)
    .bind(claims.sub)
    .bind(read_at)
    .fetch_one(&state.db)
    .await?;
    let out = json!({
        "channel_id": dm_id,
        "server_id": null,
        "message_id": body.message_id,
        "read_at": read_at,
        "unread": true,
        "count": count,
        "mention_count": count,
    });
    broadcast_read_state(&state, claims.sub, out).await;
    Ok(Json(
        json!({ "ok": true, "read_at": read_at, "count": count, "mention_count": count }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_becomes_unread() {
        let at = Utc::now();
        let read_at = read_at_before(at);
        // Compteurs : created_at > read_at → le message visé est compté, le précédent non.
        assert!(at > read_at);
        assert_eq!(at - read_at, Duration::microseconds(1));
    }
}
