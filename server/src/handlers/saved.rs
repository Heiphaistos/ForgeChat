use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, handlers::servers::require_member_and_channel, middleware::auth::Claims, state::AppState};

#[derive(Deserialize)]
pub struct SaveMessageBody {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
    pub content: Option<String>,
    pub author_username: Option<String>,
    pub author_avatar: Option<String>,
}

#[derive(Serialize)]
pub struct SavedMessage {
    pub id: Uuid,
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
    pub content: Option<String>,
    pub author_username: Option<String>,
    pub author_avatar: Option<String>,
    pub saved_at: DateTime<Utc>,
    // Le frontend (SavedPage.tsx) attend ces 4 champs pour le fil d'ariane
    // serveur/canal, la date d'origine du message et les pièces jointes --
    // jamais renvoyés avant ce fix, donc toujours `undefined` côté client :
    // fil d'ariane jamais affiché, date "Invalid Date", filtre Images/Fichiers
    // toujours négatif (detectType() ne voyait jamais d'attachments).
    pub created_at: DateTime<Utc>,
    pub channel_name: Option<String>,
    pub server_name: Option<String>,
    pub attachments: Vec<crate::models::message::Attachment>,
}

pub async fn save_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SaveMessageBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Vérifier que l'utilisateur a accès au canal/serveur référencé. Sans server_id,
    // channel_id désigne un DM 1-à-1 (dm_channels) -- ce cas n'était PAS vérifié du
    // tout : n'importe quel utilisateur authentifié pouvait fournir un channel_id de
    // DM arbitraire (dont il n'a jamais été membre) sans jamais être rejeté.
    if let Some(sid) = body.server_id {
        require_member_and_channel(&state, claims.sub, sid, body.channel_id).await?;
    } else {
        let is_dm_member: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
        )
        .bind(body.channel_id)
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
        if !is_dm_member {
            return Err(AppError::Forbidden);
        }
    }
    sqlx::query(
        "INSERT INTO saved_messages (user_id, message_id, channel_id, server_id, content, author_username, author_avatar)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, message_id) DO NOTHING"
    )
    .bind(claims.sub)
    .bind(body.message_id)
    .bind(body.channel_id)
    .bind(body.server_id)
    .bind(body.content)
    .bind(body.author_username)
    .bind(body.author_avatar)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_saved(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<SavedMessage>>, AppError> {
    use sqlx::Row;
    // LEFT JOIN partout : le message/canal/serveur d'origine peut avoir été
    // supprimé depuis la sauvegarde (schéma volontairement sans FK dessus,
    // cf. migration 006) -- content/author_* déjà figés dans saved_messages
    // servent justement de secours dans ce cas, created_at retombe sur
    // saved_at plutôt que de planter ou renvoyer NULL.
    let rows = sqlx::query(
        "SELECT sm.id, sm.message_id, sm.channel_id, sm.server_id,
                sm.content, sm.author_username, sm.author_avatar, sm.saved_at,
                COALESCE(m.created_at, sm.saved_at) as created_at,
                c.name as channel_name,
                s.name as server_name
         FROM saved_messages sm
         LEFT JOIN messages m ON m.id = sm.message_id
         LEFT JOIN channels c ON c.id = sm.channel_id
         LEFT JOIN servers s ON s.id = sm.server_id
         WHERE sm.user_id=$1 ORDER BY sm.saved_at DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let message_ids: Vec<Uuid> = rows.iter().map(|r| r.get("message_id")).collect();
    let all_attachments: Vec<crate::models::message::Attachment> = sqlx::query_as(
        "SELECT * FROM attachments WHERE message_id = ANY($1) AND (expires_at IS NULL OR expires_at > NOW())"
    )
    .bind(&message_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let items = rows.iter().map(|r| {
        let mid: Uuid = r.get("message_id");
        SavedMessage {
            id: r.get("id"),
            message_id: mid,
            channel_id: r.get("channel_id"),
            server_id: r.get("server_id"),
            content: r.get("content"),
            author_username: r.get("author_username"),
            author_avatar: r.get("author_avatar"),
            saved_at: r.get("saved_at"),
            created_at: r.get("created_at"),
            channel_name: r.get("channel_name"),
            server_name: r.get("server_name"),
            attachments: all_attachments.iter().filter(|a| a.message_id == mid).cloned().collect(),
        }
    }).collect();

    Ok(Json(items))
}

pub async fn unsave_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query("DELETE FROM saved_messages WHERE user_id=$1 AND message_id=$2")
        .bind(claims.sub)
        .bind(message_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// Notes privées utilisateur
#[derive(Serialize)]
pub struct UserNote {
    pub content: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct SetNoteBody {
    pub content: String,
}

pub async fn get_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
) -> Result<Json<UserNote>, AppError> {
    use sqlx::Row;
    let row = sqlx::query("SELECT content, updated_at FROM user_notes WHERE user_id=$1 AND target_user_id=$2")
        .bind(claims.sub).bind(target_id)
        .fetch_optional(&state.db).await?;

    if let Some(r) = row {
        Ok(Json(UserNote { content: r.get("content"), updated_at: r.get("updated_at") }))
    } else {
        Ok(Json(UserNote { content: String::new(), updated_at: Utc::now() }))
    }
}

pub async fn set_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<SetNoteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Note trop longue (max 2000 chars)".into()));
    }
    sqlx::query(
        "INSERT INTO user_notes (user_id, target_user_id, content, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (user_id, target_user_id) DO UPDATE SET content=$3, updated_at=NOW()"
    )
    .bind(claims.sub).bind(target_id).bind(&body.content)
    .execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
