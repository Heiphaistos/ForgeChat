use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub discriminator: String,
    pub email: String,
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
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
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
}

#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
pub struct PendingRegistration {
    pub id: Uuid,
    pub email: String,
    pub username: String,
    pub password_hash: String,
    pub discriminator: String,
    pub code: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}
