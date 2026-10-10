use axum::{extract::{Path, Query, State}, Extension, Json};
use chrono::Utc;
use rand::Rng;
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::e2e_conv,
    middleware::auth::Claims,
    state::AppState,
};

/// Demande d'ami de `me` vers `target` : crée la demande, ou ACCEPTE celle que `target` avait
/// déjà envoyée (demandes croisées = amis, comme Discord). Avant, n'importe quelle ligne entre
/// les deux comptes (une demande restée en attente) renvoyait « Demande déjà existante ».
async fn request_or_accept(state: &AppState, me: Uuid, target: Uuid, message: Option<String>) -> Result<&'static str> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT id, user_id, status FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)"
    )
    .bind(me).bind(target).fetch_optional(&state.db).await?;
    let me_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
        .bind(me).fetch_optional(&state.db).await?.unwrap_or_default();
    match row {
        Some(r) if r.get::<String, _>("status") == "accepted" => Err(AppError::Conflict("Vous êtes déjà amis".into())),
        Some(r) if r.get::<Uuid, _>("user_id") == me => Err(AppError::Conflict("Demande déjà envoyée, en attente de sa réponse".into())),
        Some(r) => {
            sqlx::query("UPDATE friendships SET status='accepted', friend_since=NOW() WHERE id=$1")
                .bind(r.get::<Uuid, _>("id")).execute(&state.db).await?;
            let event = serde_json::json!({ "type": "FRIEND_ACCEPTED", "from_id": me, "from_username": me_name });
            state.broadcast_to_user(target, event.to_string()).await;
            Ok("accepted")
        }
        None => {
            sqlx::query("INSERT INTO friendships (user_id, friend_id, status, message) VALUES ($1, $2, 'pending', $3)")
                .bind(me).bind(target).bind(message).execute(&state.db).await?;
            let event = serde_json::json!({ "type": "FRIEND_REQUEST", "from_id": me, "from_username": me_name });
            state.broadcast_to_user(target, event.to_string()).await;
            Ok("sent")
        }
    }
}

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

    // Bloqué dans un sens ou l'autre -- jamais vérifié ici jusqu'ici (contrairement
    // aux DMs/messages qui checkent déjà `blocks` ailleurs dans ce fichier)
    let blocked = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM blocks WHERE
         (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))"
    )
    .bind(claims.sub)
    .bind(target_id)
    .fetch_one(&state.db)
    .await?;
    if blocked {
        return Err(AppError::Forbidden);
    }

    // Réglage de confidentialité du destinataire (`friend_request_from` dans
    // user_settings) -- jamais appliqué avant, un simple placebo côté UI.
    let pref: Option<String> = sqlx::query_scalar::<_, String>(
        "SELECT friend_request_from FROM user_settings WHERE user_id=$1"
    )
    .bind(target_id)
    .fetch_optional(&state.db)
    .await?;
    match pref.as_deref() {
        Some("nobody") => return Err(AppError::Forbidden),
        Some("friends_of_friends") => {
            let has_mutual = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(
                    SELECT 1 FROM friendships f1
                    JOIN friendships f2 ON
                        (CASE WHEN f1.user_id=$1 THEN f1.friend_id ELSE f1.user_id END) =
                        (CASE WHEN f2.user_id=$2 THEN f2.friend_id ELSE f2.user_id END)
                    WHERE (f1.user_id=$1 OR f1.friend_id=$1) AND f1.status='accepted'
                      AND (f2.user_id=$2 OR f2.friend_id=$2) AND f2.status='accepted'
                )"
            )
            .bind(claims.sub)
            .bind(target_id)
            .fetch_one(&state.db)
            .await?;
            if !has_mutual {
                return Err(AppError::Forbidden);
            }
        }
        _ => {}
    }

    let outcome = request_or_accept(&state, claims.sub, target_id, None).await?;
    Ok(Json(serde_json::json!({ "ok": true, "outcome": outcome })))
}

pub async fn accept_friend(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(friendship_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    // Récupère l'expéditeur original (user_id) pour le notifier
    let row = sqlx::query(
        "UPDATE friendships SET status='accepted', friend_since=NOW() WHERE id=$1 AND friend_id=$2 AND status='pending' RETURNING user_id"
    )
    .bind(friendship_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;

    let row = row.ok_or_else(|| AppError::NotFound("Demande d'ami introuvable".into()))?;
    let requester_id: Uuid = row.get("user_id");
    let accepter = sqlx::query("SELECT username FROM users WHERE id=$1")
        .bind(claims.sub).fetch_optional(&state.db).await?;
    let accepter_name: String = accepter.as_ref()
        .and_then(|r| r.try_get("username").ok())
        .unwrap_or_default();
    let event = serde_json::json!({
        "type": "FRIEND_ACCEPTED",
        "from_id": claims.sub,
        "from_username": accepter_name,
    });
    state.broadcast_to_user(requester_id, event.to_string()).await;

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

    // Notifier les deux parties pour mise à jour temps réel
    let event = serde_json::json!({
        "type": "FRIEND_REMOVED",
        "user_id": claims.sub,
    });
    state.broadcast_to_user(user_id, event.to_string()).await;
    state.broadcast_to_user(claims.sub, serde_json::json!({
        "type": "FRIEND_REMOVED",
        "user_id": user_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_dms(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    // Paralléliser la récupération des DMs 1:1 et Group DMs
    let (dms, group_dms) = tokio::try_join!(
        sqlx::query(
            "WITH last_msg AS (
               SELECT DISTINCT ON (dm_channel_id)
                 dm_channel_id, created_at AS last_message_at, LEFT(content, 80) AS last_message_content,
                 (enc IS NOT NULL) AS last_message_encrypted
               FROM dm_messages
               ORDER BY dm_channel_id, created_at DESC
             )
             SELECT dc.id,
               CASE WHEN dc.user1_id=$1 THEN dc.user2_id ELSE dc.user1_id END AS other_user_id,
               u.username, u.discriminator, u.avatar, u.status,
               lm.last_message_at, lm.last_message_content, COALESCE(lm.last_message_encrypted, FALSE) AS last_message_encrypted,
               (COALESCE(dus.muted, FALSE) AND (dus.muted_until IS NULL OR dus.muted_until > NOW())) AS is_muted,
               CASE WHEN dus.muted THEN dus.muted_until END AS muted_until,
               COALESCE(dus.pinned, FALSE) AS is_pinned,
               COALESCE(dus.archived, FALSE) AS is_archived
             FROM dm_channels dc
             JOIN users u ON u.id = CASE WHEN dc.user1_id=$1 THEN dc.user2_id ELSE dc.user1_id END
             LEFT JOIN last_msg lm ON lm.dm_channel_id = dc.id
             LEFT JOIN dm_user_settings dus ON dus.dm_channel_id = dc.id AND dus.user_id = $1
             WHERE (dc.user1_id=$1 OR dc.user2_id=$1)
               -- Fermée : masquée jusqu'au prochain message (ou réouverture par open_dm).
               AND (dus.closed_at IS NULL OR lm.last_message_at > dus.closed_at)
             ORDER BY COALESCE(lm.last_message_at, dc.created_at) DESC"
        )
        .bind(claims.sub)
        .fetch_all(&state.db),
        sqlx::query(
            "WITH last_gdm AS (
               SELECT DISTINCT ON (m.dm_id)
                 m.dm_id, m.created_at AS last_message_at,
                 LEFT(m.content, 80) AS last_message_content,
                 (m.enc IS NOT NULL) AS last_message_encrypted,
                 u.username AS last_message_author
               FROM group_dm_messages m
               LEFT JOIN users u ON u.id = m.sender_id
               ORDER BY m.dm_id, m.created_at DESC
             ),
             member_counts AS (
               SELECT dm_id, COUNT(*) AS cnt FROM group_dm_members GROUP BY dm_id
             )
             SELECT g.id, g.name, mc.cnt AS member_count, lgm.last_message_at, lgm.last_message_content, lgm.last_message_author,
                    COALESCE(lgm.last_message_encrypted, FALSE) AS last_message_encrypted,
                    (COALESCE(dus.muted, FALSE) AND (dus.muted_until IS NULL OR dus.muted_until > NOW())) AS is_muted,
                    CASE WHEN dus.muted THEN dus.muted_until END AS muted_until,
                    COALESCE(dus.pinned, FALSE) AS is_pinned,
                    COALESCE(dus.archived, FALSE) AS is_archived
             FROM group_dm_channels g
             JOIN group_dm_members gm ON gm.dm_id = g.id AND gm.user_id = $1
             LEFT JOIN last_gdm lgm ON lgm.dm_id = g.id
             LEFT JOIN member_counts mc ON mc.dm_id = g.id
             LEFT JOIN dm_user_settings dus ON dus.dm_channel_id = g.id AND dus.user_id = $1
             WHERE dus.closed_at IS NULL OR lgm.last_message_at > dus.closed_at
             ORDER BY COALESCE(lgm.last_message_at, g.created_at) DESC"
        )
        .bind(claims.sub)
        .fetch_all(&state.db),
    )?;

    let mut result: Vec<serde_json::Value> = dms.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "other_user_id": r.get::<Uuid, _>("other_user_id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
        "last_message_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_message_at"),
        "last_message_content": r.get::<Option<String>, _>("last_message_content"),
        "last_message_encrypted": r.get::<bool, _>("last_message_encrypted"),
        "is_muted": r.get::<bool, _>("is_muted"),
        "muted_until": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("muted_until"),
        "is_pinned": r.get::<bool, _>("is_pinned"),
        "is_archived": r.get::<bool, _>("is_archived"),
        "is_group": false,
    })).collect();

    for r in &group_dms {
        result.push(serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "member_count": r.get::<Option<i64>, _>("member_count").unwrap_or(0),
            "last_message_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("last_message_at"),
            "last_message_content": r.get::<Option<String>, _>("last_message_content"),
            "last_message_author": r.get::<Option<String>, _>("last_message_author"),
            "last_message_encrypted": r.get::<bool, _>("last_message_encrypted"),
            "is_muted": r.get::<bool, _>("is_muted"),
            "muted_until": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("muted_until"),
            "is_pinned": r.get::<bool, _>("is_pinned"),
            "is_archived": r.get::<bool, _>("is_archived"),
            "is_group": true,
        }));
    }

    // Trier par last_message_at desc (null dernier)
    result.sort_by(|a, b| {
        let ta = a["last_message_at"].as_str();
        let tb = b["last_message_at"].as_str();
        tb.cmp(&ta)
    });

    Ok(Json(result))
}

