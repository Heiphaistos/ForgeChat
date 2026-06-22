use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use std::path::PathBuf;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

const MAX_STICKER_SIZE: usize = 512 * 1024; // 512 KB
const MAX_STICKERS_PER_SERVER: i64 = 60;

/// GET /api/servers/:id/stickers
pub async fn list_stickers(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let rows = sqlx::query(
        "SELECT id, name, description, url, uploaded_by, created_at
         FROM server_stickers WHERE server_id=$1 ORDER BY created_at ASC"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let stickers = rows.iter().map(|r| serde_json::json!({
        "id":          r.get::<Uuid, _>("id"),
        "name":        r.get::<String, _>("name"),
        "description": r.get::<Option<String>, _>("description"),
        "url":         r.get::<String, _>("url"),
        "uploaded_by": r.get::<Option<Uuid>, _>("uploaded_by"),
        "created_at":  r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })).collect();

    Ok(Json(stickers))
}

/// POST /api/servers/:id/stickers — multipart (name, description?, file)
pub async fn create_sticker(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    // Vérifier quota
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM server_stickers WHERE server_id=$1"
    )
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;

    if count >= MAX_STICKERS_PER_SERVER {
        return Err(AppError::BadRequest(
            format!("Maximum {} stickers par serveur atteint", MAX_STICKERS_PER_SERVER)
        ));
    }

    let upload_dir = PathBuf::from(&state.config.upload_dir).join("stickers");
    tokio::fs::create_dir_all(&upload_dir).await
        .map_err(|e| AppError::Internal(e.into()))?;

    let mut sticker_name: Option<String> = None;
    let mut sticker_desc: Option<String> = None;
    let mut sticker_url: Option<String> = None;

    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let field_name = field.name().unwrap_or("").to_string();

        match field_name.as_str() {
            "name" => {
                let name = field.text().await.unwrap_or_default();
                let name = name.trim().to_string();
                if name.is_empty() || name.len() > 50 {
                    return Err(AppError::BadRequest("Nom sticker invalide (1-50 chars)".into()));
                }
                sticker_name = Some(name);
            }
            "description" => {
                let desc = field.text().await.unwrap_or_default();
                let desc = desc.trim().chars().take(200).collect::<String>();
                if !desc.is_empty() {
                    sticker_desc = Some(desc);
                }
            }
            "file" => {
                let ct = field.content_type().unwrap_or("").to_string();
                let allowed = ["image/png", "image/webp", "image/gif"];
                if !allowed.contains(&ct.as_str()) {
                    return Err(AppError::BadRequest(
                        "Seuls PNG, WEBP et GIF sont acceptés".into()
                    ));
                }
                let data = field.bytes().await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                if data.len() > MAX_STICKER_SIZE {
                    return Err(AppError::BadRequest(
                        "Sticker trop volumineux (max 512KB)".into()
                    ));
                }
                let ext = match ct.as_str() {
                    "image/gif"  => "gif",
                    "image/webp" => "webp",
                    _            => "png",
                };
                let file_id = Uuid::new_v4();
                let filename = format!("sticker_{}.{}", file_id, ext);
                let file_path = upload_dir.join(&filename);
                tokio::fs::write(&file_path, &data).await
                    .map_err(|e| AppError::Internal(e.into()))?;
                sticker_url = Some(format!("/uploads/stickers/{}", filename));
            }
            _ => {}
        }
    }

    let name = sticker_name.ok_or_else(|| AppError::BadRequest("Champ 'name' manquant".into()))?;
    let url  = sticker_url.ok_or_else(|| AppError::BadRequest("Champ 'file' manquant".into()))?;

    let row = sqlx::query(
        "INSERT INTO server_stickers (server_id, name, description, url, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, description, url, uploaded_by, created_at"
    )
    .bind(server_id)
    .bind(&name)
    .bind(&sticker_desc)
    .bind(&url)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    Ok(Json(serde_json::json!({
        "id":          row.get::<Uuid, _>("id"),
        "name":        row.get::<String, _>("name"),
        "description": row.get::<Option<String>, _>("description"),
        "url":         row.get::<String, _>("url"),
        "uploaded_by": row.get::<Option<Uuid>, _>("uploaded_by"),
        "created_at":  row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })))
}

/// DELETE /api/servers/:id/stickers/:sticker_id
pub async fn delete_sticker(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, sticker_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let url = sqlx::query_scalar::<_, String>(
        "SELECT url FROM server_stickers WHERE id=$1 AND server_id=$2"
    )
    .bind(sticker_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Sticker introuvable".into()))?;

    // Supprimer le fichier physique avec protection path traversal
    let upload_dir = PathBuf::from(&state.config.upload_dir);
    let base = upload_dir.canonicalize().unwrap_or(upload_dir.clone());
    if let Some(relative) = url.strip_prefix("/uploads/") {
        if !relative.contains("..") && !relative.contains('\0') {
            let path = upload_dir.join(relative);
            if let Ok(canonical) = path.canonicalize() {
                if canonical.starts_with(&base) {
                    let _ = tokio::fs::remove_file(&canonical).await;
                } else {
                    tracing::warn!("Path traversal bloqué pour sticker delete : {:?}", canonical);
                }
            }
        }
    }

    sqlx::query("DELETE FROM server_stickers WHERE id=$1")
        .bind(sticker_id)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
