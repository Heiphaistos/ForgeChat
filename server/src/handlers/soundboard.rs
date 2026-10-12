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

    let (name, emoji, file_url) = read_sound_upload(&state, &mut multipart).await?;
    let sound_id = Uuid::new_v4();

    let sound = sqlx::query_as::<_, SoundboardEntry>(
        "INSERT INTO soundboard (id, server_id, name, emoji, file_url, uploader_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, emoji, file_url, volume, uploader_id"
    )
    .bind(sound_id)
    .bind(server_id)
    .bind(&name)
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

    remove_sound_file(&state, &file_url).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Lit un envoi de son (champs `name`, `emoji`, `file`), le valide et l'enregistre sous
/// `/uploads/sounds/`. Renvoie (nom, emoji, adresse du fichier).
async fn read_sound_upload(state: &AppState, multipart: &mut Multipart) -> Result<(String, Option<String>, String)> {
    let mut name: Option<String> = None;
    let mut emoji: Option<String> = None;
    let mut file_bytes: Vec<u8> = Vec::new();
    let mut file_ext: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(format!("multipart error: {e}"))
    })? {
        match field.name().unwrap_or("") {
            "name" => name = Some(field.text().await.map_err(|e| AppError::BadRequest(e.to_string()))?),
            "emoji" => emoji = Some(field.text().await.map_err(|e| AppError::BadRequest(e.to_string()))?),
            "file" => {
                // Type MIME audio exigé (pas seulement l'extension, choisie par le client).
                let ct = field.content_type().unwrap_or("").to_string();
                if !ct.starts_with("audio/") {
                    return Err(AppError::BadRequest("Seuls les fichiers audio sont acceptés".into()));
                }
                let filename = field.file_name().unwrap_or("sound.mp3").to_lowercase();
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

    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty())
        .ok_or_else(|| AppError::BadRequest("Nom requis".into()))?;
    if name.chars().count() > 50 {
        return Err(AppError::BadRequest("Nom trop long (50 caractères au plus)".into()));
    }
    let emoji = emoji.map(|e| e.trim().to_string()).filter(|e| !e.is_empty());
    if emoji.as_ref().is_some_and(|e| e.chars().count() > 10) {
        return Err(AppError::BadRequest("Emoji invalide".into()));
    }
    let ext = file_ext.ok_or_else(|| AppError::BadRequest("Fichier requis".into()))?;
    if !ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(AppError::BadRequest(
            format!("Extension non supportée. Autorisées : {}", ALLOWED_EXTS.join(", "))
        ));
    }
    if file_bytes.is_empty() {
        return Err(AppError::BadRequest("Fichier vide".into()));
    }

    let filename = format!("{}.{ext}", Uuid::new_v4());
    let upload_dir = PathBuf::from(&state.config.upload_dir).join("sounds");
    tokio::fs::create_dir_all(&upload_dir).await.map_err(|e| AppError::Internal(e.into()))?;
    crate::antivirus::check(&file_bytes).await?;
    tokio::fs::write(upload_dir.join(&filename), &file_bytes).await.map_err(|e| AppError::Internal(e.into()))?;
    Ok((name, emoji, format!("/uploads/sounds/{filename}")))
}

/// Supprime le fichier d'un son, sans jamais sortir du dossier des envois (path traversal).
async fn remove_sound_file(state: &AppState, file_url: &str) {
    let upload_dir = PathBuf::from(&state.config.upload_dir);
    let base = upload_dir.canonicalize().unwrap_or_else(|_| upload_dir.clone());
    let Some(relative) = file_url.strip_prefix("/uploads/") else { return };
    if relative.contains("..") || relative.contains('\0') { return; }
    if let Ok(canonical) = upload_dir.join(relative).canonicalize() {
        if canonical.starts_with(&base) {
            let _ = tokio::fs::remove_file(&canonical).await;
        } else {
            tracing::warn!("Path traversal bloqué pour soundboard delete : {:?}", canonical);
        }
    }
}

// ─── Sons perso (à l'utilisateur, jouables dans tous ses salons vocaux) ──────

const MAX_SOUNDS_PER_USER: i64 = 30;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserSound {
    pub id: Uuid,
    pub name: String,
    pub emoji: Option<String>,
    pub file_url: String,
}

/// GET /users/me/sounds
pub async fn list_personal(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UserSound>>> {
    let rows = sqlx::query_as::<_, UserSound>(
        "SELECT id, name, emoji, file_url FROM user_sounds WHERE user_id = $1 ORDER BY name LIMIT 100",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

/// POST /users/me/sounds (multipart `name`, `emoji`, `file`)
pub async fn upload_personal(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<UserSound>> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_sounds WHERE user_id = $1")
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
    if count >= MAX_SOUNDS_PER_USER {
        return Err(AppError::BadRequest(format!("Maximum {MAX_SOUNDS_PER_USER} sons perso atteint")));
    }
    let (name, emoji, file_url) = read_sound_upload(&state, &mut multipart).await?;
    let sound = sqlx::query_as::<_, UserSound>(
        "INSERT INTO user_sounds (user_id, name, emoji, file_url) VALUES ($1, $2, $3, $4)
         RETURNING id, name, emoji, file_url",
    )
    .bind(claims.sub)
    .bind(&name)
    .bind(emoji.as_deref())
    .bind(&file_url)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(sound))
}

/// DELETE /users/me/sounds/:id — seulement ses propres sons.
pub async fn delete_personal(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(sound_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let file_url: String = sqlx::query_scalar(
        "DELETE FROM user_sounds WHERE id = $1 AND user_id = $2 RETURNING file_url",
    )
    .bind(sound_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Son introuvable".into()))?;
    remove_sound_file(&state, &file_url).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}
