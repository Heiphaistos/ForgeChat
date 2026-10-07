//! Profil par serveur (« Mon profil sur ce serveur ») : avatar, bannière et bio
//! propres à un serveur, en plus du surnom (audit::set_nickname). NULL = profil
//! global du compte. Chaque changement est diffusé aux membres du serveur
//! (MEMBER_PROFILE_UPDATE).

use axum::{extract::{Multipart, Path, State}, Extension, Json};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_member,
    middleware::auth::Claims,
    state::AppState,
};

pub const BIO_MAX: usize = 190;

/// Colonne visée par `:kind` — liste blanche, jamais l'entrée brute dans le SQL.
/// Rend aussi la taille maximale acceptée (mêmes plafonds que le profil global).
pub fn image_column(kind: &str) -> Result<(&'static str, u64)> {
    match kind {
        "avatar" => Ok(("server_avatar", 8 * 1024 * 1024)),
        "banner" => Ok(("server_banner", 10 * 1024 * 1024)),
        _ => Err(AppError::NotFound("Introuvable".into())),
    }
}

/// Bio rognée ; vide = retour à la bio du compte.
pub fn normalize_bio(bio: Option<String>) -> Result<Option<String>> {
    let bio = bio.map(|b| b.trim().to_string()).filter(|b| !b.is_empty());
    if bio.as_ref().is_some_and(|b| b.chars().count() > BIO_MAX) {
        return Err(AppError::BadRequest(format!("Bio trop longue (max {BIO_MAX})")));
    }
    Ok(bio)
}

/// Relit le profil de serveur du membre et le diffuse aux membres du serveur.
async fn publish(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<Json<serde_json::Value>> {
    let row = sqlx::query(
        "SELECT server_avatar, server_banner, server_bio FROM server_members WHERE server_id=$1 AND user_id=$2"
    ).bind(server_id).bind(user_id).fetch_one(&state.db).await?;
    let profile = serde_json::json!({
        "server_id": server_id,
        "user_id": user_id,
        "server_avatar": row.get::<Option<String>, _>("server_avatar"),
        "server_banner": row.get::<Option<String>, _>("server_banner"),
        "server_bio": row.get::<Option<String>, _>("server_bio"),
    });
    let mut event = profile.clone();
    event["type"] = "MEMBER_PROFILE_UPDATE".into();
    state.broadcast_to_server_members(server_id, event.to_string()).await;
    Ok(Json(profile))
}

#[derive(Deserialize)]
pub struct ProfileBody {
    pub bio: Option<String>,
}

/// PATCH /servers/:server_id/profile { bio } — null ou vide : bio du compte.
pub async fn update_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ProfileBody>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let bio = normalize_bio(body.bio)?;
    sqlx::query("UPDATE server_members SET server_bio=$1 WHERE server_id=$2 AND user_id=$3")
        .bind(&bio).bind(server_id).bind(claims.sub).execute(&state.db).await?;
    publish(&state, server_id, claims.sub).await
}

/// POST /servers/:server_id/profile/:kind (avatar | banner), champ multipart `file`.
pub async fn upload_profile_image(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, kind)): Path<(Uuid, String)>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    let (column, max) = image_column(&kind)?;
    require_member(&state, claims.sub, server_id).await?;

    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        if field.name() != Some("file") { continue; }
        let ext = crate::handlers::uploads::image_ext(field.content_type().unwrap_or("image/jpeg"))?;
        let filename = format!("member_profiles/{}.{}", Uuid::new_v4(), ext);
        let path = std::path::Path::new(&state.config.upload_dir).join(&filename);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| AppError::Internal(e.into()))?;
        }
        crate::handlers::uploads::save_field(field, &path, max).await?;

        // `column` vient de la liste blanche image_column, jamais de l'utilisateur.
        sqlx::query(&format!("UPDATE server_members SET {column}=$1 WHERE server_id=$2 AND user_id=$3"))
            .bind(format!("/uploads/{filename}")).bind(server_id).bind(claims.sub)
            .execute(&state.db).await?;
        return publish(&state, server_id, claims.sub).await;
    }
    Err(AppError::BadRequest("Champ 'file' manquant".into()))
}

/// DELETE /servers/:server_id/profile/:kind — retour à l'image du compte.
pub async fn delete_profile_image(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, kind)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    let (column, _) = image_column(&kind)?;
    require_member(&state, claims.sub, server_id).await?;
    sqlx::query(&format!("UPDATE server_members SET {column}=NULL WHERE server_id=$1 AND user_id=$2"))
        .bind(server_id).bind(claims.sub).execute(&state.db).await?;
    publish(&state, server_id, claims.sub).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colonne_en_liste_blanche() {
        assert_eq!(image_column("avatar").unwrap().0, "server_avatar");
        assert_eq!(image_column("banner").unwrap().0, "server_banner");
        assert!(image_column("nickname").is_err());
        assert!(image_column("server_avatar=NULL--").is_err());
    }

    #[test]
    fn bio_rognee_vide_ou_trop_longue() {
        assert_eq!(normalize_bio(None).unwrap(), None);
        assert_eq!(normalize_bio(Some("   ".into())).unwrap(), None);
        assert_eq!(normalize_bio(Some("  salut ".into())).unwrap(), Some("salut".into()));
        assert!(normalize_bio(Some("é".repeat(BIO_MAX))).is_ok());
        assert!(normalize_bio(Some("é".repeat(BIO_MAX + 1))).is_err());
    }
}
