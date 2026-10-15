//! Commandes slash contre un vrai PostgreSQL et Redis (ignorés par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=… FORGECHAT_TEST_REDIS_URL=… cargo test -- --ignored cmd_`

use super::*;
use crate::handlers::bots;
use axum::{extract::ConnectInfo, http::HeaderMap};
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
        .bind(&tag[..20]).bind(format!("{tag}@test.local")).fetch_one(db).await.expect("user")
}

fn claims(sub: Uuid) -> Claims {
    Claims { sub, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None }
}

struct World {
    s: Uuid,
    chan: Uuid,
    owner: Uuid,
    modo: Uuid,
    highmod: Uuid,
    member: Uuid,
    victim: Uuid,
    mod_role: Uuid,
}

async fn world(db: &PgPool) -> World {
    let (owner, modo, highmod, member, victim) = (user(db).await, user(db).await, user(db).await, user(db).await, user(db).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('cmds', $1) RETURNING id").bind(owner).fetch_one(db).await.unwrap();
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', $2, TRUE)")
        .bind(s).bind(Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES | Permissions::READ_HISTORY).execute(db).await.unwrap();
    let mod_perms = Permissions::KICK_MEMBERS | Permissions::MANAGE_MESSAGES;
    let mod_role: Uuid = sqlx::query_scalar("INSERT INTO roles (server_id, name, permissions, position) VALUES ($1, 'Modo', $2, 2) RETURNING id")
        .bind(s).bind(mod_perms).fetch_one(db).await.unwrap();
    let high_role: Uuid = sqlx::query_scalar("INSERT INTO roles (server_id, name, permissions, position) VALUES ($1, 'Haut', $2, 5) RETURNING id")
        .bind(s).bind(mod_perms).fetch_one(db).await.unwrap();
    for (m, is_owner) in [(owner, true), (modo, false), (highmod, false), (member, false), (victim, false)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)").bind(m).bind(s).bind(is_owner).execute(db).await.unwrap();
    }
    for (u, r) in [(modo, mod_role), (highmod, high_role)] {
        sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1,$2,$3)").bind(u).bind(s).bind(r).execute(db).await.unwrap();
    }
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'general') RETURNING id").bind(s).fetch_one(db).await.unwrap();
    World { s, chan, owner, modo, highmod, member, victim, mod_role }
}

/// Insère le message d'invocation puis traite la commande, comme `send_message`.
async fn run(state: &AppState, db: &PgPool, w: &World, who: Uuid, text: &str) -> (bool, Uuid) {
    let mid: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1,$2,$3) RETURNING id")
        .bind(w.chan).bind(who).bind(text).fetch_one(db).await.unwrap();
    (handle_message(state, &claims(who), w.s, w.chan, mid, text).await, mid)
}

async fn is_member(db: &PgPool, w: &World, u: Uuid) -> bool {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)").bind(w.s).bind(u).fetch_one(db).await.unwrap()
}

async fn audit_count(db: &PgPool, w: &World, action: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE server_id=$1 AND action=$2").bind(w.s).bind(action).fetch_one(db).await.unwrap()
}

async fn msg_exists(db: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM messages WHERE id=$1)").bind(id).fetch_one(db).await.unwrap()
}