pub async fn open_dm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    if user_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de s'envoyer un DM à soi-même".into()));
    }

    // Même pattern que send_friend_request : ni le blocage ni le réglage de
    // confidentialité `dm_from_all` du destinataire n'étaient jamais vérifiés ici --
    // n'importe qui pouvait ouvrir un salon DM avec n'importe qui, y compris un
    // utilisateur l'ayant bloqué ou ayant explicitement désactivé "Autoriser les DMs
    // de tout le monde" dans PrivacySection.tsx (réglage 100% placebo côté serveur).
    let blocked = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM blocks WHERE
         (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))"
    )
    .bind(claims.sub)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if blocked {
        return Err(AppError::Forbidden);
    }

    let dm_from_all: bool = sqlx::query_scalar("SELECT dm_from_all FROM user_settings WHERE user_id=$1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .unwrap_or(true);
    if !dm_from_all {
        let is_friend: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted')"
        )
        .bind(claims.sub)
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        if !is_friend {
            return Err(AppError::Forbidden);
        }
    }

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
    let dm_id: Uuid = dm.get("id");
    // Ouvrir une conversation fermée la remet dans la liste.
    sqlx::query("UPDATE dm_user_settings SET closed_at = NULL WHERE user_id=$1 AND dm_channel_id=$2 AND closed_at IS NOT NULL")
        .bind(claims.sub)
        .bind(dm_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "dm_id": dm_id })))
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
    let before: Option<Uuid> = params.get("before").and_then(|s| s.parse().ok());
    let around: Option<Uuid> = params.get("around").and_then(|s| s.parse().ok());
    // Voir messages.rs::get_messages -- la branche `around` construit déjà son
    // résultat en ordre chronologique croissant, le `.reverse()` final ne doit
    // s'appliquer qu'aux autres branches.
    let is_around = around.is_some();

    let messages = if let Some(around_id) = around {
        let ts: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT created_at FROM dm_messages WHERE id=$1 AND dm_channel_id=$2"
        )
        .bind(around_id).bind(dm_id)
        .fetch_optional(&state.db).await?;

        let ts = ts.ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;
        let half = limit / 2;

        let mut before_rows = sqlx::query(
            "SELECT dm.*, u.username, u.avatar, u.avatar_decoration FROM dm_messages dm
             JOIN users u ON u.id = dm.sender_id
             WHERE dm.dm_channel_id=$1 AND (dm.created_at, dm.id) < ($2, $4)
             ORDER BY dm.created_at DESC, dm.id DESC LIMIT $3"
        )
        .bind(dm_id).bind(ts).bind(half).bind(around_id)
        .fetch_all(&state.db).await?;

        let after_rows = sqlx::query(
            "SELECT dm.*, u.username, u.avatar, u.avatar_decoration FROM dm_messages dm
             JOIN users u ON u.id = dm.sender_id
             WHERE dm.dm_channel_id=$1 AND (dm.created_at, dm.id) >= ($2, $4)
             ORDER BY dm.created_at ASC, dm.id ASC LIMIT $3"
        )
        .bind(dm_id).bind(ts).bind(limit - half + 1).bind(around_id)
        .fetch_all(&state.db).await?;

        before_rows.reverse();
        before_rows.extend(after_rows);
        before_rows
    } else if let Some(before_id) = before {
        sqlx::query(
            "SELECT dm.*, u.username, u.avatar, u.avatar_decoration FROM dm_messages dm
             JOIN users u ON u.id = dm.sender_id
             WHERE dm.dm_channel_id=$1
               AND (dm.created_at, dm.id) < (SELECT created_at, id FROM dm_messages WHERE id=$3 AND dm_channel_id=$1)
             ORDER BY dm.created_at DESC, dm.id DESC LIMIT $2"
        )
        .bind(dm_id)
        .bind(limit)
        .bind(before_id)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query(
            "SELECT dm.*, u.username, u.avatar, u.avatar_decoration FROM dm_messages dm
             JOIN users u ON u.id = dm.sender_id
             WHERE dm.dm_channel_id=$1
             ORDER BY dm.created_at DESC, dm.id DESC LIMIT $2"
        )
        .bind(dm_id)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    use sqlx::Row;
    let msg_ids: Vec<Uuid> = messages.iter().map(|r| r.get::<Uuid, _>("id")).collect();

    // Collect reply_to IDs before the parallel fetch
    let reply_ids: Vec<Uuid> = messages.iter()
        .filter_map(|r| r.get::<Option<Uuid>, _>("reply_to_id"))
        .collect();

    // Paralléliser attachments + reactions (queries indépendantes)
    let (attachments_rows, reactions_rows) = if msg_ids.is_empty() {
        (vec![], vec![])
    } else {
        let (att, react) = tokio::join!(
            sqlx::query(
                "SELECT id, dm_message_id, filename, content_type, size, url, expires_at
                 FROM attachments WHERE dm_message_id = ANY($1)"
            )
            .bind(&msg_ids)
            .fetch_all(&state.db),
            sqlx::query(
                "SELECT dm_message_id, emoji, COUNT(*) as count, bool_or(user_id=$2) as me
                 FROM dm_reactions WHERE dm_message_id = ANY($1)
                 GROUP BY dm_message_id, emoji"
            )
            .bind(&msg_ids)
            .bind(claims.sub)
            .fetch_all(&state.db),
        );
        (att.unwrap_or_default(), react.unwrap_or_default())
    };

    let reply_rows = if reply_ids.is_empty() {
        vec![]
    } else {
        sqlx::query(
            "SELECT dm.id, dm.content, dm.enc, dm.client_msg_id, dm.sender_id, u.username as sender_username
             FROM dm_messages dm JOIN users u ON u.id = dm.sender_id
             WHERE dm.id = ANY($1) AND dm.dm_channel_id = $2"
        )
        .bind(&reply_ids)
        .bind(dm_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    // Group by message id
    let mut att_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for a in &attachments_rows {
        let mid = a.get::<Uuid, _>("dm_message_id");
        att_map.entry(mid).or_default().push(serde_json::json!({
            "id": a.get::<Uuid, _>("id"),
            "filename": a.get::<String, _>("filename"),
            "content_type": a.get::<String, _>("content_type"),
            "size": a.get::<i64, _>("size"),
            "url": crate::upload_sign::sign_url(&a.get::<String, _>("url")),
            "expires_at": a.get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at"),
        }));
    }

    let mut react_map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &reactions_rows {
        let mid = r.get::<Uuid, _>("dm_message_id");
        react_map.entry(mid).or_default().push(serde_json::json!({
            "emoji": r.get::<String, _>("emoji"),
            "count": r.get::<i64, _>("count"),
            "me": r.get::<bool, _>("me"),
        }));
    }

    let mut reply_ctx_map: std::collections::HashMap<Uuid, serde_json::Value> = std::collections::HashMap::new();
    for r in &reply_rows {
        let id = r.get::<Uuid, _>("id");
        reply_ctx_map.insert(id, serde_json::json!({
            "id": id,
            "content": r.get::<Option<String>, _>("content"),
            "enc": r.get::<Option<serde_json::Value>, _>("enc"),
            "client_msg_id": r.get::<Option<Uuid>, _>("client_msg_id"),
            "sender_id": r.get::<Uuid, _>("sender_id"),
            "sender_username": r.get::<String, _>("sender_username"),
        }));
    }

    let mut result: Vec<serde_json::Value> = messages.iter().map(|r| {
        let id = r.get::<Uuid, _>("id");
        let reply_to_id = r.get::<Option<Uuid>, _>("reply_to_id");
        serde_json::json!({
            "id": id,
            "content": r.get::<Option<String>, _>("content"),
            "enc": r.get::<Option<serde_json::Value>, _>("enc"),
            "client_msg_id": r.get::<Option<Uuid>, _>("client_msg_id"),
            "purged": r.get::<bool, _>("purged"),
            "expires_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at"),
            "expire_on_read": r.get::<bool, _>("expire_on_read"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "sender_id": r.get::<Uuid, _>("sender_id"),
            "sender_username": r.get::<String, _>("username"),
            "sender_avatar": r.get::<Option<String>, _>("avatar"),
            "sender_avatar_decoration": r.get::<Option<String>, _>("avatar_decoration"),
            "edited_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("edited_at"),
            "reply_to_id": reply_to_id,
            "reply_to": reply_to_id.and_then(|rid| reply_ctx_map.get(&rid)).cloned(),
            "attachments": att_map.get(&id).cloned().unwrap_or_default(),
            "reactions": react_map.get(&id).cloned().unwrap_or_default(),
        })
    }).collect();

    if !is_around {
        result.reverse();
    }
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

    // Un lien d'invitation d'ami est un code public partageable (URL) -- contrairement
    // à send_friend_request (envoyée à une personne précise), l'inviteur ne choisit pas
    // QUI clique dessus. Sans ce check, un utilisateur bloqué par l'inviteur pouvait
    // quand même forcer l'amitié en visitant le lien (blocks n'était jamais consulté ici).
    let blocked = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM blocks WHERE
         (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))"
    )
    .bind(inviter_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if blocked {
        return Err(AppError::Forbidden);
    }

    let already = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE
         (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1))",
    )
    .bind(inviter_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    // Une demande restée en attente entre les deux comptes devient l'amitié : avant, le lien
    // répondait « ok » sans rien faire et on se croyait déjà amis.
    let upgraded = already && sqlx::query(
        "UPDATE friendships SET status='accepted', friend_since=NOW() WHERE status='pending' AND
         ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1))",
    )
    .bind(inviter_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?
    .rows_affected() > 0;

    if !already || upgraded {
        if !already {
            sqlx::query(
                "INSERT INTO friendships (user_id, friend_id, status, friend_since) VALUES ($1, $2, 'accepted', NOW())",
            )
            .bind(inviter_id)
            .bind(claims.sub)
            .execute(&state.db)
            .await?;
        }

        sqlx::query("UPDATE friend_invites SET uses = uses + 1 WHERE code=$1")
            .bind(&code)
            .execute(&state.db)
            .await?;

        let from_username: Option<String> = sqlx::query_scalar("SELECT username FROM users WHERE id=$1")
            .bind(claims.sub).fetch_optional(&state.db).await?;
        let event = serde_json::json!({ "type": "FRIEND_ACCEPTED", "from_id": claims.sub, "from_username": from_username });
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

    // Vérifier que le destinataire n'a pas bloqué l'expéditeur
    {
        use sqlx::Row;
        let other_id: Option<Uuid> = sqlx::query(
            "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END AS other
             FROM dm_channels WHERE id=$1"
        )
        .bind(dm_id).bind(claims.sub)
        .fetch_optional(&state.db).await?
        .map(|r| r.get("other"));
        if let Some(oid) = other_id {
            let blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2)"
            ).bind(oid).bind(claims.sub).fetch_one(&state.db).await.unwrap_or(false);
            if blocked { return Err(AppError::Forbidden); }
        }
    }

    // Anti-spam DM : max 5 messages / 3 secondes via Redis
    {
        use redis::AsyncCommands;
        let key = format!("dm_spam:{}:{}", claims.sub, dm_id);
        let mut redis = state.redis.lock().await;
        let count: i64 = redis.incr(&key, 1).await.unwrap_or(0);
        if count == 1 {
            let _: () = redis.expire(&key, 3).await.unwrap_or(());
        }
        if count > 5 {
            return Err(AppError::TooManyRequests);
        }
    }

    let content_raw = body["content"].as_str().unwrap_or("").trim().to_string();
    let mut reply_to: Option<Uuid> = body["reply_to"].as_str().and_then(|s| s.parse().ok());
    // Une réponse ne peut citer qu'un message de CETTE conversation : sinon
    // l'aperçu de réponse renvoyait le contenu du message privé de n'importe qui.
    if let Some(rid) = reply_to {
        let same_dm: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM dm_messages WHERE id=$1 AND dm_channel_id=$2)"
        ).bind(rid).bind(dm_id).fetch_one(&state.db).await?;
        if !same_dm { reply_to = None; }
    }
    let has_attachments = body["has_attachments"].as_bool().unwrap_or(false);

    // Chiffrement de bout en bout obligatoire : `enc` remplace `content`, le clair est refusé.
    let conv = e2e_conv::Conv::Dm(dm_id);
    let enc = e2e_conv::check_message(&state.db, conv, !content_raw.is_empty(), body.get("enc")).await?;
    let client_msg_id = e2e_conv::parse_client_msg_id(&body["client_msg_id"]);
    if enc.is_some() && client_msg_id.is_none() {
        return Err(AppError::BadRequest("client_msg_id requis".into()));
    }
    let enc_json = enc.as_ref().map(e2e_conv::Enc::to_json);

    if content_raw.is_empty() && !has_attachments && enc.is_none() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    if content_raw.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }

    let content = content_raw.clone();

    let content_opt: Option<&str> = if content.is_empty() { None } else { Some(content.as_str()) };
    // Messages éphémères : réglage de la conversation, imposé par le serveur.
    let (expires_at, expire_on_read) = crate::handlers::disappearing::expiry(
        crate::handlers::disappearing::setting(&state.db, conv).await?,
        chrono::Utc::now(),
    );
    let msg = sqlx::query(
        "INSERT INTO dm_messages (dm_channel_id, sender_id, content, reply_to_id, enc, client_msg_id, expires_at, expire_on_read)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .bind(content_opt)
    .bind(reply_to)
    .bind(&enc_json)
    .bind(client_msg_id)
    .bind(expires_at)
    .bind(expire_on_read)
    .fetch_one(&state.db)
    .await?;
    crate::handlers::badges::count_message(&state, claims.sub);

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
    let created_at = msg.get::<chrono::DateTime<chrono::Utc>, _>("created_at");

    // Récupérer username + avatar du sender pour la payload WS
    let sender_info = sqlx::query(
        "SELECT username, avatar, avatar_decoration FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let sender_decoration: Option<String> = sender_info.as_ref().and_then(|r| r.get("avatar_decoration"));
    let (sender_username, sender_avatar) = sender_info.as_ref().map(|r| {
        (r.get::<String, _>("username"), r.get::<Option<String>, _>("avatar"))
    }).unwrap_or_else(|| (String::new(), None));

    // Récupérer le contexte du message auquel on répond si applicable
    let reply_ctx = if let Some(rid) = reply_to {
        sqlx::query(
            "SELECT dm.id, dm.content, dm.enc, dm.client_msg_id, dm.sender_id, u.username as sender_username
             FROM dm_messages dm JOIN users u ON u.id = dm.sender_id WHERE dm.id=$1"
        )
        .bind(rid)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .map(|r| serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "content": r.get::<Option<String>, _>("content"),
            "enc": r.get::<Option<serde_json::Value>, _>("enc"),
            "client_msg_id": r.get::<Option<Uuid>, _>("client_msg_id"),
            "sender_id": r.get::<Uuid, _>("sender_id"),
            "sender_username": r.get::<String, _>("sender_username"),
        }))
    } else {
        None
    };

    let pending_att = has_attachments && content.is_empty() && enc.is_none();
    let event = serde_json::json!({
        "type": "DM_MESSAGE",
        "dm_id": dm_id,
        "pending_attachments": pending_att,
        "message": {
            "id": msg_id,
            "content": if content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(content.clone()) },
            "enc": enc_json,
            "client_msg_id": client_msg_id,
            "sender_id": claims.sub,
            "sender_username": sender_username,
            "sender_avatar": sender_avatar,
            "sender_avatar_decoration": sender_decoration,
            "reply_to_id": reply_to,
            "reply_to": reply_ctx,
            "created_at": created_at,
            "expires_at": expires_at,
            "expire_on_read": expire_on_read,
        }
    });
    let event_str = event.to_string();
    state.broadcast_to_user(other_id, event_str.clone()).await;
    // Sync multi-onglets/appareils : notifier aussi le sender lui-même
    state.broadcast_to_user(claims.sub, event_str).await;
    // Destinataire sans aucune session ouverte : Web Push.
    // Message chiffré : le serveur ne connaît pas le texte (aperçu déchiffré sur l'appareil).
    let text: String = if enc.is_some() {
        "Message chiffré".to_string()
    } else if content.is_empty() {
        "Pièce jointe".to_string()
    } else {
        content.chars().take(200).collect()
    };
    let mobile = crate::mobile_push::Notice::new(
        sender_username.clone(),
        &text,
        "Nouveau message privé",
        crate::mobile_push::Target::Dm(dm_id),
    ).with_message(msg_id);
    crate::notify::push_direct(&state, vec![other_id], Some(dm_id), serde_json::json!({
        "title": sender_username,
        "body": text,
        "url": format!("/dms/{dm_id}"),
        "tag": dm_id,
    }), mobile);

    Ok(Json(serde_json::json!({
        "id": msg_id,
        "content": if content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(content) },
        "enc": enc_json,
        "client_msg_id": client_msg_id,
        "reply_to_id": reply_to,
        "reply_to": reply_ctx,
        "created_at": created_at,
        "expires_at": expires_at,
        "expire_on_read": expire_on_read,
        "attachments": [],
        "reactions": [],
    })))
}

