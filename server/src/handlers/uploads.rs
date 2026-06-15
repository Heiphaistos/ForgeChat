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

pub async fn upload_file(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;

    let upload_dir = PathBuf::from(&state.config.upload_dir);
    tokio::fs::create_dir_all(&upload_dir).await
        .map_err(|e| AppError::Internal(e.into()))?;

    let mut uploaded = Vec::new();

    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let original_name = field.file_name()
            .unwrap_or("fichier")
            .to_string();

        let content_type = field.content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        let data = field.bytes().await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() as u64 > state.config.max_upload_size {
            return Err(AppError::BadRequest("Fichier trop volumineux (max 50MB)".into()));
        }

        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");

        let file_id = Uuid::new_v4();
        let filename = format!("{}.{}", file_id, ext);
        let file_path = upload_dir.join(&filename);

        tokio::fs::write(&file_path, &data).await
            .map_err(|e| AppError::Internal(e.into()))?;

        let url = format!("/uploads/{}", filename);
        let size = data.len() as i64;

        let attachment = sqlx::query(
            "INSERT INTO attachments (message_id, filename, content_type, size, url)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, url, filename, content_type, size"
        )
        .bind(message_id)
        .bind(&original_name)
        .bind(&content_type)
        .bind(size)
        .bind(&url)
        .fetch_one(&state.db)
        .await?;

        use sqlx::Row;
        uploaded.push(serde_json::json!({
            "id": attachment.get::<Uuid, _>("id"),
            "url": attachment.get::<String, _>("url"),
            "filename": attachment.get::<String, _>("filename"),
            "content_type": attachment.get::<String, _>("content_type"),
            "size": attachment.get::<i64, _>("size"),
        }));
    }

    Ok(Json(uploaded))
}
