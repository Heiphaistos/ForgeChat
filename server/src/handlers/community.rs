//! Starboard et messages de bienvenue : messages SYSTÈME (en clair, marqués
//! « non chiffré » comme les flux) qui ne portent que des métadonnées. Le message
//! mis en avant n'est jamais recopié : le starboard publie une RÉFÉRENCE, l'appli
//! d'un membre qui voit le salon d'origine le recharge et le déchiffre elle-même.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// Publie un message système dans un salon et le diffuse à ceux qui le voient.
pub async fn post_system_message(
    state: &AppState,
    server_id: Uuid,
    channel_id: Uuid,
    author: Uuid,
    kind: &str,
    content: &str,
    meta: serde_json::Value,
) -> Option<Uuid> {
    let row = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content, type, system_meta)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at"
    )
    .bind(channel_id).bind(author).bind(content).bind(kind).bind(&meta)
    .fetch_one(&state.db).await
    .map_err(|e| tracing::warn!("Message système {kind} : {e}"))
    .ok()?;
    let id: Uuid = row.get("id");
    let _ = sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
        .bind(id).bind(channel_id).execute(&state.db).await;
    let user = sqlx::query(
        "SELECT u.username, u.discriminator, COALESCE(sm.server_avatar, u.avatar) AS avatar
         FROM users u LEFT JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $2 WHERE u.id = $1"
    ).bind(author).bind(server_id).fetch_optional(&state.db).await.ok().flatten();
    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "server_id": server_id,
        "message": {
            "id": id, "channel_id": channel_id, "content": content, "type": kind,
            "reply_to": null, "pinned": false, "edited_at": null,
            "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            "author_id": author,
            "author_username": user.as_ref().map(|u| u.get::<String, _>("username")),
            "author_discriminator": user.as_ref().map(|u| u.get::<String, _>("discriminator")),
            "author_avatar": user.as_ref().and_then(|u| u.get::<Option<String>, _>("avatar")),
            "author_is_bot": false, "author_verified": false,
            "attachments": [], "reactions": [],
            "unencrypted": true, "purged": false,
            "system_meta": meta,
        },
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    Some(id)
}

/// Salon d'un serveur, sinon erreur (IDOR).
async fn channel_of(state: &AppState, server_id: Uuid, channel_id: Option<Uuid>) -> Result<()> {
    if let Some(c) = channel_id {
        crate::handlers::servers::require_channel_in_server(state, c, server_id).await?;
    }
    Ok(())
}

// ─── Starboard ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StarboardInput {
    pub enabled: bool,
    pub channel_id: Option<Uuid>,
    pub emoji: String,
    pub threshold: i32,
}

/// GET /servers/:id/starboard
pub async fn get_starboard(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_member(&state, claims.sub, server_id).await?;
    let r = sqlx::query("SELECT enabled, channel_id, emoji, threshold FROM starboard_settings WHERE server_id=$1")
        .bind(server_id).fetch_optional(&state.db).await?;
    Ok(Json(serde_json::json!({
        "enabled": r.as_ref().is_some_and(|r| r.get::<bool, _>("enabled")),
        "channel_id": r.as_ref().and_then(|r| r.get::<Option<Uuid>, _>("channel_id")),
        "emoji": r.as_ref().map_or("⭐".to_string(), |r| r.get("emoji")),
        "threshold": r.as_ref().map_or(3, |r| r.get::<i32, _>("threshold")),
    })))
}