pub async fn upload_dm_attachment(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !ok { return Err(AppError::Forbidden); }

    let msg_enc: bool = sqlx::query_scalar::<_, bool>(
        "SELECT enc IS NOT NULL FROM dm_messages WHERE id=$1 AND dm_channel_id=$2 AND sender_id=$3"
    )
    .bind(message_id).bind(dm_id).bind(claims.sub).fetch_optional(&state.db).await?
    .ok_or(AppError::Forbidden)?;

    // Fichiers chiffrés si le message l'est ; en clair refusés dès que les deux ont une clé.
    let encrypted = crate::handlers::uploads::conv_file_mode(&state, msg_enc, e2e_conv::Conv::Dm(dm_id)).await?;
    let uploaded = crate::handlers::uploads::store_attachments(
        &state, &mut multipart, false, crate::handlers::uploads::AttachmentOwner::DmMessage(message_id), claims.sub, encrypted,
    ).await?;

    // Notifier l'autre utilisateur
    if !uploaded.is_empty() {
        let other = sqlx::query_scalar::<_, Uuid>(
            "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END FROM dm_channels WHERE id=$1"
        ).bind(dm_id).bind(claims.sub).fetch_optional(&state.db).await?.unwrap_or(claims.sub);

        let event = serde_json::json!({
            "type": "DM_ATTACHMENT_ADDED",
            "dm_id": dm_id,
            "message_id": message_id,
            "attachments": uploaded,
        });
        let att_event = event.to_string();
        state.broadcast_to_user(other, att_event.clone()).await;
        // Sync multi-onglets sender
        state.broadcast_to_user(claims.sub, att_event).await;
    }

    Ok(Json(uploaded))
}

