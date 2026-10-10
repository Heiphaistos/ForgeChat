use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub discriminator: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub bio: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
    pub activity_type: Option<String>,
    pub activity_name: Option<String>,
    pub activity_detail: Option<String>,
    pub is_bot: bool,
    pub focus_mode: bool,
    pub is_verified: bool,
    pub birthday: Option<chrono::NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[sqlx(default)]
    pub totp_enabled: bool,
    pub pronouns: Option<String>,
    /// Statut choisi (online/idle/dnd/invisible) ; `status` est le statut en direct.
    #[sqlx(default)]
    #[serde(skip_serializing, default)]
    pub preferred_status: String,
    #[sqlx(default)]
    pub avatar_decoration: Option<String>,
    #[sqlx(default)]
    pub profile_color_primary: Option<i32>,
    #[sqlx(default)]
    pub profile_color_accent: Option<i32>,
    #[sqlx(default)]
    pub profile_effect: Option<String>,
    #[sqlx(default)]
    pub display_name: Option<String>,
    /// Style du pseudo (models/profile_style.rs), JSON déjà validé.
    #[sqlx(default)]
    pub name_style: Option<serde_json::Value>,
    #[sqlx(default)]
    pub profile_tag: Option<String>,
    #[sqlx(default)]
    pub profile_links: Option<serde_json::Value>,
    #[sqlx(default)]
    pub custom_status_expires_at: Option<DateTime<Utc>>,
    /// Connexion v2 : bcrypt de `auth` (dérivé du mot de passe sur l'appareil). NULL = compte non migré.
    #[sqlx(default)]
    #[serde(skip_serializing, default)]
    pub auth_hash: Option<String>,
}

impl User {
    /// Fiche de l'utilisateur lui-même : il voit le statut qu'il a CHOISI
    /// (« invisible », « ne pas déranger »), pas celui que voient les autres.
    pub fn into_self_public(self) -> UserPublic {
        let preferred = self.preferred_status.clone();
        let mut public = UserPublic::from(self);
        if !preferred.is_empty() {
            public.status = preferred;
        }
        public
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPublic {
    pub id: Uuid,
    pub username: String,
    pub discriminator: String,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub bio: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub custom_status_emoji: Option<String>,
    pub activity_type: Option<String>,
    pub activity_name: Option<String>,
    pub activity_detail: Option<String>,
    pub focus_mode: bool,
    pub verified: bool,
    pub totp_enabled: bool,
    pub birthday: Option<chrono::NaiveDate>,
    pub created_at: DateTime<Utc>,
    pub pronouns: Option<String>,
    pub avatar_decoration: Option<String>,
    pub profile_color_primary: Option<i32>,
    pub profile_color_accent: Option<i32>,
    pub profile_effect: Option<String>,
    pub display_name: Option<String>,
    pub name_style: Option<serde_json::Value>,
    pub profile_tag: Option<String>,
    pub profile_links: Option<serde_json::Value>,
    pub custom_status_expires_at: Option<DateTime<Utc>>,
}

impl UserPublic {
    /// Fiche vue par quelqu'un d'autre : ni date de naissance (birthdays.rs décide
    /// du jour et du mois montrés), ni état de la double authentification.
    pub fn for_others(mut self) -> Self {
        self.birthday = None;
        self.totp_enabled = false;
        self
    }
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            discriminator: u.discriminator,
            avatar: u.avatar,
            banner: u.banner,
            bio: u.bio,
            status: u.status,
            custom_status: u.custom_status,
            custom_status_emoji: u.custom_status_emoji,
            activity_type: u.activity_type,
            activity_name: u.activity_name,
            activity_detail: u.activity_detail,
            focus_mode: u.focus_mode,
            verified: u.is_verified,
            totp_enabled: u.totp_enabled,
            birthday: u.birthday,
            created_at: u.created_at,
            pronouns: u.pronouns,
            avatar_decoration: u.avatar_decoration,
            profile_color_primary: u.profile_color_primary,
            profile_color_accent: u.profile_color_accent,
            profile_effect: u.profile_effect,
            display_name: u.display_name,
            name_style: u.name_style,
            profile_tag: u.profile_tag,
            profile_links: u.profile_links,
            custom_status_expires_at: u.custom_status_expires_at,
        }
    }
}

/// Inscription v2 : `auth` et `kdf_salt` calculés sur l'appareil, jamais le mot de passe.
/// Pas de `Debug` : ces corps ne doivent jamais finir dans un journal.
#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    #[serde(default)]
    pub auth: Option<String>,
    #[serde(default)]
    pub kdf_salt: Option<String>,
    /// Envoyé seulement par les anciennes applis : refus 426.
    #[serde(default)]
    pub password: Option<String>,
    /// Code d'invitation (obligatoire quand l'inscription est sur invitation).
    #[serde(default)]
    pub invite_code: Option<String>,
}

