use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use chrono::{Duration, Utc};
use std::path::PathBuf;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// Liste blanche d'extensions autorisées (SVG réservé aux admins/mods — XSS via JS inline)
pub const ALLOWED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp",
    "mp4", "webm", "mov", "mkv",
    "mp3", "ogg", "wav", "flac",
    "pdf", "txt", "md",
    "zip", "tar", "gz", "7z", "rar",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "bin",
];

/// Propriétaire d'une pièce jointe : une colonne de `attachments` par source.
#[derive(Clone, Copy)]
pub enum AttachmentOwner {
    Message(Uuid),
    ThreadMessage(Uuid),
    ForumReply(Uuid),
}

impl AttachmentOwner {
    /// Nom de colonne figé (jamais issu d'une entrée utilisateur).
    fn column(self) -> &'static str {
        match self {
            Self::Message(_) => "message_id",
            Self::ThreadMessage(_) => "thread_message_id",
            Self::ForumReply(_) => "forum_reply_id",
        }
    }
    fn id(self) -> Uuid {
        match self {
            Self::Message(id) | Self::ThreadMessage(id) | Self::ForumReply(id) => id,
        }
    }
}

/// Admins/modérateurs/propriétaires peuvent uploader n'importe quel type de fichier.
pub async fn is_upload_privileged(state: &AppState, server_id: Uuid, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
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
    .bind(user_id)
    .bind(Permissions::ADMINISTRATOR)
    .bind(Permissions::MANAGE_MESSAGES)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

/// Enregistre les fichiers d'un multipart sur disque et dans `attachments`,
/// rattachés à `owner`. Validations communes à toutes les sources : taille,
/// liste blanche d'extensions (sauf privilégiés), MIME dérivé de l'extension,
/// nom nettoyé, nom de fichier disque aléatoire.
pub async fn store_attachments(
    state: &AppState,
    multipart: &mut Multipart,
    privileged: bool,
    owner: AttachmentOwner,
) -> Result<Vec<serde_json::Value>> {
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

        // Le Content-Type du client est ignoré : dérivé de l'extension (anti-spoofing)
        let data = field.bytes().await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() as u64 > state.config.max_upload_size {
            return Err(AppError::BadRequest("Fichier trop volumineux (max 50MB)".into()));
        }

        // Valider et normaliser l'extension — bloquer les types dangereux
        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_lowercase();

        if !privileged && !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::BadRequest(
                format!("Extension .{} non autorisée (admin/modérateur requis pour ce type)", ext)
            ));
        }

        let content_type = mime_guess::from_ext(&ext)
            .first_raw()
            .unwrap_or("application/octet-stream")
            .to_string();

        // Nettoyer le nom de fichier original (path traversal protection)
        let safe_name = std::path::Path::new(&original_name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("fichier")
            .replace(['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'], "_");

        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        tokio::fs::write(upload_dir.join(&filename), &data).await
            .map_err(|e| AppError::Internal(e.into()))?;

        let url = format!("/uploads/{}", filename);
        let size = data.len() as i64;
        // Pièce jointe éphémère : 1 h à 30 jours (même raison que les messages éphémères).
        let expires_at = ttl_hours.map(|h| Utc::now() + Duration::hours(h.clamp(1, 24 * 30)));

        let attachment = sqlx::query(&format!(
            "INSERT INTO attachments ({}, filename, content_type, size, url, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, url, filename, content_type, size, expires_at",
            owner.column()
        ))
        .bind(owner.id())
        .bind(&safe_name)
        .bind(&content_type)
        .bind(size)
        .bind(&url)
        .bind(expires_at)
        .fetch_one(&state.db)
        .await?;

        use sqlx::Row;
        uploaded.push(serde_json::json!({
            "id": attachment.get::<Uuid, _>("id"),
            "url": attachment.get::<String, _>("url"),
            "filename": attachment.get::<String, _>("filename"),
            "content_type": attachment.get::<String, _>("content_type"),
            "size": attachment.get::<i64, _>("size"),
            "expires_at": attachment.get::<Option<chrono::DateTime<Utc>>, _>("expires_at"),
        }));
    }

    Ok(uploaded)
}

/// Pièces jointes non expirées de plusieurs propriétaires d'une même source,
/// groupées par identifiant de propriétaire.
pub async fn attachments_by_owner(
    state: &AppState,
    kind: fn(Uuid) -> AttachmentOwner,
    ids: &[Uuid],
) -> std::collections::HashMap<Uuid, Vec<serde_json::Value>> {
    use sqlx::Row;
    let mut map: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    if ids.is_empty() { return map; }
    let col = kind(Uuid::nil()).column();
    let rows = sqlx::query(&format!(
        "SELECT id, {col} AS owner_id, url, filename, content_type, size, expires_at
         FROM attachments WHERE {col} = ANY($1) AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at"
    ))
    .bind(ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    for r in rows {
        map.entry(r.get::<Uuid, _>("owner_id")).or_default().push(serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "url": r.get::<String, _>("url"),
            "filename": r.get::<String, _>("filename"),
            "content_type": r.get::<String, _>("content_type"),
            "size": r.get::<i64, _>("size"),
            "expires_at": r.get::<Option<chrono::DateTime<Utc>>, _>("expires_at"),
        }));
    }
    map
}

