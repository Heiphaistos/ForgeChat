mod config;
mod email;
mod error;
mod handlers;
mod middleware;
mod models;
mod state;

use axum::{
    middleware as axum_middleware,
    routing::{delete, get, patch, post, put},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use std::{path::PathBuf, time::Duration};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use axum::extract::DefaultBodyLimit;
use axum::http::{header, HeaderValue};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{config::Config, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "forgechat=debug,tower_http=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;

    let db = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;
    tracing::info!("Migrations OK");

    let redis_client = redis::Client::open(config.redis_url.clone())?;
    let redis_conn = redis_client.get_multiplexed_async_connection().await?;
    tracing::info!("Redis OK");

    let state = AppState::new(db, redis_conn, config.clone());

    // Tâche de nettoyage des pièces jointes expirées (toutes les heures)
    let cleanup_state = state.clone();
    let cleanup_upload_dir = config.upload_dir.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            cleanup_expired_attachments(&cleanup_state, &cleanup_upload_dir).await;
        }
    });

    // Tâche de polling RSS (toutes les 5 minutes)
    let feed_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            handlers::feeds::poll_rss_feeds(&feed_state).await;
        }
    });

    // Tâche d'envoi des messages programmés (toutes les 60 secondes)
    let scheduled_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            handlers::scheduled::dispatch_scheduled_messages(scheduled_state.clone()).await;
        }
    });

    // Tâche de rappels messages (toutes les 30 secondes)
    let reminder_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let due = sqlx::query(
                "SELECT r.id, r.user_id, r.message_id, m.content \
                 FROM message_reminders r \
                 JOIN messages m ON m.id = r.message_id \
                 WHERE r.remind_at <= NOW() AND r.sent = FALSE \
                 LIMIT 50"
            ).fetch_all(&reminder_state.db).await.unwrap_or_default();

            for r in due {
                use sqlx::Row;
                let event = serde_json::json!({
                    "type": "REMINDER",
                    "message_id": r.get::<uuid::Uuid, _>("message_id").to_string(),
                    "content": r.get::<Option<String>, _>("content"),
                });
                reminder_state.broadcast_to_user(r.get::<uuid::Uuid, _>("user_id"), event.to_string()).await;
                let _ = sqlx::query("UPDATE message_reminders SET sent = TRUE WHERE id = $1")
                    .bind(r.get::<uuid::Uuid, _>("id"))
                    .execute(&reminder_state.db).await;
            }
        }
    });

    // Tâche de levée des bans temporaires expirés (toutes les 60 secondes)
    let unban_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let _ = sqlx::query(
                "DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at < NOW()"
            )
            .execute(&unban_state.db)
            .await;
        }
    });

    // Tâche de suppression des messages éphémères expirés (toutes les 60 secondes)
    let ephemeral_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let _ = sqlx::query(
                "DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < NOW()"
            )
            .execute(&ephemeral_state.db)
            .await;
        }
    });

    // Notifications email — DMs non lus depuis 24h (toutes les 6 heures)
    let email_notif_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(21600));
        loop {
            interval.tick().await;
            send_dm_notifications(&email_notif_state).await;
        }
    });

    // Notifications anniversaire (toutes les 24h)
    let birthday_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(86400));
        loop {
            interval.tick().await;
            send_birthday_notifications(&birthday_state).await;
        }
    });

    let mut allowed_origins = vec![
        config.frontend_url.parse::<HeaderValue>()?,
    ];
    for origin in &["tauri://localhost", "https://tauri.localhost"] {
        if let Ok(v) = origin.parse::<HeaderValue>() {
            allowed_origins.push(v);
        }
    }
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::PATCH,
            axum::http::Method::DELETE,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
        ])
        .allow_credentials(true);

    let app = Router::new()
        // Auth publique
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/verify-email", post(handlers::auth::verify_email))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/invites/:code", get(handlers::invites::get_invite_info))
        // Invitation amis (lecture publique — affiche le profil de l'invitant)
        .route("/api/friend-invite/:code", get(handlers::friends::get_friend_invite))
        // Profil public (auth optionnelle pour les infos de relation)
        .route("/api/users/:id/profile", get(handlers::users::get_user_profile_public))
        // WebSocket
        .route("/ws", get(handlers::websocket::ws_handler))
        // Routes bot (sans JWT — auth via Bearer token)
        .route("/api/bot/messages", post(handlers::bots::bot_send_message))
        .route("/api/bots/:bot_id/commands", post(handlers::bots::register_bot_command))
        // Webhook entrant (sans JWT — auth via token dans l'URL)
        .route("/api/webhook/:id/:token", post(handlers::webhooks::execute_webhook))
        // Webhook GitHub entrant (sans JWT — push/PR/issues)
        .route("/api/github-webhook/:channel_id", post(handlers::webhooks::receive_github_webhook))
        // Vérification mise à jour desktop (sans auth)
        .route("/api/desktop/update/:target/:arch/:version", get(handlers::desktop::check_update))
        // Routes protégées
        .nest("/api", protected_routes(state.clone()))
        // Fichiers uploadés — avec en-têtes de sécurité pour éviter le sniffing de type MIME
        .nest_service(
            "/uploads",
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::X_CONTENT_TYPE_OPTIONS,
                    HeaderValue::from_static("nosniff"),
                ))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::CONTENT_SECURITY_POLICY,
                    HeaderValue::from_static("default-src 'none'; sandbox"),
                ))
                .service(ServeDir::new(&config.upload_dir))
        )
        .layer(DefaultBodyLimit::max(52_428_800)) // 50 MB
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("ForgeChat v{} écoute sur {addr}", env!("CARGO_PKG_VERSION"));

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    ).await?;

    Ok(())
}