#[tokio::test]
#[ignore]
async fn cmd_moderation_permissions_and_hierarchy() {
    let (state, db) = setup().await;
    let w = world(&db).await;

    // Un simple membre n'a jamais accès : rien ne change, refus journalisé, message d'invocation retiré.
    let (handled, mid) = run(&state, &db, &w, w.member, &format!("/kick <@{}> spam", w.victim)).await;
    assert!(handled && !msg_exists(&db, mid).await);
    assert!(is_member(&db, &w, w.victim).await, "un membre ne peut pas expulser");
    assert_eq!(audit_count(&db, &w, "COMMAND_DENIED").await, 1);
    run(&state, &db, &w, w.member, &format!("/ban <@{}>", w.victim)).await;
    run(&state, &db, &w, w.member, "/purge 5").await;
    run(&state, &db, &w, w.member, &format!("/roleadd <@{}> Modo", w.member)).await;
    let bans: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bans WHERE server_id=$1").bind(w.s).fetch_one(&db).await.unwrap();
    assert_eq!(bans, 0);
    let roles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_roles WHERE server_id=$1 AND user_id=$2").bind(w.s).bind(w.member).fetch_one(&db).await.unwrap();
    assert_eq!(roles, 0, "pas d'auto-promotion par commande");

    // Modérateur : ne peut pas toucher plus haut que lui, ni le propriétaire.
    run(&state, &db, &w, w.modo, &format!("/kick <@{}>", w.highmod)).await;
    run(&state, &db, &w, w.modo, &format!("/kick <@{}>", w.owner)).await;
    assert!(is_member(&db, &w, w.highmod).await && is_member(&db, &w, w.owner).await, "hiérarchie respectée");
    assert_eq!(audit_count(&db, &w, "COMMAND_USE").await, 2, "les tentatives dangereuses autorisées sont journalisées");

    // Il a KICK_MEMBERS mais pas BAN_MEMBERS.
    run(&state, &db, &w, w.modo, &format!("/ban <@{}>", w.victim)).await;
    assert!(is_member(&db, &w, w.victim).await);

    // Résolution par pseudo + expulsion réelle.
    let victim_name: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1").bind(w.victim).fetch_one(&db).await.unwrap();
    run(&state, &db, &w, w.modo, &format!("/kick @{victim_name} test")).await;
    assert!(!is_member(&db, &w, w.victim).await, "le modérateur expulse un membre de rang inférieur");
    assert_eq!(audit_count(&db, &w, "MEMBER_KICK").await, 1);

    // Le propriétaire bannit puis lève le ban (cible hors serveur : pseudo résolu dans `bans`).
    let target = user(&db).await;
    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1,$2)").bind(target).bind(w.s).execute(&db).await.unwrap();
    run(&state, &db, &w, w.owner, &format!("/ban <@{target}> pub")).await;
    assert!(!is_member(&db, &w, target).await);
    let banned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bans WHERE server_id=$1 AND user_id=$2)").bind(w.s).bind(target).fetch_one(&db).await.unwrap();
    assert!(banned);
    let tname: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1").bind(target).fetch_one(&db).await.unwrap();
    run(&state, &db, &w, w.owner, &format!("/unban {tname}")).await;
    let banned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bans WHERE server_id=$1 AND user_id=$2)").bind(w.s).bind(target).fetch_one(&db).await.unwrap();
    assert!(!banned);

    // Texte ordinaire : une commande inconnue n'est pas touchée.
    let (handled, mid) = run(&state, &db, &w, w.member, "/nimportequoi bonjour").await;
    assert!(!handled && msg_exists(&db, mid).await);
}

