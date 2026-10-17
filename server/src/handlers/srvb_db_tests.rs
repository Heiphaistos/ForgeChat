//! Durcissement métier (limites de texte, hiérarchie, freins d'écriture, suspension, webhooks,
//! tickets, actualités publiques…) contre un vrai PostgreSQL et Redis (ignorés par défaut) :
//! `cargo test -- --ignored srvb_`

use crate::{
    error::AppError,
    handlers::templates::EVERYONE_PERMS,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};
use axum::{extract::{Path, State}, Extension, Json};
use serde_json::json;
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

/// (serveur, propriétaire, salon) : @everyone avec les droits d'un serveur neuf.
async fn server(db: &PgPool) -> (Uuid, Uuid, Uuid) {
    let owner = user(db).await;
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('srvb', $1) RETURNING id")
        .bind(owner).fetch_one(db).await.expect("server");
    sqlx::query("INSERT INTO roles (server_id, name, permissions, position, is_everyone) VALUES ($1, '@everyone', $2, 0, TRUE)")
        .bind(s).bind(EVERYONE_PERMS).execute(db).await.expect("everyone");
    sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, TRUE)")
        .bind(owner).bind(s).execute(db).await.expect("owner member");
    let c: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'g') RETURNING id")
        .bind(s).fetch_one(db).await.expect("channel");
    (s, owner, c)
}

async fn member(db: &PgPool, s: Uuid) -> Uuid {
    let u = user(db).await;
    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)").bind(u).bind(s).execute(db).await.expect("member");
    u
}

/// Rôle de permissions `perms` à la position `pos`, donné à `u`.
async fn give_role(db: &PgPool, s: Uuid, u: Uuid, perms: i64, pos: i32) -> Uuid {
    let r: Uuid = sqlx::query_scalar("INSERT INTO roles (server_id, name, permissions, position) VALUES ($1, 'r', $2, $3) RETURNING id")
        .bind(s).bind(perms).bind(pos).fetch_one(db).await.expect("role");
    sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)")
        .bind(u).bind(s).bind(r).execute(db).await.expect("member_role");
    r
}

#[tokio::test]
#[ignore]
async fn srvb_server_text_bounds_banner_and_channels() {
    let (state, db) = setup().await;
    let (s, owner, c) = server(&db).await;
    let other = server(&db).await;
    let upd = |v: serde_json::Value| {
        let st = state.clone();
        async move {
            crate::handlers::servers::update_server(State(st), Extension(claims(owner)), Path(s), Json(serde_json::from_value(v).unwrap())).await
        }
    };
    assert!(upd(json!({ "description": "é".repeat(1000) })).await.is_ok());
    assert!(matches!(upd(json!({ "description": "é".repeat(1001) })).await, Err(AppError::BadRequest(_))));
    assert!(matches!(upd(json!({ "welcome_message": "x".repeat(2001) })).await, Err(AppError::BadRequest(_))));
    assert!(matches!(upd(json!({ "content_filter": "tout" })).await, Err(AppError::BadRequest(_))));
    assert!(matches!(upd(json!({ "afk_timeout": 9_999_999 })).await, Err(AppError::BadRequest(_))));
    assert!(matches!(upd(json!({ "banner": "https://evil.example/x.png" })).await, Err(AppError::BadRequest(_))));
    assert!(upd(json!({ "banner": "/uploads/server-banners/a.png" })).await.is_ok());
    // Salon d'un AUTRE serveur refusé, salon du serveur accepté.
    assert!(matches!(upd(json!({ "system_channel_id": other.2 })).await, Err(AppError::BadRequest(_))));
    assert!(upd(json!({ "system_channel_id": c })).await.is_ok());
    let r = crate::handlers::servers::update_server_verification(
        State(state.clone()), Extension(claims(owner)), Path(s),
        Json(json!({ "verification_enabled": true, "verification_rules": "r".repeat(4001) })),
    ).await;
    assert!(matches!(r, Err(AppError::BadRequest(_))));
    // La création borne la description aussi.
    let r = crate::handlers::templates::create_server_from(&state, owner, "Serveur", Some(&"d".repeat(1001)), false, None).await;
    assert!(matches!(r, Err(AppError::BadRequest(_))));
}

