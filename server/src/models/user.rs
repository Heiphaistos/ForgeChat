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
    /// Date chiffrée (handlers::birthdays::open) ; `users.birthday` reste NULL.
    #[sqlx(default)]
    #[serde(skip)]
    pub birthday_enc: Option<String>,
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
    /// Réglages de la décoration (models/profile_style::parse_decoration_opts), JSON déjà validé.
    #[sqlx(default)]
    pub avatar_decoration_opts: Option<serde_json::Value>,
    #[sqlx(default)]
    pub profile_color_primary: Option<i32>,
    #[sqlx(default)]
    pub profile_color_accent: Option<i32>,
    #[sqlx(default)]
    pub profile_effect: Option<String>,
    /// Intensité de l'effet de profil en % (25-200) ; NULL = 100.
    #[sqlx(default)]
    pub profile_effect_intensity: Option<i16>,
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
    pub avatar_decoration_opts: Option<serde_json::Value>,
    pub profile_color_primary: Option<i32>,
    pub profile_color_accent: Option<i32>,
    pub profile_effect: Option<String>,
    pub profile_effect_intensity: Option<i16>,
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
            birthday: u.birthday_enc.as_deref().and_then(|s| crate::handlers::birthdays::open(u.id, s)),
            created_at: u.created_at,
            pronouns: u.pronouns,
            avatar_decoration: u.avatar_decoration,
            avatar_decoration_opts: u.avatar_decoration_opts,
            profile_color_primary: u.profile_color_primary,
            profile_color_accent: u.profile_color_accent,
            profile_effect: u.profile_effect,
            profile_effect_intensity: u.profile_effect_intensity,
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
    /// Dérivation du mot de passe utilisée par l'appli (`pbkdf2` si absent : anciennes applis).
    #[serde(default)]
    pub kdf: Option<String>,
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
    /// Dérivation de `auth_new` (`pbkdf2` si absent).
    #[serde(default)]
    pub kdf_new: Option<String>,
    pub totp_code: Option<String>,
    /// Second facteur par clé d'accès (web) au lieu du code.
    #[serde(default)]
    pub passkey: Option<crate::handlers::passkeys::Assertion>,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    /// Absents (vides) quand la requête porte `X-ForgeChat-Tokens: cookie` : appli web, jetons
    /// en cookies HttpOnly seulement, jamais lisibles par le JavaScript.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub access_token: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub refresh_token: String,
    pub user: UserPublic,
    /// Identifiant d'appareil neuf à garder par l'appli (en-tête `X-ForgeChat-Device` ensuite).
    /// Jamais pour le web, qui le reçoit en cookie HttpOnly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
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
    /// Réglages de la décoration ; absent = inchangés, `{}` = réglages par défaut
    /// (models/profile_style::parse_decoration_opts).
    pub avatar_decoration_opts: Option<serde_json::Value>,
    /// 0xRRGGBB ; -1 = revenir au thème par défaut.
    pub profile_color_primary: Option<i32>,
    pub profile_color_accent: Option<i32>,
    /// "" = aucun effet.
    pub profile_effect: Option<String>,
    /// Intensité de l'effet en % (PROFILE_EFFECT_INTENSITY) ; 100 = normale.
    pub profile_effect_intensity: Option<i16>,
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

/// Catalogue des décorations d'avatar (mêmes identifiants, dans le même ordre, côté web et
/// mobile : client/src/lib/profileDecor.ts + profileDecorMore.ts, mobile/src/features/account/
/// profileDecor.ts + profileDecorMore.ts ; vérifié par mobile/__tests__/profile-decor.test.ts
/// et client/scripts/profileDecor.test.mjs).
pub const AVATAR_DECORATIONS: &[&str] = &[
    "gold", "silver", "neon", "rainbow", "fire", "ice", "emerald",
    "sakura", "void", "sunset", "ocean", "dashed", "double", "glow",
    // Holographiques / irisées
    "holo", "iridescent", "prism", "opal", "pearl", "aurora", "chroma", "mirage",
    // Éléments
    "inferno", "ember", "frost", "glacier", "lightning", "storm", "tide", "magma",
    "terra", "zephyr", "toxic", "plasma",
    // Néon
    "neon_pink", "neon_cyan", "neon_lime", "synthwave", "cyberpunk", "laser",
    // Pixel
    "pixel", "pixel_rainbow", "arcade",
    // Saisons et fêtes
    "halloween", "christmas", "winter", "spring", "summer", "autumn", "valentine",
    "easter", "newyear", "lunar",
    // Cosmos
    "galaxy", "nebula", "starry", "moonlit", "solar", "orbit", "comet",
    // Pierres
    "royal", "diamond", "ruby", "sapphire", "amethyst",    // Anneaux animés
    "vortex", "turbine", "radar_sweep", "dual_spin", "holo_ring", "iridescent_flux", "chrome_spin", "candy_spin",
    "rgb_cycle", "kaleido", "gyro", "spectrum",
    // Orbites et particules
    "orbit_duo", "orbit_trio", "electrons", "firefly_ring", "sparkle_ring", "stardust_ring", "snow_orbit", "bubble_ring",
    "confetti_ring", "heart_orbit", "star_orbit", "moon_orbit",
    // Auras
    "aura_violet", "aura_gold", "aura_crimson", "aura_azure", "aura_emerald", "chakra", "spirit", "shadow_aura",
    "solar_flare", "divine",
    // Flammes, foudre et eau
    "blaze", "blue_flame", "green_flame", "phoenix", "thunder", "tesla", "volt_violet", "ripple",
    "raindrop", "whirlpool", "sakura_fall", "blossom", "snowfall", "tornado", "vines",
    // Magie et runes
    "runes", "arcane", "lunar_sigil", "elven", "alchemy", "crystal_ball", "fairy", "enchanted",
    // Cadres néon et pixel
    "neon_square", "neon_square_cyan", "neon_duo", "neon_sign", "neon_frame_rgb", "pixel_frame", "pixel_gold", "glitch_ring",
    // Jeu vidéo
    "gamer_rgb", "headset", "dpad", "pixel_hearts", "pixel_coin", "boss", "respawn", "legendary",
    "epic", "rare", "level_up", "critical", "speedrun",
    // Accessoires
    "crown_gold", "crown_silver", "tiara", "angel", "angel_wings", "devil", "demon_wings", "cat_ears",
    "fox_ears", "bunny_ears", "headphones", "antlers", "bow", "party_hat", "laurel",
    // Fêtes et saisons, suite
    "witch", "ghostly", "pumpkin", "santa", "reindeer", "frosty", "easter_bunny", "shamrock",
    "cupid", "sunshine", "harvest", "lantern_festival", "fireworks_ring",
];