async fn cleanup_expired_attachments(state: &AppState, upload_dir: &str) {
    let rows = sqlx::query(
        "DELETE FROM attachments WHERE expires_at IS NOT NULL AND expires_at < NOW()
         RETURNING url"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let count = rows.len();
    let base = PathBuf::from(upload_dir).canonicalize().unwrap_or_else(|_| PathBuf::from(upload_dir));

    for row in rows {
        use sqlx::Row;
        let url: String = row.get("url");
        if let Some(relative) = url.strip_prefix("/uploads/") {
            // Rejeter les séquences de traversal avant de joindre
            if relative.contains("..") || relative.contains('\0') {
                tracing::warn!("Tentative de path traversal détectée dans cleanup: {}", url);
                continue;
            }
            let path = base.join(relative);
            // Vérifier que le chemin canonique reste dans upload_dir
            if let Ok(canonical) = path.canonicalize() {
                if canonical.starts_with(&base) {
                    let _ = tokio::fs::remove_file(&canonical).await;
                } else {
                    tracing::warn!("Path traversal bloqué : {:?} hors de {:?}", canonical, base);
                }
            }
        }
    }

    if count > 0 {
        tracing::info!("Nettoyage : {} pièces jointes expirées supprimées", count);
    }
}

async fn send_dm_notifications(state: &AppState) {
    use sqlx::Row;
    use uuid::Uuid;

    // Récupère les utilisateurs ayant des DMs non lus depuis 24h avec notifications email activées
    let rows = sqlx::query(
        "WITH unread AS (
            SELECT
                dm.id          AS msg_id,
                dm.created_at  AS msg_at,
                dc.id          AS channel_id,
                CASE WHEN dc.user1_id = dm.sender_id THEN dc.user2_id ELSE dc.user1_id END AS recipient_id
            FROM dm_messages dm
            JOIN dm_channels dc ON dc.id = dm.dm_channel_id
            WHERE dm.created_at < NOW() - INTERVAL '24 hours'
        )
        SELECT
            un.recipient_id,
            u.email,
            u.username,
            COUNT(un.msg_id) AS unread_count
        FROM unread un
        JOIN users u ON u.id = un.recipient_id
        JOIN email_preferences ep ON ep.user_id = un.recipient_id
        LEFT JOIN dm_read_receipts rr ON rr.dm_id = un.channel_id AND rr.user_id = un.recipient_id
        WHERE (rr.last_read_at IS NULL OR un.msg_at > rr.last_read_at)
          AND ep.dm_unread_notify = TRUE
          AND (ep.last_notified_at IS NULL OR ep.last_notified_at < NOW() - INTERVAL '24 hours')
        GROUP BY un.recipient_id, u.email, u.username"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for row in &rows {
        let recipient_id: Uuid = row.get("recipient_id");
        let email: String = row.get("email");
        let username: String = row.get("username");
        let count: i64 = row.get("unread_count");

        let plural_s = if count > 1 { "s" } else { "" };
        let html = format!(
            r#"<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1e1f22;color:#dbdee1;padding:32px">
<div style="max-width:480px;margin:auto;background:#313338;border-radius:12px;padding:32px">
  <h2 style="color:#5865f2;margin-top:0">ForgeChat — Messages non lus</h2>
  <p>Bonjour <strong>{username}</strong>,</p>
  <p>Tu as <strong>{count}</strong> message{plural_s} direct{plural_s} non lu{plural_s} depuis plus de 24h.</p>
  <p><a href="{url}" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#5865f2;color:#fff;border-radius:8px;text-decoration:none">Ouvrir ForgeChat</a></p>
  <p style="color:#949ba4;font-size:12px;margin-top:24px">Pour ne plus recevoir ces emails, désactive les notifications email dans Paramètres &rarr; Emails.</p>
</div></body></html>"#,
            username = username,
            count = count,
            plural_s = plural_s,
            url = state.config.frontend_url,
        );

        match email::send_email(&state.config, &email, "Nouveaux messages directs — ForgeChat", html).await {
            Ok(true) => {
                tracing::info!("Email DM digest envoyé à {} ({} non-lus)", username, count);
            }
            Ok(false) => {
                tracing::debug!("SMTP non configuré, email ignoré pour {}", username);
            }
            Err(e) => {
                tracing::error!("Erreur envoi email DM à {}: {}", username, e);
                continue;
            }
        }

        // Mettre à jour last_notified_at
        let _ = sqlx::query(
            "UPDATE email_preferences SET last_notified_at = NOW() WHERE user_id = $1"
        )
        .bind(recipient_id)
        .execute(&state.db)
        .await;
    }

    if !rows.is_empty() {
        tracing::info!("DM email digest : {} notification(s) traitée(s)", rows.len());
    }
}

