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
    pub is_bot: bool,
    pub is_verified: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
}
