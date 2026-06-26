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
    pub reply_to_content: Option<String>,
    pub reply_to_username: Option<String>,
    pub forward_from_id: Option<Uuid>,
    pub forward_from_username: Option<String>,
    pub pinned: bool,
    pub edited_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_discriminator: String,
    pub author_avatar: Option<String>,
    pub author_is_bot: bool,
    pub author_verified: bool,
    pub attachments: Vec<Attachment>,
    pub reactions: Vec<ReactionCount>,
    pub expires_at: Option<DateTime<Utc>>,
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
    pub expires_at: Option<DateTime<Utc>>,
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
    pub expires_at_seconds: Option<i64>,
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

#[derive(Debug, Deserialize)]
pub struct ForwardMessageRequest {
    pub channel_id: Uuid,
}

