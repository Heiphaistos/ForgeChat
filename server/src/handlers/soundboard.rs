use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use serde::Serialize;
use std::path::PathBuf;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_permission,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

const MAX_SOUND_BYTES: usize = 2 * 1024 * 1024; // 2 Mo (Discord : 512 Ko)
const ALLOWED_EXTS: &[&str] = &["mp3", "wav", "ogg", "webm", "m4a"];

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SoundboardEntry {
    pub id: Uuid,
    pub name: String,
    pub emoji: Option<String>,
    pub file_url: String,
    pub volume: f32,
    pub uploader_id: Uuid,
}

async fn ensure_member(
    state: &AppState,
    server_id: Uuid,
    user_id: Uuid,
) -> Result<()> {
    let ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

/// GET /users/me/soundboard — sons de tous ses serveurs, jouables dans n'importe quel salon vocal
/// (gratuit ; Discord le réserve à Nitro).
pub async fn my_sounds(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT sb.id, sb.name, sb.emoji, sb.file_url, sb.server_id, s.name AS server_name
         FROM soundboard sb
         JOIN server_members m ON m.server_id = sb.server_id AND m.user_id = $1
         JOIN servers s ON s.id = sb.server_id
         ORDER BY s.name, sb.name
         LIMIT 2000",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "emoji": r.get::<Option<String>, _>("emoji"),
        "file_url": r.get::<String, _>("file_url"),
        "server_id": r.get::<Uuid, _>("server_id"),
        "server_name": r.get::<String, _>("server_name"),
    })).collect()))
}

pub async fn list_sounds(
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<Vec<SoundboardEntry>>> {
    ensure_member(&state, server_id, claims.sub).await?;

    let sounds = sqlx::query_as::<_, SoundboardEntry>(
        "SELECT id, name, emoji, file_url, volume, uploader_id
         FROM soundboard WHERE server_id = $1 ORDER BY name"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(sounds))
}

const MAX_SOUNDS_PER_SERVER: i64 = 200;

pub async fn upload_sound(
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<SoundboardEntry>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM soundboard WHERE server_id=$1")
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
    if count >= MAX_SOUNDS_PER_SERVER {
        return Err(AppError::BadRequest(
            format!("Maximum {} sons par serveur atteint", MAX_SOUNDS_PER_SERVER)
        ));
    }

    let mut name: Option<String> = None;
    let mut emoji: Option<String> = None;
    let mut file_bytes: Vec<u8> = Vec::new();
    let mut file_ext: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(format!("multipart error: {e}"))
    })? {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "name" => {
                name = Some(field.text().await.map_err(|e| AppError::BadRequest(e.to_string()))?);
            }
            "emoji" => {
                emoji = Some(field.text().await.map_err(|e| AppError::BadRequest(e.to_string()))?);
            }
            "file" => {
                // stickers.rs/emojis.rs valident déjà content_type() (pas seulement le nom
                // de fichier, entièrement contrôlé par le client) avant d'accepter un upload
                // -- soundboard.rs ne le faisait pas, seule extension manquante du même trio
                // de handlers d'upload. Sans ça, n'importe quel fichier pouvait être déposé
                // sous `/uploads/sounds/` tant que son NOM se terminait par une extension
                // autorisée, peu importe son contenu réel.
                let ct = field.content_type().unwrap_or("").to_string();
                if !ct.starts_with("audio/") {
                    return Err(AppError::BadRequest("Seuls les fichiers audio sont acceptés".into()));
                }
                let filename = field
                    .file_name()
                    .unwrap_or("sound.mp3")
                    .to_lowercase();
                file_ext = filename.rsplit('.').next().map(|s| s.to_string());
                let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
                if data.len() > MAX_SOUND_BYTES {
                    return Err(AppError::BadRequest("Fichier trop volumineux (max 2 Mo)".into()));
                }
                file_bytes = data.to_vec();
            }
            _ => {}
        }
    }

    let name = name.filter(|n| !n.trim().is_empty())
        .ok_or_else(|| AppError::BadRequest("Nom requis".into()))?;
    let ext = file_ext.ok_or_else(|| AppError::BadRequest("Fichier requis".into()))?;

    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(AppError::BadRequest(
            format!("Extension non supportée. Autorisées : {}", ALLOWED_EXTS.join(", "))
        ));
    }
    if file_bytes.is_empty() {
        return Err(AppError::BadRequest("Fichier vide".into()));
    }

    // Sauvegarde du fichier dans le répertoire uploads configuré
    let sound_id = Uuid::new_v4();
    let filename = format!("{sound_id}.{ext}");
    let upload_dir = PathBuf::from(&state.config.upload_dir).join("sounds");
    tokio::fs::create_dir_all(&upload_dir)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let file_path = upload_dir.join(&filename);
    tokio::fs::write(&file_path, &file_bytes)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let file_url = format!("/uploads/sounds/{filename}");

    let sound = sqlx::query_as::<_, SoundboardEntry>(
        "INSERT INTO soundboard (id, server_id, name, emoji, file_url, uploader_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, emoji, file_url, volume, uploader_id"
    )
    .bind(sound_id)
    .bind(server_id)
    .bind(name.trim())
    .bind(emoji.as_deref())
    .bind(&file_url)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(sound))
}

pub async fn delete_sound(
    Extension(claims): Extension<Claims>,
    Path((server_id, sound_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    // Modérateurs (MANAGE_SERVER) ou uploadeur peuvent supprimer
    let is_mod = require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER)
        .await
        .is_ok();

    let row = if is_mod {
        sqlx::query(
            "DELETE FROM soundboard WHERE id = $1 AND server_id = $2 RETURNING file_url"
        )
        .bind(sound_id)
        .bind(server_id)
        .fetch_optional(&state.db)
        .await?
    } else {
        sqlx::query(
            "DELETE FROM soundboard WHERE id = $1 AND server_id = $2 AND uploader_id = $3
             RETURNING file_url"
        )
        .bind(sound_id)
        .bind(server_id)
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
    };

    let row = row.ok_or_else(|| AppError::NotFound("Son introuvable ou non autorisé".into()))?;

    use sqlx::Row;
    let file_url: String = row.get("file_url");

    // Supprimer le fichier physique avec protection path traversal (même schéma que stickers.rs/emojis.rs)
    let upload_dir = PathBuf::from(&state.config.upload_dir);
    let base = upload_dir.canonicalize().unwrap_or_else(|_| upload_dir.clone());
    if let Some(relative) = file_url.strip_prefix("/uploads/") {
        if !relative.contains("..") && !relative.contains('\0') {
            let path = upload_dir.join(relative);
            if let Ok(canonical) = path.canonicalize() {
                if canonical.starts_with(&base) {
                    let _ = tokio::fs::remove_file(&canonical).await;
                } else {
                    tracing::warn!("Path traversal bloqué pour soundboard delete : {:?}", canonical);
                }
            }
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