/// Supprime du disque les fichiers `/uploads/<nom>` (en tâche de fond, échec
/// silencieux : la base est la source de vérité).
pub fn remove_upload_files(state: &AppState, urls: Vec<String>) {
    if urls.is_empty() { return; }
    let upload_dir = state.config.upload_dir.clone();
    tokio::spawn(async move {
        for url in urls {
            if let Some(rel) = url.strip_prefix("/uploads/") {
                if rel.contains("..") || rel.contains('/') || rel.contains('\\') { continue; }
                let _ = tokio::fs::remove_file(std::path::Path::new(&upload_dir).join(rel)).await;
            }
        }
    });
}

pub async fn upload_file(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, true).await?;

    // Vérifier que le message appartient à l'utilisateur courant et est dans ce canal (IDOR protection)
    let msg_owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2 AND user_id=$3)"
    )
    .bind(message_id)
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;
    if !msg_owned {
        return Err(AppError::Forbidden);
    }

    let privileged = is_upload_privileged(&state, server_id, claims.sub).await;
    let uploaded = store_attachments(&state, &mut multipart, privileged, AttachmentOwner::Message(message_id)).await?;

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

/// POST .../threads/:thread_id/messages/:msg_id/attachments
pub async fn upload_thread_attachment(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, thread_id, msg_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, true).await?;

    // Message de l'utilisateur, dans ce fil, dans ce salon (IDOR)
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
         WHERE tm.id=$1 AND tm.thread_id=$2 AND t.channel_id=$3 AND tm.user_id=$4)"
    )
    .bind(msg_id).bind(thread_id).bind(channel_id).bind(claims.sub)
    .fetch_one(&state.db).await?;
    if !owned { return Err(AppError::Forbidden); }

    let privileged = is_upload_privileged(&state, server_id, claims.sub).await;
    let uploaded = store_attachments(&state, &mut multipart, privileged, AttachmentOwner::ThreadMessage(msg_id)).await?;

    if !uploaded.is_empty() {
        state.broadcast_to_channel_members(channel_id, serde_json::json!({
            "type": "THREAD_ATTACHMENT_ADDED",
            "thread_id": thread_id,
            "channel_id": channel_id,
            "message_id": msg_id,
            "attachments": uploaded,
        }).to_string()).await;
    }
    Ok(Json(uploaded))
}

/// POST .../posts/:post_id/replies/:reply_id/attachments
pub async fn upload_forum_reply_attachment(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, post_id, reply_id)): Path<(Uuid, Uuid, Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<Vec<serde_json::Value>>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, true).await?;

    // Réponse de l'utilisateur, sous ce post, dans ce salon (IDOR)
    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM forum_replies fr JOIN forum_posts fp ON fp.id = fr.post_id
         WHERE fr.id=$1 AND fr.post_id=$2 AND fp.channel_id=$3 AND fr.user_id=$4)"
    )
    .bind(reply_id).bind(post_id).bind(channel_id).bind(claims.sub)
    .fetch_one(&state.db).await?;
    if !owned { return Err(AppError::Forbidden); }

    let privileged = is_upload_privileged(&state, server_id, claims.sub).await;
    let uploaded = store_attachments(&state, &mut multipart, privileged, AttachmentOwner::ForumReply(reply_id)).await?;

    if !uploaded.is_empty() {
        state.broadcast_to_channel_members(channel_id, serde_json::json!({
            "type": "FORUM_REPLY_ATTACHMENT_ADDED",
            "post_id": post_id,
            "channel_id": channel_id,
            "reply_id": reply_id,
            "attachments": uploaded,
        }).to_string()).await;
    }
    Ok(Json(uploaded))
}

/// Upload simple pour les forums : sauvegarde une image/vidéo et renvoie son
/// URL, à insérer dans le contenu du post ou de la réponse (pas de table
/// d'attachments dédiée pour les forums)
pub async fn forum_upload(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    crate::handlers::servers::require_can_post(&state, claims.sub, server_id, channel_id, true).await?;

    const FORUM_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "mov"];

    let upload_dir = PathBuf::from(&state.config.upload_dir);
    tokio::fs::create_dir_all(&upload_dir).await
        .map_err(|e| AppError::Internal(e.into()))?;

    if let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let original_name = field.file_name().unwrap_or("fichier").to_string();
        let data = field.bytes().await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;

        if data.len() as u64 > state.config.max_upload_size {
            return Err(AppError::BadRequest("Fichier trop volumineux (max 50MB)".into()));
        }

        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !FORUM_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::BadRequest(
                "Seules les images (jpg, png, gif, webp) et vidéos (mp4, webm, mov) sont autorisées".into()
            ));
        }

        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        let file_path = upload_dir.join(&filename);
        tokio::fs::write(&file_path, &data).await
            .map_err(|e| AppError::Internal(e.into()))?;

        return Ok(Json(serde_json::json!({ "url": format!("/uploads/{}", filename) })));
    }

    Err(AppError::BadRequest("Aucun fichier reçu".into()))
}
