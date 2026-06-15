use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Channel {
    pub id: Uuid,
    pub server_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub name: String,
    pub r#type: String,
    pub topic: Option<String>,
    pub position: i32,
    pub is_nsfw: bool,
    pub slowmode_delay: i32,
    pub bitrate: Option<i32>,
    pub user_limit: Option<i32>,
    pub last_message_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub r#type: Option<String>,
    pub topic: Option<String>,
    pub category_id: Option<Uuid>,
    pub is_nsfw: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: Option<i32>,
    pub slowmode_delay: Option<i32>,
    pub is_nsfw: Option<bool>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Category {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub position: i32,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
}
