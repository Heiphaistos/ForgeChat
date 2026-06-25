use axum::{extract::Path, response::IntoResponse, Json};
use serde_json::json;

pub async fn check_update(
    Path((target, arch, version)): Path<(String, String, String)>,
) -> impl IntoResponse {
    let latest_version = "3.2.0";

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
