use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, handlers::servers::require_member_and_channel, middleware::auth::Claims, state::AppState};

#[derive(Deserialize)]
pub struct SaveMessageBody {
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
    pub content: Option<String>,
    pub author_username: Option<String>,
    pub author_avatar: Option<String>,
}

#[derive(Serialize)]
pub struct SavedMessage {
    pub id: Uuid,
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Option<Uuid>,
    pub content: Option<String>,
    pub author_username: Option<String>,
    pub author_avatar: Option<String>,
    pub saved_at: DateTime<Utc>,
    // Le frontend (SavedPage.tsx) attend ces 4 champs pour le fil d'ariane
    // serveur/canal, la date d'origine du message et les pièces jointes --
    // jamais renvoyés avant ce fix, donc toujours `undefined` côté client :
    // fil d'ariane jamais affiché, date "Invalid Date", filtre Images/Fichiers
    // toujours négatif (detectType() ne voyait jamais d'attachments).
    pub created_at: DateTime<Utc>,
    pub channel_name: Option<String>,
    pub server_name: Option<String>,
    pub attachments: Vec<crate::models::message::Attachment>,
    /// Message de salon chiffré : aucune copie du texte, l'appli déchiffre l'original.
    pub enc: Option<serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
    pub author_id: Option<Uuid>,
}

pub async fn save_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SaveMessageBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Vérifier que l'utilisateur a accès au canal/serveur référencé. Sans server_id,
    // channel_id désigne un DM 1-à-1 (dm_channels) -- ce cas n'était PAS vérifié du
    // tout : n'importe quel utilisateur authentifié pouvait fournir un channel_id de
    // DM arbitraire (dont il n'a jamais été membre) sans jamais être rejeté.
    if let Some(sid) = body.server_id {
        require_member_and_channel(&state, claims.sub, sid, body.channel_id).await?;
    } else {
        let is_dm_member: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
        )
        .bind(body.channel_id)
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
        if !is_dm_member {
            return Err(AppError::Forbidden);
        }
    }
    // Le message doit être dans CE salon / ce MP : sinon get_saved renvoyait les pièces
    // jointes et le chiffré d'un message d'un salon masqué (identifiant connu).
    let in_place: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)
             OR EXISTS(SELECT 1 FROM dm_messages WHERE id=$1 AND dm_channel_id=$2)",
    )
    .bind(body.message_id)
    .bind(body.channel_id)
    .fetch_one(&state.db)
    .await?;
    if !in_place {
        return Err(AppError::NotFound("Message introuvable".into()));
    }
    // Message chiffré de bout en bout (MP ou salon) : aucune copie du texte en clair côté serveur.
    let encrypted: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM dm_messages WHERE id=$1 AND enc IS NOT NULL)
             OR EXISTS(SELECT 1 FROM messages WHERE id=$1 AND enc IS NOT NULL)",
    )
    .bind(body.message_id)
    .fetch_one(&state.db)
    .await?;
    let content = if encrypted { None } else { body.content };
    sqlx::query(
        "INSERT INTO saved_messages (user_id, message_id, channel_id, server_id, content, author_username, author_avatar)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, message_id) DO NOTHING"
    )
    .bind(claims.sub)
    .bind(body.message_id)
    .bind(body.channel_id)
    .bind(body.server_id)
    .bind(content)
    .bind(body.author_username)
    .bind(body.author_avatar)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Lecture encore permise (fail-closed : toute erreur => non).
async fn can_still_read(state: &AppState, user: Uuid, server_id: Option<Uuid>, channel_id: Uuid) -> bool {
    match server_id {
        Some(sid) => {
            require_member_and_channel(state, user, sid, channel_id).await.is_ok()
                && crate::handlers::servers::can_read_history(state, user, channel_id).await
        }
        None => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))",
        )
        .bind(channel_id)
        .bind(user)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false),
    }
}

