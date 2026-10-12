//! Profil par serveur (« Mon profil sur ce serveur ») : avatar, bannière, bio,
//! anneau d'avatar et style du pseudo propres à un serveur, en plus du surnom
//! (audit::set_nickname). NULL = profil global du compte. Chaque changement est diffusé aux membres du serveur
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
        "avatar" => Ok(("server_avatar", 10 * 1024 * 1024)),
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
        "SELECT server_avatar, server_banner, server_bio, server_avatar_ring, server_name_style
         FROM server_members WHERE server_id=$1 AND user_id=$2"
    ).bind(server_id).bind(user_id).fetch_one(&state.db).await?;
    let profile = serde_json::json!({
        "server_id": server_id,
        "user_id": user_id,
        "server_avatar": row.get::<Option<String>, _>("server_avatar"),
        "server_banner": row.get::<Option<String>, _>("server_banner"),
        "server_bio": row.get::<Option<String>, _>("server_bio"),
        "server_avatar_ring": row.get::<Option<serde_json::Value>, _>("server_avatar_ring"),
        "server_name_style": row.get::<Option<serde_json::Value>, _>("server_name_style"),
    });
    let mut event = profile.clone();
    event["type"] = "MEMBER_PROFILE_UPDATE".into();
    state.broadcast_to_server_members(server_id, event.to_string()).await;
    Ok(Json(profile))
}

#[derive(Deserialize)]
pub struct ProfileBody {
    /// Absent = inchangée ; null ou vide = bio du compte.
    #[serde(default, deserialize_with = "crate::models::serde_helpers::deserialize_double_option")]
    pub bio: Option<Option<String>>,
    /// Absent = inchangé ; `{}` = pas d'anneau (models/profile_style::parse_avatar_ring).
    #[serde(default)]
    pub avatar_ring: Option<serde_json::Value>,
    /// Absent = inchangé ; `{}` = style du compte (models/profile_style::parse_name_style).
    #[serde(default)]
    pub name_style: Option<serde_json::Value>,
}

/// Anneau et style validés par liste blanche : `None` = champ absent (inchangé),
/// `Some(None)` = effacer.
type Styles = (Option<Option<serde_json::Value>>, Option<Option<serde_json::Value>>);

pub fn parse_styles(body: &ProfileBody) -> Result<Styles> {
    use crate::models::profile_style as ps;
    let bad = |e: &'static str| AppError::BadRequest(e.into());
    Ok((
        body.avatar_ring.as_ref().map(ps::parse_avatar_ring).transpose().map_err(bad)?,
        body.name_style.as_ref().map(ps::parse_name_style).transpose().map_err(bad)?,
    ))
}

/// PATCH /servers/:server_id/profile { bio?, avatar_ring?, name_style? } — champ absent :
/// inchangé ; bio null ou vide : bio du compte.
pub async fn update_profile(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ProfileBody>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let (ring, style) = parse_styles(&body)?;
    let has_bio = body.bio.is_some();
    let bio = normalize_bio(body.bio.flatten())?;
    sqlx::query(
        "UPDATE server_members SET server_bio = CASE WHEN $8 THEN $1 ELSE server_bio END,
            server_avatar_ring = CASE WHEN $4 THEN $5 ELSE server_avatar_ring END,
            server_name_style = CASE WHEN $6 THEN $7 ELSE server_name_style END
         WHERE server_id=$2 AND user_id=$3",
    )
    .bind(&bio).bind(server_id).bind(claims.sub)
    .bind(ring.is_some()).bind(ring.flatten())
    .bind(style.is_some()).bind(style.flatten())
    .bind(has_bio)
    .execute(&state.db).await?;
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

    crate::handlers::profile_custom::upload_rate_limit(&state, claims.sub).await?;
    let data = crate::handlers::profile_custom::read_image_field(&mut multipart, "file", max as usize).await?;
    let url = crate::handlers::profile_custom::store_image(&state, "member_profiles", &data).await?;
    // `column` vient de la liste blanche image_column, jamais de l'utilisateur.
    sqlx::query(&format!("UPDATE server_members SET {column}=$1 WHERE server_id=$2 AND user_id=$3"))
        .bind(url).bind(server_id).bind(claims.sub)
        .execute(&state.db).await?;
    publish(&state, server_id, claims.sub).await
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
    fn anneau_et_style_valides() {
        let body = |v: serde_json::Value| serde_json::from_value::<ProfileBody>(v).unwrap();
        let (ring, style) = parse_styles(&body(serde_json::json!({ "bio": null }))).unwrap();
        assert!(ring.is_none() && style.is_none());
        assert_eq!(body(serde_json::json!({ "bio": null })).bio, Some(None));
        assert_eq!(body(serde_json::json!({})).bio, None);
        let (ring, style) = parse_styles(&body(serde_json::json!({ "avatar_ring": {}, "name_style": {} }))).unwrap();
        assert_eq!(ring, Some(None));
        assert_eq!(style, Some(None));
        let (ring, _) = parse_styles(&body(serde_json::json!({ "avatar_ring": { "colors": [16711680], "style": "glow", "width": 4 } }))).unwrap();
        assert_eq!(ring.unwrap().unwrap()["style"], "glow");
        assert!(parse_styles(&body(serde_json::json!({ "avatar_ring": { "colors": ["red"] } }))).is_err());
        assert!(parse_styles(&body(serde_json::json!({ "name_style": { "font": "x;y" } }))).is_err());
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
