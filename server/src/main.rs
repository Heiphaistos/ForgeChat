mod config;
mod email;
mod error;
mod handlers;
mod livekit;
mod middleware;
mod models;
mod state;
mod notify;
mod push;
mod mobile_push;
mod net_guard;
mod privacy;
mod crypto;
mod email_crypto;
mod upload_sign;
mod jwt;
mod security_headers;
mod cookies;
mod security_events;
mod webauthn;
mod key_log;
mod antivirus;
mod health;
mod dnd;
#[cfg(test)]
mod fuzz_props;
#[cfg(test)]
mod routes_test;

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

/// Corps des routes publiques et des petits réglages JSON (anti-saturation mémoire).
const SMALL_JSON_LIMIT: usize = 64 * 1024;
/// Webhooks entrants et routes bot : JSON seulement (aucun fichier), 1 Mo suffit.
const INBOUND_JSON_LIMIT: usize = 1024 * 1024;
use axum::http::{header, HeaderValue};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{config::Config, state::AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // `forgechat generate-vapid-keys` : paire VAPID pour le .env, sans démarrer le serveur.
    if std::env::args().nth(1).as_deref() == Some("generate-vapid-keys") {
        push::print_new_vapid_keys();
        return Ok(());
    }
    // `forgechat sweep-orphan-uploads` : liste (lecture seule) des fichiers orphelins, voir upload_sweep.rs.
    if std::env::args().nth(1).as_deref() == Some("sweep-orphan-uploads") {
        return handlers::upload_sweep::run_cli().await;
    }
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
    handlers::totp::init_enc_key()?;
    email_crypto::init()?;
    let sealed = email_crypto::migrate_at_rest(&db).await?;
    if sealed > 0 {
        tracing::info!("E-mails : {sealed} adresse(s) chiffrée(s) au repos");
    }
    let sealed = handlers::birthdays::migrate_at_rest(&db).await?;
    if sealed > 0 {
        tracing::info!("Anniversaires : {sealed} date(s) chiffrée(s) au repos");
    }
    let sealed = handlers::webhooks::migrate_github_tokens(&db).await?;
    if sealed > 0 {
        tracing::info!("GitHub : {sealed} secret(s) de webhook chiffré(s) au repos");
    }
    let sealed = handlers::totp::migrate_at_rest(&db).await?;
    if sealed > 0 {
        tracing::info!("2FA : {sealed} compte(s) passé(s) au secret chiffré / codes de secours hachés");
    }

    let redis_client = redis::Client::open(config.redis_url.clone())?;
    let redis_conn = redis::aio::ConnectionManager::new(redis_client).await?; // se reconnecte seul après une coupure (auth fail-closed : sinon 503 jusqu au redémarrage)
    tracing::info!("Redis OK");

    let state = AppState::new(db, redis_conn, config.clone()).await;
    health::mark_started();
    handlers::discord_import::recover_interrupted(&state).await;
    handlers::site_admin::sync_owner_email(&state).await;
    handlers::site_admin::sync_banned_set(&state).await;
    // P1-3 — aucune session WebSocket n'existe au démarrage : un arrêt brutal
    // laissait des utilisateurs « en ligne » jusqu'à leur prochaine connexion.
    if let Err(e) = sqlx::query("UPDATE users SET status='offline' WHERE status <> 'offline'")
        .execute(&state.db)
        .await
    {
        tracing::warn!("Remise hors ligne des statuts au démarrage : {e}");
    }

    // Tâche de nettoyage des pièces jointes expirées (toutes les heures)
    let cleanup_state = state.clone();
    let cleanup_upload_dir = config.upload_dir.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            cleanup_expired_attachments(&cleanup_state, &cleanup_upload_dir).await;
            handlers::diagnostics::purge_old(&cleanup_state).await;
            purge_retention(&cleanup_state).await;
            handlers::e2e_conv::purge_legacy(&cleanup_state.db).await;
        }
    });

    // Journal de transparence des clés : rattrapage au démarrage, puis chaque heure.
    let kt_db = state.db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            match key_log::reconcile(&kt_db).await {
                Ok(0) => {}
                Ok(n) => tracing::info!("journal de transparence : {n} clé(s) inscrite(s)"),
                Err(e) => tracing::warn!("journal de transparence : {e}"),
            }
        }
    });

    // Alertes de sécurité (seuils par heure), toutes les 5 minutes.
    let alert_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            security_events::check_alerts(&alert_state).await;
        }
    });

    // Actualités : image et résumé manquants complétés depuis la page de l'article (chaque minute).
    let news_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            handlers::news::enrich_batch(&news_state).await;
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
            // P1-8 — seulement les utilisateurs connectés : un rappel échu hors
            // ligne n'est plus perdu, la reconnexion WebSocket le livre.
            handlers::reminders::deliver_due(&reminder_state, None).await;
            handlers::reminders::push_offline_due(&reminder_state).await;
        }
    });

    // Communauté (toutes les 60 secondes) : événements récurrents et rappels,
    // XP vocal et présence vocale du jour.
    let community_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            handlers::event_tools::tick(&community_state).await;
            handlers::levels::voice_tick(&community_state).await;
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
            handlers::profile_custom::expire_custom_statuses(&unban_state).await;
        }
    });

    // Tâche de suppression des messages éphémères expirés (toutes les 60 secondes)
    let ephemeral_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            purge_expired_messages(&ephemeral_state).await;
            handlers::disappearing::purge_private(&ephemeral_state).await;
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

    // Synchronisation Discord -> ForgeChat : passages échus (24 ou 48 h) toutes les 10 minutes,
    // un verrou Redis par serveur (handlers/discord_import/sync.rs). `run_due` lance au plus
    // autant de passages que de créneaux libres (AppState::discord_sync_slots), les serveurs
    // synchronisés le moins récemment d'abord, sans attendre leur fin.
    let discord_sync_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            handlers::discord_import::sync::run_due(&discord_sync_state).await;
        }
    });

    // Anniversaires du jour (toutes les heures, une seule fête par an : birthdays.rs)
    let birthday_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            handlers::birthdays::run(&birthday_state).await;
        }
    });

    let mut allowed_origins = vec![
        config.frontend_url.parse::<HeaderValue>()?,
    ];
    // Tauri v2 : origine http://tauri.localhost sur Windows (schéma https/custom sur macOS/Linux)
    for origin in &[
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ] {
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
            // Appli web : jetons en cookies HttpOnly seulement (auth.rs, cookie_only).
            axum::http::HeaderName::from_static("x-forgechat-tokens"),
            axum::http::HeaderName::from_static("x-forgechat-device"),
        ])
        .allow_credentials(true);

    let app = app_routes(protected_routes(state.clone()), &config.upload_dir)
        // 12 Mo partout ailleurs (plus gros envoi hors pièce jointe : une bannière de 10 Mo) : un
        // corps JSON est lu entier en mémoire. Seules les pièces jointes, écrites sur le disque au
        // fil de l'eau, ont droit à ATTACHMENT_BODY_LIMIT (route par route).
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(axum::middleware::from_fn(security_headers::apply))
        .layer(axum::middleware::from_fn_with_state(state.clone(), health::count_server_errors))
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

