//! Correctifs de l'audit de sécurité du 2026-10-10 contre un vrai PostgreSQL et un vrai Redis
//! (ignorés par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... FORGECHAT_TEST_REDIS_URL=redis://... cargo test -- --ignored security_`

use super::*;
use crate::middleware::auth::{token_state, TokenState};
use sqlx::PgPool;

async fn setup() -> (AppState, PgPool) {
    let db_url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let redis_url = std::env::var("FORGECHAT_TEST_REDIS_URL").expect("FORGECHAT_TEST_REDIS_URL");
    std::env::set_var("DATABASE_URL", &db_url);
    std::env::set_var("REDIS_URL", &redis_url);
    std::env::set_var("JWT_SECRET", "secret-de-test-assez-long-pour-demarrer-0123456789");
    let config = crate::config::Config::from_env().expect("config");
    let db = PgPool::connect(&db_url).await.expect("db");
    sqlx::migrate!("./migrations").run(&db).await.expect("migrations");
    let redis = redis::Client::open(redis_url).expect("redis url").get_multiplexed_async_connection().await.expect("redis");
    (AppState::new(db.clone(), redis, config).await, db)
}

async fn user(db: &PgPool) -> Uuid {
    let tag = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
        .bind(&tag[..20])
        .bind(format!("{tag}@test.local"))
        .fetch_one(db)
        .await
        .expect("user")
}

#[tokio::test]
#[ignore]
async fn security_audit_2026_10_10() {
    let (state, db) = setup().await;
    let (owner, a, b) = (user(&db).await, user(&db).await, user(&db).await);

    // Serveur, salon privé pour b (VIEW_CHANNEL refusé par surcharge).
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('audit', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.expect("server");
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', $2, TRUE)")
        .bind(s).bind(Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES | Permissions::READ_HISTORY)
        .execute(&db).await.expect("everyone");
    for (m, is_owner) in [(owner, true), (a, false), (b, false)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(is_owner).execute(&db).await.expect("member");
    }
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'prive') RETURNING id")
        .bind(s).fetch_one(&db).await.expect("channel");
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, deny) VALUES ($1, $2, 'member', $3)")
        .bind(chan).bind(b).bind(Permissions::VIEW_CHANNEL).execute(&db).await.expect("override");

    // F3 : salon masqué = ni vocal, ni scène, ni réactions.
    assert!(visible_channel(&state, a, chan).await.is_some());
    assert!(visible_channel(&state, b, chan).await.is_none());

    // F4 : historique d'éditions / rappels d'un message d'un salon masqué.
    let msg: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'secret') RETURNING id")
        .bind(chan).bind(a).fetch_one(&db).await.expect("message");
    assert!(crate::handlers::messages::channel_message_visible(&state, a, msg).await.expect("visible"));
    assert!(crate::handlers::messages::channel_message_visible(&state, b, msg).await.is_err());
    assert!(!crate::handlers::messages::channel_message_visible(&state, b, Uuid::new_v4()).await.expect("absent"));

    // F9 : ticket WebSocket à usage unique.
    let ticket = Uuid::new_v4().simple().to_string();
    {
        use redis::AsyncCommands;
        let mut r = state.redis.lock().await;
        let _: () = r.set_ex(format!("ws_ticket:{ticket}"), a.to_string(), 30).await.expect("ticket");
    }
    assert_eq!(consume_ticket(&state, &ticket).await, Ok(Some((a, None))));
    assert_eq!(consume_ticket(&state, &ticket).await, Ok(None));

    // M6 / F6 : révocation vue par la revérification périodique des sockets.
    let now = chrono::Utc::now().timestamp();
    assert_eq!(token_state(&state, a, now - 10, None, None).await, TokenState::Valid);
    crate::middleware::auth::revoke_all_tokens(&state, a).await;
    assert_eq!(token_state(&state, a, now - 10, None, None).await, TokenState::Revoked);
    assert_eq!(token_state(&state, a, now + 5, None, None).await, TokenState::Valid);

    // M6 : fermeture des sockets d'un compte (signal interne).
    let mut rx = {
        let mut clients = state.clients.write().await;
        let tx = clients.entry(b).or_insert_with(|| tokio::sync::broadcast::channel::<String>(8).0);
        tx.subscribe()
    };
    state.disconnect_user_sockets(b).await;
    assert_eq!(rx.recv().await.expect("signal"), crate::state::WS_CLOSE);

    // F2 : DM_CALL_ACCEPT sans appel en sonnerie, puis avec, puis bloqué.
    let (u1, u2) = if a < b { (a, b) } else { (b, a) };
    sqlx::query("INSERT INTO dm_channels (user1_id, user2_id) VALUES ($1, $2)").bind(u1).bind(u2).execute(&db).await.expect("dm");
    let answered = |db: PgPool| async move {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM call_history WHERE caller_id=$1 AND callee_id=$2 AND status='answered'")
            .bind(b).bind(a).fetch_one(&db).await.expect("count")
    };
    accept_dm_call(&state, a, Uuid::new_v4(), "a", b, &serde_json::Value::Null, true).await;
    assert_eq!(answered(db.clone()).await, 0, "aucun appel en sonnerie : rien à décrocher");
    sqlx::query("INSERT INTO call_history (caller_id, callee_id, status) VALUES ($1, $2, 'ringing')")
        .bind(b).bind(a).execute(&db).await.expect("ringing");
    sqlx::query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)").bind(a).bind(b).execute(&db).await.expect("block");
    accept_dm_call(&state, a, Uuid::new_v4(), "a", b, &serde_json::Value::Null, true).await;
    assert_eq!(answered(db.clone()).await, 0, "bloqué : pas d'appel");
    sqlx::query("DELETE FROM blocks WHERE blocker_id=$1").bind(a).execute(&db).await.expect("unblock");
    accept_dm_call(&state, a, Uuid::new_v4(), "a", b, &serde_json::Value::Null, true).await;
    assert_eq!(answered(db.clone()).await, 1);
}

