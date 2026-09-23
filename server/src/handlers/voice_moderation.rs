//! Modération vocale (audit P2-2) : muet et sourdine imposés, déplacement
//! et déconnexion d'un membre, comme Discord et TeamSpeak.
//!
//! ForgeChat reste l'autorité : les droits sont vérifiés ici (MUTE_MEMBERS,
//! DEAFEN_MEMBERS, MOVE_MEMBERS et hiérarchie des rôles), puis appliqués au
//! SFU LiveKit (`UpdateParticipant` retire le micro ou l'écoute,
//! `RemoveParticipant` éjecte). Le muet / la sourdine sont stockés sur
//! `server_members` : ils suivent le membre et ne sont pas levables par lui.

use std::time::{Duration, Instant};

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::websocket::{cleanup_voice, has_perm, voice_perm_ok},
    livekit::Publish,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// Délai laissé au client déplacé pour rejoindre le salon cible.
const MOVE_GRANT_TTL: Duration = Duration::from_secs(30);

/// Droits média d'un membre dans un salon vocal.
pub(crate) struct VoiceRights {
    /// SPEAK_VOICE et pas de timeout (caméra comprise).
    speak: bool,
    /// Partage d'écran (STREAM) et pas de timeout.
    stream: bool,
    pub server_muted: bool,
    pub server_deafened: bool,
}

impl VoiceRights {
    /// Le micro est-il autorisé ? Muet ou sourdine imposés le retirent.
    pub fn microphone(&self) -> bool {
        self.speak && !self.server_muted && !self.server_deafened
    }

    pub fn publish(&self, listen_only: bool) -> Publish {
        Publish {
            microphone: self.microphone() && !listen_only,
            camera: self.speak && !listen_only,
            screen: self.stream && !listen_only,
            deafened: self.server_deafened,
        }
    }
}