#[tokio::test]
#[ignore]
async fn srvb_remove_timeout_needs_rank_and_not_self() {
    let (state, db) = setup().await;
    let (s, _owner, _c) = server(&db).await;
    let (moderator, admin, plain) = (member(&db, s).await, member(&db, s).await, member(&db, s).await);
    give_role(&db, s, moderator, Permissions::MANAGE_MESSAGES, 1).await;
    give_role(&db, s, admin, Permissions::MANAGE_MESSAGES, 5).await;
    for u in [moderator, admin, plain] {
        sqlx::query("INSERT INTO user_timeouts (server_id, user_id, moderator_id, expires_at) VALUES ($1, $2, $3, NOW() + interval '1 hour')")
            .bind(s).bind(u).bind(admin).execute(&db).await.expect("timeout");
    }
    let lift = |actor: Uuid, target: Uuid| crate::handlers::moderation::remove_timeout(
        Extension(claims(actor)), Path((s, target)), State(state.clone()));
    // Ni le sien, ni celui d'un rang supérieur ; celui d'un membre sans rôle, oui.
    assert!(matches!(lift(moderator, moderator).await, Err(AppError::Forbidden)));
    assert!(matches!(lift(moderator, admin).await, Err(AppError::BadRequest(_))));
    assert!(lift(moderator, plain).await.is_ok());
    assert!(lift(admin, moderator).await.is_ok());
}

#[tokio::test]
#[ignore]
async fn srvb_webhooks_follow_their_creator_and_suspension() {
    let (state, db) = setup().await;
    let (s, owner, c) = server(&db).await;
    let creator = member(&db, s).await;
    let mk = |u: Uuid| {
        let db = db.clone();
        async move {
            let tok = Uuid::new_v4().simple().to_string();
            let id: Uuid = sqlx::query_scalar(
                "INSERT INTO webhooks (server_id, channel_id, name, created_by, token_hash) VALUES ($1, $2, 'w', $3, $4) RETURNING id")
                .bind(s).bind(c).bind(u).bind(crate::handlers::webhooks::hash_webhook_token(&tok))
                .fetch_one(&db).await.expect("webhook");
            (id, tok)
        }
    };
    let post = |id: Uuid, tok: String| crate::handlers::webhooks::execute_webhook(
        State(state.clone()), Path((id, tok)), Json(serde_json::from_value(json!({ "content": "salut" })).unwrap()));
    // Créateur membre : le webhook poste.
    let (id, tok) = mk(creator).await;
    assert!(post(id, tok.clone()).await.is_ok());
    // Serveur suspendu : plus rien ne passe.
    sqlx::query("UPDATE servers SET suspended_at=NOW() WHERE id=$1").bind(s).execute(&db).await.unwrap();
    assert!(matches!(post(id, tok.clone()).await, Err(AppError::Unauthorized)));
    sqlx::query("UPDATE servers SET suspended_at=NULL WHERE id=$1").bind(s).execute(&db).await.unwrap();
    // Créateur parti SANS purge (état d'avant le correctif) : refusé à l'exécution.
    sqlx::query("DELETE FROM server_members WHERE user_id=$1 AND server_id=$2").bind(creator).bind(s).execute(&db).await.unwrap();
    assert!(matches!(post(id, tok).await, Err(AppError::Unauthorized)));
    // Départ normal (expulsion, ban, départ) : le webhook est supprimé avec le membre.
    let (id2, _) = mk(owner).await;
    let (id3, _) = mk(creator).await;
    crate::handlers::servers::purge_membership(&state, creator, s).await;
    let left: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM webhooks WHERE server_id=$1 AND id = ANY($2)")
        .bind(s).bind(vec![id2, id3]).fetch_all(&db).await.unwrap();
    assert_eq!(left, vec![id2]);
}