/// PUT /servers/:id/starboard — MANAGE_SERVER.
pub async fn put_starboard(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(b): Json<StarboardInput>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let emoji = b.emoji.trim();
    if emoji.is_empty() || emoji.chars().count() > 64 || !(1..=100).contains(&b.threshold) {
        return Err(AppError::BadRequest("Emoji (1-64) ou seuil (1-100) invalide".into()));
    }
    if b.enabled && b.channel_id.is_none() {
        return Err(AppError::BadRequest("Choisis le salon du starboard".into()));
    }
    channel_of(&state, server_id, b.channel_id).await?;
    sqlx::query(
        "INSERT INTO starboard_settings (server_id, enabled, channel_id, emoji, threshold) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (server_id) DO UPDATE SET enabled=$2, channel_id=$3, emoji=$4, threshold=$5"
    ).bind(server_id).bind(b.enabled).bind(b.channel_id).bind(emoji).bind(b.threshold).execute(&state.db).await?;
    crate::handlers::audit::log_event(&state, server_id, "STARBOARD_UPDATE", Some(claims.sub), None, None, None).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Un membre SANS rôle lit-il ce salon ? Même calcul que les droits effectifs (base de @everyone puis
/// surcharges du salon). Avant : seul un refus direct de VIEW_CHANNEL à @everyone rendait le salon
/// privé ; un salon réservé par la seule absence du droit de base, ou sans READ_HISTORY, fuitait.
/// Erreur de lecture : traité comme privé (jamais de publication dans le doute).
async fn open_to_everyone(state: &AppState, server_id: Uuid, channel_id: Uuid) -> bool {
    let Ok(Some((everyone, base))) = sqlx::query_as::<_, (Uuid, i64)>(
        "SELECT id, permissions FROM roles WHERE server_id=$1 AND is_everyone LIMIT 1"
    ).bind(server_id).fetch_optional(&state.db).await else { return false };
    let Ok(overrides) = sqlx::query_as::<_, (Uuid, String, i64, i64)>(
        "SELECT target_id, target_type, allow, deny FROM channel_permissions WHERE channel_id=$1"
    ).bind(channel_id).fetch_all(&state.db).await else { return false };
    plain_member_can_read(base, everyone, &overrides)
}

fn plain_member_can_read(base: i64, everyone: Uuid, overrides: &[(Uuid, String, i64, i64)]) -> bool {
    let perms = crate::state::apply_channel_overrides(base, false, Uuid::nil(), None, Some(everyone), overrides);
    let need = Permissions::VIEW_CHANNEL | Permissions::READ_HISTORY;
    perms & need == need
}

/// Après une réaction : au seuil atteint, publie une seule fois la référence.
/// Un salon privé (VIEW_CHANNEL refusé à @everyone) n'est jamais mis en avant :
/// son auteur et son nom fuiteraient vers le salon du starboard.
pub fn on_reaction(state: &AppState, server_id: Uuid, channel_id: Uuid, message_id: Uuid, emoji: &str) {
    let (state, emoji) = (state.clone(), emoji.to_string());
    tokio::spawn(async move {
        let Ok(Some(cfg)) = sqlx::query(
            "SELECT channel_id, threshold FROM starboard_settings
             WHERE server_id=$1 AND enabled AND emoji=$2 AND channel_id IS NOT NULL AND channel_id <> $3"
        ).bind(server_id).bind(&emoji).bind(channel_id).fetch_optional(&state.db).await else { return };
        let (target, threshold): (Uuid, i32) = (cfg.get("channel_id"), cfg.get("threshold"));
        let Ok(Some(src)) = sqlx::query(
            "SELECT m.user_id, m.type, u.username, c.name AS channel_name,
                    (SELECT COUNT(DISTINCT r.user_id) FROM reactions r WHERE r.message_id = m.id AND r.emoji = $3) AS stars
             FROM messages m JOIN users u ON u.id = m.user_id JOIN channels c ON c.id = m.channel_id
             WHERE m.id = $1 AND m.channel_id = $2"
        ).bind(message_id).bind(channel_id).bind(&emoji)
        .fetch_optional(&state.db).await else { return };
        if src.get::<i64, _>("stars") < threshold as i64 || !open_to_everyone(&state, server_id, channel_id).await
            || !matches!(src.get::<String, _>("type").as_str(), "default" | "reply") {
            return;
        }
        let claimed = sqlx::query("INSERT INTO starboard_entries (message_id, server_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(message_id).bind(server_id).execute(&state.db).await;
        if !claimed.is_ok_and(|r| r.rows_affected() == 1) {
            return;
        }
        let content = format!("{emoji} Message de {} dans #{}", src.get::<String, _>("username"), src.get::<String, _>("channel_name"));
        let meta = serde_json::json!({ "source_message_id": message_id, "source_channel_id": channel_id, "emoji": emoji });
        if let Some(id) = post_system_message(&state, server_id, target, src.get("user_id"), "starboard", &content, meta).await {
            let _ = sqlx::query("UPDATE starboard_entries SET starboard_message_id=$2 WHERE message_id=$1")
                .bind(message_id).bind(id).execute(&state.db).await;
        }
    });
}

// ─── Bienvenue ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct WelcomeInput {
    pub enabled: bool,
    pub channel_id: Option<Uuid>,
    pub text: String,
}

/// Variables : {user}, {server}, {count}.
pub fn render_welcome(text: &str, user: &str, server: &str, count: i64) -> String {
    text.replace("{user}", user).replace("{server}", server).replace("{count}", &count.to_string())
}

/// GET /servers/:id/welcome — MANAGE_SERVER.
pub async fn get_welcome(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let r = sqlx::query("SELECT enabled, channel_id, text FROM welcome_settings WHERE server_id=$1")
        .bind(server_id).fetch_optional(&state.db).await?;
    Ok(Json(serde_json::json!({
        "enabled": r.as_ref().is_some_and(|r| r.get::<bool, _>("enabled")),
        "channel_id": r.as_ref().and_then(|r| r.get::<Option<Uuid>, _>("channel_id")),
        "text": r.as_ref().map_or("Bienvenue {user} sur {server} ! Tu es le membre n°{count}.".to_string(), |r| r.get("text")),
    })))
}

/// PUT /servers/:id/welcome — MANAGE_SERVER.
pub async fn put_welcome(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(b): Json<WelcomeInput>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let text = b.text.trim();
    if text.is_empty() || text.chars().count() > 500 {
        return Err(AppError::BadRequest("Texte de bienvenue : 1 à 500 caractères".into()));
    }
    if b.enabled && b.channel_id.is_none() {
        return Err(AppError::BadRequest("Choisis le salon de bienvenue".into()));
    }
    channel_of(&state, server_id, b.channel_id).await?;
    sqlx::query(
        "INSERT INTO welcome_settings (server_id, enabled, channel_id, text) VALUES ($1, $2, $3, $4)
         ON CONFLICT (server_id) DO UPDATE SET enabled=$2, channel_id=$3, text=$4"
    ).bind(server_id).bind(b.enabled).bind(b.channel_id).bind(text).execute(&state.db).await?;
    crate::handlers::audit::log_event(&state, server_id, "WELCOME_UPDATE", Some(claims.sub), None, None, None).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// À l'arrivée d'un membre : message de bienvenue (carte dessinée par les applis
/// d'après l'auteur = le nouveau membre et `system_meta.member_number`).
pub async fn on_join(state: &AppState, server_id: Uuid, user_id: Uuid, username: &str) {
    let Ok(Some(r)) = sqlx::query(
        "SELECT w.channel_id, w.text, s.name, s.member_count FROM welcome_settings w JOIN servers s ON s.id = w.server_id
         WHERE w.server_id=$1 AND w.enabled AND w.channel_id IS NOT NULL"
    ).bind(server_id).fetch_optional(&state.db).await else { return };
    let count = r.get::<i32, _>("member_count") as i64;
    let content = render_welcome(&r.get::<String, _>("text"), username, &r.get::<String, _>("name"), count);
    let meta = serde_json::json!({ "member_number": count });
    post_system_message(state, server_id, r.get("channel_id"), user_id, "welcome", &content, meta).await;
}

#[cfg(test)]
mod tests {
    use crate::models::role::Permissions;
    use uuid::Uuid;

    #[test]
    fn starboard_privacy_follows_effective_permissions() {
        let (ev, vc, rh) = (Uuid::new_v4(), Permissions::VIEW_CHANNEL, Permissions::READ_HISTORY);
        let ov = |allow, deny| vec![(ev, "role".to_string(), allow, deny)];
        // Ouvert : droits de base, aucune surcharge.
        assert!(super::plain_member_can_read(vc | rh, ev, &[]));
        // Privé : refus direct, mais aussi droit de base absent ou READ_HISTORY retiré.
        assert!(!super::plain_member_can_read(vc | rh, ev, &ov(0, vc)));
        assert!(!super::plain_member_can_read(rh, ev, &[]));
        assert!(!super::plain_member_can_read(vc | rh, ev, &ov(0, rh)));
        // Rôle seul qui voit le salon : @everyone reste exclu.
        assert!(!super::plain_member_can_read(0, ev, &[(Uuid::new_v4(), "role".into(), vc | rh, 0)]));
        // Surcharge qui OUVRE le salon à @everyone.
        assert!(super::plain_member_can_read(0, ev, &ov(vc | rh, 0)));
    }

    #[test]
    fn welcome_variables() {
        assert_eq!(
            super::render_welcome("Salut {user} ! {server} compte {count} membres, {user}.", "Momo", "Jötunheim", 42),
            "Salut Momo ! Jötunheim compte 42 membres, Momo."
        );
        assert_eq!(super::render_welcome("{inconnu}", "a", "b", 1), "{inconnu}");
    }
}
