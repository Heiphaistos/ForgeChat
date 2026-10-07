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

/// Médias acceptés par les forums et les salons médias (images et vidéos).
pub const FORUM_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm", "mov"];

/// Extension d'une image d'avatar / de bannière : liste blanche stricte sur le type MIME.
pub fn image_ext(content_type: &str) -> Result<&'static str> {
    match content_type {
        "image/png" => Ok("png"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        _ => Err(AppError::BadRequest(
            "Type de fichier non supporté. Acceptés: PNG, GIF, WEBP, JPEG".into()
        )),
    }
}

/// Écrit un fichier reçu morceau par morceau sur le disque, sans jamais le charger entier en
/// mémoire (jusqu'à 500 Mo par fichier). Au-delà de `max` octets, le fichier partiel est supprimé
/// et l'envoi refusé. Rend la taille écrite.
pub async fn save_field(field: axum::extract::multipart::Field<'_>, path: &std::path::Path, max: u64) -> Result<u64> {
    write_field(field, path, max, || format!("Fichier trop volumineux (max {} Mo)", max / 1_048_576)).await
}

async fn write_field(
    mut field: axum::extract::multipart::Field<'_>,
    path: &std::path::Path,
    max: u64,
    too_big: impl FnOnce() -> String,
) -> Result<u64> {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(path).await.map_err(|e| AppError::Internal(e.into()))?;
    let mut total: u64 = 0;
    loop {
        let chunk = match field.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = tokio::fs::remove_file(path).await;
                return Err(AppError::BadRequest(e.to_string()));
            }
        };
        total += chunk.len() as u64;
        if total > max {
            drop(file);
            let _ = tokio::fs::remove_file(path).await;
            return Err(AppError::PayloadTooLarge(too_big()));
        }
        if let Err(e) = file.write_all(&chunk).await {
            drop(file);
            let _ = tokio::fs::remove_file(path).await;
            return Err(AppError::Internal(e.into()));
        }
    }
    file.flush().await.map_err(|e| AppError::Internal(e.into()))?;
    Ok(total)
}

fn fmt_bytes(n: u64) -> String {
    if n >= 1 << 30 { format!("{:.1} Go", n as f64 / (1u64 << 30) as f64) } else { format!("{} Mo", n >> 20) }
}

/// Droit d'envoi d'un compte pour une requête : débit (429) puis quota de stockage (413).
/// `save` écrit chaque fichier en bornant sa taille au reste du quota.
pub struct UploadBudget {
    remaining: u64,
}

impl UploadBudget {
    pub async fn open(state: &AppState, user_id: Uuid) -> Result<Self> {
        {
            use redis::AsyncCommands;
            let key = format!("upload_rl:{user_id}");
            let mut redis = state.redis.lock().await;
            let count: i64 = redis.incr(&key, 1).await
                .map_err(|_| AppError::Internal(anyhow::anyhow!("rate limit unavailable")))?;
            if count == 1 { let _: () = redis.expire(&key, 60).await.unwrap_or(()); }
            if count > state.config.upload_rate_per_minute {
                return Err(AppError::TooManyRequestsMsg(
                    "Trop d'envois de fichiers : réessayez dans une minute".into(),
                ));
            }
        }
        // ponytail: usage lu une fois par requête, deux envois simultanés peuvent dépasser
        // le quota d'un fichier ; verrou par compte si ça devient un problème.
        let used: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(size), 0)::BIGINT FROM attachments WHERE uploader_id = $1",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;
        let quota = state.config.upload_quota_bytes;
        let remaining = quota.saturating_sub(used.max(0) as u64);
        if remaining == 0 {
            return Err(AppError::PayloadTooLarge(format!(
                "Quota de stockage atteint ({}) : supprimez d'anciens fichiers pour en envoyer d'autres",
                fmt_bytes(quota)
            )));
        }
        Ok(Self { remaining })
    }

    pub async fn save(&mut self, state: &AppState, field: axum::extract::multipart::Field<'_>, path: &std::path::Path) -> Result<i64> {
        let per_file = state.config.max_upload_size;
        let (max, remaining) = (per_file.min(self.remaining), self.remaining);
        let size = write_field(field, path, max, || {
            if max < per_file {
                format!(
                    "Quota de stockage dépassé : il vous reste {} sur {}",
                    fmt_bytes(remaining),
                    fmt_bytes(state.config.upload_quota_bytes)
                )
            } else {
                format!("Fichier trop volumineux (max {} Mo)", per_file / 1_048_576)
            }
        }).await?;
        self.remaining -= size;
        Ok(size as i64)
    }
}

