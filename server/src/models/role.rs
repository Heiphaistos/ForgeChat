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
    pub const PRIORITY_SPEAKER: i64 = 1 << 18;
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
        | Self::PRIORITY_SPEAKER | Self::CREATE_CHANNELS | Self::EDIT_CHANNELS
        | Self::DELETE_CHANNELS | Self::DELETE_OWN_CHANNELS | Self::BAN_TEMP
        | Self::STREAM | Self::ADMINISTRATOR;
}
