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
    pub owner_id: Uuid,
    pub invite_code: Option<String>,
    pub member_count: i32,
    pub is_public: bool,
    pub created_at: DateTime<Utc>,
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
}

#[derive(Debug, Serialize, sqlx::FromRow)]
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
