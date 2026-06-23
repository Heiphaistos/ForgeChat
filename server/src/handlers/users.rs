use axum::{
    extract::{Path, Query, State, Multipart},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    models::user::{UpdateProfileRequest, UserPublic},
    state::AppState,
};

pub async fn get_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<UserPublic>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    Ok(Json(user.into()))
}

pub async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<UserPublic>> {
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE id=$1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    Ok(Json(user.into()))
}

pub async fn update_me(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<UpdateProfileRequest>,
) -> Result<Json<UserPublic>> {
    if let Some(ref username) = body.username {
        if username.len() < 2 || username.len() > 32 {
            return Err(AppError::BadRequest("Nom 2-32 chars".into()));
        }
    }

    // Valider activity_type si fourni
    if let Some(ref at) = body.activity_type {
        let valid = ["playing", "listening", "watching", "streaming", "competing", ""];
        if !valid.contains(&at.as_str()) {
            return Err(AppError::BadRequest("activity_type invalide".into()));
        }
    }

    let user = sqlx::query_as::<_, crate::models::user::User>(
        "UPDATE users SET
            username = COALESCE($2, username),
            bio = COALESCE($3, bio),
            custom_status = COALESCE($4, custom_status),
            status = COALESCE($5, status),
            banner = CASE WHEN $6::TEXT IS NOT NULL THEN $6 ELSE banner END,
            activity_type = CASE WHEN $7::VARCHAR IS NOT NULL THEN NULLIF($7, '') ELSE activity_type END,
            activity_name = CASE WHEN $7::VARCHAR IS NOT NULL THEN NULLIF($8, '') ELSE activity_name END,
            activity_detail = CASE WHEN $7::VARCHAR IS NOT NULL THEN NULLIF($9, '') ELSE activity_detail END,
            updated_at = NOW()
         WHERE id=$1 RETURNING *"
    )
    .bind(claims.sub)
    .bind(body.username)
    .bind(body.bio)
    .bind(body.custom_status)
    .bind(body.status)
    .bind(body.banner.as_deref())
    .bind(body.activity_type.as_deref())
    .bind(body.activity_name.as_deref())
    .bind(body.activity_detail.as_deref())
    .fetch_one(&state.db)
    .await?;

    // Broadcast mise à jour statut
    let event = serde_json::json!({
        "type": "USER_UPDATE",
        "user": UserPublic::from(user.clone())
    });
    state.broadcast_to_user(claims.sub, event.to_string()).await;

    Ok(Json(user.into()))
}

pub async fn upload_avatar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<UserPublic>> {
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        let name = field.name().unwrap_or("").to_string();
        if name != "avatar" { continue; }

        let content_type = field.content_type()
            .unwrap_or("image/jpeg")
            .to_string();

        // Valider le content-type — liste blanche stricte pour les avatars
        let ext = match content_type.as_str() {
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/jpeg" | "image/jpg" => "jpg",
            _ => return Err(AppError::BadRequest(
                "Type de fichier non supporté. Acceptés: PNG, GIF, WEBP, JPEG".into()
            )),
        };

        let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() > 8 * 1024 * 1024 {
            return Err(AppError::BadRequest("Fichier trop grand (max 8 MB)".into()));
        }

        let filename = format!("avatars/{}.{}", Uuid::new_v4(), ext);
        let path = std::path::Path::new(&state.config.upload_dir).join(&filename);

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| AppError::Internal(e.into()))?;
        }

        tokio::fs::write(&path, &data).await
            .map_err(|e| AppError::Internal(e.into()))?;

        let avatar_url = format!("/uploads/{}", filename);

        let user = sqlx::query_as::<_, crate::models::user::User>(
            "UPDATE users SET avatar=$2, updated_at=NOW() WHERE id=$1 RETURNING *"
        )
        .bind(claims.sub)
        .bind(&avatar_url)
        .fetch_one(&state.db)
        .await?;

        return Ok(Json(user.into()));
    }

    Err(AppError::BadRequest("Champ 'avatar' manquant".into()))
}

