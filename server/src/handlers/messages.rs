use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use uuid::Uuid;
use chrono::Utc;

use crate::{
    error::{AppError, Result},
    handlers::audit::log_event,
    handlers::e2e_channel,
    handlers::servers::{require_member_and_channel, require_permission, require_permission_and_channel},
    models::role::Permissions,
    middleware::auth::Claims,
    models::message::{EditMessageRequest, ForwardMessageRequest, GetMessagesQuery, MessageWithAuthor, MsgE2e, SendMessageRequest},
    state::AppState,
};

pub async fn get_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Query(params): Query<GetMessagesQuery>,
) -> Result<Json<Vec<MessageWithAuthor>>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    // Sans « Lire l'historique » : aucun message passé, seulement le direct (comme Discord).
    if !crate::handlers::servers::can_read_history(&state, claims.sub, channel_id).await {
        return Ok(Json(vec![]));
    }

    // Borné des deux côtés : une limite négative donnait « LIMIT -1 » et une erreur 500.
    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    // La branche `around` construit déjà son résultat en ordre chronologique
    // croissant (before_rows inversé + after_rows) -- le `.reverse()` final plus
    // bas ne doit s'appliquer qu'aux branches `before`/défaut (qui sortent de la
    // requête SQL en DESC). Appliqué inconditionnellement avant ce fix, il
    // remettait la vue "aller au message" (around) à l'envers (récent en haut).
    let is_around = params.around.is_some();

    let messages = if let Some(around_id) = params.around {
        // Fetch up to 25 messages before the target + target + up to 24 after
        let ts: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT created_at FROM messages WHERE id=$1 AND channel_id=$2"
        )
        .bind(around_id).bind(channel_id)
        .fetch_optional(&state.db).await?;

        let ts = ts.ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

        let half = limit / 2;
        let before_rows = sqlx::query(
            "SELECT m.*, u.username, u.discriminator, NULLIF(COALESCE(m.webhook_avatar_url, (SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id WHERE c.id = m.channel_id AND sm.user_id = m.user_id), u.avatar), '') AS avatar, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration END AS avatar_decoration, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration_opts END AS avatar_decoration_opts, u.is_bot, u.is_verified,
                    rm.content as reply_to_content, COALESCE(rm.webhook_display_name, ru.username) as reply_to_username,
                    rm.enc as reply_to_enc, rm.client_msg_id as reply_to_client_msg_id, rm.user_id as reply_to_author_id
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN messages rm ON rm.id = m.reply_to AND rm.channel_id = m.channel_id
             LEFT JOIN users ru ON ru.id = rm.user_id
             WHERE m.channel_id=$1 AND (m.created_at, m.id) < ($2, $4)
             AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC, m.id DESC LIMIT $3"
        )
        .bind(channel_id).bind(ts).bind(half).bind(around_id)
        .fetch_all(&state.db).await?;

        let after_rows = sqlx::query(
            "SELECT m.*, u.username, u.discriminator, NULLIF(COALESCE(m.webhook_avatar_url, (SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id WHERE c.id = m.channel_id AND sm.user_id = m.user_id), u.avatar), '') AS avatar, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration END AS avatar_decoration, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration_opts END AS avatar_decoration_opts, u.is_bot, u.is_verified,
                    rm.content as reply_to_content, COALESCE(rm.webhook_display_name, ru.username) as reply_to_username,
                    rm.enc as reply_to_enc, rm.client_msg_id as reply_to_client_msg_id, rm.user_id as reply_to_author_id
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN messages rm ON rm.id = m.reply_to AND rm.channel_id = m.channel_id
             LEFT JOIN users ru ON ru.id = rm.user_id
             WHERE m.channel_id=$1 AND (m.created_at, m.id) >= ($2, $4)
             AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at ASC, m.id ASC LIMIT $3"
        )
        .bind(channel_id).bind(ts).bind(limit - half + 1).bind(around_id)
        .fetch_all(&state.db).await?;

        // Combine: before (reversed to ASC) + after (target first)
        let mut combined: Vec<_> = before_rows.into_iter().rev().collect();
        combined.extend(after_rows);
        combined
    } else if let Some(before) = params.before {
        // Vérifier que le curseur existe avant d'utiliser la subquery (évite le retour silencieux vide si UUID invalide)
        let cursor_ts: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
            "SELECT created_at FROM messages WHERE id=$1 AND channel_id=$2"
        )
        .bind(before).bind(channel_id)
        .fetch_optional(&state.db).await?;

        let ts = cursor_ts.ok_or_else(|| AppError::NotFound("Curseur invalide".into()))?;

        sqlx::query(
            "SELECT m.*, u.username, u.discriminator, NULLIF(COALESCE(m.webhook_avatar_url, (SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id WHERE c.id = m.channel_id AND sm.user_id = m.user_id), u.avatar), '') AS avatar, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration END AS avatar_decoration, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration_opts END AS avatar_decoration_opts, u.is_bot, u.is_verified,
                    rm.content as reply_to_content, COALESCE(rm.webhook_display_name, ru.username) as reply_to_username,
                    rm.enc as reply_to_enc, rm.client_msg_id as reply_to_client_msg_id, rm.user_id as reply_to_author_id
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN messages rm ON rm.id = m.reply_to AND rm.channel_id = m.channel_id
             LEFT JOIN users ru ON ru.id = rm.user_id
             WHERE m.channel_id=$1 AND (m.created_at, m.id) < ($2, $4)
             AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC, m.id DESC LIMIT $3"
        )
        .bind(channel_id).bind(ts).bind(limit).bind(before)
        .fetch_all(&state.db).await?
    } else {
        sqlx::query(
            "SELECT m.*, u.username, u.discriminator, NULLIF(COALESCE(m.webhook_avatar_url, (SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id WHERE c.id = m.channel_id AND sm.user_id = m.user_id), u.avatar), '') AS avatar, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration END AS avatar_decoration, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration_opts END AS avatar_decoration_opts, u.is_bot, u.is_verified,
                    rm.content as reply_to_content, COALESCE(rm.webhook_display_name, ru.username) as reply_to_username,
                    rm.enc as reply_to_enc, rm.client_msg_id as reply_to_client_msg_id, rm.user_id as reply_to_author_id
             FROM messages m
             JOIN users u ON u.id = m.user_id
             LEFT JOIN messages rm ON rm.id = m.reply_to AND rm.channel_id = m.channel_id
             LEFT JOIN users ru ON ru.id = rm.user_id
             WHERE m.channel_id=$1 AND (m.expires_at IS NULL OR m.expires_at > NOW())
             ORDER BY m.created_at DESC, m.id DESC LIMIT $2"
        )
        .bind(channel_id).bind(limit)
        .fetch_all(&state.db).await?
    };

    use sqlx::Row;
    use std::collections::HashMap;
    let msg_ids: Vec<Uuid> = messages.iter().map(|r| r.get("id")).collect();

    // Paralléliser attachments + reactions (queries indépendantes)
    let (all_attachments, all_reactions) = tokio::join!(
        sqlx::query_as::<_, crate::models::message::Attachment>(
            "SELECT * FROM attachments WHERE message_id = ANY($1) AND (expires_at IS NULL OR expires_at > NOW())"
        )
        .bind(&msg_ids)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT r.message_id, r.emoji, r.is_super, COUNT(*) as count,
             bool_or(r.user_id = $2) as me
             FROM reactions r WHERE r.message_id = ANY($1) GROUP BY r.message_id, r.emoji, r.is_super"
        )
        .bind(&msg_ids)
        .bind(claims.sub)
        .fetch_all(&state.db),
    );
    let all_attachments = all_attachments.unwrap_or_default();
    let all_reactions = all_reactions.unwrap_or_default();

    // Grouper par message_id pour accès O(1) plutôt qu'O(n²) avec filter
    let mut attachments_map: HashMap<Uuid, Vec<crate::models::message::Attachment>> = HashMap::new();
    for a in all_attachments {
        attachments_map.entry(a.message_id).or_default().push(a);
    }
    let mut reactions_map: HashMap<Uuid, Vec<crate::models::message::ReactionCount>> = HashMap::new();
    for r in &all_reactions {
        let mid: Uuid = r.get("message_id");
        reactions_map.entry(mid).or_default().push(crate::models::message::ReactionCount {
            emoji: r.get("emoji"),
            count: r.get("count"),
            me: r.get("me"),
            is_super: r.get("is_super"),
        });
    }

    let mut result = Vec::new();
    for row in &messages {
        let msg_id: Uuid = row.get("id");
        let attachments = attachments_map.remove(&msg_id).unwrap_or_default();
        let reactions = reactions_map.remove(&msg_id).unwrap_or_default();

        result.push(MessageWithAuthor {
            id: msg_id,
            channel_id,
            content: row.get("content"),
            r#type: row.get("type"),
            reply_to: row.get("reply_to"),
            reply_to_content: row.try_get("reply_to_content").ok().flatten(),
            reply_to_username: row.try_get("reply_to_username").ok().flatten(),
            forward_from_id: row.try_get("forward_from_id").ok().flatten(),
            forward_from_username: row.try_get("forward_from_username").ok().flatten(),
            pinned: row.get("pinned"),
            edited_at: row.get("edited_at"),
            created_at: row.get("created_at"),
            author_id: row.get("user_id"),
            author_username: row.try_get("webhook_display_name").ok().flatten().unwrap_or_else(|| row.get("username")),
            author_discriminator: row.get("discriminator"),
            author_avatar: row.get("avatar"),
            author_avatar_decoration: row.try_get("avatar_decoration").ok().flatten(),
            author_avatar_decoration_opts: row.try_get("avatar_decoration_opts").ok().flatten(),
            author_is_bot: row.get("is_bot"),
            author_verified: row.try_get("is_verified").unwrap_or(false),
            attachments,
            reactions,
            expires_at: row.try_get("expires_at").ok().flatten(),
            poll_id: row.try_get("poll_id").ok().flatten(),
            e2e: MsgE2e::from_row(row),
        });
    }

    if !is_around {
        result.reverse();
    }
    Ok(Json(result))
}