// ─── Friends Ultra ─────────────────────────────────────────────────────────────

/// GET /friends/v2?filter=all|online|pending|blocked&q=search
pub async fn get_friends_v2(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let filter = params.get("filter").map(|s| s.as_str()).unwrap_or("all");
    let q = params.get("q").cloned().unwrap_or_default().to_lowercase();

    let friends = sqlx::query(
        "SELECT f.id, CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END as friend_id, f.user_id as initiator_id, f.status,
                f.message, f.created_at as requested_at, f.friend_since,
                u.username, u.discriminator, u.avatar, u.status as user_status,
                u.custom_status, u.activity_type, u.activity_name,
                fn2.nickname as custom_nickname,
                EXISTS(SELECT 1 FROM friend_online_notifs fon WHERE fon.user_id=$1 AND fon.target_id=u.id) as notify_online
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END
         LEFT JOIN friend_nicknames fn2 ON fn2.user_id=$1 AND fn2.target_id=u.id
         WHERE f.user_id=$1 OR f.friend_id=$1
         ORDER BY u.username"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let all_accepted = friends.iter().filter(|r| r.get::<String, _>("status") == "accepted").count() as i64;
    let all_online = friends.iter().filter(|r| {
        r.get::<String, _>("status") == "accepted" && r.get::<String, _>("user_status") == "online"
    }).count() as i64;
    let pending_total = friends.iter().filter(|r| r.get::<String, _>("status") == "pending").count() as i64;
    let pending_received = friends.iter().filter(|r| {
        r.get::<String, _>("status") == "pending" && r.get::<Uuid, _>("initiator_id") != claims.sub
    }).count() as i64;

    let mut result: Vec<serde_json::Value> = friends.iter()
        .filter(|r| {
            let status: String = r.get("status");
            let username: String = r.get("username");
            let initiator_id: Uuid = r.get("initiator_id");
            let user_status: String = r.get("user_status");

            let pass_filter = match filter {
                "online" => status == "accepted" && user_status == "online",
                "pending" => status == "pending",
                "pending_sent" => status == "pending" && initiator_id == claims.sub,
                "pending_received" => status == "pending" && initiator_id != claims.sub,
                _ => status == "accepted",
            };
            let pass_search = q.is_empty() || username.to_lowercase().contains(&q);
            pass_filter && pass_search
        })
        .map(|r| {
            let initiator_id: Uuid = r.get("initiator_id");
            let status: String = r.get("status");
            let direction = if status == "pending" {
                if initiator_id == claims.sub { "sent" } else { "received" }
            } else { "accepted" };
            serde_json::json!({
                "id": r.get::<Uuid, _>("id"),
                "friend_id": r.get::<Uuid, _>("friend_id"),
                "status": status,
                "direction": direction,
                "message": r.get::<Option<String>, _>("message"),
                "friend_since": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("friend_since"),
                "requested_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("requested_at"),
                "username": r.get::<String, _>("username"),
                "discriminator": r.get::<String, _>("discriminator"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "user_status": r.get::<String, _>("user_status"),
                "custom_status": r.get::<Option<String>, _>("custom_status"),
                // Demande en attente = pas encore ami : pas d'activité (enrich_friends
                // la recalcule selon la visibilité pour les amis acceptés).
                "activity_type": if direction == "accepted" { r.get::<Option<String>, _>("activity_type") } else { None },
                "activity_name": if direction == "accepted" { r.get::<Option<String>, _>("activity_name") } else { None },
                "custom_nickname": r.get::<Option<String>, _>("custom_nickname"),
                "notify_online": r.get::<bool, _>("notify_online"),
            })
        })
        .collect();
    crate::handlers::social::enrich_friends(&state, claims.sub, &mut result).await;

    // Bloqués gérés séparément
    if filter == "blocked" {
        let blocked = sqlx::query(
            "SELECT b.blocked_id, u.username, u.discriminator, u.avatar
             FROM blocks b JOIN users u ON u.id = b.blocked_id
             WHERE b.blocker_id=$1 ORDER BY u.username"
        )
        .bind(claims.sub).fetch_all(&state.db).await?;

        result = blocked.iter().map(|r| serde_json::json!({
            "id": r.get::<Uuid, _>("blocked_id"),
            "friend_id": r.get::<Uuid, _>("blocked_id"),
            "status": "blocked",
            "direction": "blocked",
            "username": r.get::<String, _>("username"),
            "discriminator": r.get::<String, _>("discriminator"),
            "avatar": r.get::<Option<String>, _>("avatar"),
            "user_status": "offline",
        })).collect();
    }

    Ok(Json(serde_json::json!({
        "friends": result,
        "counts": {
            "all": all_accepted,
            "online": all_online,
            "pending": pending_total,
            "pending_received": pending_received,
        }
    })))
}

/// POST /friends/by-name { name: "user#1234", message? }
#[derive(serde::Deserialize)]
pub struct AddByNameBody {
    pub name: String,
    pub message: Option<String>,
}

pub async fn send_friend_by_name(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<AddByNameBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let name = body.name.trim().to_string();
    let (username, discriminator) = if name.contains('#') {
        let parts: Vec<&str> = name.splitn(2, '#').collect();
        (parts[0].to_lowercase(), Some(parts[1].to_string()))
    } else {
        (name.to_lowercase(), None)
    };

    let target = if let Some(disc) = discriminator {
        sqlx::query("SELECT id FROM users WHERE LOWER(username)=$1 AND discriminator=$2")
            .bind(&username).bind(&disc).fetch_optional(&state.db).await?
    } else {
        sqlx::query("SELECT id FROM users WHERE LOWER(username)=$1 LIMIT 1")
            .bind(&username).fetch_optional(&state.db).await?
    };

    let target = target.ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;
    let target_id: Uuid = target.get("id");

    if target_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de s'ajouter soi-même".into()));
    }

    let msg = body.message.as_deref().unwrap_or("").chars().take(256).collect::<String>();
    let outcome = request_or_accept(&state, claims.sub, target_id, if msg.is_empty() { None } else { Some(msg) }).await?;
    Ok(Json(serde_json::json!({ "ok": true, "user_id": target_id, "outcome": outcome })))
}

/// DELETE /friends/:id/cancel — annuler une demande envoyée
pub async fn cancel_friend_request(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(friendship_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM friendships WHERE id=$1 AND user_id=$2 AND status='pending'")
        .bind(friendship_id).bind(claims.sub).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /friends/:id/nickname
pub async fn get_friend_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT nickname FROM friend_nicknames WHERE user_id=$1 AND target_id=$2"
    ).bind(claims.sub).bind(target_id).fetch_optional(&state.db).await?;
    let nickname = row.map(|r| r.get::<String, _>("nickname")).unwrap_or_default();
    Ok(Json(serde_json::json!({ "nickname": nickname })))
}

/// PUT /friends/:id/nickname { nickname }
#[derive(serde::Deserialize)]
pub struct NicknameBody { pub nickname: String }

pub async fn set_friend_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<NicknameBody>,
) -> Result<Json<serde_json::Value>> {
    let nickname = body.nickname.trim().chars().take(64).collect::<String>();
    if nickname.is_empty() {
        sqlx::query("DELETE FROM friend_nicknames WHERE user_id=$1 AND target_id=$2")
            .bind(claims.sub).bind(target_id).execute(&state.db).await?;
    } else {
        sqlx::query(
            "INSERT INTO friend_nicknames (user_id, target_id, nickname, updated_at) VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, target_id) DO UPDATE SET nickname=EXCLUDED.nickname, updated_at=NOW()"
        ).bind(claims.sub).bind(target_id).bind(&nickname).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /friends/groups
pub async fn list_friend_groups(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let groups = sqlx::query(
        "SELECT fg.id, fg.name, fg.color, fg.position,
                COALESCE(ARRAY_AGG(fgm.user_id::text) FILTER (WHERE fgm.user_id IS NOT NULL), '{}') as member_ids
         FROM friend_groups fg
         LEFT JOIN friend_group_members fgm ON fgm.group_id = fg.id
         WHERE fg.user_id=$1
         GROUP BY fg.id ORDER BY fg.position, fg.name"
    ).bind(claims.sub).fetch_all(&state.db).await?;

    let result = groups.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "color": r.get::<Option<String>, _>("color"),
        "position": r.get::<i32, _>("position"),
        "member_ids": r.get::<Vec<String>, _>("member_ids"),
    })).collect();
    Ok(Json(result))
}

