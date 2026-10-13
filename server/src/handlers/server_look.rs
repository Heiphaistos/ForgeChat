//! Apparence d'un serveur (migration 135, models/server_look.rs) et envoi des images
//! du serveur (bannière, images de fond).
//!
//! Les bannières et images de fond passent par la même vérification que les images de
//! profil (profile_custom::store_image) : format relu dans les octets, dimensions et
//! nombre d'images bornés, antivirus, nom généré par le serveur, version fixe d'une
//! image animée. Aucune image n'est recadrée ni réduite : elle est gardée telle quelle,
//! en entier (le client l'affiche sans rognage, voir components/ui/ProfileBanner.tsx).

use axum::{
    extract::{Multipart, Path, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{audit::log_event, profile_custom, servers::require_owner},
    middleware::auth::Claims,
    models::{server::Server, server_look::parse_server_look},
    state::AppState,
};

/// Bannière de serveur : 10 Mo (avant : 2 Mo, type déclaré cru sur parole, sans contrôle
/// des dimensions). Jusqu'à 4096 × 4096 px (image_probe::MAX_DIM), animations gardées.
pub const SERVER_BANNER_MAX: usize = 10 * 1024 * 1024;
/// Image de fond (liste des salons, zone des messages).
pub const LOOK_IMAGE_MAX: usize = 10 * 1024 * 1024;
const DIR: &str = "server-banners";

/// Premier champ fichier du multipart, quel que soit son nom (le web envoyait `icon`,
/// le mobile `banner`). Type déclaré vérifié, puis format réel relu par store_image.
async fn read_first_image(multipart: &mut Multipart, max: usize) -> Result<bytes::Bytes> {
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        if field.file_name().is_none() && field.content_type().is_none() {
            continue;
        }
        crate::handlers::uploads::image_ext(field.content_type().unwrap_or("image/jpeg"))?;
        let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
        if data.len() > max {
            return Err(AppError::BadRequest(format!("Fichier trop grand (max {} Mo)", max / 1_048_576)));
        }
        return Ok(data);
    }
    Err(AppError::BadRequest("Champ image manquant".into()))
}

async fn broadcast_server(state: &AppState, server_id: Uuid) -> Result<Server> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_one(&state.db)
        .await?;
    let event = serde_json::json!({ "type": "SERVER_UPDATE", "server_id": server_id, "server": server });
    state.broadcast_to_server_members(server_id, event.to_string()).await;
    Ok(server)
}

/// POST /servers/:server_id/banner — PNG, JPEG, GIF, WebP (animés gardés), 10 Mo.
pub async fn upload_server_banner(
    state: AppState,
    claims: Claims,
    server_id: Uuid,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;
    profile_custom::upload_rate_limit(&state, claims.sub).await?;
    let data = read_first_image(&mut multipart, SERVER_BANNER_MAX).await?;
    let url = profile_custom::store_image(&state, DIR, &data).await?;
    sqlx::query("UPDATE servers SET banner=$2 WHERE id=$1")
        .bind(server_id)
        .bind(&url)
        .execute(&state.db)
        .await?;
    log_event(&state, server_id, "SERVER_UPDATE", Some(claims.sub), None, None, None, None).await;
    broadcast_server(&state, server_id).await?;
    Ok(Json(serde_json::json!({ "banner": url })))
}

/// POST /servers/:server_id/look/image — image de fond, rendue en `{ url }` ; elle n'est
/// utilisée qu'une fois placée dans l'apparence (PUT /servers/:server_id/look).
pub async fn upload_look_image(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    require_owner(&state, claims.sub, server_id).await?;
    profile_custom::upload_rate_limit(&state, claims.sub).await?;
    let data = read_first_image(&mut multipart, LOOK_IMAGE_MAX).await?;
    let url = profile_custom::store_image(&state, DIR, &data).await?;
    Ok(Json(serde_json::json!({ "url": url })))
}

/// PUT /servers/:server_id/look — apparence complète (remplace l'ancienne) ; `null` = par défaut.
pub async fn put_look(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<Server>> {
    require_owner(&state, claims.sub, server_id).await?;
    let look = parse_server_look(&body).map_err(|e| AppError::BadRequest(e.into()))?;
    sqlx::query("UPDATE servers SET look=$2 WHERE id=$1")
        .bind(server_id)
        .bind(look)
        .execute(&state.db)
        .await?;
    log_event(&state, server_id, "SERVER_UPDATE", Some(claims.sub), None, None, None, None).await;
    Ok(Json(broadcast_server(&state, server_id).await?))
}
