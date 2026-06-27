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

const MAX_SOUND_BYTES: usize = 512 * 1024; // 512 KB
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

const MAX_SOUNDS_PER_SERVER: i64 = 50;

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
                let filename = field
                    .file_name()
                    .unwrap_or("sound.mp3")
                    .to_lowercase();
                file_ext = filename.rsplit('.').next().map(|s| s.to_string());
                let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
                if data.len() > MAX_SOUND_BYTES {
                    return Err(AppError::BadRequest("Fichier trop volumineux (max 512 KB)".into()));
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

    if row.is_none() {
        return Err(AppError::NotFound("Son introuvable ou non autorisé".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}