#[tokio::test]
#[ignore]
async fn srvb_suspended_server_is_frozen() {
    let (state, db) = setup().await;
    let (s, owner, _c) = server(&db).await;
    sqlx::query("UPDATE servers SET is_public=TRUE, invite_code='SUSPEND1' WHERE id=$1").bind(s).execute(&db).await.unwrap();
    let joiner = user(&db).await;
    let join = |u: Uuid| crate::handlers::servers::join_server(State(state.clone()), Extension(claims(u)), Path("SUSPEND1".to_string()));
    let list = || async {
        let q = axum::extract::Query(serde_json::from_value(json!({})).unwrap());
        crate::handlers::directory::discover_servers(State(state.clone()), Extension(claims(joiner)), q).await.unwrap().0
    };
    assert!(list().await.iter().any(|v| v["id"] == json!(s)));
    sqlx::query("UPDATE servers SET suspended_at=NOW() WHERE id=$1").bind(s).execute(&db).await.unwrap();
    use crate::handlers::servers::{require_owner, require_owner_even_suspended, require_permission};
    assert!(require_permission(&state, owner, s, Permissions::MANAGE_SERVER).await.is_err());
    assert!(require_owner(&state, owner, s).await.is_err());
    assert!(require_owner_even_suspended(&state, owner, s).await.is_ok());
    assert!(matches!(join(joiner).await, Err(AppError::ForbiddenMsg(_))));
    assert!(!list().await.iter().any(|v| v["id"] == json!(s)));
    // Levée : tout revient.
    sqlx::query("UPDATE servers SET suspended_at=NULL WHERE id=$1").bind(s).execute(&db).await.unwrap();
    assert!(require_permission(&state, owner, s, Permissions::MANAGE_SERVER).await.is_ok());
    assert!(join(joiner).await.is_ok());
}

#[tokio::test]
#[ignore]
async fn srvb_news_public_needs_site_admin_grant() {
    let (state, db) = setup().await;
    let (s, _owner, _c) = server(&db).await;
    let bot: Uuid = sqlx::query_scalar("INSERT INTO users (username, email, password_hash, is_bot) VALUES ($1, $2, 'x', TRUE) RETURNING id")
        .bind(&Uuid::new_v4().simple().to_string()[..20]).bind(format!("{}@b.local", Uuid::new_v4().simple())).fetch_one(&db).await.unwrap();
    let raw = "jeton-de-test-news";
    sqlx::query("INSERT INTO bot_tokens (bot_user_id, server_id, token_hash, name) VALUES ($1, $2, $3, 'rssdi')")
        .bind(bot).bind(s).bind(crate::handlers::bots::hash_bot_token(raw)).execute(&db).await.unwrap();
    let post = |site: &str, public: bool| {
        let mut h = axum::http::HeaderMap::new();
        h.insert("authorization", format!("Bot {raw}").parse().unwrap());
        let body = serde_json::from_value(json!({
            "server_id": s, "site": site, "category": "Informatique", "public": public,
            "title": "Un titre", "link": format!("https://exemple.fr/{}", Uuid::new_v4()),
        })).unwrap();
        crate::handlers::news::bot_post_news(State(state.clone()), h, Json(body))
    };
    let is_public = |site: &str| {
        let db = db.clone();
        let site = site.to_string();
        async move { sqlx::query_scalar::<_, bool>("SELECT public FROM news_sites WHERE server_id=$1 AND name=$2").bind(s).bind(site).fetch_one(&db).await.unwrap() }
    };
    let _ = post("Site A", true).await.expect("post");
    assert!(!is_public("Site A").await, "serveur non autorisé : le site reste privé");
    sqlx::query("UPDATE servers SET news_public_allowed=TRUE WHERE id=$1").bind(s).execute(&db).await.unwrap();
    let _ = post("Site A", true).await.expect("post");
    assert!(is_public("Site A").await);
    let _ = post("Site B", false).await.expect("post");
    assert!(!is_public("Site B").await);
}

#[tokio::test]
#[ignore]
async fn srvb_poll_obeys_slowmode_and_verification_gate() {
    let (state, db) = setup().await;
    let (s, owner, c) = server(&db).await;
    let u = member(&db, s).await;
    let poll = |who: Uuid| {
        let body = crate::handlers::polls::CreatePollBody {
            question: "Q ?".into(), options: vec!["a".into(), "b".into()], enc: None,
            client_msg_id: None, multiple_choice: None, anonymous: None, ends_at: None,
        };
        crate::handlers::polls::create_poll_with(state.clone(), claims(who), s, c, body, true)
    };
    sqlx::query("UPDATE channels SET slowmode_delay=60 WHERE id=$1").bind(c).execute(&db).await.unwrap();
    assert!(poll(u).await.is_ok());
    assert!(matches!(poll(u).await, Err(AppError::SlowMode(_))), "le 2e sondage subit le mode lent");
    assert!(poll(owner).await.is_ok() && poll(owner).await.is_ok(), "le staff est exempté");
    // Porte de vérification : écrire exige d'avoir accepté les règles (sauf staff).
    sqlx::query("UPDATE channels SET slowmode_delay=0 WHERE id=$1").bind(c).execute(&db).await.unwrap();
    sqlx::query("UPDATE servers SET verification_enabled=TRUE WHERE id=$1").bind(s).execute(&db).await.unwrap();
    let post = |who: Uuid| crate::handlers::servers::require_can_post(&state, who, s, c, false);
    assert!(matches!(post(u).await, Err(AppError::ForbiddenMsg(_))));
    assert!(post(owner).await.is_ok());
    let _ = crate::handlers::servers::verify_member(State(state.clone()), Extension(claims(u)), Path(s)).await.expect("verify");
    assert!(post(u).await.is_ok());
}

