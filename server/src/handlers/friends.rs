use axum::{extract::{Path, State}, Extension, Json};
use chrono::Utc;
use rand::Rng;
use serde::Deserialize;
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

    let limit: i64 = params.get("limit").and_then(|l| l.parse().ok()).unwrap_or(50).min(100).max(1);

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

// ─── Invitations amis par lien ───────────────────────────────────────────────

pub async fn create_friend_invite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    let code: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let expires_at = Utc::now() + chrono::Duration::days(7);

    sqlx::query(
        "INSERT INTO friend_invites (code, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(&code)
    .bind(claims.sub)
    .bind(expires_at)
    .execute(&state.db)
    .await?;

    let url = format!("{}/friend-invite/{}", "https://forgechat.heiphaistos.org", code);
    Ok(Json(serde_json::json!({ "code": code, "url": url })))
}

pub async fn get_friend_invite(
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let row = sqlx::query(
        "SELECT fi.user_id, fi.expires_at, fi.uses,
                u.username, u.discriminator, u.avatar, u.status
         FROM friend_invites fi
         JOIN users u ON u.id = fi.user_id
         WHERE fi.code=$1",
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invitation introuvable".into()))?;

    use sqlx::Row;
    let expires_at: Option<chrono::DateTime<Utc>> = row.get("expires_at");
    if let Some(exp) = expires_at {
        if exp < Utc::now() {
            return Err(AppError::BadRequest("Invitation expirée".into()));
        }
    }

    Ok(Json(serde_json::json!({
        "code": code,
        "user": {
            "id": row.get::<Uuid, _>("user_id"),
            "username": row.get::<String, _>("username"),
            "discriminator": row.get::<String, _>("discriminator"),
            "avatar": row.get::<Option<String>, _>("avatar"),
            "status": row.get::<String, _>("status"),
        }
    })))
}

pub async fn accept_friend_invite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(code): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let row = sqlx::query(
        "SELECT user_id, expires_at FROM friend_invites WHERE code=$1",
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Invitation introuvable".into()))?;

    use sqlx::Row;
    let inviter_id: Uuid = row.get("user_id");

    if inviter_id == claims.sub {
        return Err(AppError::BadRequest(
            "Tu ne peux pas accepter ta propre invitation".into(),
        ));
    }

    let expires_at: Option<chrono::DateTime<Utc>> = row.get("expires_at");
    if let Some(exp) = expires_at {
        if exp < Utc::now() {
            return Err(AppError::BadRequest("Invitation expirée".into()));
        }
    }

    let already = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE
         (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1))",
    )
    .bind(inviter_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !already {
        sqlx::query(
            "INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'accepted')",
        )
        .bind(inviter_id)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;

        sqlx::query("UPDATE friend_invites SET uses = uses + 1 WHERE code=$1")
            .bind(&code)
            .execute(&state.db)
            .await?;

        let event = serde_json::json!({ "type": "FRIEND_ACCEPTED", "user_id": claims.sub });
        state.broadcast_to_user(inviter_id, event.to_string()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
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

// ─── E2E Encrypted DM Messages ───────────────────────────────────────────────

pub async fn get_e2e_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !ok { return Err(AppError::Forbidden); }

    let limit: i64 = params.get("limit").and_then(|l| l.parse().ok()).unwrap_or(50).min(100).max(1);

    let messages = sqlx::query(
        "SELECT m.id, m.sender_id, m.ciphertext, m.created_at, u.username, u.avatar
         FROM dm_e2e_messages m JOIN users u ON u.id = m.sender_id
         WHERE m.dm_channel_id = $1
         ORDER BY m.created_at DESC LIMIT $2"
    )
    .bind(dm_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let mut result: Vec<serde_json::Value> = messages.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "sender_id": r.get::<Uuid, _>("sender_id"),
        "sender_username": r.get::<String, _>("username"),
        "sender_avatar": r.get::<Option<String>, _>("avatar"),
        "ciphertext": r.get::<String, _>("ciphertext"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "encrypted": true,
    })).collect();

    result.reverse();
    Ok(Json(result))
}

pub async fn send_e2e_message(
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

    let ciphertext = body["ciphertext"]
        .as_str()
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("ciphertext vide".into()))?;

    if ciphertext.len() > 64 * 1024 {
        return Err(AppError::BadRequest("Message trop volumineux (max 64KB ciphertext)".into()));
    }

    let msg = sqlx::query(
        "INSERT INTO dm_e2e_messages (dm_channel_id, sender_id, ciphertext) VALUES ($1, $2, $3) RETURNING id, created_at"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .bind(ciphertext)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let msg_id: Uuid = msg.get("id");
    let created_at = msg.get::<chrono::DateTime<chrono::Utc>, _>("created_at");

    // Récupérer les infos de l'expéditeur pour le broadcast
    let sender = sqlx::query("SELECT username, avatar FROM users WHERE id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
    let sender_username: String = sender.get("username");
    let sender_avatar: Option<String> = sender.get("avatar");

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
        "type": "DM_E2E_MESSAGE",
        "dm_id": dm_id,
        "message": {
            "id": msg_id,
            "sender_id": claims.sub,
            "sender_username": sender_username,
            "sender_avatar": sender_avatar,
            "ciphertext": ciphertext,
            "created_at": created_at,
            "encrypted": true,
        }
    });
    state.broadcast_to_user(other_id, event.to_string()).await;

    Ok(Json(serde_json::json!({
        "id": msg_id,
        "sender_id": claims.sub,
        "sender_username": sender_username,
        "sender_avatar": sender_avatar,
        "ciphertext": ciphertext,
        "created_at": created_at,
        "encrypted": true,
    })))
}

