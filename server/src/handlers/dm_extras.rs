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

fn is_user1(row: &sqlx::postgres::PgRow, user_id: Uuid) -> bool {
    use sqlx::Row;
    row.get::<Uuid, _>("user1_id") == user_id
}

// ── Mute ──────────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct MuteBody { pub minutes: Option<i64> }

pub async fn mute_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<MuteBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "muted_by_user1_until" } else { "muted_by_user2_until" };
    let until = body.minutes.map(|m| chrono::Utc::now() + chrono::Duration::minutes(m));
    let sql = format!("UPDATE dm_channels SET {col}=$1 WHERE id=$2");
    sqlx::query(&sql).bind(until).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true, "muted_until": until })))
}

pub async fn unmute_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "muted_by_user1_until" } else { "muted_by_user2_until" };
    let sql = format!("UPDATE dm_channels SET {col}=NULL WHERE id=$1");
    sqlx::query(&sql).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── Archive ───────────────────────────────────────────────────────────────────

pub async fn archive_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "archived_by_user1" } else { "archived_by_user2" };
    let sql = format!("UPDATE dm_channels SET {col}=TRUE WHERE id=$1");
    sqlx::query(&sql).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unarchive_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    assert_dm_member(&state.db, dm_id, claims.sub).await?;
    let row = sqlx::query("SELECT user1_id FROM dm_channels WHERE id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    let col = if is_user1(&row, claims.sub) { "archived_by_user1" } else { "archived_by_user2" };
    let sql = format!("UPDATE dm_channels SET {col}=FALSE WHERE id=$1");
    sqlx::query(&sql).bind(dm_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
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
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM dm_pins WHERE dm_channel_id=$1")
        .bind(dm_id).fetch_one(&state.db).await?;
    if count >= 50 { return Err(AppError::BadRequest("Maximum 50 messages épinglés".into())); }
    sqlx::query(
        "INSERT INTO dm_pins (dm_channel_id, message_id, pinned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING"
    ).bind(dm_id).bind(message_id).bind(claims.sub).execute(&state.db).await?;
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
    Ok(Json(serde_json::json!({ "ok": true })))
}
