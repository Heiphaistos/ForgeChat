use axum::{
    extract::State,
    Extension,
    http::header,
    response::IntoResponse,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub async fn export_user_data(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<impl IntoResponse> {
    use sqlx::Row;

    let uid: Uuid = claims.sub;

    // Toutes les données utilisateur en parallèle. L'export était présenté comme
    // couvrant "vos messages" (conformité RGPD, droit à la portabilité) mais ne
    // lisait QUE la table `messages` (serveur) -- les DM 1-à-1 et les messages de
    // groupe DM, souvent le contenu le plus personnel, n'étaient jamais inclus.
    let (user_res, messages, dm_messages, group_dm_messages, servers, friends) = tokio::join!(
        sqlx::query(
            "SELECT username, email, bio, pronouns, created_at FROM users WHERE id=$1"
        ).bind(uid).fetch_one(&state.db),
        // Pas de LIMIT -- un export RGPD (droit à la portabilité) doit couvrir la
        // TOTALITÉ des messages, pas un échantillon. `LIMIT 100` tronquait
        // silencieusement l'export dès qu'un utilisateur avait posté plus de 100
        // messages au total (n'importe quel utilisateur actif sur plusieurs
        // semaines), sans jamais l'indiquer -- l'utilisateur recevait un fichier
        // qui se présentait comme complet mais ne l'était pas.
        sqlx::query(
            "SELECT m.content, m.created_at, c.name as channel_name
             FROM messages m
             JOIN channels c ON c.id = m.channel_id
             WHERE m.user_id = $1
             ORDER BY m.created_at DESC"
        ).bind(uid).fetch_all(&state.db),
        sqlx::query(
            "SELECT dm.content, dm.created_at,
                    u.username as other_username
             FROM dm_messages dm
             JOIN dm_channels dc ON dc.id = dm.dm_channel_id
             JOIN users u ON u.id = (CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END)
             WHERE dm.sender_id = $1
             ORDER BY dm.created_at DESC"
        ).bind(uid).fetch_all(&state.db),
        sqlx::query(
            "SELECT gm.content, gm.created_at, gc.name as group_name
             FROM group_dm_messages gm
             JOIN group_dm_channels gc ON gc.id = gm.dm_id
             WHERE gm.sender_id = $1
             ORDER BY gm.created_at DESC"
        ).bind(uid).fetch_all(&state.db),
        sqlx::query(
            "SELECT s.name FROM servers s
             JOIN server_members sm ON sm.server_id = s.id
             WHERE sm.user_id = $1 ORDER BY s.name"
        ).bind(uid).fetch_all(&state.db),
        sqlx::query(
            "SELECT u.username FROM users u
             JOIN friendships f ON (f.user_id = u.id AND f.friend_id = $1) OR (f.friend_id = u.id AND f.user_id = $1)
             WHERE f.status = 'accepted'
             ORDER BY u.username"
        ).bind(uid).fetch_all(&state.db),
    );
    let user = user_res.map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;
    // `.unwrap_or_default()` sur une vraie erreur DB (pas juste "aucune ligne", fetch_all
    // renvoie déjà Ok(vec![]) dans ce cas) produisait silencieusement un export RGPD
    // amputé d'une section entière -- même défaut que les deux bugs déjà corrigés dans
    // cette fonction (LIMIT tronquant, DM absents) : présenté comme complet, ne l'était
    // pas. Propager l'erreur : mieux vaut un export qui échoue franchement qu'un export
    // qui ment sur son contenu.
    let messages = messages?;
    let dm_messages = dm_messages?;
    let group_dm_messages = group_dm_messages?;
    let servers = servers?;
    let friends = friends?;

    let export = serde_json::json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "profile": {
            "username": user.get::<String, _>("username"),
            "email": user.get::<String, _>("email"),
            "bio": user.get::<Option<String>, _>("bio"),
            "pronouns": user.get::<Option<String>, _>("pronouns"),
            "created_at": user.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        },
        "messages": messages.iter().map(|m| serde_json::json!({
            "content": m.get::<Option<String>, _>("content"),
            "channel": m.get::<String, _>("channel_name"),
            "date": m.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })).collect::<Vec<_>>(),
        "dm_messages": dm_messages.iter().map(|m| serde_json::json!({
            "content": m.get::<Option<String>, _>("content"),
            "with": m.get::<String, _>("other_username"),
            "date": m.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })).collect::<Vec<_>>(),
        "group_dm_messages": group_dm_messages.iter().map(|m| serde_json::json!({
            "content": m.get::<Option<String>, _>("content"),
            "group": m.get::<String, _>("group_name"),
            "date": m.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })).collect::<Vec<_>>(),
        "servers": servers.iter().map(|s| s.get::<String, _>("name")).collect::<Vec<String>>(),
        "friends": friends.iter().map(|f| f.get::<String, _>("username")).collect::<Vec<String>>(),
    });

    let json_str = serde_json::to_string_pretty(&export)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Sérialisation: {}", e)))?;

    Ok((
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"forgechat-mes-donnees.json\""),
        ],
        json_str,
    ))
}
