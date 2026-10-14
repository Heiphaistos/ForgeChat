//! Réglages d'une conversation privée (sourdine temporaire, épingle, fermeture) contre un
//! vrai PostgreSQL et Redis (ignorés par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... FORGECHAT_TEST_REDIS_URL=redis://... cargo test -- --ignored dm_settings_`

use super::*;
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
    let redis = redis::Client::open(redis_url).expect("redis url").get_connection_manager().await.expect("redis");
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

fn claims(sub: Uuid) -> Extension<Claims> {
    Extension(Claims { sub, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None })
}

async fn listed(state: &AppState, me: Uuid, id: Uuid) -> Option<serde_json::Value> {
    let Json(list) = get_dms(State(state.clone()), claims(me)).await.expect("dms");
    list.into_iter().find(|d| d["id"] == serde_json::json!(id))
}

async fn patch(state: &AppState, me: Uuid, dm: Uuid, body: serde_json::Value) -> Result<()> {
    patch_dm_settings(State(state.clone()), claims(me), Path(dm), Json(body)).await.map(|_| ())
}

#[tokio::test]
#[ignore]
async fn dm_settings_mute_pin_close() {
    let (state, db) = setup().await;
    let (a, b) = (user(&db).await, user(&db).await);
    let Json(opened) = open_dm(State(state.clone()), claims(a), Path(b)).await.expect("open");
    let dm: Uuid = serde_json::from_value(opened["dm_id"].clone()).expect("dm_id");

    // Sourdine d'une heure : muette avec échéance ; durée hors liste refusée.
    patch(&state, a, dm, serde_json::json!({ "muted": true, "mute_minutes": 60 })).await.expect("mute");
    let d = listed(&state, a, dm).await.expect("listed");
    assert_eq!(d["is_muted"], true);
    assert!(d["muted_until"].is_string());
    assert!(patch(&state, a, dm, serde_json::json!({ "muted": true, "mute_minutes": 7 })).await.is_err());
    // Échéance passée : plus muette.
    sqlx::query("UPDATE dm_user_settings SET muted_until = NOW() - INTERVAL '1 minute' WHERE dm_channel_id=$1")
        .bind(dm).execute(&db).await.expect("expire");
    assert_eq!(listed(&state, a, dm).await.expect("listed")["is_muted"], false);
    // Sans durée : jusqu'à réactivation ; un autre réglage ne touche pas la sourdine.
    patch(&state, a, dm, serde_json::json!({ "muted": true })).await.expect("mute forever");
    patch(&state, a, dm, serde_json::json!({ "pinned": true })).await.expect("pin");
    let d = listed(&state, a, dm).await.expect("listed");
    assert_eq!((d["is_muted"].clone(), d["is_pinned"].clone(), d["muted_until"].clone()), (true.into(), true.into(), serde_json::Value::Null));

    // Fermée : absente de la liste jusqu'au prochain message, et pour soi seulement.
    patch(&state, a, dm, serde_json::json!({ "closed": true })).await.expect("close");
    assert!(listed(&state, a, dm).await.is_none());
    sqlx::query("INSERT INTO dm_messages (dm_channel_id, sender_id, content, created_at) VALUES ($1, $2, 'x', NOW() + INTERVAL '1 second')")
        .bind(dm).bind(b).execute(&db).await.expect("message");
    assert!(listed(&state, a, dm).await.is_some());
    // Fermée puis rouverte par « Envoyer un message ».
    patch(&state, a, dm, serde_json::json!({ "closed": true })).await.expect("close again");
    sqlx::query("UPDATE dm_user_settings SET closed_at = NOW() + INTERVAL '1 minute' WHERE dm_channel_id=$1")
        .bind(dm).execute(&db).await.expect("close after message");
    assert!(listed(&state, a, dm).await.is_none());
    let _ = open_dm(State(state.clone()), claims(a), Path(b)).await.expect("reopen");
    assert!(listed(&state, a, dm).await.is_some());

    // Un tiers ne règle pas la conversation des autres.
    let c = user(&db).await;
    assert!(patch(&state, c, dm, serde_json::json!({ "pinned": true })).await.is_err());
}

async fn send(state: &AppState, me: Uuid, dm: Uuid) -> Result<()> {
    send_dm(State(state.clone()), claims(me), Path(dm), Json(serde_json::json!({ "content": "salut" }))).await.map(|_| ())
}

#[tokio::test]
#[ignore]
async fn dm_send_blocked_both_ways_and_throttled() {
    let (state, db) = setup().await;
    let (a, b) = (user(&db).await, user(&db).await);
    let Json(opened) = open_dm(State(state.clone()), claims(a), Path(b)).await.expect("open");
    let dm: Uuid = serde_json::from_value(opened["dm_id"].clone()).expect("dm_id");

    // Blocage dans un sens comme dans l'autre : ni le bloqué ni le bloqueur n'écrivent.
    sqlx::query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)").bind(a).bind(b).execute(&db).await.expect("block");
    assert!(matches!(send(&state, b, dm).await, Err(AppError::Forbidden)));
    assert!(matches!(send(&state, a, dm).await, Err(AppError::Forbidden)));
    sqlx::query("DELETE FROM blocks").execute(&db).await.expect("unblock");
    // Sans blocage la garde laisse passer (le clair est ensuite refusé : conversation chiffrée par défaut).
    assert!(!matches!(send(&state, a, dm).await, Err(AppError::Forbidden | AppError::TooManyRequests)));

    // Anti-spam : 5 messages par fenêtre de 3 s, le 6e est refusé.
    let mut refused = false;
    for _ in 0..6 {
        refused |= matches!(send(&state, a, dm).await, Err(AppError::TooManyRequests));
    }
    assert!(refused, "le 6e message de la fenêtre doit être refusé");
}