/// Table complète des routes (publiques, `/api` protégé, `/uploads`), sans les couches
/// globales qui portent l'état. Séparée de `main` pour que routes_test.rs la construise
/// sans Postgres ni Redis : axum panique dès l'insertion d'une route en conflit.
fn app_routes(protected: Router<AppState>, upload_dir: &str) -> Router<AppState> {
    Router::new()
        // Healthcheck réel du backend -- accessible via nginx location /api/ existante
        // (contrairement à /health qui n'a pas de route nginx dédiée et retombe
        // silencieusement sur le SPA React, 200 même backend down)
        .route("/api/health", get(|| async { "ok" }))
        // Page d'état publique (amélioration n° 50) : états seulement, cache 30 s.
        .route("/api/status", get(health::public_status))
        // Manifeste de mise à jour de l'application bureau. Public : l'updater
        // l'interroge au lancement, avant toute authentification.
        .route("/api/desktop/latest", get(handlers::desktop::get_latest))
        // Auth publique
        // Corps limité à 64 Ko : routes sans compte, quelques champs texte seulement.
        .route("/api/auth/register", post(handlers::auth::register).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/registration-info", get(handlers::site_admin::registration_info))
        .route("/api/auth/verify-email", post(handlers::auth::verify_email).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/login", post(handlers::auth::login).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/prelogin", post(handlers::auth_v2::prelogin).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/refresh", post(handlers::auth::refresh).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        // Plusieurs comptes dans le même navigateur : jetons des autres comptes en cookies HttpOnly.
        .route("/api/auth/accounts", get(handlers::accounts::list))
        .route("/api/auth/accounts/stash", post(handlers::accounts::stash).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/accounts/switch", post(handlers::accounts::switch).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/accounts/forget", post(handlers::accounts::forget).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/forgot-password", post(handlers::password_reset::forgot_password).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/reset-password", post(handlers::password_reset::reset_password).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/auth/pwned-range/:prefix", get(handlers::pwned::range))
        .route("/api/auth/panic", post(handlers::account_guard::panic_with_token).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/api/invites/:code", get(handlers::invites::get_invite_info))
        // Invitation amis (lecture publique — affiche le profil de l'invitant)
        .route("/api/friend-invite/:code", get(handlers::friends::get_friend_invite))
        // WebSocket
        .route("/ws", get(handlers::websocket::ws_handler))
        // Routes bot (sans JWT — auth via Bearer token)
        .route("/api/bot/messages", post(handlers::bots::bot_send_message).layer(DefaultBodyLimit::max(INBOUND_JSON_LIMIT)))
        .route("/api/bot/news", post(handlers::news::bot_post_news).layer(DefaultBodyLimit::max(INBOUND_JSON_LIMIT)))
        .route("/api/bots/:bot_id/commands", post(handlers::bots::register_bot_command).layer(DefaultBodyLimit::max(INBOUND_JSON_LIMIT)))
        // Webhook entrant (sans JWT — auth via token dans l'URL)
        .route("/api/webhook/:id/:token", post(handlers::webhooks::execute_webhook).layer(DefaultBodyLimit::max(INBOUND_JSON_LIMIT)))
        // Webhook GitHub entrant (sans JWT — push/PR/issues)
        .route("/api/github-webhook/:channel_id", post(handlers::webhooks::receive_github_webhook).layer(DefaultBodyLimit::max(INBOUND_JSON_LIMIT)))
        // Événements du SFU (sans JWT — signés par LiveKit, vérifiés dans le handler)
        .route("/api/livekit/webhook", post(handlers::voice::livekit_webhook).layer(DefaultBodyLimit::max(INBOUND_JSON_LIMIT)))
        // Rapports d'erreurs des applis (sans JWT : une page blanche n'est pas
        // connectée). Corps borné ici, limite par IP dans le handler.
        // Rapports CSP / Trusted Types du navigateur (sans JWT, corps borné, limite par IP).
        .route(
            "/api/security/csp-report",
            post(handlers::diagnostics::csp_report)
                .layer(DefaultBodyLimit::max(handlers::diagnostics::CSP_MAX_BODY)),
        )
        .route(
            "/api/diagnostics/report",
            post(handlers::diagnostics::submit_report)
                .layer(DefaultBodyLimit::max(handlers::diagnostics::MAX_BODY_BYTES)),
        )
        // Routes protégées
        .nest("/api", protected)
        // Fichiers uploadés — avec en-têtes de sécurité pour éviter le sniffing de type MIME
        .nest_service(
            "/uploads",
            tower::ServiceBuilder::new()
                // nosniff + téléchargement forcé de tout ce qui n'est pas image/vidéo/son.
                .layer(axum::middleware::from_fn(handlers::uploads::serve_headers))
                .layer(SetResponseHeaderLayer::if_not_present(
                    header::CONTENT_SECURITY_POLICY,
                    HeaderValue::from_static("default-src 'none'; sandbox"),
                ))
                // F8 : hors dossiers publics, URL signée exigée (404 sinon).
                .layer(axum::middleware::from_fn(upload_sign::guard))
                .service(ServeDir::new(upload_dir))
        )
}

/// Supprime les messages éphémères expirés comme une suppression normale :
/// MESSAGE_DELETE diffusé aux membres qui voient le salon et fichiers joints
/// effacés du disque. Le SELECT externe lit l'instantané d'avant le DELETE,
/// donc les pièces jointes (supprimées en cascade) y sont encore visibles.
async fn purge_expired_messages(state: &AppState) {
    use sqlx::Row;
    let rows = match sqlx::query(
        "WITH gone AS (
            DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < NOW()
            RETURNING id, channel_id
         )
         SELECT g.id, g.channel_id, a.url
         FROM gone g LEFT JOIN attachments a ON a.message_id = g.id"
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!("Purge des messages éphémères : {}", e);
            return;
        }
    };

    let mut deleted: std::collections::HashSet<(uuid::Uuid, uuid::Uuid)> = std::collections::HashSet::new();
    let mut urls = Vec::new();
    for r in &rows {
        deleted.insert((r.get("id"), r.get("channel_id")));
        if let Some(url) = r.get::<Option<String>, _>("url") {
            urls.push(url);
        }
    }
    handlers::uploads::remove_upload_files(state, urls);

    // ponytail: une requête d'audience par message ; regrouper par salon si la purge devient massive.
    for (message_id, channel_id) in deleted {
        let event = serde_json::json!({
            "type": "MESSAGE_DELETE",
            "message_id": message_id,
            "channel_id": channel_id,
        });
        state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    }
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

/// Durées de conservation annoncées sur la page de confidentialité : au-delà, la ligne disparaît.
/// Durée de rétention en jours, réglable par variable d'environnement (amélioration n° 14),
/// bornée à [1, 3650] ; valeur par défaut si absente ou invalide.
fn retention_days(var: &str, default: i64) -> i64 {
    std::env::var(var).ok().and_then(|v| v.trim().parse::<i64>().ok()).filter(|d| (1..=3650).contains(d)).unwrap_or(default)
}

async fn purge_retention(state: &AppState) {
    let sessions = retention_days("RETENTION_SESSIONS_DAYS", 30);
    let devices = retention_days("RETENTION_PUSH_DEVICES_DAYS", 60);
    let audit = retention_days("RETENTION_AUDIT_LOG_DAYS", 90);
    let reports = retention_days("RETENTION_REPORTS_DAYS", 90);
    let owned: Vec<(&str, String)> = vec![
        ("sessions inactives", format!("DELETE FROM user_sessions WHERE last_seen < NOW() - INTERVAL '{sessions} days'")),
        ("téléphones inactifs", format!("DELETE FROM push_devices WHERE last_seen_at < NOW() - INTERVAL '{devices} days'")),
        ("journal d'audit", format!("DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '{audit} days'")),
        ("signalements de MP traités", format!(
            "DELETE FROM dm_reports WHERE status IN ('resolved', 'dismissed') AND COALESCE(resolved_at, created_at) < NOW() - INTERVAL '{reports} days'")),
        ("signalements de messages traités", format!(
            "DELETE FROM message_reports WHERE status IN ('resolved', 'dismissed') AND created_at < NOW() - INTERVAL '{reports} days'")),
    ];
    for (what, sql) in &owned {
        if let Err(e) = sqlx::query(sql).execute(&state.db).await {
            tracing::warn!("Purge ({what}) : {e}");
        }
    }
    const PURGES: &[(&str, &str)] = &[
        ("jetons de session expirés", "DELETE FROM refresh_tokens WHERE expires_at < NOW()"),
        ("inscriptions non confirmées", "DELETE FROM pending_registrations WHERE expires_at < NOW()"),
    ];
    for (what, sql) in PURGES {
        if let Err(e) = sqlx::query(sql).execute(&state.db).await {
            tracing::warn!("Purge ({what}) : {e}");
        }
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
            u.email_enc,
            u.username,
            COUNT(un.msg_id) AS unread_count
        FROM unread un
        JOIN users u ON u.id = un.recipient_id
        JOIN email_preferences ep ON ep.user_id = un.recipient_id
        LEFT JOIN dm_read_receipts rr ON rr.dm_id = un.channel_id AND rr.user_id = un.recipient_id
        WHERE (rr.last_read_at IS NULL OR un.msg_at > rr.last_read_at)
          AND ep.dm_unread_notify = TRUE
          AND (ep.last_notified_at IS NULL OR ep.last_notified_at < NOW() - INTERVAL '24 hours')
        GROUP BY un.recipient_id, u.email_enc, u.username"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for row in &rows {
        let recipient_id: Uuid = row.get("recipient_id");
        // Adresse chiffrée au repos : déchiffrée seulement pour l'envoi.
        let Some(email) = row.get::<Option<String>, _>("email_enc")
            .and_then(|e| email_crypto::open(recipient_id, &e)) else { continue };
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
                tracing::debug!("Email DM digest envoyé ({} non-lus)", count);
            }
            Ok(false) => {
                tracing::debug!("SMTP non configuré, email ignoré");
            }
            Err(e) => {
                tracing::error!("Erreur envoi email DM : {}", privacy::redact_emails(&e.to_string()));
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

/// Pièces jointes : 500 Mo par fichier (gratuit ; Discord Nitro) + marge pour plusieurs pièces et
/// l'enveloppe multipart. Le multipart est lu au fil de l'eau (`uploads::save_field`).
const ATTACHMENT_BODY_LIMIT: usize = 1_100 * 1_048_576;

fn protected_routes(state: AppState) -> Router<AppState> {
    protected_route_table().route_layer(axum_middleware::from_fn_with_state(
        state,
        middleware::require_auth,
    ))
}

/// Routes `/api` authentifiées, sans la couche d'auth (qui porte l'état).
fn protected_route_table() -> Router<AppState> {
    Router::new()
        // Auth
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/change-password", post(handlers::auth::change_password))
        .route("/auth/upgrade-kdf", post(handlers::auth_v2::upgrade_kdf).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/auth/2fa/setup", post(handlers::totp::setup_totp))
        .route("/auth/2fa/confirm", post(handlers::totp::confirm_totp))
        .route("/auth/2fa/disable", post(handlers::totp::disable_totp))
        .route("/auth/2fa/backup-codes", post(handlers::totp::regenerate_backup_codes))
        .route("/auth/2fa/status", get(handlers::totp::totp_status))
        .route("/auth/passkeys", get(handlers::passkeys::list))
        .route("/auth/passkeys/register/start", post(handlers::passkeys::register_start))
        .route("/auth/passkeys/register/finish", post(handlers::passkeys::register_finish))
        .route("/auth/passkeys/:id", delete(handlers::passkeys::delete))
        .route("/auth/ws-ticket", post(handlers::auth::ws_ticket))
        // Users
        .route("/users/me", get(handlers::users::get_me))
        .route("/users/me/panic", post(handlers::account_guard::panic_self))
        .route("/users/me/dnd-schedule", get(dnd::get_schedule).put(dnd::put_schedule))
        .route("/users/me/sessions", get(handlers::auth::list_sessions))
        .route("/users/me/sessions/:id", delete(handlers::auth::revoke_session))
        .route("/users/me", patch(handlers::users::update_me))
        .route("/users/me", delete(handlers::users::delete_account))
        .route("/users/me/data-export", get(handlers::privacy::export_user_data))
        .route("/users/me/stats", get(handlers::users::get_my_stats))
        .route("/users/me/login-history", get(handlers::users::get_login_history))
        .route("/users/me/avatar", post(handlers::profile_custom::upload_avatar))
        .route("/users/me/banner", post(handlers::profile_custom::upload_banner))
        .route("/users/styles", get(handlers::profile_custom::name_styles))
        .route("/users/:id", get(handlers::users::get_user))
        // Profil (fiche) : authentifié depuis l'audit 2026-10-10 (avant : public, jeton optionnel jamais révoqué)
        .route("/users/:id/profile", get(handlers::users::get_user_profile))
        .route("/users/search", get(handlers::users::search_users))
        // Servers
        .route("/servers", get(handlers::servers::get_my_servers))
        .route("/servers", post(handlers::servers::create_server))
        .route("/servers/:id", get(handlers::servers::get_server))
        .route("/servers/:id", patch(handlers::servers::update_server))
        .route("/servers/:id", delete(handlers::servers::delete_server))
        .route("/servers/join/:code", post(handlers::servers::join_server))
        .route("/servers/import-discord", post(handlers::discord_import::start_import))
        .route("/servers/import-discord/:id", get(handlers::discord_import::get_import))
        .route("/servers/:server_id/discord-sync", get(handlers::discord_import::sync::get_config)
            .put(handlers::discord_import::sync::put_config)
            .delete(handlers::discord_import::sync::delete_config)
            .layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/discord-sync/run", post(handlers::discord_import::sync::run_now))
        .route("/servers/:server_id/discord-sync/categories", get(handlers::discord_import::sync::list_categories))
        .route("/servers/:id/leave", post(handlers::servers::leave_server))
        .route("/servers/:id/members", get(handlers::servers::get_members))
        .route("/servers/:server_id/members/:user_id/kick", post(handlers::servers::kick_member))
        .route("/servers/:server_id/members/:user_id", get(handlers::servers::get_member))
        .route("/servers/:server_id/members/:user_id/voice", patch(handlers::voice_moderation::moderate_voice))
        .route("/servers/:server_id/members/:user_id/ban", post(handlers::servers::ban_member))
        .route("/servers/:server_id/members/:user_id/nickname", patch(handlers::nicknames::set_member_nickname).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/icon", post(handlers::servers::upload_server_icon))
        .route("/servers/:server_id/banner", post(handlers::servers::upload_server_banner))
        // Apparence du serveur (135) : document validé (models/server_look.rs) et images de fond.
        .route("/servers/:server_id/look", put(handlers::server_look::put_look).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/look/image", post(handlers::server_look::upload_look_image))
        .route("/admin/stats", get(handlers::servers::get_admin_stats))
        .route("/admin/me", get(handlers::site_admin::admin_me))
        .route("/admin/overview", get(handlers::site_admin::overview))
        .route("/admin/users", get(handlers::site_admin::list_users))
        .route("/admin/users/:user_id", get(handlers::site_admin::user_detail))
        .route("/admin/users/:user_id/ban", post(handlers::site_admin::ban_user).delete(handlers::site_admin::unban_user))
        .route("/admin/users/:user_id/logout", post(handlers::site_admin::force_logout))
        .route("/admin/users/:user_id/patron", put(handlers::site_admin::set_patron))
        .route("/admin/servers", get(handlers::site_admin::list_servers))
        .route("/admin/servers/:server_id", delete(handlers::site_admin::delete_server_admin))
        .route("/admin/servers/:server_id/supervise", post(handlers::site_admin::supervise_server).delete(handlers::site_admin::end_supervision))
        .route("/admin/servers/:server_id/suspend", post(handlers::site_admin::suspend_server).delete(handlers::site_admin::unsuspend_server))
        .route("/admin/invites", get(handlers::site_admin::list_invites).post(handlers::site_admin::create_invite))
        .route("/admin/invites/:invite_id", delete(handlers::site_admin::revoke_invite))
        .route("/admin/settings", get(handlers::site_admin::get_settings).put(handlers::site_admin::put_settings))
        .route("/admin/audit", get(handlers::site_admin::audit_log))
        .route("/admin/diagnostics", get(handlers::diagnostics::list_reports))
        .route("/admin/security-events", get(security_events::admin_events))
        .route("/admin/health", get(health::admin_health))
        .route("/admin/dm-reports", get(handlers::reports::list_dm_reports))
        .route("/admin/dm-reports/:id", patch(handlers::reports::update_dm_report))
        .route("/admin/diagnostics/:id", get(handlers::diagnostics::get_report).delete(handlers::diagnostics::delete_report))
        .route("/servers/:server_id/stats", get(handlers::servers::get_server_stats))
        .route("/servers/:server_id/leaderboard", get(handlers::servers::get_leaderboard))
        .route("/servers/:server_id/tickets", get(handlers::tickets::list_tickets).post(handlers::tickets::create_ticket))
        .route("/servers/:server_id/tickets/:ticket_id", patch(handlers::tickets::update_ticket))
        .route("/servers/:server_id/ticket-categories", get(handlers::tickets::list_categories).post(handlers::tickets::create_category))
        // Channels
        .route("/servers/:id/channels", get(handlers::channels::get_channels))
        .route("/servers/:id/channels", post(handlers::channels::create_channel))
        .route("/servers/:server_id/categories", get(handlers::channels::get_categories).post(handlers::channels::create_category))
        .route("/servers/:server_id/categories/:category_id", delete(handlers::channels::delete_category).patch(handlers::categories::rename_category))
        .route("/servers/:server_id/categories/reorder", patch(handlers::categories::reorder_categories))
        .route("/servers/:server_id/categories/:category_id/permissions", get(handlers::categories::get_category_permissions))
        .route("/servers/:server_id/categories/:category_id/permissions/:target_id",
            put(handlers::categories::put_category_permission).delete(handlers::categories::delete_category_permission))
        .route("/servers/:server_id/categories/:category_id/sync-permissions", post(handlers::categories::sync_category_permissions))
        .route("/servers/:server_id/channels/:channel_id/voice-status", put(handlers::channel_extras::set_voice_status).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/channels/:channel_id/forum-settings", patch(handlers::channel_extras::set_forum_settings).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/invite-tracking", get(handlers::invite_tracking::list_invite_tracking))
        .route("/servers/:server_id/categories/:category_id/backup", get(handlers::channel_backup::backup_category))
        .route("/channels/:channel_id/backup", get(handlers::channel_backup::backup_channel))
        .route("/servers/:server_id/channels/:channel_id", patch(handlers::channels::update_channel))
        .route("/servers/:server_id/channels/:channel_id", delete(handlers::channels::delete_channel))
        .route("/servers/:server_id/channels/:channel_id/waiting-room", put(handlers::voice_waiting::set_waiting_room))
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
        // Forum channel tags
        .route("/channels/:channel_id/tags",
            get(handlers::channels::get_channel_tags)
            .post(handlers::channels::create_channel_tag))
        .route("/channels/:channel_id/tags/:tag_name", delete(handlers::channels::delete_channel_tag))
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
        .route("/reminders", get(handlers::reminders::list))
        .route("/reminders/:id", delete(handlers::reminders::cancel))
        .route("/messages/:id/report", post(handlers::reports::create_report))
        .route("/servers/:server_id/reports", get(handlers::reports::list_reports))
        .route("/servers/:server_id/reports/:report_id", patch(handlers::reports::update_report))
        .route("/servers/:server_id/reports/:report_id/action", post(handlers::reports::report_action))
        // Uploads
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/attachments", post(handlers::uploads::upload_file).layer(DefaultBodyLimit::max(ATTACHMENT_BODY_LIMIT)))
        // Roles
        .route("/servers/:server_id/roles", get(handlers::roles::get_roles))
        .route("/servers/:server_id/roles", post(handlers::roles::create_role))
        .route("/servers/:server_id/roles/order", patch(handlers::roles::reorder_roles))
        .route("/servers/:server_id/transfer", post(handlers::roles::transfer_ownership))
        .route("/servers/:server_id/roles/:role_id", patch(handlers::roles::update_role))
        .route("/servers/:server_id/roles/:role_id", delete(handlers::roles::delete_role))
        .route("/servers/:server_id/roles/:role_id/members", get(handlers::roles::get_role_members))
        .route("/servers/:server_id/members/:user_id/roles/:role_id", put(handlers::roles::assign_role))
        .route("/servers/:server_id/members/:user_id/roles/:role_id", delete(handlers::roles::remove_role))
        // Icônes de rôles (image téléversée ; l'emoji et le dégradé passent par le PATCH du rôle).
        // Salons médias : routes du forum (posts.media_url), aucune route dédiée.
        .route("/servers/:server_id/roles/:role_id/icon", post(handlers::roles::upload_role_icon))
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
        .route("/dms/:dm_id/messages/:msg_id/attachments", post(handlers::friends::upload_dm_attachment).layer(DefaultBodyLimit::max(ATTACHMENT_BODY_LIMIT)))
        .route("/dms/:dm_id/messages/:msg_id", patch(handlers::friends::edit_dm_message))
        .route("/dms/:dm_id/messages/:msg_id", delete(handlers::friends::delete_dm_message))
        .route("/dms/:dm_id/messages/:msg_id/reactions/:emoji", put(handlers::friends::toggle_dm_reaction))
        .route("/dms/:dm_id/messages/search", get(handlers::friends::search_dm_messages))
        // E2E encrypted DMs
        // E2E Public Key Management
        // Clé de compte E2E (docs/CHIFFREMENT-E2E.md §3)
        .route("/users/me/kdf", get(handlers::auth_v2::my_kdf))
        .route("/users/me/keys", get(handlers::user_keys::get_my_keys).put(handlers::user_keys::create_my_keys).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/users/me/keys/wrapped", put(handlers::user_keys::rewrap_my_key).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/users/me/keys/backup", put(handlers::user_keys::put_my_backup).delete(handlers::user_keys::delete_my_backup).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/users/me/keys/reset", post(handlers::user_keys::reset_my_key).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/users/:id/keys/public", get(handlers::user_keys::get_public_key))
        .route("/keys/log", get(key_log::list))
        .route("/keys/log/:seq", get(key_log::get))
        // Clés de conversation des MP et groupes chiffrés (docs/CHIFFREMENT-E2E.md §4.1)
        .route("/e2e/conversations/:kind/:id/keys", get(handlers::e2e_conv::get_my_envelopes).post(handlers::e2e_conv::post_envelopes).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/e2e/conversations/:kind/:id/keys/request", post(handlers::e2e_conv::request_keys))
        .route("/e2e/conversations/:kind/:id/keys/unreadable", post(handlers::e2e_conv::report_unreadable))
        .route("/e2e/conversations/:kind/:id/members", get(handlers::e2e_conv::get_members))
        .route("/e2e/legacy", get(handlers::e2e_conv::my_legacy_messages))
        // Salons chiffrés : rechiffrement de l'historique, clé de récupération du serveur (§10, §11)
        .route("/e2e/legacy/channels", get(handlers::e2e_legacy::my_legacy_items))
        .route("/e2e/legacy/channels/:channel_id", get(handlers::e2e_legacy::channel_legacy_items))
        .route("/e2e/legacy/servers/:server_id", get(handlers::e2e_legacy::server_legacy_items))
        .route("/e2e/legacy/channel/:item/:id", put(handlers::e2e_legacy::encrypt_legacy_item).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/e2e/server-key", get(handlers::e2e_server_key::get_server_key).put(handlers::e2e_server_key::put_server_key).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/e2e/server-key/recovery", put(handlers::e2e_server_key::put_recovery).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/e2e/server-key/owner", put(handlers::e2e_server_key::put_owner_wrapped).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/e2e/server-key/signature", put(handlers::e2e_server_key::put_signature).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/e2e/recovery", get(handlers::e2e_server_key::get_recovery))
        .route("/dms/:dm_id/messages/:msg_id/encrypt", put(handlers::e2e_conv::encrypt_dm_message).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/dms/groups/:group_id/messages/:msg_id/encrypt", put(handlers::e2e_conv::encrypt_group_message).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        // Unread
        .route("/unread", get(handlers::reads::get_unread_counts))
        .route("/unread/mark-all", post(handlers::reads::mark_all_read))
        .route("/channels/:channel_id/read", post(handlers::reads::mark_channel_read))
        .route("/servers/:server_id/read", post(handlers::reads::mark_server_read))
        .route("/dms/groups/:group_id/read", post(handlers::reads::mark_group_dm_read))
        .route("/channels/:channel_id/unread", post(handlers::unread::mark_channel_unread))
        .route("/dms/:dm_id/unread", post(handlers::unread::mark_dm_unread))
        // Threads
        .route("/servers/:server_id/channels/:channel_id/forum-uploads", post(handlers::uploads::forum_upload).layer(DefaultBodyLimit::max(ATTACHMENT_BODY_LIMIT)))
        .route("/uploads/sign", post(handlers::uploads::sign_urls))
        .route("/servers/:server_id/channels/:channel_id/threads", get(handlers::threads::list_threads))
        .route("/servers/:server_id/channels/:channel_id/threads", post(handlers::threads::create_thread))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages", get(handlers::threads::get_thread_messages))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages", post(handlers::threads::send_thread_message))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages/:msg_id", patch(handlers::threads::edit_thread_message))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages/:msg_id/reactions/:emoji", put(handlers::threads::toggle_thread_reaction))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages/:msg_id", delete(handlers::threads::delete_thread_message))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/messages/:msg_id/attachments", post(handlers::uploads::upload_thread_attachment).layer(DefaultBodyLimit::max(ATTACHMENT_BODY_LIMIT)))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id/ack", post(handlers::threads::ack_thread))
        .route("/servers/:server_id/channels/:channel_id/threads/:thread_id", patch(handlers::threads::archive_thread))
        // Forum
        .route("/servers/:server_id/channels/:channel_id/posts", get(handlers::forum::list_posts))
        .route("/servers/:server_id/channels/:channel_id/posts", post(handlers::forum::create_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", get(handlers::forum::get_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", patch(handlers::forum::update_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id", delete(handlers::forum::delete_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies", post(handlers::forum::reply_to_post))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies/:reply_id/reactions/:emoji", put(handlers::forum::toggle_reply_reaction))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies/:reply_id", patch(handlers::forum::edit_reply))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies/:reply_id", delete(handlers::forum::delete_reply))
        .route("/servers/:server_id/channels/:channel_id/posts/:post_id/replies/:reply_id/attachments", post(handlers::uploads::upload_forum_reply_attachment).layer(DefaultBodyLimit::max(ATTACHMENT_BODY_LIMIT)))
        // Custom Emojis
        .route("/servers/:server_id/emojis", get(handlers::emojis::list_emojis))
        .route("/servers/:server_id/emojis", post(handlers::emojis::create_emoji))
        .route("/servers/:server_id/emojis/:emoji_id", delete(handlers::emojis::delete_emoji))
        // Emojis de tous ses serveurs (utilisables partout, gratuitement) et emoji par identifiant
        .route("/users/me/emojis", get(handlers::emojis::my_emojis))
        .route("/emojis/:emoji_id", get(handlers::emojis::get_emoji))
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
        .route("/servers/:server_id/tags/:tag_id", delete(handlers::server_settings::delete_tag).patch(handlers::server_settings::update_tag))
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
        .route("/news", get(handlers::news::list_sites))
        .route("/news/latest", get(handlers::news::list_latest))
        .route("/news/sites/:site_id/articles", get(handlers::news::list_articles))
        .route("/friends/calls", get(handlers::friends::get_call_history))
        .route("/friends/groups", get(handlers::friends::list_friend_groups))
        .route("/friends/groups", post(handlers::friends::create_friend_group))
        .route("/friends/groups/:id", put(handlers::friends::update_friend_group))
        .route("/friends/groups/:id", delete(handlers::friends::delete_friend_group))
        .route("/friends/groups/:id/members", post(handlers::friends::add_to_group))
        .route("/friends/groups/:id/members/:user_id", delete(handlers::friends::remove_from_group))
        .route("/friends/:id/cancel", delete(handlers::friends::cancel_friend_request))
        .route("/friends/:id/nickname", get(handlers::friends::get_friend_nickname))
        .route("/friends/:id/nickname", put(handlers::friends::set_friend_nickname))
        .route("/friends/:id/notify", put(handlers::friends::set_online_notify))
        // Polls
        .route("/servers/:server_id/channels/:channel_id/polls", post(handlers::polls::create_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id", get(handlers::polls::get_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id/vote", post(handlers::polls::vote_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id/close", post(handlers::polls::close_poll))
        .route("/servers/:server_id/channels/:channel_id/polls/:poll_id/voters", get(handlers::polls::poll_voters))
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
        // GIF (GIPHY ou Wikimedia via le serveur : la clé ne quitte jamais le serveur)
        .route("/gifs/status", get(handlers::gifs::status))
        .route("/gifs/search", get(handlers::gifs::search))
        .route("/gifs/trending", get(handlers::gifs::trending))
        // Audit log
        .route("/servers/:server_id/audit", get(handlers::audit_search::get_audit_log))
        .route("/servers/:server_id/audit/facets", get(handlers::audit_search::get_audit_facets))
        .route("/servers/:server_id/automod/advanced", get(handlers::automod::get_advanced).put(handlers::automod::put_advanced).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/lockdown", put(handlers::automod::put_lockdown).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/stats/history", get(handlers::stats::history))
        .route("/servers/:server_id/levels", get(handlers::levels::get_settings).put(handlers::levels::put_settings).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/levels/leaderboard", get(handlers::levels::leaderboard))
        .route("/servers/:server_id/levels/members/:user_id", get(handlers::levels::member_card))
        .route("/servers/:server_id/starboard", get(handlers::community::get_starboard).put(handlers::community::put_starboard).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/welcome", get(handlers::community::get_welcome).put(handlers::community::put_welcome).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/tickets/settings", get(handlers::tickets::get_settings).put(handlers::tickets::put_settings).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/servers/:server_id/events.ics", get(handlers::event_tools::server_ics))
        .route("/servers/:server_id/events/:event_id/ics", get(handlers::event_tools::event_ics))
        // AutoMod
        .route("/servers/:server_id/automod", get(handlers::audit::get_automod))
        .route("/servers/:server_id/automod", put(handlers::audit::set_automod))
        .route("/servers/:server_id/automod/rules", get(handlers::audit::get_automod_rules))
        // Server discovery
        .route("/explore", get(handlers::directory::discover_servers))
        .route("/explore/:server_id", get(handlers::directory::server_profile))
        // Super réactions (074) et profil par serveur (075)
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/super-reactions/:emoji",
            put(handlers::super_reactions::add_super_reaction).delete(handlers::super_reactions::remove_super_reaction))
        .route("/users/me/super-reactions", get(handlers::super_reactions::get_quota))
        .route("/servers/:server_id/profile", patch(handlers::member_profile::update_profile))
        .route("/servers/:server_id/profile/:kind",
            post(handlers::member_profile::upload_profile_image).delete(handlers::member_profile::delete_profile_image))
        // Reaction detail
        .route("/reactions", get(handlers::audit::get_reaction_detail))
        // OG preview
        .route("/og", get(handlers::audit::og_preview))
        // Nickname
        .route("/servers/:server_id/nickname", patch(handlers::nicknames::set_nickname))
        // DM read receipts
        .route("/dms/:dm_id/read", post(handlers::audit::mark_dm_read))
        .route("/dms/:dm_id/read", get(handlers::audit::get_dm_read))
        // Feeds RSS/YouTube par canal
        .route("/servers/:server_id/channels/:channel_id/feeds", get(handlers::feeds::list_channel_feeds))
        .route("/servers/:server_id/channels/:channel_id/feeds", post(handlers::feeds::create_channel_feed))
        .route("/servers/:server_id/feeds/:feed_id", delete(handlers::feeds::delete_channel_feed))
        .route("/servers/:server_id/feeds/:feed_id/toggle", patch(handlers::feeds::toggle_channel_feed))
        // Historique des éditions de messages -- un seul segment (message_id) :
        // canal de serveur OU DM, résolu+vérifié dans le handler.
        .route("/messages/:msg_id/edits", get(handlers::messages::get_message_edits))
        // Forward message -- un seul segment (message_id) : le message source peut
        // venir d'un canal de serveur OU d'un DM, résolu+vérifié dans le handler.
        .route("/messages/:msg_id/forward", post(handlers::messages::forward_message))
        // Messages programmés
        .route("/servers/:server_id/channels/:channel_id/scheduled", post(handlers::scheduled::create_scheduled))
        .route("/servers/:server_id/channels/:channel_id/scheduled", get(handlers::scheduled::list_scheduled))
        .route("/scheduled/:scheduled_id", delete(handlers::scheduled::delete_scheduled).patch(handlers::scheduled::update_scheduled))
        .route("/scheduled", get(handlers::scheduled::list_all_scheduled))
        .route("/scheduled/:scheduled_id/send", post(handlers::scheduled::send_scheduled_now))
        // Messages éphémères (MP, groupes) et réglages de discussion des salons
        .route("/disappearing/:kind/:id", get(handlers::disappearing::get_setting).put(handlers::disappearing::set_setting))
        .route("/servers/:server_id/channels/:channel_id/messaging", put(handlers::disappearing::set_channel_messaging))
        // Brouillons chiffrés synchronisés
        .route("/drafts", get(handlers::drafts::list_drafts))
        .route("/drafts/:conv_id", put(handlers::drafts::put_draft).delete(handlers::drafts::delete_draft))
        // ICE config pour WebRTC (STUN + TURN)
        .route("/voice/ice-config", get(handlers::voice::get_ice_config))
        // Bootstrap REST de l'état vocal (N11) + télémétrie WebRTC (F9)
        .route("/voice/state", get(handlers::voice::get_voice_state))
        .route("/voice/telemetry", post(handlers::voice::post_voice_telemetry))
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
        .route("/user/connected-accounts/:platform", delete(handlers::user_settings::delete_connected_account).patch(handlers::connections::set_visibility))
        .route("/user/notification-overrides", get(handlers::user_settings::get_notification_overrides))
        .route("/user/notification-overrides", post(handlers::user_settings::set_notification_override))
        .route("/user/notification-overrides", delete(handlers::notif_center::reset_notif))
        .route("/user/notification-overrides/everywhere", put(handlers::notif_center::set_level_everywhere))
        .route("/user/notif-center", get(handlers::notif_center::get_notif_center))
        .route("/user/category-notif/:category_id", post(handlers::notif_center::set_category_notif))
        .route("/user/channel-notif", get(handlers::user_settings::get_all_channel_notification_overrides))
        .route("/user/channel-notif/:channel_id", get(handlers::user_settings::get_channel_notification_override))
        .route("/user/channel-notif/:channel_id", post(handlers::user_settings::set_channel_notification_override))
        .route("/users/me/server-layout", get(handlers::user_settings::get_server_layout).put(handlers::user_settings::put_server_layout).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/users/me/news-prefs", get(handlers::news::get_news_prefs).put(handlers::news::put_news_prefs).layer(DefaultBodyLimit::max(SMALL_JSON_LIMIT)))
        .route("/user/theme", get(handlers::user_settings::get_theme).put(handlers::user_settings::put_theme))
        .route("/user/theme-studio", get(handlers::user_settings::get_theme_studio).put(handlers::user_settings::put_theme_studio).layer(DefaultBodyLimit::max(handlers::user_settings::MAX_THEME_STUDIO_BYTES + 4096)))
        .route("/user/keybindings", get(handlers::user_settings::get_keybindings))
        .route("/user/keybindings", post(handlers::user_settings::set_keybinding))
        .route("/user/keybindings", delete(handlers::user_settings::reset_all_keybindings))
        .route("/user/keybindings/:action", delete(handlers::user_settings::reset_keybinding))
        // Email preferences
        .route("/user/email-prefs", get(handlers::user_settings::get_email_prefs))
        .route("/user/email-prefs", put(handlers::user_settings::update_email_prefs))
        // Soundboard
        .route("/servers/:id/soundboard", get(handlers::soundboard::list_sounds))
        .route("/servers/:id/soundboard", post(handlers::soundboard::upload_sound))
        .route("/servers/:server_id/soundboard/:sound_id", delete(handlers::soundboard::delete_sound))
        .route("/users/me/soundboard", get(handlers::soundboard::my_sounds))
        .route("/users/me/sounds", get(handlers::soundboard::list_personal).post(handlers::soundboard::upload_personal))
        .route("/users/me/sounds/:sound_id", delete(handlers::soundboard::delete_personal))
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
        // Web Push
        .route("/push/vapid-public-key", get(push::get_public_key))
        .route("/push/subscribe", post(push::subscribe))
        .route("/push/unsubscribe", post(push::unsubscribe))
        // Push mobile (app Android, via Expo)
        .route("/push/devices", post(mobile_push::register_device))
        .route("/push/devices/:token", delete(mobile_push::unregister_device))
        .route("/users/:id/mutual-servers", get(handlers::users::get_mutual_servers))
        // Lot « Profil et social » : statut riche, badges, anniversaires, favoris
        .route("/users/:id/social", get(handlers::social::get_user_social))
        .route("/users/me/birthday", get(handlers::birthdays::get_my_birthday).put(handlers::birthdays::set_my_birthday))
        .route("/servers/:server_id/birthday-channel", get(handlers::birthdays::get_server_channel).put(handlers::birthdays::set_server_channel))
        .route("/friends/:id/favorite", put(handlers::social::set_favorite))
        .route("/friends/groups/order", put(handlers::social::order_groups))
        // User status + activity feed
        .route("/user/status", patch(handlers::users::update_status))
        .route("/activity-feed", get(handlers::users::get_activity_feed))
        .route("/servers/discover", get(handlers::servers::discover_servers))
        // DM extras (mute, archive, pins)
        .route("/dms/:id/pins", get(handlers::dm_extras::get_dm_pins))
        .route("/dms/:id/pins/:msg_id", post(handlers::dm_extras::pin_dm_message))
        .route("/dms/:id/pins/:msg_id", delete(handlers::dm_extras::unpin_dm_message))
        // Custom Stickers
        .route("/servers/:server_id/stickers", get(handlers::stickers::list_stickers))
        .route("/servers/:server_id/stickers", post(handlers::stickers::create_sticker))
        .route("/servers/:server_id/stickers/:sticker_id", delete(handlers::stickers::delete_sticker))
        .route("/users/me/stickers", get(handlers::stickers::my_stickers))
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
        .route("/dms/groups/:group_id/messages/:msg_id/pin", put(handlers::group_dms::toggle_group_dm_pin))
        .route("/dms/groups/:group_id/pins", get(handlers::group_dms::list_group_dm_pins))
        .route("/dms/groups/:group_id/messages/:msg_id/attachments", post(handlers::group_dms::upload_group_dm_attachment).layer(DefaultBodyLimit::max(ATTACHMENT_BODY_LIMIT)))
        .route("/dms/groups/:group_id/messages/search", get(handlers::group_dms::search_group_dm_messages))
        .route("/dms/groups/:group_id/leave", post(handlers::group_dms::leave_group_dm))
        .route("/dms/groups/:group_id/members", post(handlers::group_dms::add_group_dm_member))
        .route("/dms/groups/:group_id/members/:user_id", delete(handlers::group_dms::remove_group_dm_member))
        .route("/dms/groups/:group_id/rename", patch(handlers::group_dms::rename_group_dm))
        .route("/dms/groups/:group_id/owner", patch(handlers::group_dms::transfer_group_dm_owner))
        // ── Salons d'annonces suivis (crosspost) et onboarding de serveur ──
        .route("/channels/:channel_id/follow", post(handlers::announcements::follow_channel))
        .route("/channels/:channel_id/follow-targets", get(handlers::announcements::follow_targets))
        .route("/channels/:channel_id/follows", get(handlers::announcements::list_follows))
        .route("/channel-follows/:follow_id", delete(handlers::announcements::delete_follow))
        .route("/servers/:server_id/channels/:channel_id/messages/:msg_id/crosspost", post(handlers::announcements::crosspost_message))
        .route("/servers/:id/onboarding", get(handlers::onboarding::get_onboarding).put(handlers::onboarding::put_onboarding))
        .route("/servers/:id/onboarding/answers", put(handlers::onboarding::put_answers))
        .route("/friends/blocked", get(handlers::friends::get_blocked))
        .route("/friends/block/:user_id", post(handlers::friends::block_user))
        .route("/friends/block/:user_id", delete(handlers::friends::unblock_user))
}