/// Phase 2, point 1 : révoquer UNE session coupe ses jetons d'accès et ses sockets, pas celles
/// des autres appareils ; « tout déconnecter » coupe tout.
#[tokio::test]
#[ignore]
async fn security_session_revocation_closes_sockets() {
    let (state, db) = setup().await;
    let u = user(&db).await;
    let mut sids = Vec::new();
    for i in 0..2 {
        let sid: Uuid = sqlx::query_scalar(
            "INSERT INTO user_sessions (user_id, refresh_token_hash, device_info) VALUES ($1, $2, 'test') RETURNING id",
        )
        .bind(u).bind(format!("h{i}-{u}")).fetch_one(&db).await.expect("session");
        sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')")
            .bind(u).bind(format!("h{i}-{u}")).execute(&db).await.expect("refresh");
        sids.push(sid);
    }
    let (s1, s2) = (sids[0], sids[1]);

    // Ticket porteur de la session.
    let ticket = Uuid::new_v4().simple().to_string();
    {
        use redis::AsyncCommands;
        let mut r = state.redis.lock().await;
        let _: () = r.set_ex(format!("ws_ticket:{ticket}"), format!("{u}:{s1}"), 30).await.expect("ticket");
    }
    assert_eq!(consume_ticket(&state, &ticket).await, Ok(Some((u, Some(s1)))));

    let mut rx = {
        let mut clients = state.clients.write().await;
        clients.entry(u).or_insert_with(|| tokio::sync::broadcast::channel::<String>(8).0).subscribe()
    };
    let iat = chrono::Utc::now().timestamp() - 5;
    crate::handlers::auth::end_session(&state, u, s1).await.expect("end");
    let sig = rx.recv().await.expect("signal");
    assert_eq!(close_signal(&sig, Some(s1)), Some(true), "socket de la session révoquée fermée");
    assert_eq!(close_signal(&sig, Some(s2)), Some(false), "autre appareil : ignoré, pas transmis");
    assert_eq!(close_signal(&sig, None), Some(false));
    assert_eq!(close_signal("{\"type\":\"X\"}", Some(s1)), None);
    assert_eq!(token_state(&state, u, iat, Some(s1), None).await, TokenState::Revoked);
    assert_eq!(token_state(&state, u, iat, Some(s2), None).await, TokenState::Valid);
    let left: Vec<String> = sqlx::query_scalar("SELECT token_hash FROM refresh_tokens WHERE user_id=$1")
        .bind(u).fetch_all(&db).await.expect("left");
    assert_eq!(left, vec![format!("h1-{u}")]);

    // Tout déconnecter.
    state.disconnect_user_sockets(u).await;
    assert_eq!(close_signal(&rx.recv().await.expect("signal"), Some(s2)), Some(true));
}