#[tokio::test]
#[ignore]
async fn cmd_purge_warn_roles_and_public_replies() {
    let (state, db) = setup().await;
    let w = world(&db).await;
    for i in 0..4 {
        sqlx::query("INSERT INTO messages (channel_id, user_id, content, created_at) VALUES ($1,$2,$3, NOW() - ($4 || ' minutes')::interval)")
            .bind(w.chan).bind(w.member).bind(format!("m{i}")).bind((10 + i).to_string()).execute(&db).await.unwrap();
    }
    run(&state, &db, &w, w.modo, "/purge 2").await;
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id=$1 AND content LIKE 'm%'").bind(w.chan).fetch_one(&db).await.unwrap();
    assert_eq!(left, 2, "deux messages supprimés");
    assert_eq!(audit_count(&db, &w, "MESSAGE_PURGE").await, 1);
    run(&state, &db, &w, w.modo, "/purge 500").await;
    assert_eq!(left, sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE channel_id=$1 AND content LIKE 'm%'").bind(w.chan).fetch_one(&db).await.unwrap(), "borne 1-100");

    // Avertissements : consignés, pas pour soi, pas plus haut que soi.
    run(&state, &db, &w, w.modo, &format!("/warn <@{}> insulte", w.member)).await;
    run(&state, &db, &w, w.modo, &format!("/warn <@{}> non", w.highmod)).await;
    run(&state, &db, &w, w.member, &format!("/warn <@{}> non", w.victim)).await;
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_warnings WHERE server_id=$1").bind(w.s).fetch_one(&db).await.unwrap();
    assert_eq!(n, 1);

    // Rôles : le propriétaire donne un rôle, un modérateur sans MANAGE_ROLES non.
    run(&state, &db, &w, w.modo, &format!("/roleadd <@{}> Modo", w.member)).await;
    let r: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_roles WHERE server_id=$1 AND user_id=$2").bind(w.s).bind(w.member).fetch_one(&db).await.unwrap();
    assert_eq!(r, 0);
    run(&state, &db, &w, w.owner, &format!("/roleadd <@{}> modo", w.member)).await;
    let r: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_roles WHERE server_id=$1 AND user_id=$2 AND role_id=$3").bind(w.s).bind(w.member).bind(w.mod_role).fetch_one(&db).await.unwrap();
    assert_eq!(r, 1);

    // Verrouillage : SEND_MESSAGES refusé à @everyone sur le salon, puis rétabli.
    run(&state, &db, &w, w.member, "/lock").await;
    let denied = |db: PgPool, w_s: Uuid, c: Uuid| async move {
        sqlx::query_scalar::<_, Option<i64>>("SELECT cp.deny FROM channel_permissions cp JOIN roles r ON r.id=cp.target_id AND r.is_everyone WHERE cp.channel_id=$1 AND r.server_id=$2")
            .bind(c).bind(w_s).fetch_optional(&db).await.unwrap().flatten().unwrap_or(0)
    };
    assert_eq!(denied(db.clone(), w.s, w.chan).await & Permissions::SEND_MESSAGES, 0, "un membre ne verrouille pas");
    run(&state, &db, &w, w.owner, "/lock").await;
    assert_ne!(denied(db.clone(), w.s, w.chan).await & Permissions::SEND_MESSAGES, 0);
    run(&state, &db, &w, w.owner, "/unlock").await;
    assert_eq!(denied(db.clone(), w.s, w.chan).await & Permissions::SEND_MESSAGES, 0);
    run(&state, &db, &w, w.owner, "/slowmode 30").await;
    let slow: i32 = sqlx::query_scalar("SELECT slowmode_delay FROM channels WHERE id=$1").bind(w.chan).fetch_one(&db).await.unwrap();
    assert_eq!(slow, 30);

    // Réponse publique d'une commande ouverte à tous : message de l'appelant, invocation retirée.
    let (handled, mid) = run(&state, &db, &w, w.member, "/coinflip").await;
    assert!(handled && !msg_exists(&db, mid).await);
    let reply: String = sqlx::query_scalar("SELECT content FROM messages WHERE channel_id=$1 AND user_id=$2 AND content LIKE '🪙%'").bind(w.chan).bind(w.member).fetch_one(&db).await.unwrap();
    assert!(reply.contains("Pile") || reply.contains("Face"));
    // Un texte saisi ne peut pas déclencher de mention de masse.
    run(&state, &db, &w, w.member, "/choose @everyone | @here").await;
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id=$1 AND content LIKE '%@everyone%'").bind(w.chan).fetch_one(&db).await.unwrap();
    assert_eq!(n, 0, "@everyone neutralisé");
}

#[tokio::test]
#[ignore]
async fn cmd_list_overrides_and_rate_limit() {
    let (state, db) = setup().await;
    let w = world(&db).await;
    let list = |who: Uuid| {
        let state = state.clone();
        let s = w.s;
        async move {
            list_server_commands(State(state), Extension(claims(who)), Path(s)).await.unwrap().0
        }
    };
    let flag = |l: &[serde_json::Value], name: &str| l.iter().find(|c| c["name"] == name).unwrap_or_else(|| panic!("{name}"))["allowed"].as_bool().unwrap();
    let l = list(w.member).await;
    assert!(l.len() >= 26 && l.iter().all(|c| c["bot_name"] == "ForgeBot"));
    assert!(flag(&l, "help") && flag(&l, "roll") && flag(&l, "8ball"));
    for dangerous in ["kick", "ban", "tempban", "unban", "purge", "roleadd", "roleremove", "timeout", "warn", "lock"] {
        assert!(!flag(&l, dangerous), "{dangerous} fermé à un simple membre");
    }
    let lm = list(w.modo).await;
    assert!(flag(&lm, "kick") && flag(&lm, "purge") && flag(&lm, "warn") && !flag(&lm, "ban") && !flag(&lm, "roleadd"));
    let lo = list(w.owner).await;
    assert!(lo.iter().all(|c| c["allowed"] == true), "le propriétaire a tout");
    // Non-membre refusé.
    assert!(list_server_commands(State(state.clone()), Extension(claims(user(&db).await)), Path(w.s)).await.is_err());

    // Exceptions : réservées à MANAGE_SERVER.
    let body = || OverrideBody { enabled: false, allowed_role_ids: vec![], required_permission: None };
    let put = |who: Uuid, name: &str, b: OverrideBody| {
        let (state, s, name) = (state.clone(), w.s, name.to_string());
        async move { put_override(State(state), Extension(claims(who)), Path((s, name)), Json(b)).await }
    };
    assert!(put(w.modo, "kick", body()).await.is_err(), "un modérateur ne règle pas les commandes");
    assert!(put(w.owner, "inexistante", body()).await.is_err());
    assert!(put(w.owner, "kick", OverrideBody { enabled: true, allowed_role_ids: vec![Uuid::new_v4()], required_permission: None }).await.is_err(), "rôle étranger refusé");
    assert!(put(w.owner, "kick", OverrideBody { enabled: true, allowed_role_ids: vec![], required_permission: Some("ROOT".into()) }).await.is_err());
    let _ = put(w.owner, "kick", body()).await.unwrap();
    assert!(!flag(&list(w.modo).await, "kick"), "désactivée");
    run(&state, &db, &w, w.modo, &format!("/kick <@{}>", w.victim)).await;
    assert!(is_member(&db, &w, w.victim).await, "désactivée = refusée aussi à l'exécution");
    // Réactivée avec limite de rôle : les autres rôles n'y ont plus accès.
    let _ = put(w.owner, "kick", OverrideBody { enabled: true, allowed_role_ids: vec![w.mod_role], required_permission: None }).await.unwrap();
    assert!(flag(&list(w.modo).await, "kick") && !flag(&list(w.highmod).await, "kick"));
    // Retour au défaut = ligne supprimée.
    let _ = put(w.owner, "kick", OverrideBody { enabled: true, allowed_role_ids: vec![], required_permission: None }).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM server_command_overrides WHERE server_id=$1").bind(w.s).fetch_one(&db).await.unwrap();
    assert_eq!(n, 0);
    assert!(audit_count(&db, &w, "COMMAND_OVERRIDE").await >= 3);

    // Limite de débit : 15 commandes / 30 s par utilisateur, la suivante est refusée.
    let spammer = user(&db).await;
    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1,$2)").bind(spammer).bind(w.s).execute(&db).await.unwrap();
    for _ in 0..15 {
        run(&state, &db, &w, spammer, "/ping").await;
    }
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id=$1 AND user_id=$2").bind(w.chan).bind(spammer).fetch_one(&db).await.unwrap();
    assert_eq!(before, 0, "invocations toutes retirées");
    let r = execute(&state, &claims(spammer), &lookup(&state, w.s, "coinflip").await.unwrap().unwrap(), w.s, w.chan, Uuid::new_v4(), "").await;
    assert!(matches!(r, Err(AppError::TooManyRequestsMsg(_))), "16e commande refusée");
}

