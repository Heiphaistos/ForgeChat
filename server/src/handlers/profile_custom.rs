//! Personnalisation du profil : envoi d'avatar et de bannière (fixes ou animés),
//! styles de pseudo en lot et expiration des statuts personnalisés.

use axum::{
    extract::{Multipart, Query, State},
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{image_probe, password_reset::over_limit},
    middleware::auth::Claims,
    models::user::UserPublic,
    state::AppState,
};

pub const AVATAR_MAX: usize = 10 * 1024 * 1024;
pub const BANNER_MAX: usize = 10 * 1024 * 1024;

/// 20 envois d'image de profil par tranche de 10 minutes.
pub async fn upload_rate_limit(state: &AppState, user: Uuid) -> Result<()> {
    if over_limit(state, &format!("profile_upload:{user}"), 20, 600).await {
        return Err(AppError::TooManyRequests);
    }
    Ok(())
}

/// Lit le champ `name` du multipart (taille bornée) et vérifie que le type déclaré
/// est une image de la liste blanche. Le vrai format est relu dans les octets ensuite.
pub async fn read_image_field(multipart: &mut Multipart, name: &str, max: usize) -> Result<bytes::Bytes> {
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        if field.name() != Some(name) { continue; }
        crate::handlers::uploads::image_ext(field.content_type().unwrap_or("image/jpeg"))?;
        let data = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
        if data.len() > max {
            return Err(AppError::BadRequest(format!("Fichier trop grand (max {} Mo)", max / 1_048_576)));
        }
        return Ok(data);
    }
    Err(AppError::BadRequest(format!("Champ '{name}' manquant")))
}

/// Nom de la version fixe d'une image animée : `a_<id>.gif` → `a_<id>_s.gif`
/// (même règle côté web et mobile pour couper l'animation).
pub fn still_name(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) => format!("{stem}_s.{ext}"),
        None => format!("{name}_s"),
    }
}

/// Vérifie l'image (format réel, dimensions, nombre d'images) puis l'écrit sous
/// `uploads/<dir>/` avec un nom généré par le serveur. Une image animée est nommée
/// `a_<uuid>.<ext>` et accompagnée de sa version fixe `a_<uuid>_s.<ext>`.
/// `dir` est toujours une constante du code, jamais une entrée utilisateur.
pub async fn store_image(state: &AppState, dir: &'static str, data: &[u8]) -> Result<String> {
    let (probe, still) = image_probe::probe(data).map_err(|e| AppError::BadRequest(e.into()))?;
    let name = format!("{}{}.{}", if still.is_some() { "a_" } else { "" }, Uuid::new_v4(), probe.ext);
    let folder = std::path::Path::new(&state.config.upload_dir).join(dir);
    tokio::fs::create_dir_all(&folder).await.map_err(|e| AppError::Internal(e.into()))?;
    crate::antivirus::check(&data).await?;
    if let Some(still) = still {
        tokio::fs::write(folder.join(still_name(&name)), still).await.map_err(|e| AppError::Internal(e.into()))?;
    }
    tokio::fs::write(folder.join(&name), data).await.map_err(|e| AppError::Internal(e.into()))?;
    Ok(format!("/uploads/{dir}/{name}"))
}

/// Diffuse le profil à soi-même et aux membres des serveurs communs, sans l'activité
/// (elle suit son propre réglage de visibilité, voir users::update_me).
async fn broadcast_profile(state: &AppState, user: crate::models::user::User) -> UserPublic {
    let public = UserPublic::from(user.clone());
    let mut shared = public.clone().for_others();
    shared.activity_type = None;
    shared.activity_name = None;
    shared.activity_detail = None;
    state.broadcast_to_user(user.id, serde_json::json!({ "type": "USER_UPDATE", "user": public }).to_string()).await;
    let event = serde_json::json!({ "type": "USER_UPDATE", "user": shared }).to_string();
    let visible_to: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT sm2.user_id FROM server_members sm1
         JOIN server_members sm2 ON sm2.server_id = sm1.server_id
         WHERE sm1.user_id = $1 AND sm2.user_id != $1",
    )
    .bind(user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    let clients = state.clients.read().await;
    for uid in visible_to {
        if let Some(tx) = clients.get(&uid) {
            let _ = tx.send(event.clone());
        }
    }
    user.into_self_public()
}

/// POST /users/me/avatar — PNG, JPEG, GIF, WebP ou APNG (animés acceptés), 10 Mo max.
pub async fn upload_avatar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<UserPublic>> {
    upload_rate_limit(&state, claims.sub).await?;
    let data = read_image_field(&mut multipart, "avatar", AVATAR_MAX).await?;
    let url = store_image(&state, "avatars", &data).await?;
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "UPDATE users SET avatar=$2, updated_at=NOW() WHERE id=$1 RETURNING *",
    )
    .bind(claims.sub)
    .bind(&url)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(broadcast_profile(&state, user).await))
}

/// POST /users/me/banner — mêmes formats que l'avatar, 10 Mo max.
pub async fn upload_banner(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>> {
    upload_rate_limit(&state, claims.sub).await?;
    let data = read_image_field(&mut multipart, "banner", BANNER_MAX).await?;
    let url = store_image(&state, "banners", &data).await?;
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "UPDATE users SET banner=$2, updated_at=NOW() WHERE id=$1 RETURNING *",
    )
    .bind(claims.sub)
    .bind(&url)
    .fetch_one(&state.db)
    .await?;
    broadcast_profile(&state, user).await;
    Ok(Json(serde_json::json!({ "banner": url })))
}

