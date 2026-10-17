use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::serde_helpers::deserialize_double_option;

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
    /// Étiquettes de l'annuaire des serveurs publics (092).
    #[sqlx(default)]
    #[serde(default)]
    pub discovery_tags: Vec<String>,
    /// La couleur du rôle remplace la couleur perso du pseudo dans ce serveur (migration 088).
    #[sqlx(default)]
    pub role_color_overrides_name: bool,
    /// Apparence du serveur (migration 135, validée par models/server_look.rs) ; None = par défaut.
    #[sqlx(default)]
    #[serde(default)]
    pub look: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    /// Identifiant d'un modèle intégré (`template_builtin::IDS`).
    pub template: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub welcome_message: Option<String>,
    pub banner: Option<String>,
    // null = vider (salon système/AFK/règles retiré, URL personnalisée supprimée).
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub system_channel_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub afk_channel_id: Option<Option<Uuid>>,
    pub afk_timeout: Option<i32>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub rules_channel_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub vanity_url: Option<Option<String>>,
    pub content_filter: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub server_category: Option<Option<String>>,
    pub discovery_tags: Option<Vec<String>>,
    pub role_color_overrides_name: Option<bool>,
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
    /// Absent : 7 jours ; `null` explicite : sans expiration (option « Jamais » de l'appli web).
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub expires_hours: Option<Option<f64>>,
}

/// Durée de vie par défaut d'une invitation quand le client n'en indique aucune.
pub const DEFAULT_INVITE_HOURS: i64 = 168;
