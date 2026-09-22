//! « Importer un serveur Discord » depuis un export ZIP ArchiveForge.
//!
//! `POST /api/servers/import-discord { url }` : l'URL signée et temporaire du ZIP
//! doit être en https sur l'origine `ARCHIVEFORGE_URL` (anti-SSRF). Une tâche de
//! fond télécharge le ZIP, l'importe (voir `importer`) et met à jour
//! `server_imports`, que le client sonde via `GET /api/servers/import-discord/:id`.

mod format;
mod importer;
#[cfg(test)]
mod e2e_test;

use std::{path::PathBuf, time::Duration};

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use reqwest::Url;
use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

/// Erreur destinée à l'utilisateur (message affiché tel quel, en français).
#[derive(Debug)]
pub struct UserError(pub String);
impl std::fmt::Display for UserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for UserError {}

fn user_message(e: &anyhow::Error) -> String {
    e.downcast_ref::<UserError>()
        .map(|u| u.0.clone())
        .unwrap_or_else(|| "Erreur interne pendant l'import. Le serveur partiellement créé a été supprimé ; réessayez ou contactez l'administrateur.".into())
}

/// URL acceptée : https, même origine que `ARCHIVEFORGE_URL`, sans identifiants.
fn validate_url(raw: &str, allowed: &str) -> std::result::Result<Url, &'static str> {
    const INVALID: &str = "Lien invalide : collez le lien de transfert fourni par ArchiveForge.";
    if raw.len() > 2048 {
        return Err(INVALID);
    }
    let url = Url::parse(raw.trim()).map_err(|_| INVALID)?;
    let allowed = Url::parse(allowed).map_err(|_| INVALID)?;
    if url.scheme() != "https" || url.origin() != allowed.origin() || !url.username().is_empty() || url.password().is_some() {
        return Err("Lien refusé : seuls les liens https d'ArchiveForge sont acceptés.");
    }
    Ok(url)
}

#[derive(Deserialize)]
pub struct StartImport {
    pub url: String,
}

pub async fn start_import(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<StartImport>,
) -> Result<Json<serde_json::Value>> {
    let url = validate_url(&body.url, &state.config.archiveforge_url).map_err(|m| AppError::BadRequest(m.into()))?;

    let import_id: Uuid = match sqlx::query_scalar(
        "INSERT INTO server_imports (user_id, label) VALUES ($1, 'En attente') RETURNING id",
    )
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await
    {
        Ok(id) => id,
        // Index unique partiel : un seul import pending/running par utilisateur
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
            return Err(AppError::Conflict("Un import est déjà en cours pour ce compte.".into()));
        }
        Err(e) => return Err(e.into()),
    };

    tokio::spawn(run_job(state, claims.sub, import_id, url));
    Ok(Json(serde_json::json!({ "import_id": import_id })))
}

pub async fn get_import(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(import_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    use sqlx::Row;
    let r = sqlx::query(
        "SELECT id, status, progress, label, server_id, error, created_at, updated_at
         FROM server_imports WHERE id=$1 AND user_id=$2",
    )
    .bind(import_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Import introuvable".into()))?;
    Ok(Json(serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "status": r.get::<String, _>("status"),
        "progress": r.get::<i32, _>("progress"),
        "label": r.get::<Option<String>, _>("label"),
        "server_id": r.get::<Option<Uuid>, _>("server_id"),
        "error": r.get::<Option<String>, _>("error"),
        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
        "updated_at": r.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
    })))
}

/// Au démarrage : un import resté pending/running a été coupé par un redémarrage.
/// Son serveur partiel est supprimé, l'import marqué en échec, les ZIP temporaires effacés.
pub async fn recover_interrupted(state: &AppState) {
    let res = sqlx::query(
        "WITH stale AS (
             UPDATE server_imports
             SET status='failed', error='Import interrompu par un redémarrage du serveur ForgeChat. Relancez-le.',
                 updated_at=NOW()
             WHERE status IN ('pending', 'running')
             RETURNING server_id AS sid
         )
         DELETE FROM servers WHERE id IN (SELECT sid FROM stale WHERE sid IS NOT NULL)",
    )
    .execute(&state.db)
    .await;
    if let Err(e) = res {
        tracing::error!("Import Discord : reprise après redémarrage impossible : {e}");
    }
    let _ = tokio::fs::remove_dir_all(&state.config.discord_import_tmp_dir).await;
}

async fn set_state(state: &AppState, id: Uuid, status: &str, progress: i32, label: &str, error: Option<&str>) {
    let _ = sqlx::query(
        "UPDATE server_imports SET status=$2, progress=$3, label=$4, error=$5, updated_at=NOW(),
                server_id = CASE WHEN $2 = 'failed' THEN NULL ELSE server_id END
         WHERE id=$1",
    )
    .bind(id)
    .bind(status)
    .bind(progress)
    .bind(label)
    .bind(error)
    .execute(&state.db)
    .await;
}