#[tokio::test]
#[ignore]
async fn srvb_channel_overrides_apply_to_channel_settings_and_moderation() {
    let (state, db) = setup().await;
    let (s, owner, c) = server(&db).await;
    let (chan_mod, msg_mod) = (member(&db, s).await, member(&db, s).await);
    let r1 = give_role(&db, s, chan_mod, Permissions::MANAGE_CHANNELS, 1).await;
    let r2 = give_role(&db, s, msg_mod, Permissions::MANAGE_MESSAGES, 1).await;
    let archive = |u: Uuid| crate::handlers::channels::archive_channel(State(state.clone()), Extension(claims(u)), Path((s, c)));
    assert!(archive(chan_mod).await.is_ok());
    // Une surcharge de salon retire le droit SUR CE SALON : refus, malgré le droit du serveur.
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'role', 0, $3)")
        .bind(c).bind(r1).bind(Permissions::MANAGE_CHANNELS).execute(&db).await.unwrap();
    assert!(matches!(archive(chan_mod).await, Err(AppError::Forbidden)));
    assert!(archive(owner).await.is_ok());
    // Idem pour la suppression des messages d'autrui.
    let msg: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'x') RETURNING id")
        .bind(c).bind(owner).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'role', 0, $3)")
        .bind(c).bind(r2).bind(Permissions::MANAGE_MESSAGES).execute(&db).await.unwrap();
    let del = crate::handlers::messages::delete_message(State(state.clone()), Extension(claims(msg_mod)), Path((s, c, msg))).await;
    assert!(matches!(del, Err(AppError::Forbidden)));
}

#[tokio::test]
#[ignore]
async fn srvb_ticket_weekly_cap_and_close_rules() {
    let (state, db) = setup().await;
    let (s, _owner, _c) = server(&db).await;
    let u = member(&db, s).await;
    for i in 0..10 {
        sqlx::query("INSERT INTO tickets (server_id, creator_id, title, status, number) VALUES ($1, $2, $3, 'closed', $4)")
            .bind(s).bind(u).bind(format!("t{i}")).bind(i + 1).execute(&db).await.unwrap();
    }
    let r = crate::handlers::tickets::create_ticket(
        State(state.clone()), Extension(claims(u)), Path(s), Json(serde_json::from_value(json!({})).unwrap())).await;
    assert!(matches!(r, Err(AppError::BadRequest(_))));
    // Fermé par l'équipe : le créateur ne le rouvre pas ; fermé par lui : oui.
    let (staff_closed, own_closed): (Uuid, Uuid) = (
        sqlx::query_scalar("SELECT id FROM tickets WHERE server_id=$1 AND number=1").bind(s).fetch_one(&db).await.unwrap(),
        sqlx::query_scalar("SELECT id FROM tickets WHERE server_id=$1 AND number=2").bind(s).fetch_one(&db).await.unwrap(),
    );
    sqlx::query("UPDATE tickets SET closed_by=$2 WHERE id=$1").bind(own_closed).bind(u).execute(&db).await.unwrap();
    let reopen = |t: Uuid| crate::handlers::tickets::update_ticket(
        State(state.clone()), Extension(claims(u)), Path((s, t)), Json(serde_json::from_value(json!({ "status": "open" })).unwrap()));
    assert!(matches!(reopen(staff_closed).await, Err(AppError::ForbiddenMsg(_))));
    assert!(reopen(own_closed).await.is_ok());
}

#[tokio::test]
#[ignore]
async fn srvb_lockdown_lift_needs_manage_server() {
    let (state, db) = setup().await;
    let (s, _owner, _c) = server(&db).await;
    let modo = member(&db, s).await;
    give_role(&db, s, modo, Permissions::MANAGE_MESSAGES, 1).await;
    let put = |enabled: bool| crate::handlers::automod::put_lockdown(
        State(state.clone()), Extension(claims(modo)), Path(s), Json(serde_json::from_value(json!({ "enabled": enabled })).unwrap()));
    assert!(put(true).await.is_ok());
    assert!(matches!(put(false).await, Err(AppError::Forbidden)));
}

