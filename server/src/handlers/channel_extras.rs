//! Réglages de salon façon Discord, hors du PATCH général :
//!  * statut d'un salon vocal (texte court affiché sous le nom du salon) ;
//!  * forum : réaction par défaut des publications et consignes de publication.
//!
//! Chaque changement part en CHANNEL_UPDATE (objet `channel` partiel) aux membres qui voient le salon.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{
        channel_access::{require_channel_perm, CAN_EDIT},
        password_reset::over_limit,
        servers::require_permission_and_channel,
    },
    middleware::auth::Claims,
    models::{profile_style::clean_label, serde_helpers::deserialize_double_option},
    state::AppState,
};

/// Statut vocal, en caractères (Discord : 500).
pub const VOICE_STATUS_MAX: usize = 500;
/// Réaction par défaut : même borne que les réactions (messages::require_can_react).
pub const DEFAULT_REACTION_MAX: usize = 64;
/// Consignes de publication d'un forum, en caractères.
pub const GUIDELINES_MAX: usize = 2000;

/// Consignes multi-lignes : même filtre que `clean_label` (contrôle, invisibles, bidi)
/// mais les retours à la ligne sont permis. Vide → None (effacer).
pub fn clean_guidelines(s: &str) -> std::result::Result<Option<String>, String> {
    let s = s.replace("\r\n", "\n");
    // Remplacement 1 pour 1 : le compte de caractères est inchangé.
    clean_label(&s.replace('\n', " "), GUIDELINES_MAX, "Consignes")?;
    let s = s.trim();
    Ok((!s.is_empty()).then(|| s.to_string()))
}

async fn broadcast_partial(state: &AppState, server_id: Uuid, channel_id: Uuid, channel: &Value) {
    let event = json!({ "type": "CHANNEL_UPDATE", "server_id": server_id, "channel": channel });
    state
        .broadcast_to_channel_members(channel_id, event.to_string())
        .await;
}

// ─── Statut vocal ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoiceStatusBody {
    /// Texte ; `null` ou vide = effacer.
    pub status: Option<String>,
}

