//! Suivi des salons d'annonces (crosspost, comme Discord).
//!
//! Un salon `announcement` peut être suivi depuis un salon texte d'un serveur
//! qu'on administre. Un modérateur « publie » un message du salon d'annonces :
//! il est recopié dans chaque salon abonné, signé du serveur et du salon d'origine.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::password_reset::over_limit,
    handlers::servers::{require_member_and_channel, require_permission},
    middleware::auth::Claims,
    models::{message::MessageWithAuthor, role::Permissions},
    state::AppState,
};

/// Droit d'abonner un salon ou de gérer ses abonnements : gérer les salons ou
/// le serveur (les webhooks relèvent de MANAGE_SERVER ici).
const FOLLOW_PERM: i64 = Permissions::MANAGE_CHANNELS | Permissions::EDIT_CHANNELS | Permissions::MANAGE_SERVER;
/// Abonnements maximum par salon de destination (Discord : 10).
const MAX_FOLLOWS_PER_TARGET: i64 = 10;
/// Publications maximum par salon d'annonces et par heure (Discord : 10).
const MAX_PUBLISH_PER_HOUR: i64 = 10;

async fn channel_info(state: &AppState, channel_id: Uuid) -> Result<(Uuid, String)> {
    let row = sqlx::query("SELECT server_id, type FROM channels WHERE id=$1")
        .bind(channel_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Salon introuvable".into()))?;
    let server_id: Option<Uuid> = row.get("server_id");
    Ok((server_id.ok_or_else(|| AppError::NotFound("Salon introuvable".into()))?, row.get("type")))
}

#[derive(Deserialize)]
pub struct FollowRequest {
    pub target_channel_id: Uuid,
}

/// POST /channels/:channel_id/follow — abonne `target_channel_id` au salon d'annonces.
pub async fn follow_channel(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(source_id): Path<Uuid>,
    Json(body): Json<FollowRequest>,
) -> Result<Json<serde_json::Value>> {
    let (source_server, source_type) = channel_info(&state, source_id).await?;
    // On ne suit que ce qu'on voit.
    require_member_and_channel(&state, claims.sub, source_server, source_id).await?;
    if source_type != "announcement" {
        return Err(AppError::BadRequest("Seul un salon d'annonces peut être suivi".into()));
    }
    let (target_server, target_type) = channel_info(&state, body.target_channel_id).await?;
    // IDOR : la destination doit appartenir à un serveur qu'on administre.
    require_permission(&state, claims.sub, target_server, FOLLOW_PERM).await?;
    if !matches!(target_type.as_str(), "text" | "announcement") || body.target_channel_id == source_id {
        return Err(AppError::BadRequest("Choisissez un autre salon texte".into()));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channel_follows WHERE target_channel_id=$1")
        .bind(body.target_channel_id)
        .fetch_one(&state.db)
        .await?;
    if count >= MAX_FOLLOWS_PER_TARGET {
        return Err(AppError::BadRequest(format!("Ce salon suit déjà {MAX_FOLLOWS_PER_TARGET} salons d'annonces")));
    }
    let id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO channel_follows (source_channel_id, target_channel_id, created_by) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id"
    )
    .bind(source_id)
    .bind(body.target_channel_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;
    let id = id.ok_or_else(|| AppError::Conflict("Ce salon suit déjà ces annonces".into()))?;
    Ok(Json(serde_json::json!({ "id": id })))
}

/// GET /channels/:channel_id/follow-targets — salons texte des serveurs que
/// l'utilisateur administre, pour choisir la destination d'un abonnement.
pub async fn follow_targets(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(source_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let servers = sqlx::query(
        "SELECT s.id, s.name FROM servers s JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = $1 ORDER BY s.name"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    let mut out = Vec::new();
    // ponytail: une vérification de droits par serveur ; regrouper si un compte a des centaines de serveurs.
    for s in servers {
        let server_id: Uuid = s.get("id");
        if require_permission(&state, claims.sub, server_id, FOLLOW_PERM).await.is_err() {
            continue;
        }
        let channels: Vec<serde_json::Value> = sqlx::query(
            "SELECT id, name FROM channels WHERE server_id=$1 AND type IN ('text','announcement') AND id <> $2
             ORDER BY position"
        )
        .bind(server_id)
        .bind(source_id)
        .fetch_all(&state.db)
        .await?
        .iter()
        .map(|c| serde_json::json!({ "id": c.get::<Uuid, _>("id"), "name": c.get::<String, _>("name") }))
        .collect();
        if !channels.is_empty() {
            out.push(serde_json::json!({ "server_id": server_id, "server_name": s.get::<String, _>("name"), "channels": channels }));
        }
    }
    Ok(Json(out))
}

/// GET /channels/:channel_id/follows — abonnés du salon (s'il publie des annonces)
/// et salons d'annonces qu'il suit. Réservé aux gestionnaires du serveur.
pub async fn list_follows(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let (server_id, _) = channel_info(&state, channel_id).await?;
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    require_permission(&state, claims.sub, server_id, FOLLOW_PERM).await?;
    let query = |side: &str, other: &str| format!(
        "SELECT f.id, s.name AS server_name, c.name AS channel_name FROM channel_follows f
         JOIN channels c ON c.id = f.{other} JOIN servers s ON s.id = c.server_id
         WHERE f.{side} = $1 ORDER BY f.created_at"
    );
    let rows = |rows: Vec<sqlx::postgres::PgRow>| rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "server_name": r.get::<String, _>("server_name"),
        "channel_name": r.get::<String, _>("channel_name"),
    })).collect::<Vec<_>>();
    let followers = sqlx::query(&query("source_channel_id", "target_channel_id"))
        .bind(channel_id).fetch_all(&state.db).await?;
    let following = sqlx::query(&query("target_channel_id", "source_channel_id"))
        .bind(channel_id).fetch_all(&state.db).await?;
    Ok(Json(serde_json::json!({ "followers": rows(followers), "following": rows(following) })))
}

/// DELETE /channel-follows/:id — par un gestionnaire du serveur source OU destination.
pub async fn delete_follow(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(follow_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let row = sqlx::query(
        "SELECT cs.server_id AS source_server, ct.server_id AS target_server FROM channel_follows f
         JOIN channels cs ON cs.id = f.source_channel_id JOIN channels ct ON ct.id = f.target_channel_id
         WHERE f.id = $1"
    )
    .bind(follow_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Abonnement introuvable".into()))?;
    let source: Uuid = row.get("source_server");
    let target: Uuid = row.get("target_server");
    if require_permission(&state, claims.sub, target, FOLLOW_PERM).await.is_err() {
        require_permission(&state, claims.sub, source, FOLLOW_PERM).await?;
    }
    sqlx::query("DELETE FROM channel_follows WHERE id=$1").bind(follow_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /servers/:server_id/channels/:channel_id/messages/:msg_id/crosspost
/// Publie un message d'annonce : copie dans chaque salon abonné.
pub async fn crosspost_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    let (_, perms) = state.effective_channel_permissions(claims.sub, channel_id).await.ok_or(AppError::Forbidden)?;
    if perms & Permissions::MANAGE_MESSAGES == 0 {
        return Err(AppError::Forbidden);
    }
    crate::handlers::servers::require_not_timed_out(&state, claims.sub, server_id).await?;
    let source = sqlx::query(
        "SELECT c.type, c.name AS channel_name, s.name AS server_name, s.icon FROM channels c
         JOIN servers s ON s.id = c.server_id WHERE c.id=$1"
    )
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;
    if source.get::<String, _>("type") != "announcement" {
        return Err(AppError::BadRequest("Seuls les messages d'un salon d'annonces se publient".into()));
    }
    if over_limit(&state, &format!("crosspost:{channel_id}"), MAX_PUBLISH_PER_HOUR, 3600).await {
        return Err(AppError::TooManyRequests);
    }
    // Atomique : deux clics simultanés ne publient pas deux fois.
    let msg = sqlx::query(
        "UPDATE messages SET crossposted_at=NOW()
         WHERE id=$1 AND channel_id=$2 AND crossposted_at IS NULL AND COALESCE(content, '') <> ''
         RETURNING user_id, content"
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Conflict("Message introuvable, vide ou déjà publié".into()))?;
    let author_id: Uuid = msg.get("user_id");
    let content: String = msg.get("content");
    let display = format!("{} • #{}", source.get::<String, _>("server_name"), source.get::<String, _>("channel_name"));
    let icon: Option<String> = source.get("icon");

    let targets = sqlx::query(
        "SELECT f.target_channel_id, c.server_id FROM channel_follows f JOIN channels c ON c.id = f.target_channel_id
         WHERE f.source_channel_id=$1"
    )
    .bind(channel_id)
    .fetch_all(&state.db)
    .await?;
    let author = sqlx::query("SELECT discriminator FROM users WHERE id=$1")
        .bind(author_id).fetch_one(&state.db).await?;

    // ponytail: texte seul, les pièces jointes ne sont pas recopiées (leurs fichiers
    // sont supprimés avec le message source) ; les copier sur disque si besoin.
    for t in &targets {
        let target: Uuid = t.get("target_channel_id");
        let target_server: Uuid = t.get("server_id");
        let row = sqlx::query(
            "INSERT INTO messages (channel_id, user_id, content, type, webhook_display_name, webhook_avatar_url)
             VALUES ($1, $2, $3, 'crosspost', $4, $5) RETURNING id, created_at"
        )
        .bind(target)
        .bind(author_id)
        .bind(&content)
        .bind(&display)
        .bind(&icon)
        .fetch_one(&state.db)
        .await?;
        let id: Uuid = row.get("id");
        sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2").bind(id).bind(target).execute(&state.db).await?;
        let full = MessageWithAuthor {
            id,
            channel_id: target,
            content: Some(content.clone()),
            r#type: "crosspost".into(),
            reply_to: None,
            reply_to_content: None,
            reply_to_username: None,
            forward_from_id: None,
            forward_from_username: None,
            pinned: false,
            edited_at: None,
            created_at: row.get("created_at"),
            author_id,
            author_username: display.clone(),
            author_discriminator: author.get("discriminator"),
            author_avatar: icon.clone(),
            author_is_bot: false,
            author_verified: false,
            attachments: vec![],
            reactions: vec![],
            expires_at: None,
            poll_id: None,
        };
        state.broadcast_to_channel_members(target, serde_json::json!({
            "type": "MESSAGE_CREATE", "server_id": target_server, "message": full,
        }).to_string()).await;
    }
    Ok(Json(serde_json::json!({ "ok": true, "delivered": targets.len() })))
}
