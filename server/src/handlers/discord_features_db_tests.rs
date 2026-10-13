//! Fonctions façon Discord (migration 137) contre un vrai PostgreSQL et un vrai Redis
//! (ignoré par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... FORGECHAT_TEST_REDIS_URL=redis://... cargo test -- --ignored discord_features_`

use super::*;
use crate::handlers::{channel_extras, connections, invite_tracking, servers, unread};
use axum::{extract::Path, Extension, Json};
use sqlx::PgPool;

async fn setup() -> (AppState, PgPool) {
    let db_url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let redis_url = std::env::var("FORGECHAT_TEST_REDIS_URL").expect("FORGECHAT_TEST_REDIS_URL");
    std::env::set_var("DATABASE_URL", &db_url);
    std::env::set_var("REDIS_URL", &redis_url);
    std::env::set_var(
        "JWT_SECRET",
        "secret-de-test-assez-long-pour-demarrer-0123456789",
    );
    let config = crate::config::Config::from_env().expect("config");
    let db = PgPool::connect(&db_url).await.expect("db");
    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .expect("migrations");
    let redis = redis::Client::open(redis_url)
        .expect("redis url")
        .get_connection_manager()
        .await
        .expect("redis");
    (AppState::new(db.clone(), redis, config).await, db)
}

async fn user(db: &PgPool) -> Uuid {
    let tag = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id",
    )
    .bind(&tag[..20])
    .bind(format!("{tag}@test.local"))
    .fetch_one(db)
    .await
    .expect("user")
}

fn claims(sub: Uuid) -> Extension<Claims> {
    Extension(Claims {
        sub,
        exp: i64::MAX,
        iss: "forgechat".into(),
        iat: 0,
        sid: None,
    })
}

