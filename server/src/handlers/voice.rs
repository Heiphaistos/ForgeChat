use axum::{extract::State, Extension, Json};

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

/// GET /api/voice/ice-config
/// Retourne la configuration ICE (STUN + TURN si configuré).
/// Le client doit appeler cet endpoint une seule fois et mettre en cache le résultat.
pub async fn get_ice_config(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut servers = vec![
        serde_json::json!({
            "urls": [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302"
            ]
        }),
    ];

    // Ajouter le serveur TURN si configuré dans les variables d'environnement
    if let (Some(turn_url), Some(turn_user), Some(turn_pass)) = (
        &state.config.turn_url,
        &state.config.turn_username,
        &state.config.turn_password,
    ) {
        servers.push(serde_json::json!({
            "urls": [turn_url],
            "username": turn_user,
            "credential": turn_pass,
        }));
    }

    Ok(Json(serde_json::json!({ "ice_servers": servers })))
}