#[tokio::test]
#[ignore]
async fn srvb_group_dm_excluded_member_and_blocks() {
    let (state, db) = setup().await;
    let (owner, a, b, target, blocker_target) = (user(&db).await, user(&db).await, user(&db).await, user(&db).await, user(&db).await);
    let g: Uuid = sqlx::query_scalar("INSERT INTO group_dm_channels (owner_id) VALUES ($1) RETURNING id").bind(owner).fetch_one(&db).await.unwrap();
    for m in [owner, a, b, target] {
        sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(m).execute(&db).await.unwrap();
    }
    let add = |who: Uuid, u: Uuid| crate::handlers::group_dms::add_group_dm_member(
        State(state.clone()), Extension(claims(who)), Path(g), Json(serde_json::from_value(json!({ "user_id": u })).unwrap()));
    // Le propriétaire exclut `target` ; un simple membre ne peut pas le ré-ajouter, le propriétaire si.
    let _ = crate::handlers::group_dms::remove_group_dm_member(State(state.clone()), Extension(claims(owner)), Path((g, target))).await.expect("kick");
    assert!(matches!(add(a, target).await, Err(AppError::ForbiddenMsg(_))));
    assert!(add(owner, target).await.is_ok());
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM group_dm_excluded WHERE dm_id=$1").bind(g).fetch_one(&db).await.unwrap();
    assert_eq!(n, 0, "réinviter lève l'exclusion");
    // Blocage entre la personne ajoutée et UN AUTRE membre que l'ajouteur : refusé.
    sqlx::query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)").bind(b).bind(blocker_target).execute(&db).await.unwrap();
    assert!(matches!(add(a, blocker_target).await, Err(AppError::ForbiddenMsg(_))));
}

#[tokio::test]
#[ignore]
async fn srvb_invite_default_expiry_and_explicit_never() {
    let (state, db) = setup().await;
    let (s, owner, _c) = server(&db).await;
    let make = |v: serde_json::Value| crate::handlers::invites::create_invite(
        State(state.clone()), Extension(claims(owner)), Path(s), Json(serde_json::from_value(v).unwrap()));
    let Json(default) = make(json!({ "max_uses": null })).await.expect("invite");
    let in_7d = chrono::Utc::now() + chrono::Duration::hours(168);
    assert!(default.expires_at.is_some_and(|e| (in_7d - e).num_minutes().abs() < 2));
    let Json(never) = make(json!({ "expires_hours": null })).await.expect("invite");
    assert!(never.expires_at.is_none(), "« Jamais » explicite reste permanent");
    let Json(two_h) = make(json!({ "expires_hours": 2 })).await.expect("invite");
    assert!(two_h.expires_at.is_some_and(|e| (e - chrono::Utc::now()).num_minutes() < 125));
}

#[tokio::test]
#[ignore]
async fn srvb_bot_name_collisions_and_audit() {
    let (state, db) = setup().await;
    let (s, owner, _c) = server(&db).await;
    let tag = Uuid::new_v4().simple().to_string();
    let human = format!("{}Bot", &tag[..8]);
    sqlx::query("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x')")
        .bind(&human).bind(format!("{tag}@t.local")).execute(&db).await.unwrap();
    let create = |name: String| crate::handlers::bots::create_bot(
        State(state.clone()), Extension(claims(owner)), Path(s), Json(serde_json::from_value(json!({ "name": name })).unwrap()));
    assert!(matches!(create(tag[..8].to_string()).await, Err(AppError::Conflict(_))));
    assert!(matches!(create("x".repeat(31)).await, Err(AppError::BadRequest(_))));
    let Json(ok) = create(format!("ok{}", &tag[..8])).await.expect("bot");
    let logged: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE server_id=$1 AND action='BOT_CREATE'").bind(s).fetch_one(&db).await.unwrap();
    assert_eq!(logged, 1);
    let bot: Uuid = ok["bot_user_id"].as_str().unwrap().parse().unwrap();
    let _ = crate::handlers::bots::delete_bot(State(state.clone()), Extension(claims(owner)), Path((s, bot))).await.expect("delete");
    let logged: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE server_id=$1 AND action='BOT_DELETE'").bind(s).fetch_one(&db).await.unwrap();
    assert_eq!(logged, 1);
}