pub async fn send_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<MessageWithAuthor>> {
    // Visibilité, SEND_MESSAGES (overrides compris), ATTACH_FILES, annonces, timeout.
    crate::handlers::servers::require_can_post(
        &state, claims.sub, server_id, channel_id, body.has_attachments.unwrap_or(false),
    ).await?;
    crate::handlers::automod::check_rate(&state, server_id, claims.sub).await?;

    // Une réponse ne peut citer qu'un message du MÊME salon : sinon l'aperçu de
    // réponse renvoyait le contenu de n'importe quel message dont on connaît l'id.
    if let Some(reply_id) = body.reply_to {
        let same_channel: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
        )
        .bind(reply_id)
        .bind(channel_id)
        .fetch_one(&state.db)
        .await?;
        if !same_channel {
            return Err(AppError::BadRequest("Le message cité n'appartient pas à ce salon".into()));
        }
    }

    // Refuser si content vide ET pas de pièces jointes annoncées
    let content_empty = body.content.as_deref().map(|c| c.trim().is_empty()).unwrap_or(true);
    let has_enc = body.enc.as_ref().is_some_and(|v| !v.is_null());
    if content_empty && !body.has_attachments.unwrap_or(false) && !has_enc {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }

    // Valider la longueur avant les vérifications coûteuses (spam/slowmode)
    if let Some(c) = &body.content {
        if c.chars().count() > 4000 {
            return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
        }
    }

    // Chiffrement de bout en bout obligatoire : clair toujours refusé (sauf commande
    // de bot), époque courante exigée. Avant le slowmode : la nouvelle tentative
    // après EPOCH_STALE ne doit pas être bloquée par lui.
    let exempt = match body.content.as_deref() {
        Some(c) if !content_empty => e2e_channel::is_bot_command(&state.db, server_id, c.trim()).await,
        _ => false,
    };
    let enc = e2e_channel::check_content(
        &state.db, channel_id, !content_empty, body.enc.as_ref(), body.client_msg_id, exempt,
    ).await?;

    let content_str: Option<String> = if enc.is_some() { None } else { body.content.clone() };

    // Mentions : lues dans le texte en clair, ou déclarées en métadonnées par
    // l'appli pour un message chiffré (le serveur ne lit jamais ce texte).
    let mentions = match content_str.as_deref() {
        Some(c) => crate::notify::parse_mentions(c),
        None => crate::notify::ParsedMentions::from_meta(&body.mentions),
    };

    // Enforcement AutoMod (message chiffré : appliqué par l'appli, mentions ici)
    if let Some(content) = content_str.as_deref() {
        if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, content).await {
            return Err(err);
        }
    } else if let Some(err) = crate::handlers::audit::check_automod_mentions(&state, server_id, mentions.count()).await {
        return Err(err);
    }
    // Mode lent (staff exempté) + anti-spam, APRÈS l'AutoMod : un message refusé
    // par le filtre ne consomme plus le créneau du mode lent.
    crate::handlers::post_guard::throttle(&state, claims.sub, channel_id).await?;

    // @everyone / @here sans MENTION_EVERYONE : le message part quand même mais
    // ne notifie personne (comportement Discord ; voir `notify::dispatch_channel_mentions`).
    let mention_everyone = (mentions.everyone || mentions.here)
        && require_permission(&state, claims.sub, server_id, Permissions::MENTION_EVERYONE).await.is_ok();

    // Messages éphémères : 10 s à 7 jours. Une valeur énorme faisait paniquer le
    // calcul de date, une valeur négative supprimait le message à l'envoi.
    // Le réglage du salon (messages éphémères) l'emporte sur la durée choisie à l'envoi.
    let channel_ttl = crate::handlers::disappearing::setting(&state.db, crate::handlers::e2e_conv::Conv::Channel(channel_id)).await?;
    let expires_at = crate::handlers::disappearing::expiry(channel_ttl, Utc::now()).0
        .or_else(|| body.expires_at_seconds.map(|s| Utc::now() + chrono::Duration::seconds(s.clamp(10, 7 * 86_400))));

    let msg = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content, reply_to, mention_everyone, expires_at, enc, client_msg_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *"
    )
    .bind(channel_id)
    .bind(claims.sub)
    .bind(content_str)
    .bind(body.reply_to)
    .bind(mention_everyone)
    .bind(expires_at)
    .bind(&enc)
    .bind(enc.as_ref().and(body.client_msg_id))
    .fetch_one(&state.db)
    .await?;
    crate::handlers::badges::count_message(&state, claims.sub);

    sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
        .bind(msg.get::<Uuid, _>("id"))
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    let user = sqlx::query(
        // Avatar du profil de ce serveur s'il y en a un (075), sinon celui du compte.
        "SELECT u.username, u.discriminator, u.is_bot, u.is_verified, u.avatar_decoration, u.avatar_decoration_opts,
                COALESCE((SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id
                          WHERE c.id = $2 AND sm.user_id = u.id), u.avatar) AS avatar
         FROM users u WHERE u.id=$1"
    )
    .bind(claims.sub)
    .bind(channel_id)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let reply_to_id: Option<Uuid> = msg.get("reply_to");
    let reply_row = match reply_to_id {
        Some(rid) => sqlx::query(
            "SELECT m.content, m.user_id, u.username, m.enc, m.client_msg_id FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id=$1"
        )
        .bind(rid)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None),
        None => None,
    };
    let (reply_to_content, reply_to_username, reply_author) = match &reply_row {
        Some(r) => (r.get::<Option<String>, _>("content"), Some(r.get::<String, _>("username")), Some(r.get::<Uuid, _>("user_id"))),
        None => (None, None, None),
    };
    let mut e2e = MsgE2e::from_row(&msg);
    if let Some(r) = &reply_row {
        e2e.reply_to_enc = r.get("enc");
        e2e.reply_to_client_msg_id = r.get("client_msg_id");
        e2e.reply_to_author_id = reply_author;
    }

    let full_msg = MessageWithAuthor {
        id: msg.get("id"),
        channel_id,
        content: msg.get("content"),
        r#type: msg.get("type"),
        reply_to: reply_to_id,
        reply_to_content,
        reply_to_username,
        forward_from_id: None,
        forward_from_username: None,
        pinned: msg.get("pinned"),
        edited_at: msg.get("edited_at"),
        created_at: msg.get("created_at"),
        author_id: claims.sub,
        author_username: user.get("username"),
        author_discriminator: user.get("discriminator"),
        author_avatar: user.get("avatar"),
        author_avatar_decoration: user.try_get("avatar_decoration").ok().flatten(),
        author_avatar_decoration_opts: user.try_get("avatar_decoration_opts").ok().flatten(),
        author_is_bot: user.try_get("is_bot").unwrap_or(false),
        author_verified: user.try_get("is_verified").unwrap_or(false),
        attachments: vec![],
        reactions: vec![],
        expires_at: msg.try_get("expires_at").ok().flatten(),
        poll_id: None,
        e2e,
    };

    // Mentions : enregistrées et notifiées AVANT MESSAGE_CREATE, pour que le
    // client sache déjà que ce message le mentionne quand il le reçoit.
    if let Err(e) = crate::notify::dispatch_channel_mentions(&state, crate::notify::ChannelMessage {
        server_id,
        channel_id,
        message_id: full_msg.id,
        author_id: claims.sub,
        author_username: &full_msg.author_username,
        author_avatar: full_msg.author_avatar.as_deref(),
        content: full_msg.content.as_deref(),
        mentions,
        enc: full_msg.e2e.enc.as_ref(),
        client_msg_id: full_msg.e2e.client_msg_id,
        // Réponse « sans mention » : l'auteur cité n'est pas notifié (il le reste s'il est mentionné).
        reply_author: reply_author.filter(|_| body.reply_ping != Some(false)),
        created_at: full_msg.created_at,
    }).await {
        tracing::warn!("Mentions non traitées pour le message {} : {e}", full_msg.id);
    }

    let pending_attachments = body.has_attachments.unwrap_or(false) && full_msg.content.is_none() && full_msg.e2e.enc.is_none();
    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "server_id": server_id,
        "message": full_msg,
        "pending_attachments": pending_attachments,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    crate::handlers::levels::on_message(&state, server_id, claims.sub);

    // Commandes slash ("/cmd args", en clair) : natives ou de bot, droits revérifiés ici
    // (voir handlers/commands). Un message de commande reconnue est retiré du salon.
    if let Some(content) = full_msg.content.as_deref().filter(|c| c.starts_with('/')) {
        crate::handlers::commands::handle_message(&state, &claims, server_id, channel_id, full_msg.id, content).await;
    }

    Ok(Json(full_msg))
}