/// Propriétaire d'une pièce jointe : une colonne de `attachments` par source.
#[derive(Clone, Copy)]
pub enum AttachmentOwner {
    Message(Uuid),
    ThreadMessage(Uuid),
    ForumReply(Uuid),
    DmMessage(Uuid),
    GroupMessage(Uuid),
}

impl AttachmentOwner {
    /// Nom de colonne figé (jamais issu d'une entrée utilisateur).
    fn column(self) -> &'static str {
        match self {
            Self::Message(_) => "message_id",
            Self::ThreadMessage(_) => "thread_message_id",
            Self::ForumReply(_) => "forum_reply_id",
            Self::DmMessage(_) => "dm_message_id",
            Self::GroupMessage(_) => "group_dm_message_id",
        }
    }
    fn id(self) -> Uuid {
        match self {
            Self::Message(id) | Self::ThreadMessage(id) | Self::ForumReply(id) | Self::DmMessage(id) | Self::GroupMessage(id) => id,
        }
    }
}

// ─── Pièces jointes chiffrées de bout en bout (docs/CHIFFREMENT-E2E.md §12) ──

/// Blob chiffré : nom `<uuid du fichier>.enc` choisi par l'appli (l'uuid est dans
/// le message chiffré, qui fait le lien), contenu opaque. Rend le nom normalisé.
pub fn encrypted_blob_name(name: &str) -> Option<String> {
    let id: Uuid = name.strip_suffix(".enc")?.parse().ok()?;
    Some(format!("{id}.enc"))
}

/// Mode des fichiers joints à un message : chiffrement obligatoire, un fichier
/// n'est accepté que joint à un message chiffré (blob opaque), sinon
/// PLAINTEXT_REFUSED comme le texte. Rend vrai pour « chiffrés ».
pub fn file_mode(message_encrypted: bool) -> Result<bool> {
    if message_encrypted {
        Ok(true)
    } else {
        Err(crate::handlers::e2e_conv::plaintext_refused())
    }
}

/// Fichiers d'un message de salon (message, fil, réponse de forum).
/// `message_encrypted` vaut None si le message n'est pas à l'appelant (IDOR).
async fn channel_file_mode(_state: &AppState, message_encrypted: Option<bool>, _user: Uuid) -> Result<bool> {
    file_mode(message_encrypted.ok_or(AppError::Forbidden)?)
}

/// Fichiers d'un MP ou d'un groupe.
pub async fn conv_file_mode(_state: &AppState, message_encrypted: bool, _conv: crate::handlers::e2e_conv::Conv) -> Result<bool> {
    file_mode(message_encrypted)
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
/// nom nettoyé, nom de fichier disque aléatoire. `encrypted` : seuls des blobs
/// chiffrés `<uuid>.enc` sont acceptés (rangés en `application/octet-stream`).
pub async fn store_attachments(
    state: &AppState,
    multipart: &mut Multipart,
    privileged: bool,
    owner: AttachmentOwner,
    user_id: Uuid,
    encrypted: bool,
) -> Result<Vec<serde_json::Value>> {
    let mut budget = UploadBudget::open(state, user_id).await?;
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
        // Pièce jointe éphémère : 1 h à 30 jours (même raison que les messages éphémères).
        let expires_at = ttl_hours.map(|h| Utc::now() + Duration::hours(h.clamp(1, 24 * 30)));

        if encrypted {
            // Conversation chiffrée : le serveur ne reçoit qu'un blob opaque.
            let name = encrypted_blob_name(&original_name)
                .ok_or_else(|| AppError::BadRequest(crate::handlers::e2e_conv::PLAINTEXT_REFUSED.into()))?;
            let filename = format!("{}.enc", Uuid::new_v4());
            let size = budget.save(state, field, &upload_dir.join(&filename)).await?;
            let url = format!("/uploads/{filename}");
            uploaded.push(insert_attachment(state, owner, &name, "application/octet-stream", size, &url, expires_at, user_id).await?);
            continue;
        }

        // Le Content-Type du client est ignoré : dérivé de l'extension (anti-spoofing)
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
        let size = budget.save(state, field, &upload_dir.join(&filename)).await?;

        let url = format!("/uploads/{}", filename);
        uploaded.push(insert_attachment(state, owner, &safe_name, &content_type, size, &url, expires_at, user_id).await?);
    }

    Ok(uploaded)
}

