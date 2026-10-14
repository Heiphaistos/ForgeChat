//! Correctifs serveur (invitations, événements, favoris) contre un vrai PostgreSQL et Redis
//! (ignorés par défaut) : `cargo test -- --ignored srv2_`

use crate::{error::AppError, middleware::auth::Claims, state::AppState};
use axum::{extract::{ConnectInfo, Path, State}, Extension, Json};
use sqlx::PgPool;
use uuid::Uuid;

async fn setup() -> (AppState, PgPool) {
    let db_url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let redis_url = std::env::var("FORGECHAT_TEST_REDIS_URL").expect("FORGECHAT_TEST_REDIS_URL");
    std::env::set_var("DATABASE_URL", &db_url);
    std::env::set_var("REDIS_URL", &redis_url);
    std::env::set_var("JWT_SECRET", "secret-de-test-assez-long-pour-demarrer-0123456789");
    let config = crate::config::Config::from_env().expect("config");
    let db = PgPool::connect(&db_url).await.expect("db");
    sqlx::migrate!("./migrations").run(&db).await.expect("migrations");
    let redis = redis::Client::open(redis_url).expect("redis url").get_connection_manager().await.expect("redis");
    (AppState::new(db.clone(), redis, config).await, db)
}

async fn user(db: &PgPool) -> Uuid {
    let tag = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
        .bind(&tag[..20]).bind(format!("{tag}@test.local")).fetch_one(db).await.expect("user")
}

fn claims(sub: Uuid) -> Claims {
    Claims { sub, exp: i64::MAX, iss: String::new(), iat: 0, sid: None }
}

#[tokio::test]
#[ignore]
async fn srv2_invite_info_rate_limited() {
    let (state, _db) = setup().await;
    let mut h = axum::http::HeaderMap::new();
    h.insert("x-real-ip", format!("10.{}.{}.1", rand::random::<u8>(), rand::random::<u8>()).parse().unwrap());
    let addr: std::net::SocketAddr = "127.0.0.1:1".parse().unwrap();
    for _ in 0..60 {
        let r = crate::handlers::invites::get_invite_info(State(state.clone()), ConnectInfo(addr), h.clone(), Path("inexistant-xyz".into())).await;
        assert!(matches!(r, Err(AppError::NotFound(_))));
    }
    let r = crate::handlers::invites::get_invite_info(State(state.clone()), ConnectInfo(addr), h, Path("inexistant-xyz".into())).await;
    assert!(matches!(r, Err(AppError::TooManyRequests)));
}

#[tokio::test]
#[ignore]
async fn srv2_event_max_attendees_atomic() {
    let (state, db) = setup().await;
    let owner = user(&db).await;
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('ev', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.expect("server");
    let ev: Uuid = sqlx::query_scalar(
        "INSERT INTO server_events (server_id, name, start_time, creator_id, max_attendees)
         VALUES ($1, 'e', NOW() + interval '1 day', $2, 3) RETURNING id")
        .bind(s).bind(owner).fetch_one(&db).await.expect("event");
    let mut tasks = Vec::new();
    for _ in 0..12 {
        let u = user(&db).await;
        sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)").bind(u).bind(s).execute(&db).await.expect("member");
        let st = state.clone();
        tasks.push(tokio::spawn(async move {
            crate::handlers::events::attend_event(Extension(claims(u)), Path(ev), State(st),
                Json(crate::handlers::events::AttendEvent { status: "going".into() })).await.is_ok()
        }));
    }
    let mut ok = 0;
    for t in tasks { if t.await.unwrap() { ok += 1; } }
    let going: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM event_attendees WHERE event_id=$1 AND status='going'")
        .bind(ev).fetch_one(&db).await.unwrap();
    assert_eq!((ok, going), (3, 3));
}

#[tokio::test]
#[ignore]
async fn srv2_saved_hides_content_after_access_loss() {
    let (state, db) = setup().await;
    let (owner, a) = (user(&db).await, user(&db).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('sv', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.expect("server");
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', $2, TRUE)")
        .bind(s).bind(crate::models::role::Permissions::VIEW_CHANNEL | crate::models::role::Permissions::READ_HISTORY)
        .execute(&db).await.expect("everyone");
    for (m, o) in [(owner, true), (a, false)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)").bind(m).bind(s).bind(o).execute(&db).await.expect("member");
    }
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'g') RETURNING id")
        .bind(s).fetch_one(&db).await.expect("channel");
    let msg: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'secret') RETURNING id")
        .bind(chan).bind(owner).fetch_one(&db).await.expect("message");
    sqlx::query("INSERT INTO saved_messages (user_id, message_id, channel_id, server_id, content) VALUES ($1,$2,$3,$4,'secret')")
        .bind(a).bind(msg).bind(chan).bind(s).execute(&db).await.expect("saved");
    let get = || crate::handlers::saved::get_saved(State(state.clone()), Extension(claims(a)));
    let Json(v) = get().await.expect("get");
    assert_eq!(v[0].content.as_deref(), Some("secret"));
    // Exclusion : l'entrée reste, sans contenu.
    sqlx::query("DELETE FROM server_members WHERE user_id=$1 AND server_id=$2").bind(a).bind(s).execute(&db).await.expect("kick");
    let Json(v) = get().await.expect("get");
    assert_eq!(v.len(), 1);
    assert!(v[0].content.is_none() && v[0].enc.is_none() && v[0].attachments.is_empty() && v[0].channel_name.is_none());
}