/// POST /friends/groups { name, color? }
#[derive(serde::Deserialize)]
pub struct GroupBody { pub name: String, pub color: Option<String> }

pub async fn create_friend_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<GroupBody>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let name = body.name.trim().chars().take(64).collect::<String>();
    if name.is_empty() { return Err(AppError::BadRequest("Nom requis".into())); }
    if !body.color.as_deref().is_none_or(crate::handlers::social::valid_group_color) {
        return Err(AppError::BadRequest("Couleur invalide (#RRGGBB)".into()));
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM friend_groups WHERE user_id=$1")
        .bind(claims.sub).fetch_one(&state.db).await?;
    if count >= 20 { return Err(AppError::BadRequest("Maximum 20 groupes".into())); }

    let row = sqlx::query(
        "INSERT INTO friend_groups (user_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id"
    ).bind(claims.sub).bind(&name).bind(&body.color).bind(count as i32)
     .fetch_one(&state.db).await?;

    Ok(Json(serde_json::json!({ "id": row.get::<Uuid, _>("id"), "name": name })))
}

/// PUT /friends/groups/:id { name?, color?, position? }
#[derive(serde::Deserialize)]
pub struct GroupUpdateBody { pub name: Option<String>, pub color: Option<String>, pub position: Option<i32> }

