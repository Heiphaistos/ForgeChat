use axum::{extract::Path, response::IntoResponse, Json};
use serde_json::json;

pub async fn check_update(
    Path((_target, _arch, version)): Path<(String, String, String)>,
) -> impl IntoResponse {
    // NB: v3.7.0 a été buildée (release GitHub) mais jamais copiée sur
    // /opt/forgechat/downloads/ (étape scp manuelle documentée non faite) --
    // pointer vers la version réellement téléchargeable publiquement, pas
    // la dernière buildée, sinon l'updater renvoie un lien mort.
    let latest_version = "3.6.0";

    // Retourner null si déjà à jour (format attendu par Tauri updater)
    if version == latest_version {
        return Json(json!(null));
    }

    // Retourner les infos de mise à jour
    Json(json!({
        "version": latest_version,
        "notes": format!("ForgeChat {} est disponible. Téléchargez depuis https://forgechat.heiphaistos.org", latest_version),
        "pub_date": "2026-06-25T00:00:00Z",
        "platforms": {
            "windows-x86_64": {
                "signature": "",
                "url": format!("https://forgechat.heiphaistos.org/downloads/ForgeChat-Setup-v{}.exe", latest_version)
            }
        }
    }))
}
