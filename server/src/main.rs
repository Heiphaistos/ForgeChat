mod config;
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
use std::time::Duration;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
    trace::TraceLayer,
};
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

    // PostgreSQL
    let db = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&db).await?;
    tracing::info!("Migrations OK");

    // Redis
    let redis_client = redis::Client::open(config.redis_url.clone())?;
    let redis_conn = redis_client.get_multiplexed_async_connection().await?;
    tracing::info!("Redis OK");

    let state = AppState::new(db, redis_conn, config.clone());

    let cors = CorsLayer::new()
        .allow_origin(config.frontend_url.parse::<axum::http::HeaderValue>()?)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Auth publique
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/invites/:code", get(handlers::invites::get_invite_info))
        // WebSocket
        .route("/ws", get(handlers::websocket::ws_handler))
        // Routes protégées
        .nest("/api", protected_routes(state.clone()))
        // Fichiers uploadés
        .nest_service("/uploads", ServeDir::new(&config.upload_dir))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("ForgeChat écoute sur {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn protected_routes(state: AppState) -> Router<AppState> {
    Router::new()
        // Auth
        .route("/auth/logout", post(handlers::auth::logout))
        // Users
        .route("/users/me", get(handlers::users::get_me))
        .route("/users/me", patch(handlers::users::update_me))
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
        // Channels
        .route("/servers/:id/channels", get(handlers::channels::get_channels))
        .route("/servers/:id/channels", post(handlers::channels::create_channel))
        .route("/servers/:server_id/categories", post(handlers::channels::create_category))
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
        .route_layer(axum_middleware::from_fn_with_state(
            state,
            middleware::require_auth,
        ))
}
