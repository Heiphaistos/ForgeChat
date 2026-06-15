use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub async fn get_friends(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let friends = sqlx::query(
        "SELECT f.id, f.friend_id, f.status, u.username, u.discriminator, u.avatar, u.status as user_status
         FROM friendships f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id=$1
         UNION
         SELECT f.id, f.user_id as friend_id, f.status, u.username, u.discriminator, u.avatar, u.status as user_status
         FROM friendships f JOIN users u ON u.id = f.user_id
         WHERE f.friend_id=$1 AND f.status='accepted'
         ORDER BY username"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = friends.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "friend_id": r.get::<Uuid, _>("friend_id"),
        "status": r.get::<String, _>("status"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "user_status": r.get::<String, _>("user_status"),
    })).collect();

    Ok(Json(result))
}

pub async fn send_friend_request(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let target_id: Uuid = body["user_id"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| AppError::BadRequest("user_id invalide".into()))?;

    if target_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de s'ajouter soi-même".into()));
    }

    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE
         (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1))"
    )
    .bind(claims.sub)
    .bind(target_id)
    .fetch_one(&state.db)
    .await?;

    if exists {
        return Err(AppError::Conflict("Demande déjà existante".into()));
    }

    sqlx::query(
        "INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending')"
    )
    .bind(claims.sub)
    .bind(target_id)
    .execute(&state.db)
    .await?;

    // Notifier le destinataire
    let event = serde_json::json!({
        "type": "FRIEND_REQUEST",
        "from_id": claims.sub,
    });
    state.broadcast_to_user(target_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn accept_friend(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(friendship_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query(
        "UPDATE friendships SET status='accepted' WHERE id=$1 AND friend_id=$2"
    )
    .bind(friendship_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn decline_friend(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(friendship_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query(
        "DELETE FROM friendships WHERE id=$1 AND friend_id=$2"
    )
    .bind(friendship_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_friend(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query(
        "DELETE FROM friendships WHERE
         (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)"
    )
    .bind(claims.sub)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_dms(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let dms = sqlx::query(
        "SELECT dc.id, dc.created_at,
         CASE WHEN dc.user1_id=$1 THEN dc.user2_id ELSE dc.user1_id END as other_user_id,
         u.username, u.discriminator, u.avatar, u.status
         FROM dm_channels dc
         JOIN users u ON u.id = CASE WHEN dc.user1_id=$1 THEN dc.user2_id ELSE dc.user1_id END
         WHERE dc.user1_id=$1 OR dc.user2_id=$1
         ORDER BY dc.created_at DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = dms.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "other_user_id": r.get::<Uuid, _>("other_user_id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
    })).collect();

    Ok(Json(result))
}

pub async fn open_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let (u1, u2) = if claims.sub < user_id {
        (claims.sub, user_id)
    } else {
        (user_id, claims.sub)
    };

    let dm = sqlx::query(
        "INSERT INTO dm_channels (user1_id, user2_id) VALUES ($1, $2)
         ON CONFLICT (user1_id, user2_id) DO UPDATE SET user1_id=$1
         RETURNING id"
    )
    .bind(u1)
    .bind(u2)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    Ok(Json(serde_json::json!({ "dm_id": dm.get::<Uuid, _>("id") })))
}

pub async fn get_dm_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>> {
    // Vérifier que l'user fait partie du DM
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !ok { return Err(AppError::Forbidden); }

    let limit: i64 = params.get("limit").and_then(|l| l.parse().ok()).unwrap_or(50);

    let messages = sqlx::query(
        "SELECT dm.*, u.username, u.avatar FROM dm_messages dm
         JOIN users u ON u.id = dm.sender_id
         WHERE dm.dm_channel_id=$1
         ORDER BY dm.created_at DESC LIMIT $2"
    )
    .bind(dm_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let mut result: Vec<serde_json::Value> = messages.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "content": r.get::<Option<String>, _>("content"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "sender_id": r.get::<Uuid, _>("sender_id"),
        "sender_username": r.get::<String, _>("username"),
        "sender_avatar": r.get::<Option<String>, _>("avatar"),
    })).collect();

    result.reverse();
    Ok(Json(result))
}

pub async fn send_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !ok { return Err(AppError::Forbidden); }

    let content = body["content"]
        .as_str()
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("Contenu vide".into()))?;

    let msg = sqlx::query(
        "INSERT INTO dm_messages (dm_channel_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .bind(content)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let msg_id: Uuid = msg.get("id");

    // Notifier l'autre utilisateur
    let other = sqlx::query(
        "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END as other
         FROM dm_channels WHERE id=$1"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let other_id: Uuid = other.get("other");
    let event = serde_json::json!({
        "type": "DM_MESSAGE",
        "dm_id": dm_id,
        "message": {
            "id": msg_id,
            "content": content,
            "sender_id": claims.sub,
            "created_at": msg.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        }
    });
    state.broadcast_to_user(other_id, event.to_string()).await;

    Ok(Json(serde_json::json!({
        "id": msg_id,
        "content": content,
        "created_at": msg.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })))
}
