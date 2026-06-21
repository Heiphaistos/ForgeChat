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
    cors::CorsLayer,
    services::ServeDir,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
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

    let cors = CorsLayer::new()
        .allow_origin(config.frontend_url.parse::<axum::http::HeaderValue>()?)
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
        .allow_credentials(false);

    let app = Router::new()
        // Auth publique
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/verify-email", post(handlers::auth::verify_email))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/invites/:code", get(handlers::invites::get_invite_info))
        // Invitation amis (lecture publique — affiche le profil de l'invitant)
        .route("/api/friend-invite/:code", get(handlers::friends::get_friend_invite))
        // WebSocket
        .route("/ws", get(handlers::websocket::ws_handler))
        // Routes bot (sans JWT — auth via Bearer token)
        .route("/api/bot/messages", post(handlers::bots::bot_send_message))
        .route("/api/bots/:bot_id/commands", post(handlers::bots::register_bot_command))
        // Webhook entrant (sans JWT — auth via token dans l'URL)
        .route("/api/webhook/:id/:token", post(handlers::webhooks::execute_webhook))
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
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("ForgeChat v2.3.0 écoute sur {addr}");

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

fn protected_routes(state: AppState) -> Router<AppState> {
    Router::new()
        // Auth
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/change-password", post(handlers::auth::change_password))
        .route("/auth/ws-ticket", post(handlers::auth::ws_ticket))
        // Users
        .route("/users/me", get(handlers::users::get_me))
        .route("/users/me", patch(handlers::users::update_me))
        .route("/users/me", delete(handlers::users::delete_account))
        .route("/users/me/avatar", post(handlers::users::upload_avatar))
        .route("/users/me/banner", post(handlers::users::upload_banner))
        .route("/users/:id", get(handlers::users::get_user))
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
        .route("/servers/:server_id/stats", get(handlers::servers::get_server_stats))
        // Channels
        .route("/servers/:id/channels", get(handlers::channels::get_channels))
        .route("/servers/:id/channels", post(handlers::channels::create_channel))
        .route("/servers/:server_id/categories", get(handlers::channels::get_categories).post(handlers::channels::create_category))
        .route("/servers/:server_id/channels/:channel_id", patch(handlers::channels::update_channel))
        .route("/servers/:server_id/channels/:channel_id", delete(handlers::channels::delete_channel))
        .route("/servers/:server_id/channels/:channel_id/pins", get(handlers::channels::get_pinned))
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
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id", patch(handlers::threads::archive_thread))
        // Forum
        .route("/servers/:server_id/channels/:channel_id/posts", get(handlers::forum::list_posts))
        .route("/servers/:server_id/channels/:channel_id/posts", post(handlers::forum::create_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", get(handlers::forum::get_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", patch(handlers::forum::update_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", delete(handlers::forum::delete_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies", post(handlers::forum::reply_to_post))
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
        // Polls
        .route("/servers/:server_id/channels/:channel_id/polls", post(handlers::polls::create_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id", get(handlers::polls::get_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id/vote", post(handlers::polls::vote_poll))
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
        .route("/user/connected-accounts", get(handlers::user_settings::list_connected_accounts))
        .route("/user/connected-accounts", post(handlers::user_settings::add_connected_account))
        .route("/user/connected-accounts/:platform", delete(handlers::user_settings::delete_connected_account))
        .route("/user/notification-overrides", get(handlers::user_settings::get_notification_overrides))
        .route("/user/notification-overrides", post(handlers::user_settings::set_notification_override))
        .route("/user/keybindings", get(handlers::user_settings::get_keybindings))
        .route("/user/keybindings", post(handlers::user_settings::set_keybinding))
        .route("/user/keybindings/:action", delete(handlers::user_settings::reset_keybinding))
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
        .route_layer(axum_middleware::from_fn_with_state(
            state,
            middleware::require_auth,
        ))
}
