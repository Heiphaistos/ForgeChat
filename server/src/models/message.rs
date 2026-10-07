use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow, Clone)]
#[allow(dead_code)]
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
    /// Décoration d'avatar de l'auteur (jamais pour un webhook).
    pub author_avatar_decoration: Option<String>,
    pub author_is_bot: bool,
    pub author_verified: bool,
    pub attachments: Vec<Attachment>,
    pub reactions: Vec<ReactionCount>,
    pub expires_at: Option<DateTime<Utc>>,
    pub poll_id: Option<Uuid>,
    #[serde(flatten)]
    pub e2e: MsgE2e,
}

/// Chiffrement de bout en bout d'un message de salon (docs/CHIFFREMENT-E2E.md §10).
#[derive(Debug, Serialize, Clone, Default)]
pub struct MsgE2e {
    /// {v, epoch, iv, ct} : `content` est alors NULL.
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
    /// Ancien texte en clair effacé 30 jours après le déploiement.
    pub purged: bool,
    /// Texte en clair (webhook, bot, système, auteur sans clé, ancien message) : affiché « non chiffré ».
    pub unencrypted: bool,
    pub reply_to_enc: Option<serde_json::Value>,
    pub reply_to_client_msg_id: Option<Uuid>,
    pub reply_to_author_id: Option<Uuid>,
}

impl MsgE2e {
    /// Message en clair (ou pièce jointe seule si `has_text` est faux).
    pub fn plain(has_text: bool) -> Self {
        MsgE2e { unencrypted: has_text, ..Default::default() }
    }

    /// Lit `enc`, `client_msg_id`, `purged`, `content` et les alias `reply_to_*` d'une ligne.
    pub fn from_row(r: &sqlx::postgres::PgRow) -> Self {
        use sqlx::Row;
        let enc: Option<serde_json::Value> = r.try_get("enc").ok().flatten();
        let content: Option<String> = r.try_get("content").ok().flatten();
        MsgE2e {
            unencrypted: enc.is_none() && content.is_some(),
            enc,
            client_msg_id: r.try_get("client_msg_id").ok().flatten(),
            purged: r.try_get("purged").unwrap_or(false),
            reply_to_enc: r.try_get("reply_to_enc").ok().flatten(),
            reply_to_client_msg_id: r.try_get("reply_to_client_msg_id").ok().flatten(),
            reply_to_author_id: r.try_get("reply_to_author_id").ok().flatten(),
        }
    }
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
    /// Super réaction : comptée à part de la réaction normale du même emoji.
    pub is_super: bool,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: Option<String>,
    pub reply_to: Option<Uuid>,
    pub expires_at_seconds: Option<i64>,
    pub has_attachments: Option<bool>,
    /// Contenu chiffré {v, epoch, iv, ct} (remplace `content`).
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
    /// Mentions en métadonnées (message chiffré : le serveur ne lit pas le texte).
    #[serde(flatten)]
    pub mentions: MentionMeta,
}

/// Mentions déclarées par l'appli : membres, rôles, @everyone, @here.
#[derive(Debug, Deserialize, Default)]
pub struct MentionMeta {
    pub mentions: Option<Vec<Uuid>>,
    pub mention_roles: Option<Vec<Uuid>>,
    pub mention_everyone: Option<bool>,
    pub mention_here: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    #[serde(default)]
    pub content: String,
    /// Édition chiffrée : nouveau contenu chiffré (même `client_msg_id`).
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct GetMessagesQuery {
    pub before: Option<Uuid>,
    #[allow(dead_code)]
    pub after: Option<Uuid>,
    pub around: Option<Uuid>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ForwardMessageRequest {
    pub channel_id: Uuid,
    /// Message source chiffré : texte déchiffré par l'appli (le salon cible n'est pas chiffré).
    pub content: Option<String>,
    /// Salon cible chiffré : copie chiffrée par l'appli pour ce salon.
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
}

