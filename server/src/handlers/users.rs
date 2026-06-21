use axum::{
    extract::{Path, State, Multipart},
    Extension, Json,
};
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