/// Muet et sourdine imposés à un membre (`false, false` hors serveur).
pub(crate) async fn imposed(state: &AppState, server_id: Uuid, user_id: Uuid) -> (bool, bool) {
    sqlx::query_as::<_, (bool, bool)>(
        "SELECT voice_muted, voice_deafened FROM server_members WHERE server_id=$1 AND user_id=$2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or((false, false))
}

/// Droits média de `user_id` dans `channel_id` (`perms` = ses permissions
/// effectives sur ce salon). Un membre en timeout peut écouter mais pas parler.
pub(crate) async fn voice_rights(
    state: &AppState, user_id: Uuid, server_id: Uuid, channel_id: Uuid, perms: i64,
) -> VoiceRights {
    let timed_out = crate::handlers::servers::require_not_timed_out(state, user_id, server_id).await.is_err();
    let (server_muted, server_deafened) = imposed(state, server_id, user_id).await;
    VoiceRights {
        speak: !timed_out && voice_perm_ok(state, server_id, channel_id, perms, Permissions::SPEAK_VOICE).await,
        stream: !timed_out && voice_perm_ok(state, server_id, channel_id, perms, crate::state::PERM_STREAM).await,
        server_muted,
        server_deafened,
    }
}

/// Consomme l'autorisation de déplacement de `user_id` vers `channel_id`.
pub(crate) async fn take_move_grant(state: &AppState, user_id: Uuid, channel_id: Uuid) -> bool {
    let mut grants = state.voice_move_grants.write().await;
    grants.retain(|_, (_, at)| at.elapsed() < MOVE_GRANT_TTL);
    match grants.get(&user_id) {
        Some((ch, _)) if *ch == channel_id => {
            grants.remove(&user_id);
            true
        }
        _ => false,
    }
}

/// L'acteur a-t-il `bit` sur ce salon (overrides compris), ou sur le serveur
/// si le membre visé n'est pas en vocal ?
async fn actor_has(state: &AppState, actor: Uuid, server_id: Uuid, channel: Option<Uuid>, bit: i64) -> Result<bool> {
    let perms = match channel {
        Some(ch) => state.effective_channel_permissions(actor, ch).await.map(|(_, p)| p).unwrap_or(0),
        None => crate::handlers::servers::effective_permissions(state, actor, server_id).await?,
    };
    Ok(has_perm(perms, bit))
}

#[derive(Debug, Deserialize)]
pub struct VoiceModeration {
    /// Muet imposé (on / off).
    pub mute: Option<bool>,
    /// Sourdine imposée (on / off) : n'entend plus rien et ne peut plus parler.
    pub deafen: Option<bool>,
    /// Déplacer vers ce salon vocal du même serveur.
    pub channel_id: Option<Uuid>,
    /// Déconnecter du vocal.
    #[serde(default)]
    pub disconnect: bool,
}

/// PATCH /servers/:server_id/members/:user_id/voice
pub async fn moderate_voice(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, target)): Path<(Uuid, Uuid)>,
    Json(body): Json<VoiceModeration>,
) -> Result<Json<serde_json::Value>> {
    let actor = claims.sub;
    if body.mute.is_none() && body.deafen.is_none() && body.channel_id.is_none() && !body.disconnect {
        return Err(AppError::BadRequest("Aucune action demandée".into()));
    }
    if body.channel_id.is_some() && body.disconnect {
        return Err(AppError::BadRequest("Déplacer ou déconnecter, pas les deux".into()));
    }
    crate::handlers::servers::require_member(&state, actor, server_id).await?;
    crate::handlers::servers::require_member(&state, target, server_id)
        .await
        .map_err(|_| AppError::NotFound("Membre introuvable".into()))?;

    // Salon vocal actuel du membre, s'il est sur CE serveur.
    let in_voice = state.user_voice.read().await.get(&target).copied();
    let current = match in_voice {
        Some(ch) if state.channel_server_id(ch).await == Some(server_id) => Some(ch),
        _ => None,
    };

    // Permissions, vérifiées sur le salon où se trouve le membre.
    if body.mute.is_some() && !actor_has(&state, actor, server_id, current, Permissions::MUTE_MEMBERS).await? {
        return Err(AppError::Forbidden);
    }
    if body.deafen.is_some() && !actor_has(&state, actor, server_id, current, Permissions::DEAFEN_MEMBERS).await? {
        return Err(AppError::Forbidden);
    }
    let moving = body.channel_id.is_some() || body.disconnect;
    if moving {
        if current.is_none() {
            return Err(AppError::BadRequest("Ce membre n'est pas en vocal sur ce serveur".into()));
        }
        if !actor_has(&state, actor, server_id, current, Permissions::MOVE_MEMBERS).await? {
            return Err(AppError::Forbidden);
        }
    }
    // Hiérarchie : jamais sur un rôle égal ou supérieur (soi-même excepté).
    if target != actor {
        crate::handlers::servers::require_outranks(&state, actor, target, server_id).await?;
    }

    // Salon de destination : vocal, du même serveur, déplaçable par l'acteur,
    // et accessible au membre (CONNECT_VOICE).
    let destination = match body.channel_id {
        Some(dest) if Some(dest) == current => None,
        Some(dest) => {
            let row = sqlx::query_as::<_, (String, bool, String)>(
                "SELECT type, is_auto_create, name FROM channels WHERE id=$1 AND server_id=$2",
            )
            .bind(dest)
            .bind(server_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::NotFound("Salon introuvable".into()))?;
            if !matches!(row.0.as_str(), "voice" | "video") || row.1 {
                return Err(AppError::BadRequest("Destination : un salon vocal ordinaire".into()));
            }
            if !actor_has(&state, actor, server_id, Some(dest), Permissions::MOVE_MEMBERS).await? {
                return Err(AppError::Forbidden);
            }
            let target_perms = state.effective_channel_permissions(target, dest).await.map(|(_, p)| p).unwrap_or(0);
            if !voice_perm_ok(&state, server_id, dest, target_perms, Permissions::CONNECT_VOICE).await {
                return Err(AppError::BadRequest("Ce membre n'a pas accès à ce salon vocal".into()));
            }
            Some((dest, row.2))
        }
        None => None,
    };

    // ── Muet / sourdine imposés ──────────────────────────────────────────
    let (mut muted, mut deafened) = imposed(&state, server_id, target).await;
    if body.mute.is_some() || body.deafen.is_some() {
        (muted, deafened) = sqlx::query_as::<_, (bool, bool)>(
            "UPDATE server_members
             SET voice_muted = COALESCE($3, voice_muted), voice_deafened = COALESCE($4, voice_deafened)
             WHERE server_id=$1 AND user_id=$2
             RETURNING voice_muted, voice_deafened",
        )
        .bind(server_id)
        .bind(target)
        .bind(body.mute)
        .bind(body.deafen)
        .fetch_one(&state.db)
        .await?;

        // Effet immédiat sur le SFU si le membre reste en vocal ici.
        if let (Some(ch), false) = (current, moving) {
            if let Some(lk) = state.livekit.clone() {
                let perms = state.effective_channel_permissions(target, ch).await.map(|(_, p)| p).unwrap_or(0);
                let rights = voice_rights(&state, target, server_id, ch, perms).await;
                crate::livekit::update_participant(
                    &state.http_client, &lk, &crate::livekit::room_for_channel(ch),
                    &target.to_string(), rights.publish(false),
                ).await;
            }
            // L'état affiché suit le muet imposé tout de suite, sans attendre
            // le VOICE_STATE du client concerné.
            if let Some(vs) = state.voice_states.write().await.get_mut(&target) {
                vs.muted |= muted || deafened;
                vs.deafened |= deafened;
            }
        }

        let event = serde_json::json!({
            "type": "VOICE_SERVER_STATE",
            "server_id": server_id,
            "channel_id": current,
            "user_id": target,
            "server_muted": muted,
            "server_deafened": deafened,
        })
        .to_string();
        if let Some(ch) = current {
            state.broadcast_to_channel_members_except(ch, Some(target), event.clone()).await;
        }
        state.broadcast_to_user(target, event).await;
        crate::handlers::audit::log_event(
            &state, server_id, "MEMBER_VOICE_UPDATE", Some(actor), None, Some(target), None,
            Some(serde_json::json!({ "mute": body.mute, "deafen": body.deafen })),
        ).await;
    }

    // ── Déplacer / déconnecter ───────────────────────────────────────────
    // La sortie est imposée côté serveur (salon quitté, éjection du SFU) : un
    // client modifié ne peut pas l'ignorer. Le déplacement demande ensuite au
    // client de rejoindre la destination, sans mot de passe ni limite.
    if body.disconnect || destination.is_some() {
        let from = current;
        cleanup_voice(&state, target, None).await;
        if let Some((dest, name)) = destination {
            state.voice_move_grants.write().await.insert(target, (dest, Instant::now()));
            state.broadcast_to_user(target, serde_json::json!({
                "type": "VOICE_MOVE",
                "server_id": server_id,
                "from_channel_id": from,
                "channel_id": dest,
                "channel_name": name,
            }).to_string()).await;
            crate::handlers::audit::log_event(
                &state, server_id, "MEMBER_MOVE", Some(actor), None, Some(target), None,
                Some(serde_json::json!({ "from": from, "to": dest })),
            ).await;
        } else {
            state.broadcast_to_user(target, serde_json::json!({
                "type": "VOICE_FORCE_DISCONNECT",
                "server_id": server_id,
                "channel_id": from,
            }).to_string()).await;
            crate::handlers::audit::log_event(
                &state, server_id, "MEMBER_DISCONNECT", Some(actor), None, Some(target), None,
                Some(serde_json::json!({ "channel_id": from })),
            ).await;
        }
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "server_muted": muted,
        "server_deafened": deafened,
    })))
}
