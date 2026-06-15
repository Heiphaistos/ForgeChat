use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub content: Option<String>,
    pub r#type: String,
    pub reply_to: Option<Uuid>,
    pub pinned: bool,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Clone)]
pub struct MessageWithAuthor {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub content: Option<String>,
    pub r#type: String,
    pub reply_to: Option<Uuid>,
    pub pinned: bool,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_discriminator: String,
    pub author_avatar: Option<String>,
    pub attachments: Vec<Attachment>,
    pub reactions: Vec<ReactionCount>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ReactionCount {
    pub emoji: String,
    pub count: i64,
    pub me: bool,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: Option<String>,
    pub reply_to: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct GetMessagesQuery {
    pub before: Option<Uuid>,
    pub after: Option<Uuid>,
    pub limit: Option<i64>,
}