pub async fn update_friend_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<GroupUpdateBody>,
) -> Result<Json<serde_json::Value>> {
    if body.name.as_deref().is_some_and(|n| n.trim().is_empty()) {
        return Err(AppError::BadRequest("Nom requis".into()));
    }
    if !body.color.as_deref().is_none_or(crate::handlers::social::valid_group_color) {
        return Err(AppError::BadRequest("Couleur invalide (#RRGGBB)".into()));
    }
    if let Some(ref name) = body.name {
        sqlx::query("UPDATE friend_groups SET name=$1 WHERE id=$2 AND user_id=$3")
            .bind(name.trim().chars().take(64).collect::<String>())
            .bind(group_id).bind(claims.sub).execute(&state.db).await?;
    }
    if let Some(ref color) = body.color {
        sqlx::query("UPDATE friend_groups SET color=$1 WHERE id=$2 AND user_id=$3")
            .bind(color).bind(group_id).bind(claims.sub).execute(&state.db).await?;
    }
    if let Some(pos) = body.position {
        sqlx::query("UPDATE friend_groups SET position=$1 WHERE id=$2 AND user_id=$3")
            .bind(pos).bind(group_id).bind(claims.sub).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// DELETE /friends/groups/:id
pub async fn delete_friend_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM friend_groups WHERE id=$1 AND user_id=$2")
        .bind(group_id).bind(claims.sub).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// POST /friends/groups/:id/members { user_id }
#[derive(serde::Deserialize)]
pub struct GroupMemberBody { pub user_id: Uuid }

pub async fn add_to_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(group_id): Path<Uuid>,
    Json(body): Json<GroupMemberBody>,
) -> Result<Json<serde_json::Value>> {
    let owns = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friend_groups WHERE id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !owns { return Err(AppError::Forbidden); }

    let is_friend: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted')"
    ).bind(claims.sub).bind(body.user_id).fetch_one(&state.db).await?;
    if !is_friend { return Err(AppError::Forbidden); }

    sqlx::query(
        "INSERT INTO friend_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    ).bind(group_id).bind(body.user_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// DELETE /friends/groups/:id/members/:user_id
pub async fn remove_from_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    let owns = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM friend_groups WHERE id=$1 AND user_id=$2)"
    ).bind(group_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !owns { return Err(AppError::Forbidden); }

    sqlx::query("DELETE FROM friend_group_members WHERE group_id=$1 AND user_id=$2")
        .bind(group_id).bind(user_id).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// PUT /friends/:id/notify { enabled: bool }
#[derive(serde::Deserialize)]
pub struct NotifyBody { pub enabled: bool }

pub async fn set_online_notify(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<NotifyBody>,
) -> Result<Json<serde_json::Value>> {
    let is_friend: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM friendships WHERE ((user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)) AND status='accepted')"
    ).bind(claims.sub).bind(target_id).fetch_one(&state.db).await?;
    if !is_friend { return Err(AppError::Forbidden); }

    if body.enabled {
        sqlx::query(
            "INSERT INTO friend_online_notifs (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
        ).bind(claims.sub).bind(target_id).execute(&state.db).await?;
    } else {
        sqlx::query("DELETE FROM friend_online_notifs WHERE user_id=$1 AND target_id=$2")
            .bind(claims.sub).bind(target_id).execute(&state.db).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /friends/suggestions
pub async fn get_friend_suggestions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let suggestions = sqlx::query(
        "WITH my_friends AS (
            SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END as fid
            FROM friendships WHERE (user_id=$1 OR friend_id=$1) AND status='accepted'
         ),
         mutual_friends AS (
            SELECT CASE WHEN f.user_id IN (SELECT fid FROM my_friends) THEN f.friend_id ELSE f.user_id END as candidate,
                   COUNT(*) as mutual_count
            FROM friendships f
            WHERE (f.user_id IN (SELECT fid FROM my_friends) OR f.friend_id IN (SELECT fid FROM my_friends))
              AND f.status='accepted'
              AND f.user_id != $1 AND f.friend_id != $1
            GROUP BY candidate
         ),
         mutual_servers AS (
            SELECT sm2.user_id as candidate, COUNT(*) as server_count
            FROM server_members sm1
            JOIN server_members sm2 ON sm1.server_id = sm2.server_id AND sm2.user_id != $1
            WHERE sm1.user_id = $1
            GROUP BY sm2.user_id
         ),
         existing AS (
            SELECT CASE WHEN user_id=$1 THEN friend_id ELSE user_id END as uid
            FROM friendships WHERE user_id=$1 OR friend_id=$1
         )
         SELECT u.id, u.username, u.discriminator, u.avatar, u.status,
                COALESCE(mf.mutual_count, 0) as mutual_friends,
                COALESCE(ms.server_count, 0) as mutual_servers
         FROM users u
         LEFT JOIN mutual_friends mf ON mf.candidate = u.id
         LEFT JOIN mutual_servers ms ON ms.candidate = u.id
         WHERE u.id != $1
           AND u.id NOT IN (SELECT uid FROM existing)
           AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id=$1)
           AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id=$1)
           -- Instance sur invitation : tous les membres sont proposés (relations communes d'abord),
           -- pour ajouter quelqu'un sans connaître son #tag. Pas les bots, bannis, compte système
           -- des messages supprimés, ni ceux qui refusent toute demande.
           AND NOT u.is_bot AND u.site_banned_at IS NULL AND u.id <> '00000000-0000-0000-0000-00000000dead'
           AND NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = u.id AND s.friend_request_from = 'nobody')
         ORDER BY COALESCE(mf.mutual_count, 0) * 3 + COALESCE(ms.server_count, 0) DESC, lower(u.username)
         LIMIT 200"
    ).bind(claims.sub).fetch_all(&state.db).await?;

    let result = suggestions.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar": r.get::<Option<String>, _>("avatar"),
        "status": r.get::<String, _>("status"),
        "mutual_friends": r.get::<i64, _>("mutual_friends"),
        "mutual_servers": r.get::<i64, _>("mutual_servers"),
    })).collect();
    Ok(Json(result))
}