#[derive(serde::Deserialize)]
pub struct StylesQuery {
    pub ids: String,
}

/// GET /users/styles?ids=a,b,c — nom d'affichage, style du pseudo et étiquette de
/// 100 utilisateurs au plus (le client les met en cache et les affiche partout où
/// un pseudo apparaît : messages, membres, MP, vocal, mentions).
pub async fn name_styles(
    State(state): State<AppState>,
    Extension(_claims): Extension<Claims>,
    Query(q): Query<StylesQuery>,
) -> Result<Json<Vec<serde_json::Value>>> {
    let ids: Vec<Uuid> = q.ids.split(',').filter_map(|s| s.trim().parse().ok()).take(100).collect();
    if ids.is_empty() {
        return Ok(Json(Vec::new()));
    }
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id, username, display_name, name_style, profile_tag FROM users WHERE id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "display_name": r.get::<Option<String>, _>("display_name"),
        "name_style": r.get::<Option<serde_json::Value>, _>("name_style"),
        "profile_tag": r.get::<Option<String>, _>("profile_tag"),
    })).collect()))
}

/// Diffuse un statut personnalisé (ou son effacement) aux membres des serveurs communs
/// et aux autres sessions de l'utilisateur.
pub async fn broadcast_custom_status(state: &AppState, user: Uuid, text: Option<&str>, emoji: Option<&str>, expires: Option<chrono::DateTime<chrono::Utc>>) {
    let event = serde_json::json!({
        "type": "PRESENCE_UPDATE",
        "user_id": user,
        "custom_status": text,
        "custom_status_emoji": emoji,
        "custom_status_expires_at": expires,
    })
    .to_string();
    let server_ids: Vec<Uuid> = sqlx::query_scalar("SELECT DISTINCT server_id FROM server_members WHERE user_id=$1")
        .bind(user)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
    for sid in server_ids {
        state.broadcast_to_server_members(sid, event.clone()).await;
    }
    state.broadcast_to_user(user, event).await;
}

/// `custom_status_clear_after` (minutes) → date d'expiration ; 0 = jamais.
pub fn status_expiry(minutes: Option<i64>) -> Result<Option<chrono::DateTime<chrono::Utc>>> {
    match minutes {
        None | Some(0) => Ok(None),
        Some(m) if crate::models::profile_style::STATUS_CLEAR_AFTER.contains(&m) => {
            Ok(Some(chrono::Utc::now() + chrono::Duration::minutes(m)))
        }
        Some(_) => Err(AppError::BadRequest("Durée du statut invalide".into())),
    }
}

/// Tâche périodique : efface les statuts personnalisés expirés et prévient les clients.
pub async fn expire_custom_statuses(state: &AppState) {
    let cleared: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE users SET custom_status=NULL, custom_status_emoji=NULL, custom_status_expires_at=NULL
         WHERE custom_status_expires_at IS NOT NULL AND custom_status_expires_at <= NOW()
         RETURNING id",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();
    for uid in cleared {
        broadcast_custom_status(state, uid, None, None, None).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nom_de_la_version_fixe() {
        assert_eq!(still_name("a_123.gif"), "a_123_s.gif");
        assert_eq!(still_name("a_1.webp"), "a_1_s.webp");
    }

    #[test]
    fn duree_du_statut() {
        assert!(status_expiry(None).unwrap().is_none());
        assert!(status_expiry(Some(0)).unwrap().is_none());
        let t = status_expiry(Some(30)).unwrap().unwrap();
        assert!(t > chrono::Utc::now() + chrono::Duration::minutes(29));
        assert!(status_expiry(Some(7)).is_err());
        assert!(status_expiry(Some(-30)).is_err());
    }

    #[test]
    fn type_declare_en_liste_blanche() {
        // Le type déclaré doit être une image connue ; le format réel est relu ensuite.
        assert!(crate::handlers::uploads::image_ext("image/gif").is_ok());
        assert!(crate::handlers::uploads::image_ext("image/svg+xml").is_err());
        assert!(crate::handlers::uploads::image_ext("text/html").is_err());
    }
}

/// Champs de personnalisation de PATCH /users/me, validés. `None` = champ absent
/// (inchangé) ; `Some(None)` = effacer.
pub struct ProfileCustom {
    pub display_name: Option<Option<String>>,
    pub name_style: Option<Option<serde_json::Value>>,
    pub profile_tag: Option<Option<String>>,
    pub profile_links: Option<Option<serde_json::Value>>,
    /// Utilisé seulement si `custom_status` est envoyé dans la même requête.
    pub status_expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl ProfileCustom {
    pub fn from_request(body: &crate::models::user::UpdateProfileRequest) -> Result<Self> {
        use crate::models::profile_style as ps;
        let bad = |e: String| AppError::BadRequest(e);
        Ok(Self {
            display_name: body.display_name.as_deref()
                .map(|s| ps::clean_label(s, ps::DISPLAY_NAME_MAX, "Nom d'affichage")).transpose().map_err(bad)?,
            name_style: body.name_style.as_ref()
                .map(ps::parse_name_style).transpose().map_err(|e| AppError::BadRequest(e.into()))?,
            profile_tag: body.profile_tag.as_deref()
                .map(|s| ps::clean_label(s, ps::TAG_MAX, "Étiquette")).transpose().map_err(bad)?,
            profile_links: body.profile_links.as_ref().map(ps::parse_links).transpose().map_err(bad)?,
            status_expires_at: status_expiry(body.custom_status_clear_after)?,
        })
    }
}