async fn send_birthday_notifications(state: &AppState) {
    use sqlx::Row;
    use uuid::Uuid;

    let birthday_users = sqlx::query(
        "SELECT u.id, u.username, sm.server_id
         FROM users u
         JOIN server_members sm ON sm.user_id = u.id
         WHERE EXTRACT(MONTH FROM u.birthday) = EXTRACT(MONTH FROM CURRENT_DATE)
           AND EXTRACT(DAY FROM u.birthday) = EXTRACT(DAY FROM CURRENT_DATE)
           AND u.birthday IS NOT NULL"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for row in birthday_users {
        let username: String = row.get("username");
        let user_id: Uuid = row.get("id");
        let server_id: Uuid = row.get("server_id");

        let channel = sqlx::query(
            "SELECT id FROM channels WHERE server_id=$1 AND (name ILIKE '%général%' OR name ILIKE '%general%' OR position=0) ORDER BY position ASC LIMIT 1"
        )
        .bind(server_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default();

        if let Some(ch) = channel {
            let channel_id: Uuid = ch.get("id");
            let msg_id = Uuid::new_v4();
            let content = format!("🎂 Joyeux anniversaire **{}** ! 🎉🎈", username);

            let server_row = sqlx::query("SELECT owner_id FROM servers WHERE id=$1")
                .bind(server_id)
                .fetch_optional(&state.db)
                .await
                .unwrap_or_default();

            if let Some(srv) = server_row {
                let owner_id: Uuid = srv.get("owner_id");
                let _ = sqlx::query(
                    "INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ($1,$2,$3,$4,NOW())"
                )
                .bind(msg_id)
                .bind(channel_id)
                .bind(owner_id)
                .bind(&content)
                .execute(&state.db)
                .await;

                let event = serde_json::json!({
                    "type": "MESSAGE_CREATE",
                    "message": {
                        "id": msg_id.to_string(),
                        "channel_id": channel_id.to_string(),
                        "content": content,
                        "author_username": "ForgeChat",
                        "author_id": owner_id.to_string(),
                        "created_at": chrono::Utc::now().to_rfc3339(),
                    }
                });
                state.broadcast_to_channel_members(channel_id, event.to_string()).await;
                tracing::info!("Anniversaire envoyé pour {} (user {}) dans server {}", username, user_id, server_id);
            }
        }
    }
}

fn protected_routes(state: AppState) -> Router<AppState> {
    Router::new()
        // Auth
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/change-password", post(handlers::auth::change_password))
        .route("/auth/2fa/setup", post(handlers::totp::setup_totp))
        .route("/auth/2fa/confirm", post(handlers::totp::confirm_totp))
        .route("/auth/2fa/disable", post(handlers::totp::disable_totp))
        .route("/auth/ws-ticket", post(handlers::auth::ws_ticket))
        // Users
        .route("/users/me", get(handlers::users::get_me))
        .route("/users/me/sessions", get(handlers::auth::list_sessions))
        .route("/users/me/sessions/:id", delete(handlers::auth::revoke_session))
        .route("/users/me", patch(handlers::users::update_me))
        .route("/users/me", delete(handlers::users::delete_account))
        .route("/users/me/data-export", get(handlers::privacy::export_user_data))
        .route("/users/me/stats", get(handlers::users::get_my_stats))
        .route("/users/me/login-history", get(handlers::users::get_login_history))
        .route("/users/me/avatar", post(handlers::users::upload_avatar))
        .route("/users/me/banner", post(handlers::users::upload_banner))
        .route("/users/:id", get(handlers::users::get_user))
        .route("/users/:id/block", post(handlers::users::block_user))
        .route("/users/:id/block", delete(handlers::users::unblock_user))
        .route("/users/:id/favorite", post(handlers::users::add_favorite))
        .route("/users/:id/favorite", delete(handlers::users::remove_favorite))
        .route("/users/search", get(handlers::users::search_users))
        // Servers
        .route("/servers", get(handlers::servers::get_my_servers))
        .route("/servers", post(handlers::servers::create_server))
        .route("/servers/:id", get(handlers::servers::get_server))
        .route("/servers/:id", patch(handlers::servers::update_server))
        .route("/servers/:id", delete(handlers::servers::delete_server))
        .route("/servers/join/:code", post(handlers::servers::join_server))
        .route("/servers/:id/leave", post(handlers::servers::leave_server))
        .route("/servers/:id/members", get(handlers::servers::get_members))
        .route("/servers/:server_id/members/:user_id/kick", post(handlers::servers::kick_member))
        .route("/servers/:server_id/members/:user_id/ban", post(handlers::servers::ban_member))
        .route("/servers/:server_id/icon", post(handlers::servers::upload_server_icon))
        .route("/admin/stats", get(handlers::servers::get_admin_stats))
        .route("/servers/:server_id/stats", get(handlers::servers::get_server_stats))
        .route("/servers/:server_id/leaderboard", get(handlers::servers::get_leaderboard))
        .route("/servers/:server_id/tickets", get(handlers::tickets::list_tickets).post(handlers::tickets::create_ticket))
        .route("/servers/:server_id/tickets/:ticket_id", patch(handlers::tickets::update_ticket))
        .route("/servers/:server_id/ticket-categories", get(handlers::tickets::list_categories).post(handlers::tickets::create_category))
        // Channels
        .route("/servers/:id/channels", get(handlers::channels::get_channels))
        .route("/servers/:id/channels", post(handlers::channels::create_channel))
        .route("/servers/:server_id/categories", get(handlers::channels::get_categories).post(handlers::channels::create_category))
        .route("/servers/:server_id/channels/:channel_id", patch(handlers::channels::update_channel))
        .route("/servers/:server_id/channels/:channel_id", delete(handlers::channels::delete_channel))
        .route("/servers/:server_id/channels/:channel_id/archive", patch(handlers::channels::archive_channel))
        .route("/servers/:server_id/channels/:channel_id/pins", get(handlers::channels::get_pinned))
        .route("/servers/:server_id/channels/reorder", patch(handlers::channels::reorder_channels))
        .route("/servers/:server_id/boost", post(handlers::servers::boost_server))
        // Channel permission overrides
        .route("/channels/:channel_id/permissions", get(handlers::channels::get_channel_permissions))
        .route("/channels/:channel_id/permissions/:target_id",
            put(handlers::channels::put_channel_permission)
            .delete(handlers::channels::delete_channel_permission))
        // Channel hide (per-user)
        .route("/channels/:channel_id/hide",
            post(handlers::channels::hide_channel)
            .delete(handlers::channels::unhide_channel))
        // Channel move (cross-category)
        .route("/channels/:id/move", patch(handlers::channels::move_channel))
        .route("/channels/:id/purge", post(handlers::channels::purge_messages))
        .route("/servers/:server_id/channels/:channel_id/github-webhook-token", put(handlers::channels::set_github_webhook_token))
        // Messages
        .route("/servers/:server_id/channels/:channel_id/messages", get(handlers::messages::get_messages))
        .route("/servers/:server_id/channels/:channel_id/messages", post(handlers::messages::send_message))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id", patch(handlers::messages::edit_message))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id", delete(handlers::messages::delete_message))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/reactions/:emoji", put(handlers::messages::add_reaction))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/reactions/:emoji", delete(handlers::messages::remove_reaction))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/pin", post(handlers::messages::pin_message))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/pin", delete(handlers::messages::unpin_message))
        .route("/servers/:server_id/channels/:channel_id/messages/search", get(handlers::messages::search_messages))
        .route("/messages/:id/remind", post(handlers::messages::set_reminder))
        .route("/messages/:id/translate", post(handlers::messages::translate_message))
        .route("/messages/:id/report", post(handlers::reports::create_report))
        .route("/servers/:server_id/reports", get(handlers::reports::list_reports))
        // Uploads
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/attachments", post(handlers::uploads::upload_file))
        // Roles
        .route("/servers/:server_id/roles", get(handlers::roles::get_roles))
        .route("/servers/:server_id/roles", post(handlers::roles::create_role))
        .route("/servers/:server_id/roles/:role_id", patch(handlers::roles::update_role))
        .route("/servers/:server_id/roles/:role_id", delete(handlers::roles::delete_role))
        .route("/servers/:server_id/members/:user_id/roles/:role_id", put(handlers::roles::assign_role))
        .route("/servers/:server_id/members/:user_id/roles/:role_id", delete(handlers::roles::remove_role))
        // Invites
        .route("/servers/:server_id/invites", get(handlers::invites::get_invites))
        .route("/servers/:server_id/invites", post(handlers::invites::create_invite))
        .route("/servers/:server_id/invites/:code", delete(handlers::invites::delete_invite))
        // Friends & DMs
        .route("/friends", get(handlers::friends::get_friends))
        .route("/friends", post(handlers::friends::send_friend_request))
        .route("/friends/:id/accept", post(handlers::friends::accept_friend))
        .route("/friends/:id/decline", post(handlers::friends::decline_friend))
        .route("/friends/:user_id", delete(handlers::friends::remove_friend))
        .route("/dms", get(handlers::friends::get_dms))
        .route("/dms/:user_id", post(handlers::friends::open_dm))
        .route("/dms/:dm_id/messages", get(handlers::friends::get_dm_messages))
        .route("/dms/:dm_id/messages", post(handlers::friends::send_dm))
        .route("/dms/:dm_id/messages/:msg_id/attachments", post(handlers::friends::upload_dm_attachment))
        .route("/dms/:dm_id/messages/:msg_id", patch(handlers::friends::edit_dm_message))
        .route("/dms/:dm_id/messages/:msg_id", delete(handlers::friends::delete_dm_message))
        .route("/dms/:dm_id/messages/:msg_id/reactions/:emoji", put(handlers::friends::toggle_dm_reaction))
        // E2E encrypted DMs
        .route("/dms/:dm_id/e2e", get(handlers::friends::get_e2e_messages))
        .route("/dms/:dm_id/e2e", post(handlers::friends::send_e2e_message))
        // E2E Public Key Management
        .route("/users/me/pubkey", post(handlers::users::set_pubkey))
        .route("/users/:id/pubkey", get(handlers::users::get_pubkey))
        // Unread
        .route("/unread", get(handlers::reads::get_unread_counts))
        .route("/channels/:channel_id/read", post(handlers::reads::mark_channel_read))
        // Threads
        .route("/servers/:server_id/channels/:channel_id/threads", get(handlers::threads::list_threads))
        .route("/servers/:server_id/channels/:channel_id/threads", post(handlers::threads::create_thread))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages", get(handlers::threads::get_thread_messages))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages", post(handlers::threads::send_thread_message))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages/:msg_id", patch(handlers::threads::edit_thread_message))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages/:msg_id", delete(handlers::threads::delete_thread_message))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id", patch(handlers::threads::archive_thread))
        // Forum
        .route("/servers/:server_id/channels/:channel_id/posts", get(handlers::forum::list_posts))
        .route("/servers/:server_id/channels/:channel_id/posts", post(handlers::forum::create_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", get(handlers::forum::get_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", patch(handlers::forum::update_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", delete(handlers::forum::delete_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies", post(handlers::forum::reply_to_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies/:reply_id", patch(handlers::forum::edit_reply))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies/:reply_id", delete(handlers::forum::delete_reply))
        // Custom Emojis
        .route("/servers/:server_id/emojis", get(handlers::emojis::list_emojis))
        .route("/servers/:server_id/emojis", post(handlers::emojis::create_emoji))
        .route("/servers/:server_id/emojis/:emoji_id", delete(handlers::emojis::delete_emoji))
        // Bots
        .route("/servers/:server_id/bots", get(handlers::bots::list_bots))
        .route("/servers/:server_id/bots", post(handlers::bots::create_bot))
        .route("/servers/:server_id/bots/:bot_id", delete(handlers::bots::delete_bot))
        .route("/servers/:server_id/bots/:bot_id/token", post(handlers::bots::regenerate_token))
        // Slash commands bots (lecture — auth user)
        .route("/servers/:server_id/commands", get(handlers::bots::list_server_commands))
        // Bans
        .route("/servers/:server_id/bans", get(handlers::server_settings::list_bans))
        .route("/servers/:server_id/bans/:user_id", delete(handlers::server_settings::unban_member))
        // Tags de clan
        .route("/servers/:server_id/tags", get(handlers::server_settings::list_tags))
        .route("/servers/:server_id/tags", post(handlers::server_settings::create_tag))
        .route("/servers/:server_id/tags/:tag_id", delete(handlers::server_settings::delete_tag))
        .route("/servers/:server_id/members/:user_id/tags/:tag_id", put(handlers::server_settings::assign_tag))
        .route("/servers/:server_id/members/:user_id/tags/:tag_id", delete(handlers::server_settings::remove_tag))
        // Membres détaillés (avec rôles + tags)
        .route("/servers/:server_id/members/detailed", get(handlers::server_settings::get_members_detailed))
        // Invitations amis
        .route("/friends/invite", post(handlers::friends::create_friend_invite))
        .route("/friend-invite/:code/accept", post(handlers::friends::accept_friend_invite))
        // Friends Ultra
        .route("/friends/v2", get(handlers::friends::get_friends_v2))
        .route("/friends/by-name", post(handlers::friends::send_friend_by_name))
        .route("/friends/suggestions", get(handlers::friends::get_friend_suggestions))
        .route("/friends/calls", get(handlers::friends::get_call_history))
        .route("/friends/groups", get(handlers::friends::list_friend_groups))
        .route("/friends/groups", post(handlers::friends::create_friend_group))
        .route("/friends/groups/:id", put(handlers::friends::update_friend_group))
        .route("/friends/groups/:id", delete(handlers::friends::delete_friend_group))
        .route("/friends/groups/:id/members", post(handlers::friends::add_to_group))
        .route("/friends/groups/:id/members/:user_id", delete(handlers::friends::remove_from_group))
        .route("/friends/:id/cancel", delete(handlers::friends::cancel_friend_request))
        .route("/friends/:id/note", get(handlers::friends::get_friend_note))
        .route("/friends/:id/note", put(handlers::friends::set_friend_note))
        .route("/friends/:id/nickname", get(handlers::friends::get_friend_nickname))
        .route("/friends/:id/nickname", put(handlers::friends::set_friend_nickname))
        .route("/friends/:id/notify", put(handlers::friends::set_online_notify))
        // Polls
        .route("/servers/:server_id/channels/:channel_id/polls", post(handlers::polls::create_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id", get(handlers::polls::get_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id/vote", post(handlers::polls::vote_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id/close", post(handlers::polls::close_poll))
        // Webhooks
        .route("/servers/:server_id/webhooks", get(handlers::webhooks::list_webhooks))
        .route("/servers/:server_id/webhooks", post(handlers::webhooks::create_webhook))
        .route("/servers/:server_id/webhooks/:webhook_id", delete(handlers::webhooks::delete_webhook))
        // Saved messages
        .route("/saved", post(handlers::saved::save_message))
        .route("/saved", get(handlers::saved::get_saved))
        .route("/saved/:message_id", delete(handlers::saved::unsave_message))
        // User notes
        .route("/notes/:target_id", get(handlers::saved::get_note))
        .route("/notes/:target_id", put(handlers::saved::set_note))
        // Global search
        .route("/search", get(handlers::search::global_search))
        // Audit log
        .route("/servers/:server_id/audit", get(handlers::audit::get_audit_log))
        // AutoMod
        .route("/servers/:server_id/automod", get(handlers::audit::get_automod))
        .route("/servers/:server_id/automod", put(handlers::audit::set_automod))
        // Server discovery
        .route("/explore", get(handlers::audit::discover_servers))
        // Reaction detail
        .route("/reactions", get(handlers::audit::get_reaction_detail))
        // OG preview
        .route("/og", get(handlers::audit::og_preview))
        // Nickname
        .route("/servers/:server_id/nickname", patch(handlers::audit::set_nickname))
        // DM read receipts
        .route("/dms/:dm_id/read", post(handlers::audit::mark_dm_read))
        .route("/dms/:dm_id/read", get(handlers::audit::get_dm_read))
        // Feeds RSS/YouTube par canal
        .route("/servers/:server_id/channels/:channel_id/feeds", get(handlers::feeds::list_channel_feeds))
        .route("/servers/:server_id/channels/:channel_id/feeds", post(handlers::feeds::create_channel_feed))
        .route("/servers/:server_id/feeds/:feed_id", delete(handlers::feeds::delete_channel_feed))
        .route("/servers/:server_id/feeds/:feed_id/toggle", patch(handlers::feeds::toggle_channel_feed))
        // Historique des éditions de messages
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/edits", get(handlers::messages::get_message_edits))
        // Forward message
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/forward", post(handlers::messages::forward_message))
        // Messages programmés
        .route("/servers/:server_id/channels/:channel_id/scheduled", post(handlers::scheduled::create_scheduled))
        .route("/servers/:server_id/channels/:channel_id/scheduled", get(handlers::scheduled::list_scheduled))
        .route("/scheduled/:scheduled_id", delete(handlers::scheduled::delete_scheduled))
        // ICE config pour WebRTC (STUN + TURN)
        .route("/voice/ice-config", get(handlers::voice::get_ice_config))
        // Server Templates
        .route("/servers/:id/template", post(handlers::templates::create_template_from_server))
        .route("/templates", get(handlers::templates::list_templates))
        .route("/templates/:id/use", post(handlers::templates::use_template))
        .route("/templates/:id", delete(handlers::templates::delete_template))
        // Verification Gate
        .route("/servers/:id/verify", post(handlers::servers::verify_member))
        .route("/servers/:id/verification", patch(handlers::servers::update_server_verification))
        // User Settings
        .route("/user/settings", get(handlers::user_settings::get_user_settings))
        .route("/user/settings", put(handlers::user_settings::update_user_settings))
        .route("/user/focus-mode", patch(handlers::users::toggle_focus_mode))
        .route("/user/connected-accounts", get(handlers::user_settings::list_connected_accounts))
        .route("/user/connected-accounts", post(handlers::user_settings::add_connected_account))
        .route("/user/connected-accounts/:platform", delete(handlers::user_settings::delete_connected_account))
        .route("/user/notification-overrides", get(handlers::user_settings::get_notification_overrides))
        .route("/user/notification-overrides", post(handlers::user_settings::set_notification_override))
        .route("/user/channel-notif/:channel_id", get(handlers::user_settings::get_channel_notification_override))
        .route("/user/channel-notif/:channel_id", post(handlers::user_settings::set_channel_notification_override))
        .route("/user/keybindings", get(handlers::user_settings::get_keybindings))
        .route("/user/keybindings", post(handlers::user_settings::set_keybinding))
        .route("/user/keybindings/:action", delete(handlers::user_settings::reset_keybinding))
        // Email preferences
        .route("/user/email-prefs", get(handlers::user_settings::get_email_prefs))
        .route("/user/email-prefs", put(handlers::user_settings::update_email_prefs))
        // Soundboard
        .route("/servers/:id/soundboard", get(handlers::soundboard::list_sounds))
        .route("/servers/:id/soundboard", post(handlers::soundboard::upload_sound))
        .route("/servers/:server_id/soundboard/:sound_id", delete(handlers::soundboard::delete_sound))
        // Events
        .route("/servers/:id/events", get(handlers::events::list_events))
        .route("/servers/:id/events", post(handlers::events::create_event))
        .route("/servers/:server_id/events/:event_id", get(handlers::events::get_event))
        .route("/servers/:server_id/events/:event_id", put(handlers::events::update_event))
        .route("/servers/:server_id/events/:event_id", delete(handlers::events::delete_event))
        .route("/events/:event_id/attend", post(handlers::events::attend_event))
        // Moderation — Notes
        .route("/servers/:server_id/members/:user_id/notes", get(handlers::moderation::get_mod_notes))
        .route("/servers/:server_id/members/:user_id/notes", post(handlers::moderation::create_mod_note))
        .route("/servers/:server_id/notes/:note_id", delete(handlers::moderation::delete_mod_note))
        // Moderation — Timeouts
        .route("/servers/:server_id/members/:user_id/timeout", post(handlers::moderation::create_timeout))
        .route("/servers/:server_id/members/:user_id/timeout", delete(handlers::moderation::remove_timeout))
        // Tasks
        .route("/channels/:channel_id/tasks", get(handlers::moderation::list_channel_tasks))
        .route("/channels/:channel_id/tasks", post(handlers::moderation::create_task))
        .route("/channels/:channel_id/tasks/:task_id", put(handlers::moderation::update_task))
        .route("/channels/:channel_id/tasks/:task_id", delete(handlers::moderation::delete_task))
        // User mentions
        .route("/user/mentions", get(handlers::reads::get_user_mentions))
        .route("/users/:id/mutual-servers", get(handlers::users::get_mutual_servers))
        .route("/users/:id/achievements", get(handlers::users::get_user_achievements))
        // User status + activity feed
        .route("/user/status", patch(handlers::users::update_status))
        .route("/activity-feed", get(handlers::users::get_activity_feed))
        .route("/servers/discover", get(handlers::servers::discover_servers))
        // DM extras (mute, archive, pins)
        .route("/dms/:id/mute", post(handlers::dm_extras::mute_dm))
        .route("/dms/:id/mute", delete(handlers::dm_extras::unmute_dm))
        .route("/dms/:id/archive", post(handlers::dm_extras::archive_dm))
        .route("/dms/:id/archive", delete(handlers::dm_extras::unarchive_dm))
        .route("/dms/:id/pins", get(handlers::dm_extras::get_dm_pins))
        .route("/dms/:id/pins/:msg_id", post(handlers::dm_extras::pin_dm_message))
        .route("/dms/:id/pins/:msg_id", delete(handlers::dm_extras::unpin_dm_message))
        // Custom Stickers
        .route("/servers/:server_id/stickers", get(handlers::stickers::list_stickers))
        .route("/servers/:server_id/stickers", post(handlers::stickers::create_sticker))
        .route("/servers/:server_id/stickers/:sticker_id", delete(handlers::stickers::delete_sticker))
        // Bulk friend invitations via CSV
        .route("/friends/invite-bulk", post(handlers::friends::invite_bulk))
        // DM settings (mute/archive) + block
        .route("/dms/:dm_id/settings", patch(handlers::friends::patch_dm_settings))
        // Group DMs
        .route("/dms/group", post(handlers::group_dms::create_group_dm))
        .route("/dms/groups", get(handlers::group_dms::list_group_dms))
        .route("/dms/groups/:group_id", get(handlers::group_dms::get_group_dm))
        .route("/dms/groups/:group_id/messages", get(handlers::group_dms::get_group_messages))
        .route("/dms/groups/:group_id/messages", post(handlers::group_dms::send_group_message))
        .route("/dms/groups/:group_id/messages/:msg_id", patch(handlers::group_dms::edit_group_message))
        .route("/dms/groups/:group_id/messages/:msg_id", delete(handlers::group_dms::delete_group_message))
        .route("/dms/groups/:group_id/messages/:msg_id/reactions/:emoji", put(handlers::group_dms::toggle_group_dm_reaction))
        .route("/friends/blocked", get(handlers::friends::get_blocked))
        .route("/friends/block/:user_id", post(handlers::friends::block_user))
        .route("/friends/block/:user_id", delete(handlers::friends::unblock_user))
        .route_layer(axum_middleware::from_fn_with_state(
            state,
            middleware::require_auth,
        ))
}
