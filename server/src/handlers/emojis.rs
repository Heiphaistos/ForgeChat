use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use std::path::PathBuf;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_member,
    middleware::auth::Claims,
    state::AppState,
};

pub async fn list_emojis(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let rows = sqlx::query(
        "SELECT id, name, url, creator_id, created_at FROM custom_emojis
         WHERE server_id=$1 ORDER BY created_at ASC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let emojis = rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "url": r.get::<String, _>("url"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })).collect();

    Ok(Json(emojis))
}

pub async fn create_emoji(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    let upload_dir = PathBuf::from(&state.config.upload_dir).join("emojis");
    tokio::fs::create_dir_all(&upload_dir).await
        .map_err(|e| AppError::Internal(e.into()))?;

    let mut emoji_name: Option<String> = None;
    let mut emoji_url: Option<String> = None;

    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let field_name = field.name().unwrap_or("").to_string();

        if field_name == "name" {
            let name = field.text().await.unwrap_or_default();
            let name = name.trim().to_lowercase();
            if name.is_empty() || name.len() > 32 || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
                return Err(AppError::BadRequest("Nom d'emoji invalide (1-32 chars, alphanum + _)".into()));
            }
            emoji_name = Some(name);
            continue;
        }

        if field_name == "file" {
            let ct = field.content_type().unwrap_or("").to_string();
            if !ct.starts_with("image/") {
                return Err(AppError::BadRequest("Seules les images sont acceptées".into()));
            }
            let data = field.bytes().await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            if data.len() > 256 * 1024 {
                return Err(AppError::BadRequest("Emoji trop volumineux (max 256KB)".into()));
            }
            let ext = match ct.as_str() {
                "image/gif" => "gif",
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/webp" => "webp",
                _ => "png",
            };
            let file_id = Uuid::new_v4();
            let filename = format!("emoji_{}.{}", file_id, ext);
            let file_path = upload_dir.join(&filename);
            tokio::fs::write(&file_path, &data).await
                .map_err(|e| AppError::Internal(e.into()))?;
            emoji_url = Some(format!("/uploads/emojis/{}", filename));
        }
    }

    let name = emoji_name.ok_or_else(|| AppError::BadRequest("Champ 'name' manquant".into()))?;
    let url = emoji_url.ok_or_else(|| AppError::BadRequest("Champ 'file' manquant".into()))?;

    let row = sqlx::query(
        "INSERT INTO custom_emojis (server_id, name, url, creator_id)
         VALUES ($1, $2, $3, $4) RETURNING id, name, url, created_at"
    )
    .bind(server_id)
    .bind(&name)
    .bind(&url)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    Ok(Json(serde_json::json!({
        "id": row.get::<Uuid, _>("id"),
        "name": row.get::<String, _>("name"),
        "url": row.get::<String, _>("url"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })))
}

pub async fn delete_emoji(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, emoji_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;

    // Vérifier que l'emoji appartient au serveur
    let row = sqlx::query_scalar::<_, String>(
        "SELECT url FROM custom_emojis WHERE id=$1 AND server_id=$2"
    )
    .bind(emoji_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Emoji introuvable".into()))?;

    // Supprimer le fichier physique — protection contre path traversal
    let upload_dir = PathBuf::from(&state.config.upload_dir);
    let base = upload_dir.canonicalize().unwrap_or(upload_dir.clone());
    if let Some(relative) = row.strip_prefix("/uploads/") {
        if !relative.contains("..") && !relative.contains('\0') {
            let path = upload_dir.join(relative);
            if let Ok(canonical) = path.canonicalize() {
                if canonical.starts_with(&base) {
                    let _ = tokio::fs::remove_file(&canonical).await;
                } else {
                    tracing::warn!("Path traversal bloqué pour emoji delete : {:?}", canonical);
                }
            }
        }
    }

    sqlx::query("DELETE FROM custom_emojis WHERE id=$1")
        .bind(emoji_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