/// GET /friends/calls — historique d'appels
pub async fn get_call_history(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let calls = sqlx::query(
        "SELECT ch.id, ch.caller_id, ch.callee_id, ch.call_type, ch.status,
                ch.started_at, ch.ended_at, ch.duration_s, ch.dm_id,
                uc.username as caller_name, uc.avatar as caller_avatar,
                ue.username as callee_name, ue.avatar as callee_avatar
         FROM call_history ch
         JOIN users uc ON uc.id = ch.caller_id
         JOIN users ue ON ue.id = ch.callee_id
         WHERE ch.caller_id=$1 OR ch.callee_id=$1
         ORDER BY ch.started_at DESC LIMIT 50"
    ).bind(claims.sub).fetch_all(&state.db).await?;

    let result = calls.iter().map(|r| {
        let is_outgoing = r.get::<Uuid, _>("caller_id") == claims.sub;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "call_type": r.get::<String, _>("call_type"),
            "status": r.get::<String, _>("status"),
            "direction": if is_outgoing { "outgoing" } else { "incoming" },
            "started_at": r.get::<chrono::DateTime<chrono::Utc>, _>("started_at"),
            "ended_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("ended_at"),
            "duration_s": r.get::<Option<i32>, _>("duration_s"),
            "dm_id": r.get::<Option<Uuid>, _>("dm_id"),
            "other_user": {
                "id": if is_outgoing { r.get::<Uuid, _>("callee_id") } else { r.get::<Uuid, _>("caller_id") },
                "username": if is_outgoing { r.get::<String, _>("callee_name") } else { r.get::<String, _>("caller_name") },
                "avatar": if is_outgoing { r.get::<Option<String>, _>("callee_avatar") } else { r.get::<Option<String>, _>("caller_avatar") },
            },
        })
    }).collect();
    Ok(Json(result))
}


/// Durées proposées par le menu « Rendre muet » (minutes) ; absente, nulle ou 0 = illimitée.
fn dm_mute_minutes(v: &serde_json::Value) -> Result<i32> {
    match v.as_i64() {
        None if v.is_null() => Ok(0),
        Some(m @ (0 | 15 | 60 | 180 | 480 | 1440)) => Ok(m as i32),
        _ => Err(AppError::BadRequest("Durée de sourdine invalide".into())),
    }
}

pub async fn patch_dm_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)
            UNION ALL
            SELECT 1 FROM group_dm_members WHERE dm_id=$1 AND user_id=$2
         )"
    )
    .bind(dm_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !ok { return Err(AppError::Forbidden); }

    let muted = body["muted"].as_bool();
    let archived = body["archived"].as_bool();
    let pinned = body["pinned"].as_bool();
    let closed = body["closed"].as_bool();
    // Sourdine temporaire (menu « Rendre muet ») : absente ou 0 = jusqu'à réactivation.
    let mute_minutes = dm_mute_minutes(&body["mute_minutes"])?;

    sqlx::query(
        "INSERT INTO dm_user_settings (user_id, dm_channel_id, muted, archived, pinned, muted_until, closed_at)
         VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, FALSE), COALESCE($5, FALSE),
                 CASE WHEN $3 AND $6 > 0 THEN NOW() + make_interval(mins => $6) END,
                 CASE WHEN $7 THEN NOW() END)
         ON CONFLICT (user_id, dm_channel_id) DO UPDATE SET
           muted    = COALESCE($3, dm_user_settings.muted),
           muted_until = CASE WHEN $3 IS NULL THEN dm_user_settings.muted_until
                              WHEN $3 AND $6 > 0 THEN NOW() + make_interval(mins => $6) END,
           archived = COALESCE($4, dm_user_settings.archived),
           pinned   = COALESCE($5, dm_user_settings.pinned),
           closed_at = CASE WHEN $7 IS NULL THEN dm_user_settings.closed_at WHEN $7 THEN NOW() END,
           updated_at = NOW()"
    )
    .bind(claims.sub)
    .bind(dm_id)
    .bind(muted)
    .bind(archived)
    .bind(pinned)
    .bind(mute_minutes)
    .bind(closed)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn block_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    if user_id == claims.sub {
        return Err(AppError::BadRequest("Impossible de se bloquer soi-même".into()));
    }
    sqlx::query(
        "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.sub)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    sqlx::query(
        "DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)"
    )
    .bind(claims.sub)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unblock_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    sqlx::query("DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2")
        .bind(claims.sub)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_blocked(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT b.blocked_id, u.username, u.discriminator, u.avatar
         FROM blocks b JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id=$1
         ORDER BY u.username"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let result = rows.iter().map(|r| serde_json::json!({
        "id":            r.get::<Uuid, _>("blocked_id"),
        "username":      r.get::<String, _>("username"),
        "discriminator": r.get::<String, _>("discriminator"),
        "avatar":        r.get::<Option<String>, _>("avatar"),
    })).collect();

    Ok(Json(result))
}

