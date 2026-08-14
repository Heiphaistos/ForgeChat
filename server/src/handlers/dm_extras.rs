use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;
use crate::{error::{AppError, Result}, middleware::auth::Claims, state::AppState};

async fn assert_dm_member(db: &sqlx::PgPool, dm_id: Uuid, user_id: Uuid) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    ).bind(dm_id).bind(user_id).fetch_one(db).await?;
    if !ok { return Err(AppError::Forbidden); }
    Ok(())
}

// group_dms.rs::toggle_group_dm_pin diffuse déjà GROUP_DM_PIN_TOGGLE à tous les membres
// (et le client group l'écoute) -- pin_dm_message/unpin_dm_message n'avaient jamais eu
// l'équivalent : épingler/désépingler un message en DM 1-à-1 ne se propageait qu'au
// cache local de l'auteur du clic (invalidateQueries dans la mutation), le partenaire
// restait figé sur l'ancien état de son panneau épinglés tant qu'il ne le fermait/
// rouvrait pas. Même pattern d'émission que send_dm (fetch de l'autre participant +
// notifier aussi l'auteur pour la sync multi-onglets).
async fn broadcast_dm_pin_toggle(state: &AppState, dm_id: Uuid, actor_id: Uuid, message_id: Uuid, pinned: bool) {
    use sqlx::Row;
    let Ok(row) = sqlx::query(
        "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END as other
         FROM dm_channels WHERE id=$1"
    ).bind(dm_id).bind(actor_id).fetch_one(&state.db).await else { return };
    let other_id: Uuid = row.get("other");
    let event = serde_json::json!({
        "type": "DM_PIN_TOGGLE",
        "dm_id": dm_id,
        "message_id": message_id,
        "pinned": pinned,
    }).to_string();
    state.broadcast_to_user(other_id, event.clone()).await;
    state.broadcast_to_user(actor_id, event).await;
}

// ── Pins ──────────────────────────────────────────────────────────────────────

pub async fn get_dm_pins(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let pins = sqlx::query(
        "SELECT dp.id, dp.message_id, dp.pinned_at, dp.pinned_by,
                dm.content, dm.sender_id, dm.created_at as msg_created_at,
                u.username as sender_name, u.avatar as sender_avatar,
                pu.username as pinner_name
         FROM dm_pins dp
         JOIN dm_messages dm ON dm.id = dp.message_id
         JOIN users u ON u.id = dm.sender_id
         JOIN users pu ON pu.id = dp.pinned_by
         WHERE dp.dm_channel_id=$1
         ORDER BY dp.pinned_at DESC"
    ).bind(dm_id).fetch_all(&state.db).await?;

    let result = pins.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "message_id": r.get::<Uuid, _>("message_id"),
        "pinned_at": r.get::<chrono::DateTime<chrono::Utc>, _>("pinned_at"),
        "pinned_by": r.get::<String, _>("pinner_name"),
        "message": {
            "content": r.get::<Option<String>, _>("content"),
            "sender_id": r.get::<Uuid, _>("sender_id"),
            "sender_name": r.get::<String, _>("sender_name"),
            "sender_avatar": r.get::<Option<String>, _>("sender_avatar"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("msg_created_at"),
        }
    })).collect();
    Ok(Json(result))
}

pub async fn pin_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    assert_dm_member(&state.db, dm_id, claims.sub).await?;

    // Vérifier que le message appartient bien à ce DM
    let msg_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_messages WHERE id=$1 AND dm_channel_id=$2)"
    )
    .bind(message_id)
    .bind(dm_id)
    .fetch_one(&state.db)
    .await?;
    if !msg_exists {
        return Err(AppError::NotFound("Message introuvable dans ce DM".into()));
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dm_pins WHERE dm_channel_id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    if count >= 50 { return Err(AppError::BadRequest("Maximum 50 messages épinglés".into())); }
    sqlx::query(
        "INSERT INTO dm_pins (dm_channel_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
    ).bind(dm_id).bind(message_id).bind(claims.sub).execute(&state.db).await?;
    broadcast_dm_pin_toggle(&state, dm_id, claims.sub, message_id, true).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unpin_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    sqlx::query("DELETE FROM dm_pins WHERE dm_channel_id=$1 AND message_id=$2")
        .bind(dm_id).bind(message_id).execute(&state.db).await?;
    broadcast_dm_pin_toggle(&state, dm_id, claims.sub, message_id, false).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}