// ─── Invite Bulk (import contacts CSV) ──────────────────────────────────────

#[derive(Deserialize)]
pub struct InviteBulkBody {
    pub emails: Vec<String>,
    pub usernames: Vec<String>,
}

/// POST /api/friends/invite-bulk
/// Pour chaque username trouvé → envoi d'une demande d'ami.
/// Les emails ne font pas l'objet d'envoi (pas de système email).
/// Limite 50 contacts max par appel.
pub async fn invite_bulk(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<InviteBulkBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let total = body.emails.len() + body.usernames.len();
    if total > 50 {
        return Err(AppError::BadRequest(
            "Maximum 50 contacts par appel".into()
        ));
    }

    let mut sent: u32 = 0;
    let mut already_friends: u32 = 0;
    let mut not_found: Vec<String> = Vec::new();

    // Emails : aucune action (pas de système email), retour dans not_found
    for email in &body.emails {
        not_found.push(email.clone());
    }

    // Usernames : chercher en DB et envoyer une demande d'ami
    for raw in &body.usernames {
        let name = raw.trim().to_lowercase();
        if name.is_empty() {
            continue;
        }

        // Supporter le format user#discriminator
        let (username, discriminator) = if name.contains('#') {
            let mut parts = name.splitn(2, '#');
            (
                parts.next().unwrap_or("").to_string(),
                Some(parts.next().unwrap_or("").to_string()),
            )
        } else {
            (name.clone(), None)
        };

        let target_row = if let Some(ref disc) = discriminator {
            sqlx::query("SELECT id FROM users WHERE LOWER(username)=$1 AND discriminator=$2")
                .bind(&username)
                .bind(disc)
                .fetch_optional(&state.db)
                .await?
        } else {
            sqlx::query("SELECT id FROM users WHERE LOWER(username)=$1 LIMIT 1")
                .bind(&username)
                .fetch_optional(&state.db)
                .await?
        };

        let Some(row) = target_row else {
            not_found.push(raw.clone());
            continue;
        };

        let target_id: Uuid = row.get("id");

        if target_id == claims.sub {
            not_found.push(raw.clone());
            continue;
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
            already_friends += 1;
            continue;
        }

        sqlx::query(
            "INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending')
             ON CONFLICT DO NOTHING"
        )
        .bind(claims.sub)
        .bind(target_id)
        .execute(&state.db)
        .await?;

        // Notifier l'utilisateur cible
        let event = serde_json::json!({
            "type": "FRIEND_REQUEST",
            "from_id": claims.sub,
        });
        state.broadcast_to_user(target_id, event.to_string()).await;

        sent += 1;
    }

    Ok(Json(serde_json::json!({
        "sent": sent,
        "already_friends": already_friends,
        "not_found": not_found,
    })))
}
