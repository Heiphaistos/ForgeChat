use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use chrono::{Duration, Utc};
use std::path::PathBuf;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_channel_in_server},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

pub async fn upload_file(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    require_channel_in_server(&state, channel_id, server_id).await?;

    // Admins/modérateurs/propriétaires peuvent uploader n'importe quel type de fichier
    let is_privileged = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM server_members sm
            LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
            LEFT JOIN roles r ON r.id = mr.role_id
            WHERE sm.server_id = $1 AND sm.user_id = $2
            AND (sm.user_id = (SELECT owner_id FROM servers WHERE id = $1)
                 OR (r.permissions & $3 <> 0)
                 OR (r.permissions & $4 <> 0))
        )"
    )
    .bind(server_id)
    .bind(claims.sub)
    .bind(Permissions::ADMINISTRATOR)
    .bind(Permissions::MANAGE_MESSAGES)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false);

    let upload_dir = PathBuf::from(&state.config.upload_dir);
    tokio::fs::create_dir_all(&upload_dir).await
        .map_err(|e| AppError::Internal(e.into()))?;

    let mut uploaded = Vec::new();
    let mut ttl_hours: Option<i64> = None;

    while let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let field_name = field.name().unwrap_or("").to_string();

        // Champ TTL (texte, pas un fichier)
        if field_name == "ttl_hours" {
            let val = field.text().await.unwrap_or_default();
            ttl_hours = val.parse::<i64>().ok();
            continue;
        }

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

        // Valider et normaliser l'extension — bloquer les types dangereux
        let raw_ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_lowercase();

        // Liste blanche d'extensions autorisées
        const ALLOWED_EXTENSIONS: &[&str] = &[
            "jpg", "jpeg", "png", "gif", "webp", "svg",
            "mp4", "webm", "mov", "mkv",
            "mp3", "ogg", "wav", "flac",
            "pdf", "txt", "md",
            "zip", "tar", "gz", "7z", "rar",
            "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "bin",
        ];

        if !is_privileged && !ALLOWED_EXTENSIONS.contains(&raw_ext.as_str()) {
            return Err(AppError::BadRequest(
                format!("Extension .{} non autorisée (admin/modérateur requis pour ce type)", raw_ext)
            ));
        }

        let ext = raw_ext;

        // Nettoyer le nom de fichier original (path traversal protection)
        let safe_name = std::path::Path::new(&original_name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("fichier")
            .replace(['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'], "_");

        let file_id = Uuid::new_v4();
        let filename = format!("{}.{}", file_id, ext);
        let file_path = upload_dir.join(&filename);

        tokio::fs::write(&file_path, &data).await
            .map_err(|e| AppError::Internal(e.into()))?;

        let url = format!("/uploads/{}", filename);
        let size = data.len() as i64;
        let expires_at = ttl_hours.map(|h| Utc::now() + Duration::hours(h));

        let attachment = sqlx::query(
            "INSERT INTO attachments (message_id, filename, content_type, size, url, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, url, filename, content_type, size, expires_at"
        )
        .bind(message_id)
        .bind(&safe_name)
        .bind(&content_type)
        .bind(size)
        .bind(&url)
        .bind(expires_at)
        .fetch_one(&state.db)
        .await?;

        use sqlx::Row;
        let att_json = serde_json::json!({
            "id": attachment.get::<Uuid, _>("id"),
            "url": attachment.get::<String, _>("url"),
            "filename": attachment.get::<String, _>("filename"),
            "content_type": attachment.get::<String, _>("content_type"),
            "size": attachment.get::<i64, _>("size"),
            "expires_at": attachment.get::<Option<chrono::DateTime<Utc>>, _>("expires_at"),
        });
        uploaded.push(att_json);
    }

    // Broadcast MESSAGE_ATTACHMENT_ADDED pour mise à jour temps réel
    if !uploaded.is_empty() {
        let event = serde_json::json!({
            "type": "MESSAGE_ATTACHMENT_ADDED",
            "message_id": message_id,
            "channel_id": channel_id,
            "attachments": uploaded,
        });
        state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    }

    Ok(Json(uploaded))
}