pub async fn upload_banner(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        let name = field.name().unwrap_or("").to_string();
        if name != "banner" { continue; }

        let content_type = field.content_type()
            .unwrap_or("image/jpeg")
            .to_string();

        let ext = match content_type.as_str() {
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/jpeg" | "image/jpg" => "jpg",
            _ => return Err(AppError::BadRequest(
                "Type de fichier non supporté. Acceptés: PNG, GIF, WEBP, JPEG".into()
            )),
        };

        let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() > 10 * 1024 * 1024 {
            return Err(AppError::BadRequest("Fichier trop grand (max 10 MB)".into()));
        }

        let filename = format!("banners/{}.{}", Uuid::new_v4(), ext);
        let path = std::path::Path::new(&state.config.upload_dir).join(&filename);

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| AppError::Internal(e.into()))?;
        }

        tokio::fs::write(&path, &data).await
            .map_err(|e| AppError::Internal(e.into()))?;

        let banner_url = format!("/uploads/{}", filename);

        sqlx::query("UPDATE users SET banner=$2, updated_at=NOW() WHERE id=$1")
            .bind(claims.sub)
            .bind(&banner_url)
            .execute(&state.db)
            .await?;

        return Ok(Json(serde_json::json!({ "banner": banner_url })));
    }

    Err(AppError::BadRequest("Champ 'banner' manquant".into()))
}