pub async fn edit_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    crate::handlers::servers::require_not_timed_out(&state, claims.sub, server_id).await?;

    let (owner, existing_cmid) = sqlx::query_as::<_, (bool, Option<Uuid>)>(
        "SELECT user_id=$2, client_msg_id FROM messages WHERE id=$1 AND channel_id=$3"
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if !owner {
        return Err(AppError::Forbidden);
    }

    let has_text = !body.content.trim().is_empty();
    if body.content.chars().count() > 4000 {
        return Err(AppError::BadRequest("Message trop long (max 4000 caractères)".into()));
    }
    // Édition chiffrée : même `client_msg_id` que le message (lié à l'AAD).
    let cmid = existing_cmid.or(body.client_msg_id);
    let enc = e2e_channel::check_content(&state.db, channel_id, has_text, body.enc.as_ref(), cmid, false).await?;
    if !has_text && enc.is_none() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }

    if let Some(enc) = &enc {
        // Aucun texte en clair gardé : ni l'ancienne version, ni l'historique.
        sqlx::query("DELETE FROM message_edits WHERE message_id=$1").bind(message_id).execute(&state.db).await?;
        sqlx::query("UPDATE saved_messages SET content=NULL WHERE message_id=$1").bind(message_id).execute(&state.db).await?;
        sqlx::query("UPDATE messages SET enc=$2, content=NULL, client_msg_id=$3, edited_at=NOW() WHERE id=$1")
            .bind(message_id)
            .bind(enc)
            .bind(cmid)
            .execute(&state.db)
            .await?;
    } else {
        // AutoMod : appliqué à la création (send_message) mais oublié à l'édition --
        // un message anodin pouvait être édité vers un contenu que l'AutoMod aurait
        // bloqué à la création (contournement du filtre de mots/mentions/liens).
        if let Some(err) = crate::handlers::audit::check_automod(&state, server_id, claims.sub, &body.content).await {
            return Err(err);
        }

        // Sauvegarder l'ancienne version dans l'historique
        sqlx::query(
            "INSERT INTO message_edits (message_id, content)
             SELECT $1, content FROM messages WHERE id=$1 AND content IS NOT NULL"
        )
        .bind(message_id)
        .execute(&state.db)
        .await?;

        // Jamais de texte en clair par-dessus un message chiffré.
        let done = sqlx::query(
            "UPDATE messages SET content=$2, edited_at=NOW() WHERE id=$1 AND enc IS NULL"
        )
        .bind(message_id)
        .bind(&body.content)
        .execute(&state.db)
        .await?;
        if done.rows_affected() == 0 {
            return Err(AppError::BadRequest(crate::handlers::e2e_conv::PLAINTEXT_REFUSED.into()));
        }
    }

    let event = serde_json::json!({
        "type": "MESSAGE_UPDATE",
        "message_id": message_id,
        "channel_id": channel_id,
        "content": if enc.is_some() { serde_json::Value::Null } else { serde_json::Value::String(body.content) },
        "enc": enc,
        "client_msg_id": enc.as_ref().and(cmid),
        "edited_at": chrono::Utc::now(),
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    let msg_user = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM messages WHERE id=$1 AND channel_id=$2"
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Message introuvable".into()))?;

    if msg_user != claims.sub {
        require_permission(&state, claims.sub, server_id, Permissions::MANAGE_MESSAGES).await?;
    }

    // Récupérer les fichiers attachés avant la suppression pour nettoyage disque
    let attachment_urls: Vec<String> = sqlx::query_scalar(
        "SELECT url FROM attachments WHERE message_id=$1"
    )
    .bind(message_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    sqlx::query("DELETE FROM messages WHERE id=$1")
        .bind(message_id)
        .execute(&state.db)
        .await?;

    // Supprimer les fichiers du disque (fail silencieux — DB est la source de vérité)
    // Chemin validé (pas de traversée) par le nettoyeur commun.
    crate::handlers::uploads::remove_upload_files(&state, attachment_urls);

    let event = serde_json::json!({
        "type": "MESSAGE_DELETE",
        "message_id": message_id,
        "channel_id": channel_id,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    if msg_user != claims.sub {
        log_event(
            &state, server_id, "MESSAGE_DELETE",
            Some(claims.sub),
            Some(message_id), None,
            Some(serde_json::json!({ "channel_id": channel_id, "author_id": msg_user })),
        ).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Contrôles communs aux réactions normales et super : emoji borné, salon visible,
/// ADD_REACTIONS après overrides du salon, pas en timeout, message bien dans ce salon.
pub(crate) async fn require_can_react(
    state: &AppState, user_id: Uuid, server_id: Uuid, channel_id: Uuid, message_id: Uuid, emoji: &str,
) -> Result<()> {
    if emoji.is_empty() || emoji.chars().count() > 64 {
        return Err(AppError::BadRequest("Emoji invalide (1-64 chars)".into()));
    }
    require_member_and_channel(state, user_id, server_id, channel_id).await?;
    let (_, perms) = state.effective_channel_permissions(user_id, channel_id).await.ok_or(AppError::Forbidden)?;
    if perms & Permissions::ADD_REACTIONS == 0 {
        return Err(AppError::Forbidden);
    }
    crate::handlers::servers::require_not_timed_out(state, user_id, server_id).await?;

    let msg_in_channel: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
    ).bind(message_id).bind(channel_id).fetch_one(&state.db).await?;
    if !msg_in_channel { return Err(AppError::NotFound("Message introuvable".into())); }
    Ok(())
}

pub async fn add_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_can_react(&state, claims.sub, server_id, channel_id, message_id, &emoji).await?;

    sqlx::query(
        "INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING"
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "REACTION_ADD",
        "message_id": message_id,
        "channel_id": channel_id,
        "user_id": claims.sub,
        "emoji": emoji,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    crate::handlers::community::on_reaction(&state, server_id, channel_id, message_id, &emoji);

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_reaction(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id, emoji)): Path<(Uuid, Uuid, Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    if emoji.is_empty() || emoji.chars().count() > 64 {
        return Err(AppError::BadRequest("Emoji invalide (1-64 chars)".into()));
    }
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;

    // Vérifier que le message appartient bien au canal
    let msg_in_channel: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
    ).bind(message_id).bind(channel_id).fetch_one(&state.db).await?;
    if !msg_in_channel { return Err(AppError::NotFound("Message introuvable".into())); }

    sqlx::query(
        "DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3 AND NOT is_super"
    )
    .bind(message_id)
    .bind(claims.sub)
    .bind(&emoji)
    .execute(&state.db)
    .await?;

    let event = serde_json::json!({
        "type": "REACTION_REMOVE",
        "message_id": message_id,
        "channel_id": channel_id,
        "user_id": claims.sub,
        "emoji": emoji,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Épingles par salon, au plus.
const MAX_PINS: i64 = 50;

pub async fn pin_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission_and_channel(&state, claims.sub, server_id, channel_id, Permissions::MANAGE_MESSAGES).await?;
    // Le message doit appartenir à CE salon : sinon on épinglait le message d'un
    // autre serveur (ou d'un salon privé) dans le sien, puis on le lisait via les épingles.
    let in_channel: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2)"
    ).bind(message_id).bind(channel_id).fetch_one(&state.db).await?;
    if !in_channel {
        return Err(AppError::NotFound("Message introuvable dans ce salon".into()));
    }

    // Plafond de 50 épingles par salon (comme Discord), vérifié dans l'INSERT même.
    let done = sqlx::query(
        "INSERT INTO pinned_messages (channel_id, message_id, pinned_by)
         SELECT $1, $2, $3 WHERE (SELECT COUNT(*) FROM pinned_messages WHERE channel_id=$1) < $4
         ON CONFLICT DO NOTHING"
    )
    .bind(channel_id)
    .bind(message_id)
    .bind(claims.sub)
    .bind(MAX_PINS)
    .execute(&state.db)
    .await?;
    if done.rows_affected() == 0 {
        let already: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM pinned_messages WHERE channel_id=$1 AND message_id=$2)",
        )
        .bind(channel_id)
        .bind(message_id)
        .fetch_one(&state.db)
        .await?;
        if !already {
            return Err(AppError::BadRequest(format!("{MAX_PINS} messages épinglés au plus par salon")));
        }
    }

    sqlx::query("UPDATE messages SET pinned=true WHERE id=$1 AND channel_id=$2")
        .bind(message_id)
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({
        "type": "MESSAGE_PIN_UPDATE",
        "channel_id": channel_id,
        "message_id": message_id,
        "pinned": true,
        "pinned_by": claims.sub,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    log_event(&state, server_id, "MESSAGE_PIN", Some(claims.sub), Some(message_id), None,
        Some(serde_json::json!({ "channel_id": channel_id }))).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn unpin_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id, message_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission_and_channel(&state, claims.sub, server_id, channel_id, Permissions::MANAGE_MESSAGES).await?;

    sqlx::query("DELETE FROM pinned_messages WHERE channel_id=$1 AND message_id=$2")
        .bind(channel_id)
        .bind(message_id)
        .execute(&state.db)
        .await?;

    sqlx::query("UPDATE messages SET pinned=false WHERE id=$1 AND channel_id=$2")
        .bind(message_id)
        .bind(channel_id)
        .execute(&state.db)
        .await?;

    let event = serde_json::json!({
        "type": "MESSAGE_PIN_UPDATE",
        "channel_id": channel_id,
        "message_id": message_id,
        "pinned": false,
    });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    log_event(&state, server_id, "MESSAGE_UNPIN", Some(claims.sub), Some(message_id), None,
        Some(serde_json::json!({ "channel_id": channel_id }))).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn search_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<MessageWithAuthor>>> {
    require_member_and_channel(&state, claims.sub, server_id, channel_id).await?;
    crate::handlers::channel_access::require_read_history(&state, claims.sub, channel_id).await?;

    let q = params.get("q").cloned().unwrap_or_default();
    if q.trim().len() < 2 {
        return Ok(Json(vec![]));
    }

    let q_esc = q.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{}%", q_esc);
    let rows = sqlx::query(
        "SELECT m.*, u.username, u.discriminator, NULLIF(COALESCE(m.webhook_avatar_url, (SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id WHERE c.id = m.channel_id AND sm.user_id = m.user_id), u.avatar), '') AS avatar, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration END AS avatar_decoration, CASE WHEN m.webhook_display_name IS NULL THEN u.avatar_decoration_opts END AS avatar_decoration_opts, u.is_bot, u.is_verified,
                rm.content as reply_to_content, COALESCE(rm.webhook_display_name, ru.username) as reply_to_username,
                    rm.enc as reply_to_enc, rm.client_msg_id as reply_to_client_msg_id, rm.user_id as reply_to_author_id
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN messages rm ON rm.id = m.reply_to AND rm.channel_id = m.channel_id
         LEFT JOIN users ru ON ru.id = rm.user_id
         WHERE m.channel_id=$1 AND m.content ILIKE $2
           AND (m.expires_at IS NULL OR m.expires_at > NOW())
         ORDER BY m.created_at DESC LIMIT 50"
    )
    .bind(channel_id)
    .bind(&pattern)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = rows.iter().map(|r| MessageWithAuthor {
        id: r.get("id"),
        channel_id,
        content: r.get("content"),
        r#type: r.get("type"),
        reply_to: r.get("reply_to"),
        reply_to_content: r.try_get("reply_to_content").ok().flatten(),
        reply_to_username: r.try_get("reply_to_username").ok().flatten(),
        forward_from_id: r.try_get("forward_from_id").ok().flatten(),
        forward_from_username: r.try_get("forward_from_username").ok().flatten(),
        pinned: r.get("pinned"),
        edited_at: r.get("edited_at"),
        created_at: r.get("created_at"),
        author_id: r.get("user_id"),
        author_username: r.try_get("webhook_display_name").ok().flatten().unwrap_or_else(|| r.get("username")),
        author_discriminator: r.get("discriminator"),
        author_avatar: r.get("avatar"),
        author_avatar_decoration: r.try_get("avatar_decoration").ok().flatten(),
        author_avatar_decoration_opts: r.try_get("avatar_decoration_opts").ok().flatten(),
        author_is_bot: r.try_get("is_bot").unwrap_or(false),
        author_verified: r.try_get("is_verified").unwrap_or(false),
        attachments: vec![],
        reactions: vec![],
        expires_at: r.try_get("expires_at").ok().flatten(),
        poll_id: r.try_get("poll_id").ok().flatten(),
        e2e: MsgE2e::from_row(r),
    }).collect();

    Ok(Json(result))
}

/// Message de salon `message_id` : false s'il n'existe pas (l'appelant essaie alors les
/// MP), Err si son salon est masqué pour `user` (VIEW_CHANNEL, surcharges comprises).
/// Avant : seule l'appartenance au serveur était vérifiée, l'historique d'éditions et
/// les rappels d'un message d'un salon privé restaient lisibles avec son identifiant.
pub(crate) async fn channel_message_visible(state: &AppState, user: Uuid, message_id: Uuid) -> Result<bool> {
    let loc: Option<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT c.server_id, m.channel_id FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE m.id = $1 AND c.server_id IS NOT NULL",
    )
    .bind(message_id)
    .fetch_optional(&state.db)
    .await?;
    let Some((server_id, channel_id)) = loc else { return Ok(false) };
    // READ_HISTORY aussi : sans lui, l'historique (éditions, réactions…) reste fermé.
    let readable = require_member_and_channel(state, user, server_id, channel_id).await.is_ok()
        && crate::handlers::servers::can_read_history(state, user, channel_id).await;
    if !readable {
        return Err(AppError::NotFound("Message introuvable".into()));
    }
    Ok(true)
}

pub async fn get_message_edits(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    // EditHistoryModal.tsx est monté depuis MessageRow, réutilisé en canal de
    // serveur ET en DM -- même pattern déjà corrigé sur remind/report/forward.
    // Le message peut donc être dans `messages` (avec appartenance serveur) ou
    // `dm_messages` (avec appartenance DM).
    let in_channel = channel_message_visible(&state, claims.sub, message_id).await?;

    let in_dm: bool = if in_channel {
        false
    } else {
        sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM dm_messages dm
                JOIN dm_channels dc ON dc.id = dm.dm_channel_id
                WHERE dm.id = $1 AND (dc.user1_id = $2 OR dc.user2_id = $2)
             )"
        ).bind(message_id).bind(claims.sub).fetch_one(&state.db).await?
    };

    if !in_channel && !in_dm {
        return Err(AppError::NotFound("Message introuvable".into()));
    }

    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT content, edited_at FROM message_edits WHERE message_id=$1 ORDER BY edited_at DESC"
    )
    .bind(message_id)
    .fetch_all(&state.db)
    .await?;

    let edits: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "content": r.get::<Option<String>, _>("content"),
        "edited_at": r.get::<chrono::DateTime<Utc>, _>("edited_at"),
    })).collect();

    Ok(Json(edits))
}