#[allow(clippy::too_many_arguments)]
async fn insert_attachment(
    state: &AppState,
    owner: AttachmentOwner,
    filename: &str,
    content_type: &str,
    size: i64,
    url: &str,
    expires_at: Option<chrono::DateTime<Utc>>,
    user_id: Uuid,
) -> Result<serde_json::Value> {
    use sqlx::Row;
    let attachment = sqlx::query(&format!(
        "INSERT INTO attachments ({}, filename, content_type, size, url, expires_at, uploader_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, url, filename, content_type, size, expires_at",
        owner.column()
    ))
    .bind(owner.id())
    .bind(filename)
    .bind(content_type)
    .bind(size)
    .bind(url)
    .bind(expires_at)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    Ok(serde_json::json!({
        "id": attachment.get::<Uuid, _>("id"),
        "url": attachment.get::<String, _>("url"),
        "filename": attachment.get::<String, _>("filename"),
        "content_type": attachment.get::<String, _>("content_type"),
        "size": attachment.get::<i64, _>("size"),
        "expires_at": attachment.get::<Option<chrono::DateTime<Utc>>, _>("expires_at"),
    }))
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

    // Message de l'utilisateur courant, dans ce canal (IDOR) ; chiffré ou non.
    let enc: Option<bool> = sqlx::query_scalar(
        "SELECT enc IS NOT NULL FROM messages WHERE id=$1 AND channel_id=$2 AND user_id=$3"
    )
    .bind(message_id)
    .bind(channel_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;
    let encrypted = channel_file_mode(&state, enc, claims.sub).await?;

    let privileged = is_upload_privileged(&state, server_id, claims.sub).await;
    let uploaded = store_attachments(&state, &mut multipart, privileged, AttachmentOwner::Message(message_id), claims.sub, encrypted).await?;

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
    let enc: Option<bool> = sqlx::query_scalar(
        "SELECT tm.enc IS NOT NULL FROM thread_messages tm JOIN threads t ON t.id = tm.thread_id
         WHERE tm.id=$1 AND tm.thread_id=$2 AND t.channel_id=$3 AND tm.user_id=$4"
    )
    .bind(msg_id).bind(thread_id).bind(channel_id).bind(claims.sub)
    .fetch_optional(&state.db).await?;
    let encrypted = channel_file_mode(&state, enc, claims.sub).await?;

    let privileged = is_upload_privileged(&state, server_id, claims.sub).await;
    let uploaded = store_attachments(&state, &mut multipart, privileged, AttachmentOwner::ThreadMessage(msg_id), claims.sub, encrypted).await?;

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
    let enc: Option<bool> = sqlx::query_scalar(
        "SELECT fr.enc IS NOT NULL FROM forum_replies fr JOIN forum_posts fp ON fp.id = fr.post_id
         WHERE fr.id=$1 AND fr.post_id=$2 AND fp.channel_id=$3 AND fr.user_id=$4"
    )
    .bind(reply_id).bind(post_id).bind(channel_id).bind(claims.sub)
    .fetch_optional(&state.db).await?;
    let encrypted = channel_file_mode(&state, enc, claims.sub).await?;

    let privileged = is_upload_privileged(&state, server_id, claims.sub).await;
    let uploaded = store_attachments(&state, &mut multipart, privileged, AttachmentOwner::ForumReply(reply_id), claims.sub, encrypted).await?;

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

    let upload_dir = PathBuf::from(&state.config.upload_dir);
    tokio::fs::create_dir_all(&upload_dir).await
        .map_err(|e| AppError::Internal(e.into()))?;

    // Chiffrement obligatoire : les médias d'une publication sont toujours des
    // blobs opaques (clé dans le contenu chiffré de la publication).
    let encrypted = true;
    let mut budget = UploadBudget::open(&state, claims.sub).await?;
    if let Some(field) = multipart.next_field().await
        .map_err(|e| AppError::BadRequest(e.to_string()))? {

        let original_name = field.file_name().unwrap_or("fichier").to_string();
        let ext = std::path::Path::new(&original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if encrypted {
            let name = encrypted_blob_name(&original_name)
                .ok_or_else(|| AppError::BadRequest(crate::handlers::e2e_conv::PLAINTEXT_REFUSED.into()))?;
            let filename = format!("{}.enc", Uuid::new_v4());
            let size = budget.save(&state, field, &upload_dir.join(&filename)).await?;
            let url = format!("/uploads/{filename}");
            sqlx::query(
                "INSERT INTO attachments (filename, content_type, size, url, uploader_id) VALUES ($1, 'application/octet-stream', $2, $3, $4)"
            )
            .bind(&name).bind(size).bind(&url).bind(claims.sub)
            .execute(&state.db).await?;
            return Ok(Json(serde_json::json!({ "url": url })));
        }

        if !FORUM_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::BadRequest(
                "Seules les images (jpg, png, gif, webp) et vidéos (mp4, webm, mov) sont autorisées".into()
            ));
        }

        let filename = format!("{}.{}", Uuid::new_v4(), ext);
        let size = budget.save(&state, field, &upload_dir.join(&filename)).await?;
        let url = format!("/uploads/{}", filename);
        // Ligne sans message propriétaire, seulement pour compter le fichier dans le quota
        // (l'URL est collée dans le contenu du post).
        sqlx::query(
            "INSERT INTO attachments (filename, content_type, size, url, uploader_id) VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(filename.as_str())
        .bind(mime_guess::from_ext(&ext).first_raw().unwrap_or("application/octet-stream"))
        .bind(size)
        .bind(&url)
        .bind(claims.sub)
        .execute(&state.db)
        .await?;

        return Ok(Json(serde_json::json!({ "url": url })));
    }

    Err(AppError::BadRequest("Aucun fichier reçu".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nom_de_blob_chiffre() {
        let id = "0b8f6c1e-2d3a-4e5f-9a8b-7c6d5e4f3a21";
        let ok = format!("{id}.enc");
        assert_eq!(encrypted_blob_name(&ok).as_deref(), Some(ok.as_str()));
        // Majuscules normalisées ; tout le reste refusé (nom en clair, chemin, autre extension).
        assert_eq!(encrypted_blob_name(&format!("{}.enc", id.to_uppercase())).as_deref(), Some(ok.as_str()));
        for bad in ["photo.jpg".to_string(), "x.enc".into(), "../a.enc".into(), format!("{id}.jpg"), format!("{id}.enc.jpg"), format!("dir/{id}.enc"), String::new()] {
            assert_eq!(encrypted_blob_name(&bad), None, "{bad}");
        }
    }

    #[test]
    fn mode_des_fichiers() {
        // Message chiffré : fichiers chiffrés.
        assert!(file_mode(true).unwrap());
        // Message en clair : fichier toujours refusé (chiffrement obligatoire).
        match file_mode(false) {
            Err(AppError::BadRequest(m)) => assert!(m.starts_with("PLAINTEXT_REFUSED ")),
            other => panic!("{other:?}"),
        }
    }
}