pub async fn delete_account(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    // Exiger la confirmation du mot de passe pour éviter la suppression accidentelle/CSRF
    let password = body["password"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Mot de passe requis pour confirmer la suppression".into()))?;

    let pw_hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM users WHERE id=$1"
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    if !bcrypt::verify(password, &pw_hash).unwrap_or(false) {
        return Err(AppError::BadRequest("Mot de passe incorrect".into()));
    }

    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(claims.sub)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn search_users(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<UserPublic>>> {
    let query = params.get("q").cloned().unwrap_or_default();
    if query.len() < 2 {
        return Ok(Json(vec![]));
    }

    let pattern = format!("%{}%", query.to_lowercase());
    let users = sqlx::query_as::<_, crate::models::user::User>(
        "SELECT * FROM users WHERE LOWER(username) LIKE $1 AND id != $2 LIMIT 20"
    )
    .bind(&pattern)
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(Into::into)
    .collect();

    Ok(Json(users))
}

// ─── E2E Encryption — Public Key Management ──────────────────────────────────

#[derive(serde::Deserialize)]
pub struct SetPubKeyRequest {
    pub pub_key: String,
}

pub async fn set_pubkey(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SetPubKeyRequest>,
) -> Result<Json<serde_json::Value>> {
    if body.pub_key.len() > 4096 {
        return Err(AppError::BadRequest("Clé publique trop longue".into()));
    }

    sqlx::query(
        "INSERT INTO user_pubkeys (user_id, pub_key) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET pub_key = EXCLUDED.pub_key, updated_at = NOW()"
    )
    .bind(claims.sub)
    .bind(&body.pub_key)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// GET /users/:id/profile — profil public + statut relation (optionnel auth via header)
pub async fn get_user_profile(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;

    let user = sqlx::query(
        "SELECT id, username, discriminator, avatar, banner, bio, status, custom_status,
                activity_type, activity_name, activity_detail, created_at
         FROM users WHERE id=$1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    let mut profile = serde_json::json!({
        "id":               user.get::<Uuid, _>("id"),
        "username":         user.get::<String, _>("username"),
        "discriminator":    user.get::<String, _>("discriminator"),
        "avatar":           user.get::<Option<String>, _>("avatar"),
        "banner":           user.get::<Option<String>, _>("banner"),
        "bio":              user.get::<Option<String>, _>("bio"),
        "status":           user.get::<String, _>("status"),
        "custom_status":    user.get::<Option<String>, _>("custom_status"),
        "activity_type":    user.get::<Option<String>, _>("activity_type"),
        "activity_name":    user.get::<Option<String>, _>("activity_name"),
        "activity_detail":  user.get::<Option<String>, _>("activity_detail"),
        "created_at":       user.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "relationship":     "none",
        "is_favorite":      false,
    });

    if let Some(Extension(claims)) = claims {
        let me = claims.sub;
        if me == user_id {
            profile["relationship"] = serde_json::json!("self");
        } else {
            // Amitié
            let friendship = sqlx::query(
                "SELECT id, status, user_id FROM friendships
                 WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)"
            )
            .bind(me)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;

            if let Some(f) = friendship {
                let friendship_id: Uuid = f.get("id");
                profile["friendship_id"] = serde_json::json!(friendship_id);
                let status: &str = match f.get::<String, _>("status").as_str() {
                    "accepted" => "friend",
                    "pending" => {
                        let initiator: Uuid = f.get("user_id");
                        if initiator == me { "pending_sent" } else { "pending_received" }
                    }
                    _ => "none",
                };
                profile["relationship"] = serde_json::json!(status);
            }

            // Bloqué
            let blocked = sqlx::query(
                "SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2"
            )
            .bind(me)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
            if blocked.is_some() {
                profile["relationship"] = serde_json::json!("blocked");
            }

            // Favori
            let fav = sqlx::query(
                "SELECT 1 FROM user_favorites WHERE user_id=$1 AND target_id=$2"
            )
            .bind(me)
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?;
            profile["is_favorite"] = serde_json::json!(fav.is_some());

            // Serveurs en commun
            let mutual = sqlx::query(
                "SELECT s.id, s.name, s.icon FROM server_members sm1
                 JOIN server_members sm2 ON sm1.server_id = sm2.server_id AND sm2.user_id=$2
                 JOIN servers s ON s.id = sm1.server_id
                 WHERE sm1.user_id=$1 LIMIT 5"
            )
            .bind(me)
            .bind(user_id)
            .fetch_all(&state.db)
            .await?;

            let mutual_servers: Vec<serde_json::Value> = mutual.iter().map(|r| serde_json::json!({
                "id":   r.get::<Uuid, _>("id"),
                "name": r.get::<String, _>("name"),
                "icon": r.get::<Option<String>, _>("icon"),
            })).collect();
            profile["mutual_servers"] = serde_json::json!(mutual_servers);
        }
    }

    Ok(Json(profile))
}

/// GET /api/users/:id/profile (route publique — JWT optionnel, cookie OU Bearer)
pub async fn get_user_profile_public(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    // Priorité : cookie access_token > Authorization: Bearer (identique au middleware auth)
    let token = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';').find_map(|part| {
                part.trim().strip_prefix("access_token=").map(|t| t.to_string())
            })
        })
        .or_else(|| {
            headers
                .get("Authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|t| t.to_string())
        });

    let claims = token
        .and_then(|token| crate::middleware::auth::verify_token(
            &token,
            &state.config.jwt_secret,
            &state.config.jwt_issuer,
        ))
        .map(Extension);

    get_user_profile(State(state), claims, Path(user_id)).await
}

/// POST /users/:id/block
pub async fn block_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode> {
    if claims.sub == user_id {
        return Err(AppError::BadRequest("Impossible de se bloquer soi-même".into()));
    }
    sqlx::query(
        "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.sub)
    .bind(user_id)
    .execute(&state.db)
    .await?;
    // Retirer l'amitié si existante
    sqlx::query(
        "DELETE FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)"
    )
    .bind(claims.sub)
    .bind(user_id)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /users/:id/block
pub async fn unblock_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode> {
    sqlx::query("DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2")
        .bind(claims.sub)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /users/:id/favorite
pub async fn add_favorite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode> {
    if claims.sub == user_id {
        return Err(AppError::BadRequest("Impossible de se mettre en favori".into()));
    }
    sqlx::query(
        "INSERT INTO user_favorites (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    )
    .bind(claims.sub)
    .bind(user_id)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /users/:id/favorite
pub async fn remove_favorite(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode> {
    sqlx::query("DELETE FROM user_favorites WHERE user_id=$1 AND target_id=$2")
        .bind(claims.sub)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_pubkey(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let row = sqlx::query("SELECT pub_key FROM user_pubkeys WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

    match row {
        Some(r) => {
            use sqlx::Row;
            Ok(Json(serde_json::json!({ "pub_key": r.get::<String, _>("pub_key") })))
        }
        None => Err(AppError::NotFound("Clé publique introuvable (E2E non activé pour cet utilisateur)".into())),
    }
}

// ─── Status rapide ────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct UpdateStatusRequest {
    pub status: Option<String>,
    pub custom_status: Option<String>,
}

/// PATCH /api/user/status
pub async fn update_status(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<UpdateStatusRequest>,
) -> Result<Json<serde_json::Value>> {
    if let Some(ref s) = req.status {
        if !["online", "away", "dnd", "invisible"].contains(&s.as_str()) {
            return Err(AppError::BadRequest("Statut invalide (online|away|dnd|invisible)".into()));
        }
    }

    sqlx::query(
        "UPDATE users SET
            status = COALESCE($1, status),
            custom_status = COALESCE($2, custom_status),
            updated_at = NOW()
         WHERE id = $3"
    )
    .bind(&req.status)
    .bind(&req.custom_status)
    .bind(claims.sub)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "PRESENCE_UPDATE",
        "user_id": claims.sub,
        "status": req.status,
        "custom_status": req.custom_status,
    });
    state.broadcast_to_user(claims.sub, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

/// GET /api/activity-feed — événements typés des serveurs communs (48h)
pub async fn get_activity_feed(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    let limit: i64 = params.get("limit").and_then(|s| s.parse().ok()).unwrap_or(20);
    let offset: i64 = params.get("offset").and_then(|s| s.parse().ok()).unwrap_or(0);

    // Nouvelles arrivées dans les serveurs communs
    let join_rows = sqlx::query(
        "SELECT sm.joined_at as ts, u.id as user_id, u.username, u.avatar,
                s.id as server_id, s.name as server_name
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         JOIN servers s ON s.id = sm.server_id
         JOIN server_members my_sm ON my_sm.server_id = s.id AND my_sm.user_id = $1
         WHERE sm.user_id != $1
           AND sm.joined_at > NOW() - INTERVAL '48 hours'
         ORDER BY sm.joined_at DESC
         LIMIT 30"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    // Messages épinglés dans les serveurs communs
    let pin_rows = sqlx::query(
        "SELECT pm.pinned_at as ts, u.id as user_id, u.username, u.avatar,
                s.id as server_id, s.name as server_name,
                c.id as channel_id, c.name as channel_name
         FROM pinned_messages pm
         JOIN users u ON u.id = pm.pinned_by
         JOIN channels c ON c.id = pm.channel_id
         JOIN servers s ON s.id = c.server_id
         JOIN server_members sm ON sm.server_id = s.id AND sm.user_id = $1
         WHERE pm.pinned_at > NOW() - INTERVAL '48 hours'
         ORDER BY pm.pinned_at DESC
         LIMIT 30"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let mut items: Vec<serde_json::Value> = Vec::new();

    for r in &join_rows {
        items.push(serde_json::json!({
            "id": Uuid::new_v4(),
            "type": "server_join",
            "actor": {
                "id":       r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar":   r.get::<Option<String>, _>("avatar"),
            },
            "server": {
                "id":   r.get::<Uuid, _>("server_id"),
                "name": r.get::<String, _>("server_name"),
            },
            "timestamp": r.get::<chrono::DateTime<chrono::Utc>, _>("ts"),
        }));
    }

    for r in &pin_rows {
        items.push(serde_json::json!({
            "id": Uuid::new_v4(),
            "type": "message_pin",
            "actor": {
                "id":       r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "avatar":   r.get::<Option<String>, _>("avatar"),
            },
            "server": {
                "id":   r.get::<Uuid, _>("server_id"),
                "name": r.get::<String, _>("server_name"),
            },
            "channel": {
                "id":   r.get::<Uuid, _>("channel_id"),
                "name": r.get::<String, _>("channel_name"),
            },
            "timestamp": r.get::<chrono::DateTime<chrono::Utc>, _>("ts"),
        }));
    }

    // Tri chronologique décroissant
    items.sort_by(|a, b| {
        let ta = a["timestamp"].as_str().unwrap_or("");
        let tb = b["timestamp"].as_str().unwrap_or("");
        tb.cmp(ta)
    });

    let off = offset as usize;
    let end = (off + limit as usize).min(items.len());
    let page = if off < items.len() { items[off..end].to_vec() } else { vec![] };

    Ok(Json(page))
}

/// GET /api/users/:id/achievements — badges calculés
pub async fn get_user_achievements(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;

    let row = sqlx::query(
        "SELECT u.created_at,
                (SELECT COUNT(*) FROM messages WHERE user_id = $1) as msg_count,
                (SELECT COUNT(*) FROM server_members WHERE user_id = $1) as server_count,
                (SELECT COUNT(*) FROM servers WHERE owner_id = $1) as owned_count
         FROM users u WHERE u.id = $1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Utilisateur introuvable".into()))?;

    let created_at = row.get::<chrono::DateTime<chrono::Utc>, _>("created_at");
    let msg_count: i64 = row.get("msg_count");
    let server_count: i64 = row.get("server_count");
    let owned_count: i64 = row.get("owned_count");
    let age_days = (chrono::Utc::now() - created_at).num_days();

    let mut badges: Vec<serde_json::Value> = Vec::new();

    if age_days <= 30 {
        badges.push(serde_json::json!({ "id": "early_adopter", "name": "Early Adopter", "icon": "🌟", "description": "A rejoint dans les 30 premiers jours" }));
    }
    if msg_count >= 1 {
        badges.push(serde_json::json!({ "id": "first_message", "name": "Premier message", "icon": "💬", "description": "A envoyé son premier message" }));
    }
    if msg_count >= 100 {
        badges.push(serde_json::json!({ "id": "chatterbox", "name": "Bavard", "icon": "🗣️", "description": "100 messages envoyés" }));
    }
    if msg_count >= 1000 {
        badges.push(serde_json::json!({ "id": "veteran", "name": "Vétéran", "icon": "⚔️", "description": "1000 messages envoyés" }));
    }
    if server_count >= 3 {
        badges.push(serde_json::json!({ "id": "social", "name": "Sociable", "icon": "🤝", "description": "Membre de 3+ serveurs" }));
    }
    if owned_count >= 1 {
        badges.push(serde_json::json!({ "id": "founder", "name": "Fondateur", "icon": "👑", "description": "A créé un serveur" }));
    }

    Ok(Json(badges))
}

pub async fn get_mutual_servers(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT s.id, s.name, s.icon,
                COALESCE(
                    (SELECT array_agg(r.name)
                     FROM roles r
                     INNER JOIN server_member_roles smr ON smr.role_id = r.id
                     WHERE smr.server_id = s.id AND smr.user_id = $2
                       AND r.is_everyone = false),
                    ARRAY[]::text[]
                ) AS member_role_names
         FROM servers s
         INNER JOIN server_members sm1 ON sm1.server_id = s.id AND sm1.user_id = $1
         INNER JOIN server_members sm2 ON sm2.server_id = s.id AND sm2.user_id = $2
         LIMIT 10"
    )
    .bind(claims.sub)
    .bind(user_id)
    .fetch_all(&state.db)
    .await?;

    let servers: Vec<serde_json::Value> = rows.iter().map(|r| {
        let member_role_names: Vec<String> = r.try_get("member_role_names").unwrap_or_default();
        serde_json::json!({
            "id":   r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "icon": r.get::<Option<String>, _>("icon"),
            "member_role_names": member_role_names,
        })
    }).collect();

    Ok(Json(serde_json::json!(servers)))
}