/// PUT /servers/:server_id/channels/:channel_id/voice-status {status}
/// Permis à qui est connecté à CE salon vocal, ou à qui peut modifier le salon.
pub async fn set_voice_status(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<VoiceStatusBody>,
) -> Result<Json<Value>> {
    if over_limit(&state, &format!("voice_status:{}", claims.sub), 10, 60).await {
        return Err(AppError::TooManyRequests);
    }
    let status = match body.status.as_deref() {
        Some(s) => {
            clean_label(s, VOICE_STATUS_MAX, "Statut vocal").map_err(AppError::BadRequest)?
        }
        None => None,
    };
    let connected = state.user_voice.read().await.get(&claims.sub) == Some(&channel_id);
    if !connected {
        require_permission_and_channel(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;
        // Droit retiré sur CE salon par une surcharge : refus (comme update_channel).
        require_channel_perm(&state, claims.sub, channel_id, CAN_EDIT).await?;
    }
    let updated = sqlx::query("UPDATE channels SET voice_status=$3 WHERE id=$1 AND server_id=$2 AND type IN ('voice', 'stage')")
        .bind(channel_id)
        .bind(server_id)
        .bind(&status)
        .execute(&state.db)
        .await?;
    if updated.rows_affected() == 0 {
        return Err(AppError::BadRequest(
            "Statut réservé aux salons vocaux".into(),
        ));
    }
    let out = json!({ "id": channel_id, "server_id": server_id, "voice_status": status, "voice_status_by": claims.sub });
    broadcast_partial(&state, server_id, channel_id, &out).await;
    Ok(Json(out))
}

/// Dernier occupant parti (websocket::cleanup_voice) : le statut tombe, comme sur Discord.
/// Rien n'est diffusé si le salon n'avait pas de statut.
pub async fn clear_voice_status(state: &AppState, channel_id: Uuid) {
    let cleared: std::result::Result<Option<Uuid>, sqlx::Error> = sqlx::query_scalar(
        "UPDATE channels SET voice_status=NULL WHERE id=$1 AND voice_status IS NOT NULL AND server_id IS NOT NULL RETURNING server_id",
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await;
    match cleared {
        Ok(Some(server_id)) => {
            let out = json!({ "id": channel_id, "server_id": server_id, "voice_status": null, "voice_status_by": null });
            broadcast_partial(state, server_id, channel_id, &out).await;
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(channel_id = %channel_id, "Effacement du statut vocal : {e}"),
    }
}

// ─── Forum ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ForumSettingsBody {
    /// Absent = inchangé ; `null` ou vide = effacer.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub default_reaction_emoji: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub post_guidelines: Option<Option<String>>,
}

/// PATCH /servers/:server_id/channels/:channel_id/forum-settings
/// {default_reaction_emoji?, post_guidelines?} — salons forum et médias.
pub async fn set_forum_settings(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ForumSettingsBody>,
) -> Result<Json<Value>> {
    require_permission_and_channel(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;
    require_channel_perm(&state, claims.sub, channel_id, CAN_EDIT).await?;
    let emoji = body
        .default_reaction_emoji
        .as_ref()
        .map(|v| match v.as_deref() {
            Some(s) => clean_label(s, DEFAULT_REACTION_MAX, "Réaction par défaut"),
            None => Ok(None),
        })
        .transpose()
        .map_err(AppError::BadRequest)?;
    let guidelines = body
        .post_guidelines
        .as_ref()
        .map(|v| {
            v.as_deref()
                .map(clean_guidelines)
                .transpose()
                .map(Option::flatten)
        })
        .transpose()
        .map_err(AppError::BadRequest)?;
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "UPDATE channels SET
            default_reaction_emoji = CASE WHEN $3 THEN $4 ELSE default_reaction_emoji END,
            post_guidelines = CASE WHEN $5 THEN $6 ELSE post_guidelines END
         WHERE id=$1 AND server_id=$2 AND type IN ('forum', 'media')
         RETURNING default_reaction_emoji, post_guidelines",
    )
    .bind(channel_id)
    .bind(server_id)
    .bind(emoji.is_some())
    .bind(emoji.flatten())
    .bind(guidelines.is_some())
    .bind(guidelines.flatten())
    .fetch_optional(&state.db)
    .await?;
    let (emoji, guidelines) =
        row.ok_or_else(|| AppError::BadRequest("Réglage réservé aux forums".into()))?;
    let out = json!({
        "id": channel_id,
        "server_id": server_id,
        "default_reaction_emoji": emoji,
        "post_guidelines": guidelines,
    });
    broadcast_partial(&state, server_id, channel_id, &out).await;
    Ok(Json(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guidelines_keep_newlines_reject_invisible() {
        assert_eq!(
            clean_guidelines("  Règle 1\r\nRègle 2  ")
                .unwrap()
                .as_deref(),
            Some("Règle 1\nRègle 2")
        );
        assert_eq!(clean_guidelines(" \n ").unwrap(), None);
        assert!(clean_guidelines("a\u{202E}b").is_err());
        assert!(clean_guidelines("a\u{0007}b").is_err());
        assert!(clean_guidelines(&"é".repeat(GUIDELINES_MAX)).is_ok());
        assert!(clean_guidelines(&"é".repeat(GUIDELINES_MAX + 1)).is_err());
    }

    #[test]
    fn voice_status_bounds() {
        assert_eq!(
            clean_label("  En réunion ", VOICE_STATUS_MAX, "Statut vocal")
                .unwrap()
                .as_deref(),
            Some("En réunion")
        );
        assert!(clean_label(
            &"x".repeat(VOICE_STATUS_MAX + 1),
            VOICE_STATUS_MAX,
            "Statut vocal"
        )
        .is_err());
        assert!(clean_label("a\nb", VOICE_STATUS_MAX, "Statut vocal").is_err());
    }
}
