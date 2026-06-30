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
    pub const ADMINISTRATOR: i64 = 1 << 31;
}