#[tokio::test]
#[ignore]
async fn cmd_bot_registration_callback_and_replies() {
    let (state, db) = setup().await;
    let w = world(&db).await;
    let owner = claims(w.owner);
    // URL de rappel : HTTPS public seulement.
    for bad in ["http://bot.example.com/x", "https://127.0.0.1/x", "https://192.168.1.5/x"] {
        let r = bots::create_bot(State(state.clone()), Extension(owner.clone()), Path(w.s),
            Json(bots::CreateBotRequest { name: "Mauvais".into(), callback_url: Some(bad.into()) })).await;
        assert!(r.is_err(), "{bad}");
    }
    let created = bots::create_bot(State(state.clone()), Extension(owner.clone()), Path(w.s),
        Json(bots::CreateBotRequest { name: "Heiphais".into(), callback_url: Some("https://bot.example.com/forgechat".into()) })).await.unwrap().0;
    let token = created["token"].as_str().unwrap().to_string();
    let bot_user: Uuid = created["bot_user_id"].as_str().unwrap().parse().unwrap();
    let token_id: Uuid = sqlx::query_scalar("SELECT id FROM bot_tokens WHERE bot_user_id=$1").bind(bot_user).fetch_one(&db).await.unwrap();
    assert!(bot_api::set_callback(State(state.clone()), Extension(claims(w.modo)), Path((w.s, bot_user)), Json(bot_api::CallbackBody { callback_url: None })).await.is_err(), "MANAGE_SERVER requis");
    assert!(bot_api::set_callback(State(state.clone()), Extension(owner.clone()), Path((w.s, bot_user)), Json(bot_api::CallbackBody { callback_url: Some("https://10.0.0.1/x".into()) })).await.is_err());

    let addr = ConnectInfo("127.0.0.1:1".parse::<std::net::SocketAddr>().unwrap());
    let hdr = |t: &str| { let mut h = HeaderMap::new(); h.insert("authorization", format!("Bot {t}").parse().unwrap()); h };
    let batch = |t: String, json: serde_json::Value| {
        let state = state.clone();
        async move { bot_api::register_batch(State(state), ConnectInfo("127.0.0.1:1".parse().unwrap()), hdr(&t), Path(token_id), Json(serde_json::from_value(json).unwrap())).await }
    };
    // Nom natif, option invalide, doublon, mauvais jeton : tout le lot est refusé.
    assert!(batch(token.clone(), serde_json::json!({"commands":[{"name":"ok1","description":"d"},{"name":"ban","description":"d"}]})).await.is_err());
    assert!(batch(token.clone(), serde_json::json!({"commands":[{"name":"a","description":"d","options":[{"name":"X!"}]}]})).await.is_err());
    assert!(batch(token.clone(), serde_json::json!({"commands":[{"name":"a","description":"d"},{"name":"a","description":"e"}]})).await.is_err());
    assert!(batch("mauvais".into(), serde_json::json!({"commands":[]})).await.is_err());
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_commands WHERE server_id=$1").bind(w.s).fetch_one(&db).await.unwrap();
    assert_eq!(n, 0, "lot refusé = rien d'enregistré");
    let _ = batch(token.clone(), serde_json::json!({"commands":[
        {"name":"meme","description":"Un meme","category":"fun","options":[{"name":"theme","type":"string","required":false}]},
        {"name":"reboot","description":"Dangereux","required_permission":"MANAGE_SERVER","dangerous":true}
    ]})).await.unwrap();
    // Ancien format (name + description seuls) toujours accepté.
    let _ = bot_api::register_command(State(state.clone()), addr, hdr(&token), Path(token_id),
        Json(serde_json::from_value(serde_json::json!({"name":"vieux","description":"d"})).unwrap())).await.unwrap();
    let l = list_server_commands(State(state.clone()), Extension(claims(w.member)), Path(w.s)).await.unwrap().0;
    let find = |n: &str| l.iter().find(|c| c["name"] == n).cloned().unwrap();
    assert_eq!(find("meme")["bot_name"], "Heiphais");
    assert_eq!(find("meme")["allowed"], true);
    assert_eq!(find("reboot")["allowed"], false, "exigence du bot respectée");
    assert_eq!(find("reboot")["dangerous"], true);
    // replace=true synchronise : "vieux" disparaît.
    let _ = batch(token.clone(), serde_json::json!({"replace":true,"commands":[{"name":"meme","description":"Un meme"}]})).await.unwrap();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_commands WHERE server_id=$1").bind(w.s).fetch_one(&db).await.unwrap();
    assert_eq!(n, 1);

    // Exécution refusée côté serveur pour un membre sans la permission, même si le client l'envoie.
    let _ = batch(token.clone(), serde_json::json!({"commands":[{"name":"reboot","description":"d","required_permission":"MANAGE_SERVER","dangerous":true}]})).await.unwrap();
    run(&state, &db, &w, w.member, "/reboot now").await;
    assert_eq!(audit_count(&db, &w, "COMMAND_DENIED").await, 1);
    let interactions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM command_interactions WHERE server_id=$1").bind(w.s).fetch_one(&db).await.unwrap();
    assert_eq!(interactions, 0, "aucune interaction créée pour un appel refusé");

    // Réponses d'interaction : au plus 5, jeton du bon bot, publique = message du bot.
    let iid: Uuid = sqlx::query_scalar("INSERT INTO command_interactions (bot_token_id, server_id, channel_id, user_id, command) VALUES ($1,$2,$3,$4,'meme') RETURNING id")
        .bind(token_id).bind(w.s).bind(w.chan).bind(w.member).fetch_one(&db).await.unwrap();
    let reply = |t: String, ephemeral: bool| {
        let state = state.clone();
        async move {
            bot_api::interaction_reply(State(state), ConnectInfo("127.0.0.1:1".parse().unwrap()), hdr(&t), Path(iid),
                Json(bot_api::ReplyBody { content: "salut".into(), ephemeral })).await
        }
    };
    assert!(reply("mauvais".into(), true).await.is_err());
    let _ = reply(token.clone(), false).await.unwrap();
    let posted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id=$1 AND user_id=$2 AND content='salut'").bind(w.chan).bind(bot_user).fetch_one(&db).await.unwrap();
    assert_eq!(posted, 1);
    for _ in 0..4 {
        let _ = reply(token.clone(), true).await.unwrap();
    }
    assert!(reply(token.clone(), true).await.is_err(), "6e réponse refusée");
    // Un autre bot ne peut pas répondre à cette interaction.
    let other = bots::create_bot(State(state.clone()), Extension(owner), Path(w.s), Json(bots::CreateBotRequest { name: "Autre".into(), callback_url: None })).await.unwrap().0;
    let iid2: Uuid = sqlx::query_scalar("INSERT INTO command_interactions (bot_token_id, server_id, channel_id, user_id, command) VALUES ($1,$2,$3,$4,'meme') RETURNING id")
        .bind(token_id).bind(w.s).bind(w.chan).bind(w.member).fetch_one(&db).await.unwrap();
    let r = bot_api::interaction_reply(State(state.clone()), ConnectInfo("127.0.0.1:1".parse().unwrap()), hdr(other["token"].as_str().unwrap()), Path(iid2),
        Json(bot_api::ReplyBody { content: "vol".into(), ephemeral: false })).await;
    assert!(r.is_err(), "interaction d'un autre bot");
}
