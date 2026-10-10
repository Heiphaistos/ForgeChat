use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Role {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub color: i32,
    pub permissions: i64,
    pub position: i32,
    pub mentionable: bool,
    pub hoisted: bool,
    pub is_everyone: bool,
    pub created_at: DateTime<Utc>,
    /// Seconde couleur du dégradé de pseudo (color → secondary_color).
    #[serde(default)]
    pub secondary_color: Option<i32>,
    /// Emoji unicode ou image `/uploads/role-icon-<uuid>.<ext>`.
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    pub color: Option<i32>,
    pub permissions: Option<i64>,
    pub mentionable: Option<bool>,
    pub hoisted: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub color: Option<i32>,
    pub permissions: Option<i64>,
    pub mentionable: Option<bool>,
    pub hoisted: Option<bool>,
    pub position: Option<i32>,
    /// Négatif = retirer le dégradé.
    pub secondary_color: Option<i32>,
    /// Chaîne vide = retirer l'icône ; sinon emoji (image : POST .../icon).
    pub icon: Option<String>,
}

// Bitfield permissions (comme Discord)
// MANAGE_CHANNELS (bit 4) reste valable : il vaut CREATE + EDIT + DELETE_CHANNELS
// pour les rôles existants (les gardes passent `MANAGE_CHANNELS | X`).
pub struct Permissions;
#[allow(dead_code)]
impl Permissions {
    pub const VIEW_CHANNEL: i64 = 1 << 0;
    pub const SEND_MESSAGES: i64 = 1 << 1;
    pub const READ_HISTORY: i64 = 1 << 2;
    pub const MANAGE_MESSAGES: i64 = 1 << 3;
    pub const MANAGE_CHANNELS: i64 = 1 << 4;
    pub const MANAGE_ROLES: i64 = 1 << 5;
    pub const KICK_MEMBERS: i64 = 1 << 6;
    pub const BAN_MEMBERS: i64 = 1 << 7;
    pub const MANAGE_SERVER: i64 = 1 << 8;
    pub const MENTION_EVERYONE: i64 = 1 << 9;
    pub const ATTACH_FILES: i64 = 1 << 10;
    pub const EMBED_LINKS: i64 = 1 << 11;
    pub const ADD_REACTIONS: i64 = 1 << 12;
    pub const CONNECT_VOICE: i64 = 1 << 13;
    pub const SPEAK_VOICE: i64 = 1 << 14;
    pub const MUTE_MEMBERS: i64 = 1 << 15;
    pub const DEAFEN_MEMBERS: i64 = 1 << 16;
    pub const MOVE_MEMBERS: i64 = 1 << 17;
    /// Ancien « orateur prioritaire » (atténuait les autres voix), retiré le 2026-10-10.
    /// Bit 18 RÉSERVÉ : ne jamais le réattribuer ; ignoré s'il est encore stocké
    /// (migration 118 le retire des rôles et des surcharges).
    pub const RETIRED_PRIORITY_SPEAKER: i64 = 1 << 18;
    /// Créer des salons et des catégories.
    pub const CREATE_CHANNELS: i64 = 1 << 19;
    /// Modifier les salons : nom, sujet, réglages, ordre, déplacement, archivage,
    /// surcharges de permissions, tags, flux RSS, jeton webhook GitHub.
    pub const EDIT_CHANNELS: i64 = 1 << 20;
    /// Supprimer n'importe quel salon ou catégorie (sauf ceux du propriétaire).
    pub const DELETE_CHANNELS: i64 = 1 << 21;
    /// Supprimer seulement les salons et catégories qu'on a créés soi-même.
    pub const DELETE_OWN_CHANNELS: i64 = 1 << 22;
    /// Bannir temporairement (BAN_MEMBERS = définitivement et temporairement).
    pub const BAN_TEMP: i64 = 1 << 23;
    /// Partage d'écran / Go Live — déclaré côté UI depuis toujours (RolesTab bit 40)
    pub const STREAM: i64 = 1 << 40;
    pub const ADMINISTRATOR: i64 = 1 << 31;

