use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::serde_helpers::deserialize_double_option;

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
    /// Créateur (migration 068) : droit DELETE_OWN_CHANNELS et protection des
    /// salons du propriétaire. NULL si le compte a été supprimé.
    #[sqlx(default)]
    pub created_by: Option<Uuid>,
    /// Salle d'attente vocale (migration 090, handlers/voice_waiting.rs).
    #[sqlx(default)]
    pub waiting_room: bool,
    /// Messages éphémères du salon (migration 088) : durée en secondes, NULL = désactivé.
    #[sqlx(default)]
    pub disappear_seconds: Option<i32>,
    /// Fils automatiques : chaque message ouvre son fil.
    #[sqlx(default)]
    pub auto_threads: bool,
    /// Statut d'un salon vocal (137, handlers/channel_extras.rs).
    #[sqlx(default)]
    pub voice_status: Option<String>,
    /// Forum : réaction par défaut et consignes de publication (137).
    #[sqlx(default)]
    pub default_reaction_emoji: Option<String>,
    #[sqlx(default)]
    pub post_guidelines: Option<String>,
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
    /// null ou 0 = sans limite.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub user_limit: Option<Option<i32>>,
    /// Mot de passe en clair — sera hashé côté serveur
    pub voice_password: Option<String>,
    /// Passer `true` pour supprimer le mot de passe
    pub remove_voice_password: Option<bool>,
    /// Toggle canal auto-create (crée un vocal temporaire au join)
    pub is_auto_create: Option<bool>,
    /// Nom template pour les canaux temporaires créés (défaut: "{username}'s Channel")
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub auto_create_name: Option<Option<String>>,
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
    #[sqlx(default)]
    pub created_by: Option<Uuid>,
    /// Réservée aux administrateurs (092) : masquée aux autres, ses salons naissent privés.
    #[sqlx(default)]
    pub staff_only: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
}

/// Mode lent : 6 h au plus (comme Discord).
pub const SLOWMODE_MAX: i32 = 21_600;
/// Sujet du salon, en caractères.
pub const TOPIC_MAX: usize = 1024;
/// Mot de passe vocal : bcrypt n'utilise que 72 octets, au-delà il serait ignoré en silence.
pub const VOICE_PASSWORD_MAX_BYTES: usize = 72;

/// Nom de salon ou de catégorie rogné : 1 à 100 caractères (VARCHAR(100)). Avant : vide
/// ou trop long passait jusqu'à la base (500) pour les catégories ; octets comptés pour les salons.
pub fn clean_name(name: &str) -> Result<&str, &'static str> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Nom : 1 à 100 caractères");
    }
    Ok(name)
}

/// Bornes communes à la création et à la modification d'un salon.
pub fn check_channel_fields(
    topic: Option<&str>,
    slowmode: Option<i32>,
    user_limit: Option<i32>,
) -> Result<(), &'static str> {
    if topic.is_some_and(|t| t.chars().count() > TOPIC_MAX) {
        return Err("Sujet : 1024 caractères au plus");
    }
    if slowmode.is_some_and(|s| !(0..=SLOWMODE_MAX).contains(&s)) {
        return Err("Mode lent : 0 à 21600 secondes");
    }
    if user_limit.is_some_and(|l| !(0..=99).contains(&l)) {
        return Err("Limite de places : 0 à 99");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bornes_salon() {
        assert_eq!(clean_name("  général "), Ok("général"));
        assert!(clean_name("   ").is_err());
        assert!(clean_name(&"é".repeat(100)).is_ok());
        assert!(clean_name(&"é".repeat(101)).is_err());
        assert!(check_channel_fields(Some("ok"), Some(0), Some(99)).is_ok());
        assert!(check_channel_fields(None, Some(SLOWMODE_MAX + 1), None).is_err());
        assert!(check_channel_fields(None, Some(-1), None).is_err());
        assert!(check_channel_fields(Some(&"x".repeat(TOPIC_MAX + 1)), None, None).is_err());
        assert!(check_channel_fields(None, None, Some(100)).is_err());
    }
}
