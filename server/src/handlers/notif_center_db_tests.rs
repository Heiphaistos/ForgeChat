//! Centre de notifications contre un vrai PostgreSQL et un vrai Redis (ignoré par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... FORGECHAT_TEST_REDIS_URL=redis://... cargo test -- --ignored notif_center_`

use super::*;
use crate::models::role::Permissions;
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

async fn mentioned(db: &PgPool, msg: Uuid) -> Vec<Uuid> {
    sqlx::query_scalar("SELECT user_id FROM message_mentions WHERE message_id = $1 ORDER BY user_id")
        .bind(msg).fetch_all(db).await.unwrap()
}

#[tokio::test]
#[ignore]
async fn notif_center_categories_roles_and_reset() {
    let (state, db) = setup().await;
    let (owner, a, b, outsider) = (user(&db).await, user(&db).await, user(&db).await, user(&db).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('notif', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', $2, TRUE)")
        .bind(s).bind(Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES | Permissions::READ_HISTORY)
        .execute(&db).await.unwrap();
    for (m, is_owner) in [(owner, true), (a, false), (b, false)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(is_owner).execute(&db).await.unwrap();
    }
    let role: Uuid = sqlx::query_scalar("INSERT INTO roles (server_id, name, mentionable) VALUES ($1, 'equipe', TRUE) RETURNING id")
        .bind(s).fetch_one(&db).await.unwrap();
    for m in [a, b] {
        sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(role).execute(&db).await.unwrap();
    }
    let cat: Uuid = sqlx::query_scalar("INSERT INTO categories (server_id, name) VALUES ($1, 'jeux') RETURNING id")
        .bind(s).fetch_one(&db).await.unwrap();
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, category_id, name) VALUES ($1, $2, 'general') RETURNING id")
        .bind(s).bind(cat).fetch_one(&db).await.unwrap();

    // Catégorie : membre seulement, niveau validé, « inherit » supprime la ligne.
    let set_cat = |who: Uuid, level: &str| set_category_notif(claims(who), State(state.clone()), Path(cat), Json(SetLevel { level: level.into() }));
    assert!(set_cat(outsider, "nothing").await.is_err(), "non-membre refusé");
    assert!(set_cat(a, "bavard").await.is_err(), "niveau invalide");
    let _ = set_cat(a, "nothing").await.unwrap();
    let Json(center) = get_notif_center(claims(a), State(state.clone())).await.unwrap();
    assert_eq!(center.categories.len(), 1);
    assert_eq!(center.categories[0].channel_ids, vec![chan]);
    assert_eq!(center.categories[0].level, "nothing");

    // Ignorer les mentions de rôles : `a` n'est plus mentionné par @equipe, `b` si.
    let body: crate::handlers::user_settings::SetNotifOverride = serde_json::from_value(serde_json::json!({
        "server_id": s, "level": "inherit", "muted": false, "suppress_roles": true
    })).unwrap();
    let _ = crate::handlers::user_settings::set_notification_override(claims(a), State(state.clone()), Json(body)).await.unwrap();
    let dispatch = |msg: Uuid, users: Vec<Uuid>, roles: Vec<Uuid>| {
        let mentions = crate::notify::ParsedMentions { users: users.into_iter().collect(), roles: roles.into_iter().collect(), ..Default::default() };
        crate::notify::dispatch_channel_mentions(&state, crate::notify::ChannelMessage {
            server_id: s, channel_id: chan, message_id: msg, author_id: owner, author_username: "owner",
            author_avatar: None, content: None, mentions, enc: None, client_msg_id: None, reply_author: None,
            created_at: chrono::Utc::now(),
        })
    };
    let (m1, m2) = (Uuid::new_v4(), Uuid::new_v4());
    sqlx::query("INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $3, $4, 'x'), ($2, $3, $4, 'y')")
        .bind(m1).bind(m2).bind(chan).bind(owner).execute(&db).await.unwrap();
    dispatch(m1, vec![], vec![role]).await.unwrap();
    assert_eq!(mentioned(&db, m1).await, vec![b]);
    // Une mention directe passe toujours (catégorie « rien » = pas d'alerte, mais badge conservé).
    dispatch(m2, vec![a], vec![]).await.unwrap();
    assert_eq!(mentioned(&db, m2).await, vec![a]);

    // « Mentions seulement partout » : niveau des serveurs, salons « tous » remis par défaut.
    sqlx::query("INSERT INTO notification_overrides_channel (user_id, channel_id, level, muted) VALUES ($1, $2, 'all', TRUE)")
        .bind(a).bind(chan).execute(&db).await.unwrap();
    assert!(set_level_everywhere(claims(a), State(state.clone()), Json(SetLevel { level: "all".into() })).await.is_err());
    let _ = set_level_everywhere(claims(a), State(state.clone()), Json(SetLevel { level: "mentions".into() })).await.unwrap();
    let (lvl, sup): (String, bool) = sqlx::query_as("SELECT level, suppress_roles FROM notification_overrides_server WHERE user_id = $1 AND server_id = $2")
        .bind(a).bind(s).fetch_one(&db).await.unwrap();
    assert_eq!((lvl.as_str(), sup), ("mentions", true));
    let (ch_lvl, ch_muted): (String, bool) = sqlx::query_as("SELECT level, muted FROM notification_overrides_channel WHERE user_id = $1 AND channel_id = $2")
        .bind(a).bind(chan).fetch_one(&db).await.unwrap();
    assert_eq!((ch_lvl.as_str(), ch_muted), ("inherit", true), "sourdine conservée");
    let Json(center) = get_notif_center(claims(a), State(state.clone())).await.unwrap();
    assert_eq!(center.categories.len(), 1, "catégorie « rien » plus discrète : conservée");
    assert_eq!(center.channels.len(), 1);
    assert_eq!(center.channels[0].channel_name, "general");

    // Remise à zéro d'un serveur : serveur, catégories et salons effacés.
    let _ = reset_notif(claims(a), State(state.clone()), Query(ResetQuery { server_id: Some(s) })).await.unwrap();
    let left: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM notification_overrides_server WHERE user_id = $1)
              + (SELECT COUNT(*) FROM notification_overrides_category WHERE user_id = $1)
              + (SELECT COUNT(*) FROM notification_overrides_channel WHERE user_id = $1)"
    ).bind(a).fetch_one(&db).await.unwrap();
    assert_eq!(left, 0);
}