/// Effets animés de la fiche profil (même catalogue côté web et mobile).
pub const PROFILE_EFFECTS: &[&str] = &[
    "sparkles", "snow", "hearts", "stars", "bubbles",
    "rain", "storm", "sakura", "leaves", "confetti", "fireworks", "embers", "fire",
    "aurora", "matrix", "galaxy", "meteors", "fireflies", "notes", "coins", "gems",
    "petals", "lightning", "sunrays", "moonlight", "love", "soap", "blizzard", "pixels",
    "glitch", "rainbow", "mist", "spooky", "festive", "synthwave", "stardust", "plasma",
    "ocean",    // Météo
    "drizzle", "monsoon", "lightning_storm", "hail", "clouds", "sandstorm", "ashfall", "fog",
    // Nature
    "maple", "dandelion", "pollen", "butterflies", "cherry_blossoms", "clovers", "firefly_swarm",
    // Eau
    "caustics", "aquarium", "champagne", "rain_ripples",
    // Feu et énergie
    "smoke", "lava_lamp", "inferno_rise", "static_charge",
    // Ciel et cosmos
    "northern_lights", "meteor_shower", "galaxy_swirl", "shooting_stars", "starfield", "supernova", "black_hole", "planets",
    "sunset_glow", "god_rays",
    // Fête
    "streamers", "sparklers", "jackpot", "party", "balloons", "lanterns", "glitter", "new_year",
    "disco",
    // Amour
    "hearts_rain", "heartbeat", "roses",
    // Saisons et frissons
    "ghosts", "bats", "pumpkins", "skulls", "witchy", "snow_globe", "snowmen", "gifts",
    "candy", "easter_eggs",
    // Rétro et techno
    "cyber_grid", "retro_sun", "vaporwave", "binary", "tetris", "scanlines", "radar", "hologram",
    "vhs", "equalizer", "neon_rain",
    // Magie et jeux
    "portal", "runes", "spotlight", "dice", "cards", "chess",
];

/// Intensité de l'effet de profil en % (nombre de particules) ; 100 = normale.
pub const PROFILE_EFFECT_INTENSITY: std::ops::RangeInclusive<i16> = 25..=200;

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
        if self.profile_effect_intensity.is_some_and(|i| !PROFILE_EFFECT_INTENSITY.contains(&i)) {
            return Err("Intensité de l'effet : 25 à 200 %");
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
        assert!(req(serde_json::json!({ "profile_effect": "Confetti" })).validate_cosmetics().is_err());
        assert!(req(serde_json::json!({ "profile_effect": "confetti", "avatar_decoration": "pixel_rainbow" })).validate_cosmetics().is_ok());
    }

    #[test]
    fn catalogues_valides() {
        // Identifiants courts (VARCHAR(32)), sans doublon, sûrs dans un nom de classe CSS.
        for list in [AVATAR_DECORATIONS, PROFILE_EFFECTS] {
            let mut seen = std::collections::HashSet::new();
            for id in list {
                assert!(!id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'), "{id}");
                assert!(seen.insert(id), "doublon {id}");
            }
        }
        assert!(AVATAR_DECORATIONS.len() >= 145 && PROFILE_EFFECTS.len() >= 88);
    }

    #[test]
    fn cosmetics_intensite_et_nouveaux_ids() {
        for i in [25, 100, 200] {
            assert!(req(serde_json::json!({ "profile_effect_intensity": i })).validate_cosmetics().is_ok());
        }
        for i in [0, 24, 201, -1] {
            assert!(req(serde_json::json!({ "profile_effect_intensity": i })).validate_cosmetics().is_err());
        }
        assert!(serde_json::from_value::<UpdateProfileRequest>(serde_json::json!({ "profile_effect_intensity": 1.5 })).is_err());
        assert!(req(serde_json::json!({ "avatar_decoration": "cat_ears", "profile_effect": "galaxy_swirl" })).validate_cosmetics().is_ok());
        assert!(req(serde_json::json!({ "avatar_decoration": "runes", "profile_effect": "runes" })).validate_cosmetics().is_ok());
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
    pub kdf: String,
}