/// F8 : signature à la demande (POST /api/uploads/sign) seulement pour qui peut lire le fichier.
#[tokio::test]
#[ignore]
async fn security_upload_sign_access() {
    use crate::handlers::uploads::can_read_upload;
    let (state, db) = setup().await;
    let (owner, a, b) = (user(&db).await, user(&db).await, user(&db).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('upl', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.expect("server");
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', $2, TRUE)")
        .bind(s).bind(Permissions::VIEW_CHANNEL | Permissions::READ_HISTORY).execute(&db).await.expect("everyone");
    for (m, is_owner) in [(owner, true), (a, false), (b, false)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(is_owner).execute(&db).await.expect("member");
    }
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'prive') RETURNING id")
        .bind(s).fetch_one(&db).await.expect("channel");
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, deny) VALUES ($1, $2, 'member', $3)")
        .bind(chan).bind(b).bind(Permissions::VIEW_CHANNEL).execute(&db).await.expect("override");
    let msg: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'x') RETURNING id")
        .bind(chan).bind(a).fetch_one(&db).await.expect("message");
    let att = |col: &'static str, owner_id: Uuid| {
        let db = db.clone();
        async move {
            let url = format!("/uploads/{}.enc", Uuid::new_v4());
            sqlx::query(&format!("INSERT INTO attachments ({col}, filename, content_type, size, url) VALUES ($1, 'f', 'application/octet-stream', 1, $2)"))
                .bind(owner_id).bind(&url).execute(&db).await.expect("attachment");
            url
        }
    };
    let in_channel = att("message_id", msg).await;
    let forum_media = att("channel_id", chan).await;
    assert!(can_read_upload(&state, a, &in_channel).await.unwrap());
    assert!(!can_read_upload(&state, b, &in_channel).await.unwrap(), "salon masqué");
    assert!(can_read_upload(&state, a, &forum_media).await.unwrap());
    assert!(!can_read_upload(&state, b, &forum_media).await.unwrap());
    assert!(!can_read_upload(&state, a, "/uploads/inconnu.enc").await.unwrap());

    let (u1, u2) = if a < owner { (a, owner) } else { (owner, a) };
    let dm: Uuid = sqlx::query_scalar("INSERT INTO dm_channels (user1_id, user2_id) VALUES ($1, $2) RETURNING id")
        .bind(u1).bind(u2).fetch_one(&db).await.expect("dm");
    let dm_msg: Uuid = sqlx::query_scalar("INSERT INTO dm_messages (dm_channel_id, sender_id, content) VALUES ($1, $2, 'x') RETURNING id")
        .bind(dm).bind(a).fetch_one(&db).await.expect("dm message");
    let in_dm = att("dm_message_id", dm_msg).await;
    assert!(can_read_upload(&state, owner, &in_dm).await.unwrap());
    assert!(!can_read_upload(&state, b, &in_dm).await.unwrap(), "hors du MP");
}
