//! Pseudo d'un autre membre contre un vrai PostgreSQL et Redis (ignoré par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... FORGECHAT_TEST_REDIS_URL=redis://... cargo test -- --ignored nicknames_`

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

async fn rename(state: &AppState, s: Uuid, actor: Uuid, target: Uuid, nick: Option<&str>) -> Result<()> {
    let body = NicknameBody { nickname: nick.map(String::from) };
    set_member_nickname(State(state.clone()), claims(actor), Path((s, target)), Json(body)).await.map(|_| ())
}

async fn nick(db: &PgPool, s: Uuid, u: Uuid) -> Option<String> {
    sqlx::query_scalar("SELECT nickname FROM server_members WHERE server_id=$1 AND user_id=$2")
        .bind(s).bind(u).fetch_one(db).await.expect("nickname")
}

async fn role(db: &PgPool, s: Uuid, perms: i64, position: i32, members: &[Uuid]) {
    let r: Uuid = sqlx::query_scalar("INSERT INTO roles (server_id, name, permissions, position) VALUES ($1, 'r', $2, $3) RETURNING id")
        .bind(s).bind(perms).bind(position).fetch_one(db).await.expect("role");
    for m in members {
        sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(r).execute(db).await.expect("member_role");
    }
}

#[tokio::test]
#[ignore]
async fn nicknames_manage_other_member() {
    let (state, db) = setup().await;
    let (owner, admin, modo, modo2, plain, outsider) =
        (user(&db).await, user(&db).await, user(&db).await, user(&db).await, user(&db).await, user(&db).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('pseudos', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.expect("server");
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', 0, TRUE)")
        .bind(s).execute(&db).await.expect("everyone");
    for m in [owner, admin, modo, modo2, plain] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(m == owner).execute(&db).await.expect("member");
    }
    role(&db, s, Permissions::ADMINISTRATOR, 3, &[admin]).await;
    role(&db, s, Permissions::MANAGE_NICKNAMES, 2, &[modo, modo2]).await;

    // Sans la permission : refusé, même vers plus bas que soi.
    assert!(rename(&state, s, plain, modo, Some("x")).await.is_err());
    // Avec : pseudo nettoyé, enregistré et journalisé.
    rename(&state, s, modo, plain, Some("  Bob  ")).await.expect("modo renomme");
    assert_eq!(nick(&db, s, plain).await.as_deref(), Some("Bob"));
    let logged: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM audit_log WHERE server_id=$1 AND action='MEMBER_NICKNAME_CHANGE' AND user_id=$2 AND target_id=$3)"
    ).bind(s).bind(modo).bind(plain).fetch_one(&db).await.expect("audit");
    assert!(logged);
    // Rang égal, supérieur, propriétaire : refusés, pseudo intact.
    for target in [modo2, admin, owner] {
        assert!(rename(&state, s, modo, target, Some("x")).await.is_err());
        assert_eq!(nick(&db, s, target).await, None);
    }
    // Validation commune avec son propre pseudo.
    assert!(rename(&state, s, modo, plain, Some(&"a".repeat(33))).await.is_err());
    assert!(rename(&state, s, modo, plain, Some("a\nb")).await.is_err());
    // Hors serveur : introuvable.
    assert!(matches!(rename(&state, s, modo, outsider, Some("x")).await, Err(AppError::NotFound(_))));
    // ADMINISTRATOR et propriétaire passent sans le bit ; vide = retirer.
    rename(&state, s, admin, modo, Some("Modo")).await.expect("admin renomme");
    assert_eq!(nick(&db, s, modo).await.as_deref(), Some("Modo"));
    rename(&state, s, owner, admin, Some("Chef")).await.expect("owner renomme");
    rename(&state, s, owner, modo, Some("")).await.expect("owner retire");
    assert_eq!(nick(&db, s, modo).await, None);
    // Soi-même par cette route : comme PATCH /servers/:id/nickname, sans permission.
    rename(&state, s, plain, plain, Some("Moi")).await.expect("soi");
    assert_eq!(nick(&db, s, plain).await.as_deref(), Some("Moi"));
}