    /// Toutes les permissions connues. Remplace l'ancien masque `0x3FFFF`
    /// (bits 0-17) qui EFFAÇAIT administrateur, orateur prioritaire et partage
    /// d'écran à chaque modification d'un rôle (simple renommage compris).
    pub const ALL: i64 = Self::VIEW_CHANNEL | Self::SEND_MESSAGES | Self::READ_HISTORY
        | Self::MANAGE_MESSAGES | Self::MANAGE_CHANNELS | Self::MANAGE_ROLES
        | Self::KICK_MEMBERS | Self::BAN_MEMBERS | Self::MANAGE_SERVER
        | Self::MENTION_EVERYONE | Self::ATTACH_FILES | Self::EMBED_LINKS
        | Self::ADD_REACTIONS | Self::CONNECT_VOICE | Self::SPEAK_VOICE
        | Self::MUTE_MEMBERS | Self::DEAFEN_MEMBERS | Self::MOVE_MEMBERS
        | Self::CREATE_CHANNELS | Self::EDIT_CHANNELS
        | Self::DELETE_CHANNELS | Self::DELETE_OWN_CHANNELS | Self::BAN_TEMP
        | Self::STREAM | Self::ADMINISTRATOR;
}

/// Couleur RGB 24 bits (0x000000-0xFFFFFF).
pub fn is_valid_color(c: i32) -> bool {
    (0..=0xFF_FFFF).contains(&c)
}

pub const ROLE_ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Préfixe des icônes de rôle téléversées (`/uploads/role-icon-<uuid>.<ext>`,
/// à plat pour que `remove_upload_files` puisse les supprimer).
pub const ROLE_ICON_PREFIX: &str = "/uploads/role-icon-";

/// Emoji d'icône de rôle : 1 à 8 caractères, au moins un non ASCII, ASCII limité
/// aux chiffres/#/* des keycaps, ni espace ni caractère de contrôle.
/// `None` = entrée invalide.
pub fn normalize_role_emoji(raw: &str) -> Option<String> {
    let s = raw.trim();
    let n = s.chars().count();
    let ascii_ok = |c: char| !c.is_ascii() || c.is_ascii_digit() || c == '#' || c == '*';
    let ok = (1..=8).contains(&n)
        && s.chars().any(|c| !c.is_ascii())
        && s.chars().all(|c| ascii_ok(c) && !c.is_control() && !c.is_whitespace());
    ok.then(|| s.to_string())
}

/// Extension d'image autorisée pour une icône de rôle, d'après le nom de fichier.
pub fn role_icon_ext(file_name: &str) -> Option<String> {
    let ext = std::path::Path::new(file_name).extension()?.to_str()?.to_lowercase();
    ROLE_ICON_EXTENSIONS.contains(&ext.as_str()).then_some(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors() {
        assert!(is_valid_color(0));
        assert!(is_valid_color(0xFF_FFFF));
        assert!(!is_valid_color(-1));
        assert!(!is_valid_color(0x100_0000));
    }

    #[test]
    fn icons() {
        assert_eq!(normalize_role_emoji(" 🔥 ").as_deref(), Some("🔥"));
        assert!(normalize_role_emoji("1️⃣").is_some());
        assert!(normalize_role_emoji("👨‍👩‍👧").is_some());
        assert!(normalize_role_emoji("abc").is_none());
        assert!(normalize_role_emoji("<b>🔥</b>").is_none());
        assert!(normalize_role_emoji("🔥🔥🔥🔥🔥🔥🔥🔥🔥").is_none());
        assert!(normalize_role_emoji("🔥 x").is_none());
        assert!(normalize_role_emoji("/uploads/role-icon-x.png").is_none());
        assert_eq!(role_icon_ext("Logo.PNG").as_deref(), Some("png"));
        assert!(role_icon_ext("x.svg").is_none());
        assert!(role_icon_ext("x").is_none());
        assert!(role_icon_ext("x.png.html").is_none());
    }
}
