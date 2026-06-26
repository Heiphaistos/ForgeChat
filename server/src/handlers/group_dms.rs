use axum::{
    extract::{Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct CreateGroupDmInput {
    pub user_ids: Vec<Uuid>,
    pub name: Option<String>,
}

pub async fn create_group_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<CreateGroupDmInput>,
) -> Result<Json<serde_json::Value>> {
    if body.user_ids.len() < 2 || body.user_ids.len() > 9 {
        return Err(AppError::BadRequest("Entre 2 et 9 membres requis".into()));
    }
    // Déduplique et retire le créateur s'il est dans la liste
    let mut members: Vec<Uuid> = body.user_ids.clone();
    members.dedup();
    members.retain(|id| *id != claims.sub);
    if members.len() < 1 {
        return Err(AppError::BadRequest("Au moins 1 autre membre requis".into()));
    }

    use sqlx::Row;
    let name = body.name.as_deref().unwrap_or("Groupe").trim().chars().take(64).collect::<String>();
    let name = if name.is_empty() { "Groupe".to_string() } else { name };

    let group = sqlx::query(
        "INSERT INTO group_dm_channels (name, owner_id) VALUES ($1, $2) RETURNING id"
    )
    .bind(&name)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let group_id: Uuid = group.get("id");

    // Ajouter le créateur comme membre
    sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)")
        .bind(group_id).bind(claims.sub).execute(&state.db).await?;

    // Ajouter les autres membres
    for uid in &members {
        let _ = sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(group_id).bind(uid).execute(&state.db).await;
    }

    Ok(Json(serde_json::json!({ "id": group_id, "name": name })))
}

pub async fn list_group_dms(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT g.id, g.name, g.created_at,
                (SELECT COUNT(*) FROM group_dm_members WHERE dm_id = g.id) as member_count
         FROM group_dm_channels g
         JOIN group_dm_members gm ON gm.dm_id = g.id
         WHERE gm.user_id = $1
         ORDER BY g.created_at DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "member_count": r.get::<i64, _>("member_count"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })).collect();
    Ok(Json(result))
}

pub async fn get_group_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    // Vérifier membership
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let group = sqlx::query(
        "SELECT id, name, owner_id, created_at FROM group_dm_channels WHERE id=$1"
    )
    .bind(group_id).fetch_one(&state.db).await
    .map_err(|_| AppError::NotFound("Groupe introuvable".into()))?;

    let members = sqlx::query(
        "SELECT u.id, u.username, u.discriminator, u.avatar, u.status
         FROM group_dm_members gm JOIN users u ON u.id = gm.user_id WHERE gm.dm_id = $1"
    )
    .bind(group_id).fetch_all(&state.db).await?;

    let members_json: Vec<serde_json::Value> = members.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
    })).collect();

    Ok(Json(serde_json::json!({
        "id": group.get::<Uuid, _>("id"),
        "name": group.get::<String, _>("name"),
        "owner_id": group.get::<Uuid, _>("owner_id"),
        "created_at": group.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "members": members_json,
    })))
}

pub async fn get_group_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let rows = sqlx::query(
        "SELECT m.id, m.content, m.created_at, m.sender_id,
                u.username as sender_username, u.avatar as sender_avatar
         FROM group_dm_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.dm_id = $1
         ORDER BY m.created_at ASC
         LIMIT 100"
    )
    .bind(group_id).fetch_all(&state.db).await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "content": r.get::<Option<String>, _>("content"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "sender_id": r.get::<Uuid, _>("sender_id"),
        "sender_username": r.get::<String, _>("sender_username"),
        "sender_avatar": r.get::<Option<String>, _>("sender_avatar"),
    })).collect();
    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct SendGroupDmInput {
    pub content: Option<String>,
}

pub async fn send_group_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<SendGroupDmInput>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2)"
    )
    .bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !is_member { return Err(AppError::Forbidden); }

    let content = body.content.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
    if content.is_none() { return Err(AppError::BadRequest("Message vide".into())); }

    let msg = sqlx::query(
        "INSERT INTO group_dm_messages (dm_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, created_at"
    )
    .bind(group_id).bind(claims.sub).bind(content)
    .fetch_one(&state.db).await?;

    let user = sqlx::query("SELECT username, avatar FROM users WHERE id=$1")
        .bind(claims.sub).fetch_one(&state.db).await?;

    let msg_json = serde_json::json!({
        "id": msg.get::<Uuid, _>("id"),
        "dm_id": group_id,
        "content": content,
        "created_at": msg.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "sender_id": claims.sub,
        "sender_username": user.get::<String, _>("username"),
        "sender_avatar": user.get::<Option<String>, _>("avatar"),
    });

    let event = serde_json::json!({
        "type": "GROUP_DM_MESSAGE",
        "group_id": group_id,
        "message": msg_json,
    });
    let event_str = event.to_string();

    // Notifier tous les membres
    let members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM group_dm_members WHERE dm_id=$1"
    )
    .bind(group_id).fetch_all(&state.db).await.unwrap_or_default();

    for uid in members {
        state.broadcast_to_user(uid, event_str.clone()).await;
    }

    Ok(Json(msg_json))
}
