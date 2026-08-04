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
    // Jamais renvoyé au client -- ne sert qu'à peupler ce champ depuis la ligne
    // SQL pour la vérification bcrypt côté serveur (websocket.rs lit la colonne
    // brute directement, pas via ce struct). Sérialiser le hash bcrypt en clair
    // dans les réponses JSON (create_channel/update_channel) permettait un
    // craquage hors-ligne du mot de passe vocal sans aucune limite de débit --
    // trouvé et reproduit en direct : PATCH d'un canal vocal protégé renvoyait
    // le hash complet, exploitable par n'importe quel modérateur MANAGE_CHANNELS.
    #[serde(skip_serializing)]
    pub voice_password_hash: Option<String>,
    #[sqlx(default)]
    pub is_auto_create: bool,
    #[sqlx(default)]
    pub auto_create_name: Option<String>,
    #[sqlx(default)]
    pub is_temporary: bool,
    #[sqlx(default)]
    pub created_by_auto: Option<Uuid>,
    #[sqlx(default)]
    pub archived: bool,
    #[sqlx(default)]
    pub default_sort: String,
    #[sqlx(default)]
    pub require_tag: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub r#type: Option<String>,
    pub topic: Option<String>,
    pub category_id: Option<Uuid>,
    pub is_nsfw: Option<bool>,
    pub slowmode_delay: Option<i32>,
    pub user_limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: Option<i32>,
    pub slowmode_delay: Option<i32>,
    pub is_nsfw: Option<bool>,
    pub user_limit: Option<i32>,
    /// Mot de passe en clair — sera hashé côté serveur
    pub voice_password: Option<String>,
    /// Passer `true` pour supprimer le mot de passe
    pub remove_voice_password: Option<bool>,
    /// Toggle canal auto-create (crée un vocal temporaire au join)
    pub is_auto_create: Option<bool>,
    /// Nom template pour les canaux temporaires créés (défaut: "{username}'s Channel")
    pub auto_create_name: Option<String>,
    pub bitrate: Option<i32>,
    /// Forum uniquement
    pub default_sort: Option<String>,
    pub require_tag: Option<bool>,
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
