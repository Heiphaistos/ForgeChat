//! Manifeste de mise à jour de l'application bureau (`GET /api/desktop/latest`).
//!
//! Le serveur ne fabrique rien : il sert un fichier JSON déposé à la
//! publication d'une release (voir `desktop/publier-manifeste.sh`), en
//! remplaçant simplement les chemins relatifs par des URL absolues.
//!
//! Pourquoi passer par un handler plutôt que servir le fichier en statique :
//! la base d'URL des artefacts est une variable d'environnement du VPS
//! (`FORGECHAT_DESKTOP_BASE_URL`), pas une valeur figée dans le fichier publié.
//! Le manifeste reste donc valable si les artefacts changent de domaine ou de
//! dossier, sans le régénérer.
//!
//! AUCUNE version n'est codée ici. La version courante est celle du binaire
//! bureau (`CARGO_PKG_VERSION` côté Tauri), la version disponible est celle
//! que porte le fichier publié.

use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::env;

/// Chemin du manifeste publié. Écrit par `desktop/publier-manifeste.sh`.
fn manifest_path() -> String {
    env::var("FORGECHAT_DESKTOP_MANIFEST")
        .unwrap_or_else(|_| "./desktop-releases/latest.json".into())
}

/// Base des URL de téléchargement des artefacts (dossier statique servi par
/// nginx). Sans barre finale.
fn base_url() -> String {
    env::var("FORGECHAT_DESKTOP_BASE_URL")
        .unwrap_or_else(|_| "https://forgechat.heiphaistos.org/desktop".into())
        .trim_end_matches('/')
        .to_string()
}

/// GET /api/desktop/latest — public, interrogé par l'updater bureau avant toute
/// authentification.
///
/// - 200 + manifeste quand une release est publiée ;
/// - 204 quand aucune ne l'est (l'updater traite « pas de contenu » comme
///   « rien de neuf », ce n'est pas une erreur) ;
/// - 500 si le fichier existe mais n'est pas du JSON exploitable.
pub async fn get_latest() -> Response {
    let path = manifest_path();

    let raw = match tokio::fs::read_to_string(&path).await {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => {
            tracing::error!("manifeste bureau illisible ({path}) : {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let mut manifest: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("manifeste bureau mal formé ({path}) : {e}");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    absolutise_urls(&mut manifest, &base_url());

    // Un manifeste change à chaque release : il ne doit jamais être servi
    // depuis un cache, sinon un client reste bloqué sur l'ancienne version.
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(manifest),
    )
        .into_response()
}

/// Préfixe chaque `platforms.*.url` relative par la base d'URL. Une URL déjà
/// absolue est laissée telle quelle (artefacts sur un autre hôte).
fn absolutise_urls(manifest: &mut serde_json::Value, base: &str) {
    let Some(platforms) = manifest.get_mut("platforms").and_then(|p| p.as_object_mut()) else {
        return;
    };
    for (_, entry) in platforms.iter_mut() {
        let Some(url) = entry.get("url").and_then(|u| u.as_str()) else {
            continue;
        };
        if url.starts_with("http://") || url.starts_with("https://") {
            continue;
        }
        let absolute = format!("{base}/{}", url.trim_start_matches('/'));
        entry["url"] = serde_json::Value::String(absolute);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prefixe_les_urls_relatives_et_laisse_les_absolues() {
        let mut m = json!({
            "version": "3.24.0",
            "platforms": {
                "windows-x86_64":   { "url": "ForgeChat-Setup-v3.24.0.exe", "sha256": "aa" },
                "windows-portable": { "url": "/ForgeChat-Portable-v3.24.0.exe", "sha256": "bb" },
                "linux-x86_64":     { "url": "https://ailleurs.example/x.deb", "sha256": "cc" },
            }
        });
        absolutise_urls(&mut m, "https://forgechat.heiphaistos.org/desktop");

        let p = &m["platforms"];
        assert_eq!(
            p["windows-x86_64"]["url"],
            "https://forgechat.heiphaistos.org/desktop/ForgeChat-Setup-v3.24.0.exe"
        );
        assert_eq!(
            p["windows-portable"]["url"],
            "https://forgechat.heiphaistos.org/desktop/ForgeChat-Portable-v3.24.0.exe"
        );
        assert_eq!(p["linux-x86_64"]["url"], "https://ailleurs.example/x.deb");
        // L'empreinte n'est jamais touchée.
        assert_eq!(p["windows-x86_64"]["sha256"], "aa");
    }

    #[test]
    fn un_manifeste_sans_plateformes_ne_fait_pas_paniquer() {
        let mut m = json!({ "version": "3.24.0" });
        absolutise_urls(&mut m, "https://x.example");
        assert_eq!(m["version"], "3.24.0");
    }
}
