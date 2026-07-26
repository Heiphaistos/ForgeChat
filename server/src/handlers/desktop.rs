use axum::{extract::Path, response::IntoResponse, Json};
use serde_json::json;

pub async fn check_update(
    Path((_target, _arch, version)): Path<(String, String, String)>,
) -> impl IntoResponse {
    // ⚠️ À mettre à jour à CHAQUE release desktop (comme LandingPage.tsx::RELEASE et
    // build.bat) -- déjà oublié une fois (3.2.0 laissé alors que le desktop était en
    // 3.7.0, itération 19), puis de nouveau ici (3.8.3 laissé alors que le desktop est
    // passé à 3.14.0 sur ~6 releases). Vérifier que le setup correspondant existe
    // vraiment dans /opt/forgechat/downloads/ avant de bumper cette constante.
    let latest_version = "3.14.0";

    // Retourner null si déjà à jour (format attendu par Tauri updater)
    if version == latest_version {
        return Json(json!(null));
    }

    // Retourner les infos de mise à jour
    Json(json!({
        "version": latest_version,
        "notes": format!("ForgeChat {} est disponible. Téléchargez depuis https://forgechat.heiphaistos.org", latest_version),
        "pub_date": "2026-07-26T19:42:00Z",
        "platforms": {
            "windows-x86_64": {
                "signature": "",
                "url": format!("https://forgechat.heiphaistos.org/downloads/ForgeChat-Setup-v{}.exe", latest_version)
            }
        }
    }))
}