#[derive(serde::Deserialize)]
pub struct InviteBulkBody {
    pub emails: Vec<String>,
    pub usernames: Vec<String>,
}

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

        // Mêmes garde-fous que send_friend_request (endpoint mono-cible) --
        // cette boucle bulk les avait tous les deux oubliés : ni le blocage
        // mutuel (table `blocks`, séparée de `friendships`) ni le réglage de
        // confidentialité `friend_request_from` du destinataire n'étaient
        // vérifiés, permettant de contourner les deux via l'import CSV.
        let blocked = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM blocks WHERE
             (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))"
        )
        .bind(claims.sub)
        .bind(target_id)
        .fetch_one(&state.db)
        .await?;
        if blocked {
            not_found.push(raw.clone());
            continue;
        }

        let pref: Option<String> = sqlx::query_scalar::<_, String>(
            "SELECT friend_request_from FROM user_settings WHERE user_id=$1"
        )
        .bind(target_id)
        .fetch_optional(&state.db)
        .await?;
        let allowed = match pref.as_deref() {
            Some("nobody") => false,
            Some("friends_of_friends") => {
                sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(
                        SELECT 1 FROM friendships f1
                        JOIN friendships f2 ON
                            (CASE WHEN f1.user_id=$1 THEN f1.friend_id ELSE f1.user_id END) =
                            (CASE WHEN f2.user_id=$2 THEN f2.friend_id ELSE f2.user_id END)
                        WHERE (f1.user_id=$1 OR f1.friend_id=$1) AND f1.status='accepted'
                          AND (f2.user_id=$2 OR f2.friend_id=$2) AND f2.status='accepted'
                    )"
                )
                .bind(claims.sub)
                .bind(target_id)
                .fetch_one(&state.db)
                .await?
            }
            _ => true,
        };
        if !allowed {
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
            "from_username": sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id=$1")
                .bind(claims.sub).fetch_optional(&state.db).await?,
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

#[derive(serde::Deserialize)]
pub struct EditDmBody {
    #[serde(default)]
    pub content: String,
    /// Édition chiffrée : nouveau contenu chiffré (même `client_msg_id`).
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

pub async fn edit_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, msg_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<EditDmBody>,
) -> crate::error::Result<Json<serde_json::Value>> {
    // Vérifier accès DM
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !ok { return Err(crate::error::AppError::Forbidden); }

    let content = body.content.trim().to_string();
    if content.chars().count() > 4000 {
        return Err(crate::error::AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }
    let conv = e2e_conv::Conv::Dm(dm_id);
    let enc = e2e_conv::check_message(&state.db, conv, !content.is_empty(), body.enc.as_ref()).await?;
    if content.is_empty() && enc.is_none() {
        return Err(crate::error::AppError::BadRequest("Contenu vide".into()));
    }

    let rows = if let Some(enc) = &enc {
        // L'AAD lie le chiffré à l'id client : celui du message, ou un nouveau pour un ancien message en clair.
        if body.client_msg_id.is_none() {
            return Err(crate::error::AppError::BadRequest("client_msg_id requis".into()));
        }
        // Un message ancien rechiffré par l'édition perd aussi son historique en clair.
        let rows = sqlx::query(
            "UPDATE dm_messages SET enc=$2, content=NULL, client_msg_id=$4, edited_at=NOW()
             WHERE id=$1 AND sender_id=$3 AND dm_channel_id=$5 AND (client_msg_id IS NULL OR client_msg_id=$4)"
        )
        .bind(msg_id).bind(enc.to_json()).bind(claims.sub).bind(body.client_msg_id).bind(dm_id)
        .execute(&state.db).await?;
        if rows.rows_affected() > 0 {
            sqlx::query("DELETE FROM message_edits WHERE message_id=$1").bind(msg_id).execute(&state.db).await?;
        }
        rows
    } else {
        // Sauvegarder ancienne version dans l'historique puis éditer
        sqlx::query(
            "INSERT INTO message_edits (message_id, content)
             SELECT $1, content FROM dm_messages WHERE id=$1 AND sender_id=$2 AND content IS NOT NULL"
        )
        .bind(msg_id).bind(claims.sub).execute(&state.db).await?;
        sqlx::query(
            "UPDATE dm_messages SET content=$2, edited_at=NOW() WHERE id=$1 AND sender_id=$3 AND enc IS NULL"
        )
        .bind(msg_id).bind(&content).bind(claims.sub)
        .execute(&state.db).await?
    };

    if rows.rows_affected() == 0 {
        return Err(crate::error::AppError::Forbidden);
    }

    // Notifier les deux participants
    let event = serde_json::json!({
        "type": "DM_MESSAGE_UPDATE",
        "dm_id": dm_id,
        "message_id": msg_id,
        "content": if enc.is_some() { serde_json::Value::Null } else { serde_json::Value::String(content) },
        "enc": enc.as_ref().map(e2e_conv::Enc::to_json),
        "client_msg_id": body.client_msg_id,
        "sender_id": claims.sub,
        "edited_at": Utc::now(),
    });
    // Récupérer l'autre participant
    use sqlx::Row;
    if let Some(row) = sqlx::query(
        "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END AS other_id FROM dm_channels WHERE id=$1"
    ).bind(dm_id).bind(claims.sub).fetch_optional(&state.db).await? {
        let other_id: Uuid = row.get("other_id");
        state.broadcast_to_user(other_id, event.to_string()).await;
    }
    state.broadcast_to_user(claims.sub, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, msg_id)): Path<(Uuid, Uuid)>,
) -> crate::error::Result<Json<serde_json::Value>> {
    // Vérifier accès DM
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !ok { return Err(crate::error::AppError::Forbidden); }

    // Récupérer les attachments avant suppression
    let attachment_urls: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM attachments WHERE dm_message_id=$1"
    )
    .bind(msg_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let rows = sqlx::query(
        "DELETE FROM dm_messages WHERE id=$1 AND sender_id=$2"
    )
    .bind(msg_id).bind(claims.sub).execute(&state.db).await?;

    if rows.rows_affected() == 0 {
        return Err(crate::error::AppError::Forbidden);
    }

    // Supprimer les fichiers du disque
    let upload_dir = state.config.upload_dir.clone();
    tokio::spawn(async move {
        for url in attachment_urls {
            if let Some(rel) = url.strip_prefix("/uploads/") {
                let _ = tokio::fs::remove_file(std::path::Path::new(&upload_dir).join(rel)).await;
            }
        }
    });

    // Notifier les deux participants
    let event = serde_json::json!({
        "type": "DM_MESSAGE_DELETE",
        "dm_id": dm_id,
        "message_id": msg_id,
    });
    use sqlx::Row;
    if let Some(row) = sqlx::query(
        "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END AS other_id FROM dm_channels WHERE id=$1"
    ).bind(dm_id).bind(claims.sub).fetch_optional(&state.db).await? {
        let other_id: Uuid = row.get("other_id");
        state.broadcast_to_user(other_id, event.to_string()).await;
    }
    state.broadcast_to_user(claims.sub, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ── Réactions sur messages DM ─────────────────────────────────────────────────

pub async fn toggle_dm_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, msg_id, emoji)): Path<(Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    // Vérifier accès au DM
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    ).bind(dm_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !ok { return Err(AppError::Forbidden); }

    // Vérifier que le message appartient à ce DM
    let msg_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_messages WHERE id=$1 AND dm_channel_id=$2)"
    ).bind(msg_id).bind(dm_id).fetch_one(&state.db).await?;
    if !msg_ok { return Err(AppError::NotFound("Message introuvable".into())); }

    // Valider l'emoji (max 64 chars, non vide)
    let emoji = emoji.trim().to_string();
    if emoji.is_empty() || emoji.chars().count() > 16 {
        return Err(AppError::BadRequest("Emoji invalide".into()));
    }

    // Toggle : si déjà réagi → supprimer, sinon → ajouter
    let existing = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_reactions WHERE dm_message_id=$1 AND user_id=$2 AND emoji=$3)"
    ).bind(msg_id).bind(claims.sub).bind(&emoji).fetch_one(&state.db).await?;

    let added = if existing {
        sqlx::query("DELETE FROM dm_reactions WHERE dm_message_id=$1 AND user_id=$2 AND emoji=$3")
            .bind(msg_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        false
    } else {
        sqlx::query("INSERT INTO dm_reactions (dm_message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
            .bind(msg_id).bind(claims.sub).bind(&emoji).execute(&state.db).await?;
        true
    };

    // Récupérer le compte total pour cet emoji sur ce message
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM dm_reactions WHERE dm_message_id=$1 AND emoji=$2"
    ).bind(msg_id).bind(&emoji).fetch_one(&state.db).await?;

    // Diffuser aux deux participants du DM
    use sqlx::Row;
    let other_row = sqlx::query(
        "SELECT CASE WHEN user1_id=$2 THEN user2_id ELSE user1_id END as other_id FROM dm_channels WHERE id=$1"
    ).bind(dm_id).bind(claims.sub).fetch_optional(&state.db).await?;

    let event = serde_json::json!({
        "type": "DM_REACTION_TOGGLE",
        "dm_id": dm_id,
        "message_id": msg_id,
        "emoji": emoji,
        "added": added,
        "count": count,
        "user_id": claims.sub,
    });
    if let Some(row) = other_row {
        let other_id: Uuid = row.get("other_id");
        state.broadcast_to_user(other_id, event.to_string()).await;
    }
    state.broadcast_to_user(claims.sub, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true, "added": added, "count": count })))
}

pub async fn search_dm_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
    )
    .bind(dm_id).bind(claims.sub).fetch_one(&state.db).await?;
    if !ok { return Err(AppError::Forbidden); }

    let q = params.get("q").cloned().unwrap_or_default();
    if q.trim().len() < 2 {
        return Ok(Json(serde_json::json!([])));
    }
    let q_esc = q.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{}%", q_esc);

    let rows = sqlx::query(
        "SELECT dm.id, dm.content, dm.created_at, u.username as author_username, u.avatar as author_avatar
         FROM dm_messages dm
         JOIN users u ON u.id = dm.sender_id
         WHERE dm.dm_channel_id = $1 AND dm.content ILIKE $2
         ORDER BY dm.created_at DESC LIMIT 50"
    )
    .bind(dm_id)
    .bind(&pattern)
    .fetch_all(&state.db)
    .await?;

    let results: Vec<serde_json::Value> = rows.iter().map(|r| {
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "content": r.get::<Option<String>, _>("content"),
            "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author_username": r.get::<String, _>("author_username"),
            "author_avatar": r.get::<Option<String>, _>("author_avatar"),
        })
    }).collect();

    Ok(Json(serde_json::json!(results)))
}

#[cfg(test)]
#[path = "dm_settings_db_tests.rs"]
mod dm_settings_db_tests;