async fn run_job(state: AppState, user_id: Uuid, id: Uuid, url: Url) {
    set_state(&state, id, "running", 0, "Téléchargement de l'archive", None).await;
    let tmp = PathBuf::from(&state.config.discord_import_tmp_dir).join(format!("{id}.zip"));
    let result = async {
        download(&state, &url, &tmp, id).await?;
        importer::run(&state.db, &state.config.upload_dir, user_id, id, &tmp).await
    }
    .await;
    let _ = tokio::fs::remove_file(&tmp).await;

    match result {
        Ok(server_id) => {
            tracing::info!("Import Discord {id} terminé : serveur {server_id}");
            set_state(&state, id, "completed", 100, "Terminé", None).await;
        }
        Err(e) => {
            tracing::error!("Import Discord {id} en échec : {e:?}");
            set_state(&state, id, "failed", 0, "Échec", Some(&user_message(&e))).await;
        }
    }
}

/// Téléchargement en flux vers `dest`, plafonné en taille, sans redirection hors origine.
async fn download(state: &AppState, url: &Url, dest: &std::path::Path, id: Uuid) -> anyhow::Result<()> {
    let user_err = |m: String| anyhow::Error::new(UserError(m));
    let max = state.config.discord_import_max_bytes;
    let origin = url.origin();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(move |a| {
            if a.previous().len() < 3 && a.url().scheme() == "https" && a.url().origin() == origin {
                a.follow()
            } else {
                a.stop()
            }
        }))
        .connect_timeout(Duration::from_secs(20))
        .user_agent(format!("ForgeChat/{}", crate::state::APP_VERSION))
        .build()?;

    let mut resp = tokio::time::timeout(Duration::from_secs(60), client.get(url.clone()).send())
        .await
        .map_err(|_| user_err("ArchiveForge ne répond pas (délai dépassé).".into()))?
        .map_err(|_| user_err("Impossible de joindre ArchiveForge.".into()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(user_err(match status.as_u16() {
            401 | 403 | 404 | 410 => "Lien de transfert expiré ou invalide : générez-en un nouveau dans ArchiveForge.".into(),
            300..=399 => "ArchiveForge a redirigé vers une adresse non autorisée.".into(),
            c => format!("ArchiveForge a refusé le téléchargement (HTTP {c})."),
        }));
    }
    let too_big = || user_err(format!("Archive trop volumineuse (maximum {} Go).", max / (1024 * 1024 * 1024)));
    let expected = resp.content_length();
    if expected.is_some_and(|l| l > max) {
        return Err(too_big());
    }

    tokio::fs::create_dir_all(dest.parent().unwrap_or(std::path::Path::new("."))).await?;
    let mut file = tokio::io::BufWriter::new(tokio::fs::File::create(dest).await?);
    let mut received: u64 = 0;
    let mut last_report = std::time::Instant::now();
    // Pas de plafond de durée totale (20 Go peuvent prendre des heures) : 2 min
    // sans aucun octet reçu = abandon.
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(120), resp.chunk())
            .await
            .map_err(|_| user_err("Téléchargement interrompu : ArchiveForge ne répond plus.".into()))?
            .map_err(|_| user_err("Téléchargement interrompu (connexion coupée).".into()))?;
        let Some(chunk) = chunk else { break };
        received += chunk.len() as u64;
        if received > max {
            return Err(too_big());
        }
        file.write_all(&chunk).await?;
        if last_report.elapsed() > Duration::from_secs(2) {
            last_report = std::time::Instant::now();
            let pct = expected.map(|l| (received * 20 / l.max(1)) as i32).unwrap_or(0).min(19);
            let label = format!("Téléchargement de l'archive ({} Mo)", received / (1024 * 1024));
            let _ = sqlx::query("UPDATE server_imports SET progress=$2, label=$3, updated_at=NOW() WHERE id=$1")
                .bind(id)
                .bind(pct)
                .bind(label)
                .execute(&state.db)
                .await;
        }
    }
    file.flush().await?;
    if expected.is_some_and(|l| l != received) {
        return Err(user_err("Téléchargement incomplet : relancez l'import.".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_url;

    #[test]
    fn url_must_be_https_on_archiveforge_origin() {
        let ok = "https://forgearchive.heiphaistos.org";
        assert!(validate_url("https://forgearchive.heiphaistos.org/api/transfer/abc?exp=1&sig=ff", ok).is_ok());
        assert!(validate_url("http://forgearchive.heiphaistos.org/api/transfer/abc", ok).is_err());
        assert!(validate_url("https://forgearchive.heiphaistos.org.evil.com/x", ok).is_err());
        assert!(validate_url("https://evil.com/?https://forgearchive.heiphaistos.org", ok).is_err());
        assert!(validate_url("https://user@forgearchive.heiphaistos.org/x", ok).is_err());
        assert!(validate_url("https://forgearchive.heiphaistos.org:8443/x", ok).is_err());
        assert!(validate_url("https://127.0.0.1/x", ok).is_err());
        assert!(validate_url("pas une url", ok).is_err());
    }
}