/// POST /servers/:server_id/channels/:channel_id/messages/:msg_id/forward
/// Transfère un message vers un autre canal.
pub async fn forward_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(message_id): Path<Uuid>,
    Json(body): Json<ForwardMessageRequest>,
) -> Result<Json<MessageWithAuthor>> {
    use sqlx::Row;

    // ForwardModal.tsx est monté aussi bien depuis un canal de serveur que depuis
    // une conversation privée (MessageList/MessageRow partagés, cf. fix reminders/
    // report) -- message_id peut donc être un id de `messages` OU de `dm_messages`.
    // On résout le message source dans les deux tables (avec vérification
    // d'appartenance intégrée) plutôt que d'exiger server_id/channel_id du client,
    // qui n'existent pas en contexte DM.
    let server_src = sqlx::query(
        "SELECT m.content, m.enc IS NOT NULL AS encrypted, COALESCE(m.webhook_display_name, u.username) as author_username,
                m.channel_id, c.server_id
         FROM messages m
         JOIN users u ON u.id = m.user_id
         JOIN channels c ON c.id = m.channel_id
         JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $2
         WHERE m.id = $1"
    )
    .bind(message_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?;

    // Texte déchiffré par l'appli quand la source est chiffrée (le serveur ne peut pas le lire).
    let supplied = || -> Result<Option<String>> {
        let text = body.content.as_deref().map(str::trim).unwrap_or_default();
        if text.is_empty() || text.chars().count() > 4000 {
            return Err(AppError::BadRequest("Contenu du message chiffré requis".into()));
        }
        Ok(Some(text.to_string()))
    };
    let has_enc = body.enc.as_ref().is_some_and(|v| !v.is_null());
    let (src_content, src_author): (Option<String>, String) = if let Some(row) = server_src {
        // Le salon source doit être VISIBLE : transférer un message d'un salon
        // privé en révélait le contenu dans un salon public.
        let (src_channel, src_server): (Uuid, Uuid) = (row.get("channel_id"), row.get("server_id"));
        require_member_and_channel(&state, claims.sub, src_server, src_channel).await?;
        crate::handlers::channel_access::require_read_history(&state, claims.sub, src_channel).await?;
        let content = if has_enc {
            None
        } else if row.get::<bool, _>("encrypted") {
            supplied()?
        } else {
            row.try_get("content").ok().flatten()
        };
        (content, row.get("author_username"))
    } else {
        let dm_row = sqlx::query(
            "SELECT dm.content, dm.enc IS NOT NULL AS encrypted, u.username as author_username
             FROM dm_messages dm
             JOIN dm_channels dc ON dc.id = dm.dm_channel_id
             JOIN users u ON u.id = dm.sender_id
             WHERE dm.id = $1 AND (dc.user1_id = $2 OR dc.user2_id = $2)"
        )
        .bind(message_id)
        .bind(claims.sub)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Message source introuvable".into()))?;
        let content: Option<String> = if has_enc {
            None
        } else if dm_row.get::<bool, _>("encrypted") {
            // Le serveur ne peut pas lire un MP chiffré : l'appli transmet le texte déchiffré.
            supplied()?
        } else {
            dm_row.try_get("content").ok().flatten()
        };
        (content, dm_row.get("author_username"))
    };

    // Vérifier que le canal de destination appartient bien à un serveur dont l'user est membre
    let dest_server_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT server_id FROM channels WHERE id=$1"
    )
    .bind(body.channel_id)
    .fetch_optional(&state.db)
    .await?;

    let dest_server_id = dest_server_id
        .ok_or_else(|| AppError::NotFound("Canal de destination introuvable".into()))?;

    // Mêmes règles qu'un envoi normal : salon masqué, lecture seule, annonces,
    // timeout, AutoMod. Le transfert contournait tout.
    crate::handlers::servers::require_can_post(&state, claims.sub, dest_server_id, body.channel_id, false).await?;
    // Salon cible chiffré : l'appli envoie une copie chiffrée pour lui (clair refusé si j'ai une clé).
    let enc = e2e_channel::check_content(
        &state.db, body.channel_id, src_content.is_some(), body.enc.as_ref(), body.client_msg_id, false,
    ).await?;
    if src_content.is_none() && enc.is_none() {
        return Err(AppError::BadRequest("Message vide".into()));
    }
    if let Some(content) = src_content.as_deref() {
        if let Some(err) = crate::handlers::audit::check_automod(&state, dest_server_id, claims.sub, content).await {
            return Err(err);
        }
    }
    // Mêmes freins qu'un envoi : le transfert contournait débit AutoMod, mode lent et anti-spam.
    crate::handlers::automod::check_rate(&state, dest_server_id, claims.sub).await?;
    crate::handlers::post_guard::throttle(&state, claims.sub, body.channel_id).await?;

    // Insérer le message forwardé dans le canal cible
    let new_msg = sqlx::query(
        "INSERT INTO messages (channel_id, user_id, content, forward_from_id, forward_from_username, enc, client_msg_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *"
    )
    .bind(body.channel_id)
    .bind(claims.sub)
    .bind(&src_content)
    .bind(message_id)
    .bind(&src_author)
    .bind(&enc)
    .bind(enc.as_ref().and(body.client_msg_id))
    .fetch_one(&state.db)
    .await?;

    sqlx::query("UPDATE channels SET last_message_id=$1 WHERE id=$2")
        .bind(new_msg.get::<Uuid, _>("id"))
        .bind(body.channel_id)
        .execute(&state.db)
        .await?;

    let user = sqlx::query(
        // Avatar du profil de ce serveur s'il y en a un (075), sinon celui du compte.
        "SELECT u.username, u.discriminator, u.is_bot, u.is_verified, u.avatar_decoration, u.avatar_decoration_opts,
                COALESCE((SELECT sm.server_avatar FROM server_members sm JOIN channels c ON c.server_id = sm.server_id
                          WHERE c.id = $2 AND sm.user_id = u.id), u.avatar) AS avatar
         FROM users u WHERE u.id=$1"
    )
    .bind(claims.sub)
    .bind(body.channel_id)
    .fetch_one(&state.db)
    .await?;

    let full_msg = MessageWithAuthor {
        id: new_msg.get("id"),
        channel_id: body.channel_id,
        content: new_msg.get("content"),
        r#type: new_msg.get("type"),
        reply_to: None,
        reply_to_content: None,
        reply_to_username: None,
        forward_from_id: Some(message_id),
        forward_from_username: Some(src_author),
        pinned: false,
        edited_at: None,
        created_at: new_msg.get("created_at"),
        author_id: claims.sub,
        author_username: user.get("username"),
        author_discriminator: user.get("discriminator"),
        author_avatar: user.get("avatar"),
        author_avatar_decoration: user.try_get("avatar_decoration").ok().flatten(),
        author_avatar_decoration_opts: user.try_get("avatar_decoration_opts").ok().flatten(),
        author_is_bot: user.try_get("is_bot").unwrap_or(false),
        author_verified: user.try_get("is_verified").unwrap_or(false),
        attachments: vec![],
        reactions: vec![],
        expires_at: None,
        poll_id: None,
        e2e: MsgE2e::from_row(&new_msg),
    };

    // Diffusion aux seuls membres qui voient le salon de destination.
    let event = serde_json::json!({
        "type": "MESSAGE_CREATE",
        "server_id": dest_server_id,
        "message": full_msg
    });
    state.broadcast_to_channel_members(body.channel_id, event.to_string()).await;

    Ok(Json(full_msg))
}