pub async fn get_saved(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<SavedMessage>>, AppError> {
    use sqlx::Row;
    // LEFT JOIN partout : le message/canal/serveur d'origine peut avoir été
    // supprimé depuis la sauvegarde (schéma volontairement sans FK dessus,
    // cf. migration 006) -- content/author_* déjà figés dans saved_messages
    // servent justement de secours dans ce cas, created_at retombe sur
    // saved_at plutôt que de planter ou renvoyer NULL.
    let rows = sqlx::query(
        "SELECT sm.id, sm.message_id, sm.channel_id, sm.server_id,
                sm.content, sm.author_username, sm.author_avatar, sm.saved_at,
                COALESCE(m.created_at, sm.saved_at) as created_at,
                c.name as channel_name,
                s.name as server_name,
                m.enc, m.client_msg_id, m.user_id AS author_id
         FROM saved_messages sm
         LEFT JOIN messages m ON m.id = sm.message_id
         LEFT JOIN channels c ON c.id = sm.channel_id
         LEFT JOIN servers s ON s.id = sm.server_id
         WHERE sm.user_id=$1 ORDER BY sm.saved_at DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let message_ids: Vec<Uuid> = rows.iter().map(|r| r.get("message_id")).collect();
    let all_attachments: Vec<crate::models::message::Attachment> = sqlx::query_as(
        "SELECT * FROM attachments WHERE message_id = ANY($1) AND (expires_at IS NULL OR expires_at > NOW())"
    )
    .bind(&message_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // Droits de lecture ACTUELS par salon/MP : exclu, salon masqué ou READ_HISTORY retiré => l'entrée
    // reste listée mais sans contenu (ni chiffré, ni pièces jointes, ni noms).
    let mut readable: std::collections::HashMap<Uuid, bool> = std::collections::HashMap::new();
    for r in &rows {
        let cid: Uuid = r.get("channel_id");
        if readable.contains_key(&cid) { continue; }
        let sid: Option<Uuid> = r.get("server_id");
        readable.insert(cid, can_still_read(&state, claims.sub, sid, cid).await);
    }
    let items = rows.iter().map(|r| {
        let mid: Uuid = r.get("message_id");
        let ok = readable.get(&r.get::<Uuid, _>("channel_id")).copied().unwrap_or(false);
        if !ok {
            return SavedMessage {
                id: r.get("id"),
                message_id: mid,
                channel_id: r.get("channel_id"),
                server_id: r.get("server_id"),
                content: None,
                author_username: None,
                author_avatar: None,
                saved_at: r.get("saved_at"),
                created_at: r.get("saved_at"),
                channel_name: None,
                server_name: None,
                attachments: Vec::new(),
                enc: None,
                client_msg_id: None,
                author_id: None,
            };
        }
        SavedMessage {
            id: r.get("id"),
            message_id: mid,
            channel_id: r.get("channel_id"),
            server_id: r.get("server_id"),
            content: r.get("content"),
            author_username: r.get("author_username"),
            author_avatar: r.get("author_avatar"),
            saved_at: r.get("saved_at"),
            created_at: r.get("created_at"),
            channel_name: r.get("channel_name"),
            server_name: r.get("server_name"),
            attachments: all_attachments.iter().filter(|a| a.message_id == mid).cloned().collect(),
            enc: r.get("enc"),
            client_msg_id: r.get("client_msg_id"),
            author_id: r.get("author_id"),
        }
    }).collect();

    Ok(Json(items))
}

pub async fn unsave_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    sqlx::query("DELETE FROM saved_messages WHERE user_id=$1 AND message_id=$2")
        .bind(claims.sub)
        .bind(message_id)
        .execute(&state.db)
        .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Notes privées sur une personne (lot « Profil et social ») ───────────────
// Chiffrées sur l'appareil avec la clé de compte de leur auteur : le serveur ne
// garde qu'un blob opaque {v, iv, ct}. `content` = ancien texte en clair, rendu
// une dernière fois à son auteur pour que son appli le rechiffre, puis effacé.

/// Taille maximale du chiffré en base64url (2000 caractères de 4 octets + tag).
const NOTE_CT_MAX_B64: usize = 11_000;

#[derive(Serialize)]
pub struct UserNote {
    pub enc: Option<serde_json::Value>,
    pub content: String,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoteEnc {
    pub v: u8,
    pub iv: String,
    pub ct: String,
}

impl NoteEnc {
    fn valid(&self) -> bool {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let len = |s: &str, max: usize| (s.len() <= max).then(|| URL_SAFE_NO_PAD.decode(s).ok().map(|b| b.len())).flatten();
        self.v == 1 && len(&self.iv, 16) == Some(12) && len(&self.ct, NOTE_CT_MAX_B64).is_some_and(|n| n >= 16)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetNoteBody {
    /// null = supprimer la note.
    #[serde(default)]
    pub enc: Option<NoteEnc>,
    /// Texte en clair des anciennes applis : refusé.
    #[serde(default)]
    pub content: Option<String>,
}

pub async fn get_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
) -> Result<Json<UserNote>, AppError> {
    use sqlx::Row;
    let row = sqlx::query("SELECT enc, content, updated_at FROM user_notes WHERE user_id=$1 AND target_user_id=$2")
        .bind(claims.sub).bind(target_id)
        .fetch_optional(&state.db).await?;
    Ok(Json(match row {
        Some(r) => UserNote { enc: r.get("enc"), content: r.get("content"), updated_at: Some(r.get("updated_at")) },
        None => UserNote { enc: None, content: String::new(), updated_at: None },
    }))
}

pub async fn set_note(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<SetNoteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.content.is_some_and(|c| !c.is_empty()) {
        return Err(AppError::BadRequest(
            "PLAINTEXT_REFUSED : les notes privées sont chiffrées, mets à jour ForgeChat pour les modifier.".into(),
        ));
    }
    if crate::handlers::password_reset::over_limit(&state, &format!("note:{}", claims.sub), 120, 600).await {
        return Err(AppError::TooManyRequests);
    }
    match body.enc {
        None => {
            sqlx::query("DELETE FROM user_notes WHERE user_id=$1 AND target_user_id=$2")
                .bind(claims.sub).bind(target_id)
                .execute(&state.db).await?;
        }
        Some(enc) => {
            if !enc.valid() {
                return Err(AppError::BadRequest("Note chiffrée invalide".into()));
            }
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)")
                .bind(target_id).fetch_one(&state.db).await?;
            if !exists {
                return Err(AppError::NotFound("Utilisateur introuvable".into()));
            }
            let json = serde_json::json!({ "v": enc.v, "iv": enc.iv, "ct": enc.ct });
            // Le clair éventuel (ancienne note) disparaît en même temps.
            sqlx::query(
                "INSERT INTO user_notes (user_id, target_user_id, content, enc, updated_at)
                 VALUES ($1,$2,'',$3,NOW())
                 ON CONFLICT (user_id, target_user_id) DO UPDATE SET content='', enc=$3, updated_at=NOW()"
            )
            .bind(claims.sub).bind(target_id).bind(&json)
            .execute(&state.db).await?;
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::NoteEnc;

    #[test]
    fn note_chiffree_valide() {
        let ok = || NoteEnc { v: 1, iv: "AAAAAAAAAAAAAAAA".into(), ct: "A".repeat(22) };
        assert!(ok().valid());
        assert!(!NoteEnc { v: 2, ..ok() }.valid());
        assert!(!NoteEnc { iv: "AAAA".into(), ..ok() }.valid());
        assert!(!NoteEnc { ct: "A".repeat(20_000), ..ok() }.valid());
        assert!(!NoteEnc { ct: "pas du base64 !".into(), ..ok() }.valid());
    }
}
