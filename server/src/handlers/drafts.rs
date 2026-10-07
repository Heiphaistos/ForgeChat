//! Brouillons synchronisés entre appareils. Chiffrés sur l'appareil par une clé dérivée
//! de la clé de compte de leur auteur (docs/CHIFFREMENT-E2E.md §14) : le serveur ne range
//! qu'un blob opaque {v:1, iv, ct} par conversation, et seul son auteur le relit.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::password_reset::over_limit,
    middleware::auth::Claims,
    state::AppState,
};

/// Texte de 4000 caractères (≤ 16 000 o) + JSON + tag, en base64url.
const MAX_CT_B64: usize = 24 * 1024;
/// Brouillons gardés par compte (les plus anciens sont oubliés au-delà).
const MAX_DRAFTS: i64 = 200;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DraftBlob {
    v: u8,
    iv: String,
    ct: String,
}

impl DraftBlob {
    fn validate(&self) -> Result<()> {
        let len = |s: &str, max: usize| (s.len() <= max).then(|| URL_SAFE_NO_PAD.decode(s).ok().map(|b| b.len())).flatten();
        let ct_ok = matches!(len(&self.ct, MAX_CT_B64), Some(n) if n >= 17);
        if self.v != 1 || len(&self.iv, 16) != Some(12) || !ct_ok {
            return Err(AppError::BadRequest("Brouillon chiffré invalide".into()));
        }
        Ok(())
    }
}

/// GET /api/drafts : tous mes brouillons (chiffrés), du plus récent au plus ancien.
pub async fn list_drafts(State(state): State<AppState>, Extension(claims): Extension<Claims>) -> Result<Json<Vec<Value>>> {
    let rows: Vec<(Uuid, Value, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT conv_id, blob, updated_at FROM message_drafts WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2",
    )
    .bind(claims.sub)
    .bind(MAX_DRAFTS)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(conv_id, blob, updated_at)| json!({ "conv_id": conv_id, "blob": blob, "updated_at": updated_at }))
            .collect(),
    ))
}

/// PUT /api/drafts/:conv_id { v, iv, ct } : enregistre (ou remplace) mon brouillon d'une conversation.
/// Le blob n'est lisible que par moi : aucune vérification d'appartenance utile, seulement des bornes.
pub async fn put_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(conv_id): Path<Uuid>,
    Json(blob): Json<DraftBlob>,
) -> Result<Json<Value>> {
    blob.validate()?;
    if over_limit(&state, &format!("drafts:{}", claims.sub), 120, 60).await {
        return Err(AppError::TooManyRequests);
    }
    let stored = json!({ "v": blob.v, "iv": blob.iv, "ct": blob.ct });
    let updated_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "INSERT INTO message_drafts (user_id, conv_id, blob, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, conv_id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = NOW()
         RETURNING updated_at",
    )
    .bind(claims.sub)
    .bind(conv_id)
    .bind(&stored)
    .fetch_one(&state.db)
    .await?;
    sqlx::query(
        "DELETE FROM message_drafts WHERE user_id=$1 AND conv_id IN (
             SELECT conv_id FROM message_drafts WHERE user_id=$1 ORDER BY updated_at DESC OFFSET $2)",
    )
    .bind(claims.sub)
    .bind(MAX_DRAFTS)
    .execute(&state.db)
    .await?;
    sync_event(&state, claims.sub, conv_id).await;
    Ok(Json(json!({ "conv_id": conv_id, "updated_at": updated_at })))
}

/// DELETE /api/drafts/:conv_id : brouillon envoyé ou vidé.
pub async fn delete_draft(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(conv_id): Path<Uuid>,
) -> Result<StatusCode> {
    let done = sqlx::query("DELETE FROM message_drafts WHERE user_id=$1 AND conv_id=$2")
        .bind(claims.sub)
        .bind(conv_id)
        .execute(&state.db)
        .await?;
    if done.rows_affected() > 0 {
        sync_event(&state, claims.sub, conv_id).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Mes autres appareils connectés rechargent ce brouillon (aucun contenu dans l'événement).
async fn sync_event(state: &AppState, user: Uuid, conv_id: Uuid) {
    let event = json!({ "type": "DRAFT_UPDATE", "conv_id": conv_id }).to_string();
    state.broadcast_to_user(user, event).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(iv: usize, ct: usize) -> DraftBlob {
        DraftBlob { v: 1, iv: URL_SAFE_NO_PAD.encode(vec![1u8; iv]), ct: URL_SAFE_NO_PAD.encode(vec![2u8; ct]) }
    }

    #[test]
    fn draft_bounds() {
        assert!(blob(12, 17).validate().is_ok());
        assert!(blob(12, 16_500).validate().is_ok());
        assert!(blob(11, 40).validate().is_err(), "IV de 12 octets");
        assert!(blob(12, 16).validate().is_err(), "au moins un octet + le tag");
        assert!(blob(12, 20_000).validate().is_err(), "trop long");
        let mut b = blob(12, 40);
        b.v = 2;
        assert!(b.validate().is_err());
        b = blob(12, 40);
        b.ct.push('*');
        assert!(b.validate().is_err(), "base64url strict");
        assert!(serde_json::from_value::<DraftBlob>(json!({ "v": 1, "iv": "a", "ct": "b", "t": "clair" })).is_err());
    }
}