#[derive(serde::Deserialize)]
pub struct ReminderInput {
    pub remind_at: chrono::DateTime<chrono::Utc>,
}

pub async fn set_reminder(
    axum::extract::Path(message_id): axum::extract::Path<uuid::Uuid>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    Json(input): Json<ReminderInput>,
) -> Result<Json<serde_json::Value>> {
    // MessageRow.tsx offre "Me rappeler" sur tout message, y compris en DM
    // (DMConversation réutilise MessageList/MessageRow, msg.id y est un
    // dm_messages.id) -- vérifier les deux tables, pas seulement les canaux
    // de serveur, sinon 100% des rappels DM échouent en 404.
    let channel_ok = channel_message_visible(&state, claims.sub, message_id).await?;

    let dm_ok: bool = if channel_ok {
        false
    } else {
        sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM dm_messages dm
                JOIN dm_channels dc ON dc.id = dm.dm_channel_id
                WHERE dm.id = $1 AND (dc.user1_id = $2 OR dc.user2_id = $2)
             )"
        ).bind(message_id).bind(claims.sub).fetch_one(&state.db).await?
    };

    if !channel_ok && !dm_ok {
        return Err(AppError::NotFound("Message introuvable".into()));
    }
    // Échéance bornée et plafond de rappels en attente (avant : ni l'un ni l'autre).
    if !crate::handlers::reminders::valid_remind_at(input.remind_at, Utc::now()) {
        return Err(AppError::BadRequest("Rappel : date future, dans un an au plus".into()));
    }
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM message_reminders WHERE user_id=$1 AND sent=FALSE")
        .bind(claims.sub).fetch_one(&state.db).await?;
    if pending >= crate::handlers::reminders::MAX_PENDING {
        return Err(AppError::BadRequest(format!("{} rappels en attente au plus", crate::handlers::reminders::MAX_PENDING)));
    }

    sqlx::query(
        "INSERT INTO message_reminders (user_id, message_id, remind_at) VALUES ($1, $2, $3)"
    )
    .bind(claims.sub)
    .bind(message_id)
    .bind(input.remind_at)
    .execute(&state.db).await
    .map_err(|e| AppError::Internal(anyhow::anyhow!("{}", e)))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
