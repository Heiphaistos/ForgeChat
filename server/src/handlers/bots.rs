use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Extension, Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::{message::MessageWithAuthor, role::Permissions},
    state::AppState,
};

#[derive(serde::Deserialize)]
pub struct CreateBotRequest {
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct BotMessageRequest {
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub content: String,
}

pub async fn create_bot(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateBotRequest>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let name = body.name.trim().to_string();
    if name.is_empty() || name.len() > 32 {
        return Err(AppError::BadRequest("Nom de bot invalide (1-32 chars)".into()));
    }

    let bot_username = format!("{}Bot", name.replace(' ', ""));
    let disc = format!("{:04}", rand::thread_rng().gen_range(1..9999u32));
    let fake_email = format!("bot_{}@forgechat.internal", Uuid::new_v4());
    let fake_hash = bcrypt::hash("bot_no_login", 4)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let bot_user = sqlx::query(
        "INSERT INTO users (username, discriminator, email, password_hash, is_bot)
         VALUES ($1, $2, $3, $4, true) RETURNING id"
    )
    .bind(&bot_username)
    .bind(&disc)
    .bind(&fake_email)
    .bind(&fake_hash)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let bot_user_id: Uuid = bot_user.get("id");

    sqlx::query(
        "INSERT INTO server_members (user_id, server_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(bot_user_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    let raw_token = generate_raw_token();
    let token_hash = bcrypt::hash(&raw_token, 4)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    sqlx::query(
        "INSERT INTO bot_tokens (bot_user_id, server_id, token_hash, name)
         VALUES ($1, $2, $3, $4)"
    )
    .bind(bot_user_id)
    .bind(server_id)
    .bind(&token_hash)
    .bind(&name)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "bot_user_id": bot_user_id,
        "username": bot_username,
        "name": name,
        "token": raw_token,
        "warning": "Copiez ce token maintenant — il ne sera plus affiché."
    })))
}

pub async fn list_bots(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let rows = sqlx::query(
        "SELECT bt.id as token_id, bt.bot_user_id, bt.name, u.username, u.avatar, bt.created_at
         FROM bot_tokens bt
         JOIN users u ON u.id = bt.bot_user_id
         WHERE bt.server_id=$1
         ORDER BY bt.created_at"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let bots = rows.iter().map(|r| serde_json::json!({
        "token_id": r.get::<Uuid, _>("token_id"),
        "bot_user_id": r.get::<Uuid, _>("bot_user_id"),
        "name": r.get::<String, _>("name"),
        "username": r.get::<String, _>("username"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })).collect();

    Ok(Json(bots))
}

pub async fn delete_bot(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, bot_user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    sqlx::query("DELETE FROM bot_tokens WHERE bot_user_id=$1 AND server_id=$2")
        .bind(bot_user_id).bind(server_id)
        .execute(&state.db).await?;

    sqlx::query("DELETE FROM server_members WHERE user_id=$1 AND server_id=$2")
        .bind(bot_user_id).bind(server_id)
        .execute(&state.db).await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn regenerate_token(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, bot_user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let raw_token = generate_raw_token();
    let token_hash = bcrypt::hash(&raw_token, 4)
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let updated = sqlx::query(
        "UPDATE bot_tokens SET token_hash=$1 WHERE bot_user_id=$2 AND server_id=$3"
    )
    .bind(&token_hash)
    .bind(bot_user_id)
    .bind(server_id)
    .execute(&state.db)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("Bot introuvable".into()));
    }

    Ok(Json(serde_json::json!({
        "token": raw_token,
        "warning": "Copiez ce token maintenant — il ne sera plus affiché."
    })))
}

// Route sans JWT — authentification via header "Authorization: Bot <token>"
pub async fn bot_send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<BotMessageRequest>,
) -> Result<Json<MessageWithAuthor>> {
    let raw_token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bot "))
        .ok_or(AppError::Unauthorized)?;

    // Retrouver le bot via token hash (itérer les tokens du serveur)
    let tokens = sqlx::query(
        "SELECT bot_user_id, token_hash FROM bot_tokens WHERE server_id=$1"
    )
    .bind(body.server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let mut bot_user_id: Option<Uuid> = None;
    for row in &tokens {
        let hash: String = row.get("token_hash");
        if bcrypt::verify(raw_token, &hash).unwrap_or(false) {
            bot_user_id = Some(row.get("bot_user_id"));
            break;
        }
    }

    let bot_id = bot_user_id.ok_or(AppError::Unauthorized)?;

    // Vérifier que le channel appartient bien au server indiqué
    let channel_in_server = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1 AND server_id=$2)"
    )
    .bind(body.channel_id)
    .bind(body.server_id)
    .fetch_one(&state.db)
    .await?;

    if !channel_in_server {
        return Err(AppError::Forbidden);
    }

    let content = body.content.trim();
    if content.is_empty() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    let content = &content[..content.len().min(4000)];

    let msg = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, $3) RETURNING *"
    )
    .bind(body.channel_id)
    .bind(bot_id)
    .bind(content)
    .fetch_one(&state.db)
    .await?;

    let user = sqlx::query(
        "SELECT username, discriminator, avatar FROM users WHERE id=$1"
    )
    .bind(bot_id)
    .fetch_one(&state.db)
    .await?;

    let full_msg = MessageWithAuthor {
        id: msg.get("id"),
        channel_id: body.channel_id,
        content: msg.get("content"),
        r#type: msg.get("type"),
        reply_to: None,
        reply_to_content: None,
        reply_to_username: None,
        pinned: false,
        edited_at: None,
        created_at: msg.get("created_at"),
        author_id: bot_id,
        author_username: user.get("username"),
        author_discriminator: user.get("discriminator"),
        author_avatar: user.get("avatar"),
        author_is_bot: true,
        attachments: vec![],
        reactions: vec![],
    };

    let event = serde_json::json!({ "type": "MESSAGE_CREATE", "message": full_msg });
    state.broadcast_to_channel(body.channel_id, event.to_string()).await;

    Ok(Json(full_msg))
}

fn generate_raw_token() -> String {
    let raw: Vec<u8> = (0..48).map(|_| rand::thread_rng().gen::<u8>()).collect();
    URL_SAFE_NO_PAD.encode(&raw)
}