#[tokio::test]
#[ignore]
async fn srvb_temp_ban_capped_to_30_days_without_ban_members() {
    let (state, db) = setup().await;
    let (s, _owner, _c) = server(&db).await;
    let (temp_mod, victim) = (member(&db, s).await, member(&db, s).await);
    give_role(&db, s, temp_mod, Permissions::BAN_TEMP, 1).await;
    let _ = crate::handlers::servers::ban_member(
        State(state.clone()), Extension(claims(temp_mod)), Path((s, victim)), Json(json!({ "duration_hours": 20_000 }))).await.expect("ban");
    let hours: f64 = sqlx::query_scalar("SELECT (EXTRACT(EPOCH FROM (expires_at - NOW())) / 3600)::float8 FROM bans WHERE user_id=$1 AND server_id=$2")
        .bind(victim).bind(s).fetch_one(&db).await.unwrap();
    assert!(hours <= 24.0 * 30.0 + 0.1 && hours > 24.0 * 29.0, "{hours}");
}

#[tokio::test]
#[ignore]
async fn srvb_reaction_emoji_cap() {
    let (state, db) = setup().await;
    let (s, owner, c) = server(&db).await;
    let msg: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'x') RETURNING id")
        .bind(c).bind(owner).fetch_one(&db).await.unwrap();
    let react = |e: String| crate::handlers::messages::add_reaction(State(state.clone()), Extension(claims(owner)), Path((s, c, msg, e)));
    for i in 0..20 {
        let _ = react(format!("e{i}")).await.expect("reaction");
    }
    assert!(matches!(react("e20".into()).await, Err(AppError::BadRequest(_))));
    assert!(react("e3".into()).await.is_ok(), "un emoji déjà présent reste ajoutable");
}

#[tokio::test]
#[ignore]
async fn srvb_tasks_need_write_access_and_events_are_capped() {
    let (state, db) = setup().await;
    let (s, owner, c) = server(&db).await;
    let u = member(&db, s).await;
    let task = |who: Uuid| crate::handlers::moderation::create_task(
        Extension(claims(who)), Path(c), State(state.clone()), Json(serde_json::from_value(json!({ "title": "t" })).unwrap()));
    assert!(task(u).await.is_ok());
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny) SELECT $1, id, 'role', 0, $2 FROM roles WHERE server_id=$3 AND is_everyone")
        .bind(c).bind(Permissions::SEND_MESSAGES).bind(s).execute(&db).await.unwrap();
    assert!(matches!(task(u).await, Err(AppError::Forbidden)), "salon en lecture seule");
    for i in 0..50 {
        sqlx::query("INSERT INTO server_events (server_id, name, start_time, creator_id) VALUES ($1, $2, NOW() + interval '1 day', $3)")
            .bind(s).bind(format!("e{i}")).bind(owner).execute(&db).await.unwrap();
    }
    let r = crate::handlers::events::create_event(
        Extension(claims(owner)), Path(s), State(state.clone()),
        Json(serde_json::from_value(json!({ "name": "de trop", "start_time": chrono::Utc::now() + chrono::Duration::days(2) })).unwrap())).await;
    assert!(matches!(r, Err(AppError::BadRequest(_))));
}

#[tokio::test]
#[ignore]
async fn srvb_explore_ranking_is_cached() {
    use redis::AsyncCommands;
    let (state, db) = setup().await;
    let (s, owner, _c) = server(&db).await;
    sqlx::query("UPDATE servers SET is_public=TRUE WHERE id=$1").bind(s).execute(&db).await.unwrap();
    {
        let mut r = state.redis.lock().await;
        let _: () = r.del("explore:activity:v1").await.unwrap();
    }
    let list = || async {
        let q = axum::extract::Query(serde_json::from_value(json!({ "sort": "activity" })).unwrap());
        crate::handlers::directory::discover_servers(State(state.clone()), Extension(claims(owner)), q).await.unwrap().0
    };
    assert!(list().await.iter().any(|v| v["id"] == json!(s)));
    let ttl: i64 = state.redis.lock().await.ttl("explore:activity:v1").await.unwrap();
    assert!(ttl > 0 && ttl <= 300, "classement mis en cache 5 min, ttl={ttl}");
    assert!(list().await.iter().any(|v| v["id"] == json!(s)), "lecture depuis le cache");
}