#[tokio::test]
#[ignore]
async fn discord_features_end_to_end() {
    let (state, db) = setup().await;
    let st = || State(state.clone());
    let (owner, member) = (user(&db).await, user(&db).await);
    let s: Uuid =
        sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('df', $1) RETURNING id")
            .bind(owner)
            .fetch_one(&db)
            .await
            .unwrap();
    let everyone: Uuid = sqlx::query_scalar(
        "INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', $2, TRUE) RETURNING id",
    )
    .bind(s)
    .bind(Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES | Permissions::READ_HISTORY)
    .fetch_one(&db)
    .await
    .unwrap();
    sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, TRUE)")
        .bind(owner)
        .bind(s)
        .execute(&db)
        .await
        .unwrap();

    // Suivi d'invitation : le code est enregistré dans la transaction d'adhésion.
    sqlx::query("INSERT INTO invites (code, server_id, creator_id) VALUES ('DFTEST01', $1, $2)")
        .bind(s)
        .bind(owner)
        .execute(&db)
        .await
        .unwrap();
    let _ = servers::join_server(st(), claims(member), Path("DFTEST01".into()))
        .await
        .unwrap();
    let Json(tracked) = invite_tracking::list_invite_tracking(st(), claims(owner), Path(s))
        .await
        .unwrap();
    assert_eq!(tracked[0].members.len(), 1);
    assert_eq!(tracked[0].members[0].user.id, member);
    assert!(
        invite_tracking::list_invite_tracking(st(), claims(member), Path(s))
            .await
            .is_err(),
        "MANAGE_SERVER requis"
    );

    // Catégories : renommer (membre refusé), surcharge, synchronisation, héritage.
    let cat: Uuid = sqlx::query_scalar(
        "INSERT INTO categories (server_id, name) VALUES ($1, 'jeux') RETURNING id",
    )
    .bind(s)
    .fetch_one(&db)
    .await
    .unwrap();
    let chan: Uuid = sqlx::query_scalar(
        "INSERT INTO channels (server_id, category_id, name, type) VALUES ($1, $2, 'vocal', 'voice') RETURNING id",
    )
    .bind(s)
    .bind(cat)
    .fetch_one(&db)
    .await
    .unwrap();
    let rename = |who| {
        rename_category(
            st(),
            claims(who),
            Path((s, cat)),
            Json(RenameCategory {
                name: " Jeux ".into(),
            }),
        )
    };
    assert!(rename(member).await.is_err());
    assert_eq!(rename(owner).await.unwrap().0.name, "Jeux");
    let body = ChannelPermOverride {
        target_type: "role".into(),
        allow: 0,
        deny: Permissions::SEND_MESSAGES,
    };
    let _ = put_category_permission(st(), claims(owner), Path((s, cat, everyone)), Json(body))
        .await
        .unwrap();
    let _ = sync_category_permissions(st(), claims(owner), Path((s, cat)))
        .await
        .unwrap();
    let deny: i64 = sqlx::query_scalar(
        "SELECT deny FROM channel_permissions WHERE channel_id=$1 AND target_id=$2",
    )
    .bind(chan)
    .bind(everyone)
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(deny, Permissions::SEND_MESSAGES);
    assert!(
        sync_category_permissions(st(), claims(member), Path((s, cat)))
            .await
            .is_err()
    );

    // Statut vocal : modification par le propriétaire, refus pour un membre non connecté.
    let status = |who| {
        channel_extras::set_voice_status(
            st(),
            claims(who),
            Path((s, chan)),
            Json(channel_extras::VoiceStatusBody {
                status: Some("Raid".into()),
            }),
        )
    };
    assert!(status(member).await.is_err());
    let _ = status(owner).await.unwrap();
    let vs: Option<String> = sqlx::query_scalar("SELECT voice_status FROM channels WHERE id=$1")
        .bind(chan)
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(vs.as_deref(), Some("Raid"));

    // Marquer comme non lu : le message visé et les suivants redeviennent non lus.
    let text: Uuid = sqlx::query_scalar(
        "INSERT INTO channels (server_id, name) VALUES ($1, 'general') RETURNING id",
    )
    .bind(s)
    .fetch_one(&db)
    .await
    .unwrap();
    let (m1, m2) = (Uuid::new_v4(), Uuid::new_v4());
    sqlx::query(
        "INSERT INTO messages (id, channel_id, user_id, content, created_at)
         VALUES ($1, $3, $4, 'a', NOW() - INTERVAL '1 minute'), ($2, $3, $4, 'b', NOW())",
    )
    .bind(m1)
    .bind(m2)
    .bind(text)
    .bind(owner)
    .execute(&db)
    .await
    .unwrap();
    let Json(r) = unread::mark_channel_unread(
        st(),
        claims(member),
        Path(text),
        Json(unread::MarkUnreadBody { message_id: m2 }),
    )
    .await
    .unwrap();
    assert_eq!(r["count"], 1);
    let Json(r) = unread::mark_channel_unread(
        st(),
        claims(member),
        Path(text),
        Json(unread::MarkUnreadBody { message_id: m1 }),
    )
    .await
    .unwrap();
    assert_eq!(r["count"], 2, "la position de lecture recule");

    // Comptes connectés : masqués par défaut, visibles après bascule.
    sqlx::query("INSERT INTO connected_accounts (user_id, platform, platform_username) VALUES ($1, 'github', 'octo')")
        .bind(member)
        .execute(&db)
        .await
        .unwrap();
    assert!(connections::visible_connections(&db, member)
        .await
        .unwrap()
        .is_empty());
    let vis = |v| {
        connections::set_visibility(
            st(),
            claims(member),
            Path("github".into()),
            Json(connections::VisibilityBody { visible: v }),
        )
    };
    assert!(vis(true).await.unwrap().0.visible);
    assert_eq!(
        connections::visible_connections(&db, member)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        connections::set_visibility(
            st(),
            claims(owner),
            Path("github".into()),
            Json(connections::VisibilityBody { visible: true })
        )
        .await
        .is_err(),
        "compte d'un autre : introuvable"
    );
}
