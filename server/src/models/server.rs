use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Server {
    pub id: Uuid,
    pub name: String,
    pub icon: Option<String>,
    pub banner: Option<String>,
    pub description: Option<String>,
    pub welcome_message: Option<String>,
    pub owner_id: Uuid,
    pub invite_code: Option<String>,
    pub member_count: i32,
    pub is_public: bool,
    pub verification_enabled: bool,
    pub verification_rules: Option<String>,
    pub created_at: DateTime<Utc>,
    pub system_channel_id: Option<Uuid>,
    pub afk_channel_id: Option<Uuid>,
    pub afk_timeout_minutes: i32,
    pub rules_channel_id: Option<Uuid>,
    pub vanity_url: Option<String>,
    pub content_filter: String,
    pub default_notification_level: String,
    pub banner_url: Option<String>,
    pub server_category: Option<String>,
    pub boost_level: i32,
    pub boost_count: i32,
    pub raid_protection: bool,
    pub require_2fa_for_moderation: bool,
    pub server_locale: String,
    pub max_video_channel_users: i32,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: Option<String>,
    pub is_public: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub welcome_message: Option<String>,
    pub banner: Option<String>,
    pub system_channel_id: Option<Uuid>,
    pub afk_channel_id: Option<Uuid>,
    pub afk_timeout: Option<i32>,
    pub rules_channel_id: Option<Uuid>,
    pub vanity_url: Option<String>,
    pub content_filter: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[allow(dead_code)]
pub struct ServerMember {
    pub id: Uuid,
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub is_owner: bool,
    pub timed_out_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Invite {
    pub code: String,
    pub server_id: Uuid,
    pub creator_id: Option<Uuid>,
    pub uses: i32,
    pub max_uses: Option<i32>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i32>,
    pub expires_hours: Option<i64>,
}