/// Compte migré : `{email, auth}`. Compte non migré : `{email, password, auth_new, kdf_salt_new}`
/// (dernière fois que le serveur voit le mot de passe), ou `{email, password}` (ancienne appli).
#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    #[serde(default)]
    pub auth: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub auth_new: Option<String>,
    #[serde(default)]
    pub kdf_salt_new: Option<String>,
    pub totp_code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserPublic,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub username: Option<String>,
    pub bio: Option<String>,
    pub custom_status: Option<String>,
    pub status: Option<String>,
    pub banner: Option<String>,
    pub activity_type: Option<String>,
    pub activity_name: Option<String>,
    pub activity_detail: Option<String>,
    pub birthday: Option<serde_json::Value>,
    pub pronouns: Option<String>,
    /// "" = retirer la décoration.
    pub avatar_decoration: Option<String>,
    /// 0xRRGGBB ; -1 = revenir au thème par défaut.
    pub profile_color_primary: Option<i32>,
    pub profile_color_accent: Option<i32>,
    /// "" = aucun effet.
    pub profile_effect: Option<String>,
    /// "" = retirer (on retombe sur le nom d'utilisateur).
    pub display_name: Option<String>,
    /// Absent = inchangé ; null = style par défaut (models/profile_style.rs).
    pub name_style: Option<serde_json::Value>,
    /// Étiquette perso courte ; "" = retirer.
    pub profile_tag: Option<String>,
    /// Liste [{label, url}] ; [] ou null = aucun lien.
    pub profile_links: Option<serde_json::Value>,
    /// Avec `custom_status` : effacer le statut après N minutes (0 = jamais).
    pub custom_status_clear_after: Option<i64>,
}

/// Catalogue des décorations d'avatar (mêmes identifiants côté web et mobile).
pub const AVATAR_DECORATIONS: &[&str] = &[
    "gold", "silver", "neon", "rainbow", "fire", "ice", "emerald",
    "sakura", "void", "sunset", "ocean", "dashed", "double", "glow",
];

/// Effets animés de la fiche profil.
pub const PROFILE_EFFECTS: &[&str] = &["sparkles", "snow", "hearts", "stars", "bubbles"];

impl UpdateProfileRequest {
    /// Liste blanche stricte de la personnalisation du profil.
    pub fn validate_cosmetics(&self) -> std::result::Result<(), &'static str> {
        let in_list = |v: &Option<String>, list: &[&str]| {
            v.as_deref().is_none_or(|s| s.is_empty() || list.contains(&s))
        };
        if !in_list(&self.avatar_decoration, AVATAR_DECORATIONS) {
            return Err("Décoration d'avatar inconnue");
        }
        if !in_list(&self.profile_effect, PROFILE_EFFECTS) {
            return Err("Effet de profil inconnu");
        }
        let color_ok = |c: Option<i32>| c.is_none_or(|c| (-1..=0xFF_FFFF).contains(&c));
        if !color_ok(self.profile_color_primary) || !color_ok(self.profile_color_accent) {
            return Err("Couleur de profil invalide (0xRRGGBB)");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(json: serde_json::Value) -> UpdateProfileRequest {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn cosmetics_whitelist() {
        assert!(req(serde_json::json!({})).validate_cosmetics().is_ok());
        assert!(req(serde_json::json!({ "avatar_decoration": "rainbow", "profile_effect": "snow" })).validate_cosmetics().is_ok());
        assert!(req(serde_json::json!({ "avatar_decoration": "", "profile_effect": "" })).validate_cosmetics().is_ok());
        assert!(req(serde_json::json!({ "avatar_decoration": "<script>" })).validate_cosmetics().is_err());
        assert!(req(serde_json::json!({ "avatar_decoration": "Gold" })).validate_cosmetics().is_err());
        assert!(req(serde_json::json!({ "profile_effect": "confetti" })).validate_cosmetics().is_err());
    }

    #[test]
    fn cosmetics_colors() {
        assert!(req(serde_json::json!({ "profile_color_primary": 0, "profile_color_accent": 0xFFFFFF })).validate_cosmetics().is_ok());
        assert!(req(serde_json::json!({ "profile_color_primary": -1 })).validate_cosmetics().is_ok());
        assert!(req(serde_json::json!({ "profile_color_primary": 0x1000000 })).validate_cosmetics().is_err());
        assert!(req(serde_json::json!({ "profile_color_accent": -2 })).validate_cosmetics().is_err());
    }
}

#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
pub struct PendingRegistration {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    pub discriminator: String,
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub auth_hash: String,
    pub kdf_salt: String,
    pub invite_code: Option<String>,
}
