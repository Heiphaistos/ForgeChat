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

    // Médias sans salon (avant la migration 109) : la 114 rattache ceux d'une publication ;
    // les autres ne sont signés que pour leur auteur, sauf blob chiffré.
    let orphan = |ext: &'static str| {
        let db = db.clone();
        async move {
            let url = format!("/uploads/{}.{ext}", Uuid::new_v4());
            sqlx::query("INSERT INTO attachments (filename, content_type, size, url, uploader_id) VALUES ('f', 'image/png', 1, $1, $2)")
                .bind(&url).bind(a).execute(&db).await.expect("orphan");
            url
        }
    };
    let posted = orphan("png").await;
    sqlx::query("INSERT INTO forum_posts (channel_id, title, creator_id, media_url) VALUES ($1, 't', $2, $3)")
        .bind(chan).bind(a).bind(&posted).execute(&db).await.expect("post");
    let plain = orphan("png").await;
    let sealed = orphan("enc").await;
    sqlx::raw_sql(include_str!("../../migrations/114_forum_media_channel.sql")).execute(&db).await.expect("114");
    let ch: Option<Uuid> = sqlx::query_scalar("SELECT channel_id FROM attachments WHERE url=$1").bind(&posted).fetch_one(&db).await.unwrap();
    assert_eq!(ch, Some(chan), "rattaché au salon de la publication");
    assert!(can_read_upload(&state, owner, &posted).await.unwrap());
    assert!(!can_read_upload(&state, b, &posted).await.unwrap(), "salon masqué");
    assert!(can_read_upload(&state, a, &plain).await.unwrap(), "auteur");
    assert!(!can_read_upload(&state, owner, &plain).await.unwrap(), "fichier en clair sans salon : auteur seul");
    assert!(can_read_upload(&state, b, &sealed).await.unwrap(), "blob chiffré");

    let (u1, u2) = if a < owner { (a, owner) } else { (owner, a) };
    let dm: Uuid = sqlx::query_scalar("INSERT INTO dm_channels (user1_id, user2_id) VALUES ($1, $2) RETURNING id")
        .bind(u1).bind(u2).fetch_one(&db).await.expect("dm");
    let dm_msg: Uuid = sqlx::query_scalar("INSERT INTO dm_messages (dm_channel_id, sender_id, content) VALUES ($1, $2, 'x') RETURNING id")
        .bind(dm).bind(a).fetch_one(&db).await.expect("dm message");
    let in_dm = att("dm_message_id", dm_msg).await;
    assert!(can_read_upload(&state, owner, &in_dm).await.unwrap());
    assert!(!can_read_upload(&state, b, &in_dm).await.unwrap(), "hors du MP");
}

/// Secret du webhook GitHub chiffré au repos : l'ancien clair est migré (rejouable), le nouveau
/// est chiffré à l'enregistrement, et la signature GitHub se vérifie toujours avec lui.
#[tokio::test]
#[ignore]
async fn security_github_token_at_rest() {
    use axum::{body::Bytes, extract::{Path, Query, State}, http::HeaderMap, Extension, Json};
    use hmac::Mac;
    crate::email_crypto::init_for_tests();
    let (state, db) = setup().await;
    let owner = user(&db).await;
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('gh', $1) RETURNING id")
        .bind(owner).fetch_one(&db).await.expect("server");
    sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, TRUE)")
        .bind(owner).bind(s).execute(&db).await.expect("member");
    let old = "ancien-secret-en-clair-0001";
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name, github_webhook_token) VALUES ($1, 'gh', $2) RETURNING id")
        .bind(s).bind(old).fetch_one(&db).await.expect("channel");
    crate::handlers::webhooks::migrate_github_tokens(&db).await.expect("migration");
    crate::handlers::webhooks::migrate_github_tokens(&db).await.expect("migration rejouée");
    let (clear, enc): (Option<String>, String) =
        sqlx::query_as("SELECT github_webhook_token, github_webhook_token_enc FROM channels WHERE id=$1")
            .bind(chan).fetch_one(&db).await.unwrap();
    assert_eq!(clear, None);
    assert!(enc.starts_with("v1:") && !enc.contains("ancien"));

    let deliver = |secret: &'static str, query: Option<&'static str>| {
        let state = state.clone();
        async move {
            let body = br#"{"zen":"ok"}"#;
            let mut m = crate::crypto::HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
            m.update(body);
            let mut h = HeaderMap::new();
            h.insert("X-Hub-Signature-256", format!("sha256={}", data_encoding::HEXLOWER.encode(&m.finalize().into_bytes())).parse().unwrap());
            h.insert("X-GitHub-Event", "ping".parse().unwrap());
            let q = query.map(|t| std::collections::HashMap::from([("token".to_string(), t.to_string())])).unwrap_or_default();
            crate::handlers::webhooks::receive_github_webhook(State(state), Path(chan), Query(q), h, Bytes::from_static(body)).await.is_ok()
        }
    };
    assert!(deliver(old, None).await, "secret migré : signature acceptée");
    assert!(deliver(old, Some(old)).await, "ancien ?token= toléré");
    assert!(!deliver("autre-secret-du-salon-xx", None).await);

    let new = "nouveau-secret-de-salon-0002";
    let claims = crate::middleware::auth::Claims { sub: owner, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None };
    let _ = crate::handlers::channels::set_github_webhook_token(State(state.clone()), Extension(claims), Path((s, chan)),
        Json(crate::handlers::channels::SetGithubTokenBody { token: Some(new.into()) })).await.expect("set");
    let enc: String = sqlx::query_scalar("SELECT github_webhook_token_enc FROM channels WHERE id=$1").bind(chan).fetch_one(&db).await.unwrap();
    assert!(!enc.contains("nouveau"));
    assert!(deliver(new, None).await);
    assert!(!deliver(old, None).await, "ancien secret remplacé");
}

/// Codes d'invitation au site : seule l'empreinte est en base (même calcul que la migration 116),
/// le code se saisit en minuscules / avec espaces, et un ancien code de 12 caractères reste valable.
#[tokio::test]
#[ignore]
async fn security_invite_code_hash() {
    use crate::handlers::site_admin::{consume_invite, invite_code_hash};
    let (_state, db) = setup().await;
    let old = Uuid::new_v4().simple().to_string().to_uppercase().replace(['0', '1'], "Z")[..12].to_string();
    let sql_hash: String = sqlx::query_scalar("SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex')")
        .bind(&old).fetch_one(&db).await.unwrap();
    assert_eq!(sql_hash, invite_code_hash(&old).unwrap(), "empreinte identique à la migration");
    let id: Uuid = sqlx::query_scalar("INSERT INTO registration_invites (code_hash, code_preview, max_uses) VALUES ($1, $2, 1) RETURNING id")
        .bind(&sql_hash).bind(&old[8..]).fetch_one(&db).await.unwrap();
    let typed = format!(" {}-{} {} ", &old[..4], &old[4..8], &old[8..]).to_lowercase();
    let mut tx = db.begin().await.unwrap();
    assert_eq!(consume_invite(&mut tx, &invite_code_hash(&typed).unwrap()).await.unwrap().0, id);
    tx.commit().await.unwrap();
    let mut tx = db.begin().await.unwrap();
    assert!(consume_invite(&mut tx, &sql_hash).await.is_err(), "usage unique");
    tx.rollback().await.unwrap();
    let cols: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM information_schema.columns WHERE table_name='registration_invites' AND column_name='code'")
        .fetch_one(&db).await.unwrap();
    assert_eq!(cols, 0, "plus de colonne en clair");
}

/// Date d'anniversaire chiffrée au repos : migration rejouable, réglage, lecture selon la
/// visibilité, profil, et fête du jour (balayage + déchiffrement).
#[tokio::test]
#[ignore]
async fn security_birthday_at_rest() {
    use axum::{extract::State, Extension, Json};
    use chrono::Datelike;
    use crate::handlers::birthdays;
    crate::email_crypto::init_for_tests();
    let (state, db) = setup().await;
    let (a, b) = (user(&db).await, user(&db).await);
    let today = chrono::Utc::now().date_naive();
    let born = chrono::NaiveDate::from_ymd_opt(1990, today.month(), today.day()).unwrap_or(chrono::NaiveDate::from_ymd_opt(1990, 2, 28).unwrap());
    sqlx::query("UPDATE users SET birthday=$2, birthday_visibility='friends' WHERE id=$1").bind(a).bind(born).execute(&db).await.unwrap();
    birthdays::migrate_at_rest(&db).await.unwrap();
    birthdays::migrate_at_rest(&db).await.unwrap();
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE birthday IS NOT NULL").fetch_one(&db).await.unwrap();
    assert_eq!(left, 0, "plus de date en clair");
    let enc: String = sqlx::query_scalar("SELECT birthday_enc FROM users WHERE id=$1").bind(a).fetch_one(&db).await.unwrap();
    assert_eq!(birthdays::open(a, &enc), Some(born));
    assert_eq!(birthdays::open(b, &enc), None, "AAD liée au compte");

    // Visible par soi et par un ami, pas par un inconnu (jamais l'année).
    assert_eq!(birthdays::for_viewer(&state, a, a, false).await, Some(serde_json::json!({ "month": born.month(), "day": born.day() })));
    assert!(birthdays::for_viewer(&state, a, b, true).await.is_some());
    assert_eq!(birthdays::for_viewer(&state, a, b, false).await, None);
    let me: crate::models::user::User = sqlx::query_as("SELECT * FROM users WHERE id=$1").bind(a).fetch_one(&db).await.unwrap();
    assert_eq!(me.into_self_public().birthday, Some(born), "profil : date déchiffrée");

    // Fête du jour : trouvée malgré le chiffrement, une seule fois.
    birthdays::run(&state).await;
    let year: Option<i32> = sqlx::query_scalar("SELECT birthday_celebrated_year FROM users WHERE id=$1").bind(a).fetch_one(&db).await.unwrap();
    if birthdays::is_today(born.month(), born.day(), today) {
        assert_eq!(year, Some(today.year()));
    }

    // Réglage par l'API : chiffré, relu.
    let claims = crate::middleware::auth::Claims { sub: b, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None };
    let body: birthdays::BirthdayBody = serde_json::from_value(serde_json::json!({ "birthday": { "month": 3, "day": 14 }, "visibility": "friends" })).unwrap();
    let Json(r) = birthdays::set_my_birthday(State(state.clone()), Extension(claims), Json(body)).await.unwrap();
    assert_eq!(r["birthday"], serde_json::json!({ "month": 3, "day": 14, "year": null }));
    let (clear, enc): (Option<chrono::NaiveDate>, String) = sqlx::query_as("SELECT birthday, birthday_enc FROM users WHERE id=$1").bind(b).fetch_one(&db).await.unwrap();
    assert_eq!(clear, None);
    assert!(!enc.contains("2000"));
}

/// Audit 2026-10-12 : la recherche globale ne livre la présence que des amis et membres d'un serveur commun.
#[tokio::test]
#[ignore]
async fn security_search_hides_strangers_presence() {
    let (state, db) = setup().await;
    let (me, stranger, friend) = (user(&db).await, user(&db).await, user(&db).await);
    let tag = Uuid::new_v4().simple().to_string()[..8].to_string();
    for (u, name) in [(stranger, format!("zz{tag}s")), (friend, format!("zz{tag}f"))] {
        sqlx::query("UPDATE users SET username=$2, status='online', custom_status='en vacances' WHERE id=$1")
            .bind(u).bind(name).execute(&db).await.expect("profil");
    }
    sqlx::query("INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'accepted')")
        .bind(me).bind(friend).execute(&db).await.expect("ami");
    let claims = crate::middleware::auth::Claims { sub: me, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None };
    let q = std::collections::HashMap::from([("q".to_string(), format!("zz{tag}"))]);
    let axum::Json(found) = crate::handlers::users::search_users(
        axum::extract::State(state.clone()), axum::Extension(claims), axum::extract::Query(q),
    ).await.expect("recherche");
    let by = |id: Uuid| found.iter().find(|u| u.id == id).expect("trouvé");
    assert_eq!(by(stranger).status, "offline");
    assert_eq!(by(stranger).custom_status, None);
    assert_eq!(by(friend).status, "online");
    assert_eq!(by(friend).custom_status.as_deref(), Some("en vacances"));
}

#[tokio::test]
#[ignore]
async fn security_deleted_files_leave_disk() {
    // Amélioration n° 18 (2026-10-12) : supprimer un serveur ou un message de groupe efface aussi
    // les fichiers du disque ; un fichier encore référencé ailleurs reste.
    let dir = std::env::temp_dir().join(format!("fc-up-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    std::env::set_var("UPLOAD_DIR", &dir);
    let (state, db) = setup().await;
    let owner = user(&db).await;
    let file = |name: &str| {
        std::fs::write(dir.join(name), b"x").unwrap();
        format!("/uploads/{name}")
    };
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id, icon) VALUES ('del', $1, $2) RETURNING id")
        .bind(owner).bind(file("icon.png")).fetch_one(&db).await.expect("server");
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'c') RETURNING id")
        .bind(s).fetch_one(&db).await.expect("channel");
    let msg: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, '') RETURNING id")
        .bind(chan).bind(owner).fetch_one(&db).await.expect("message");
    let att = file("att.bin");
    sqlx::query("INSERT INTO attachments (message_id, filename, content_type, size, url) VALUES ($1, 'f', 'application/octet-stream', 1, $2)")
        .bind(msg).bind(&att).execute(&db).await.expect("attachment");
    // Même fichier aussi utilisé comme avatar : il doit survivre.
    let shared = file("shared.png");
    sqlx::query("INSERT INTO custom_emojis (server_id, name, url) VALUES ($1, 'e', $2)").bind(s).bind(&shared).execute(&db).await.unwrap();
    sqlx::query("UPDATE users SET avatar=$1 WHERE id=$2").bind(&shared).bind(owner).execute(&db).await.unwrap();

    let files = crate::handlers::uploads::server_upload_candidates(&db, s).await;
    assert_eq!(files.len(), 3);
    sqlx::query("DELETE FROM servers WHERE id=$1").bind(s).execute(&db).await.unwrap();
    crate::handlers::uploads::remove_unreferenced(&state, files).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(!dir.join("icon.png").exists() && !dir.join("att.bin").exists(), "fichiers du serveur effacés");
    assert!(dir.join("shared.png").exists(), "fichier encore référencé conservé");

    // Compte : avatar effacé avec lui.
    let files = crate::handlers::uploads::user_upload_candidates(&db, owner).await;
    sqlx::query("DELETE FROM users WHERE id=$1").bind(owner).execute(&db).await.unwrap();
    crate::handlers::uploads::remove_unreferenced(&state, files).await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(!dir.join("shared.png").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
#[ignore]
async fn security_new_device_and_panic_lock() {
    // Améliorations n° 4 et 25 (2026-10-12).
    use crate::handlers::account_guard::*;
    use axum::http::{HeaderMap, HeaderValue};
    let (state, db) = setup().await;
    let u = user(&db).await;
    let counter = || async {
        let k = format!("secev:new_device:{}", chrono::Utc::now().timestamp() / 3600);
        let mut r = state.redis.lock().await;
        redis::AsyncCommands::get::<_, Option<i64>>(&mut *r, k).await.unwrap().unwrap_or(0)
    };
    let before = counter().await;

    // Premier appareil : identifiant neuf rendu à l'appli, aucune alerte.
    let first = note_login_device(&state, u, &HeaderMap::new(), false, true).await;
    let id = first.new_id.expect("identifiant rendu");
    assert!(valid_device_id(&id) && first.cookie.is_none());
    assert_eq!(counter().await, before);
    // Même appareil (en-tête) : connu, rien de neuf.
    let mut h = HeaderMap::new();
    h.insert("x-forgechat-device", HeaderValue::from_str(&id).unwrap());
    let again = note_login_device(&state, u, &h, false, true).await;
    assert!(again.new_id.is_none());
    assert_eq!(counter().await, before);
    // Autre appareil (web, sans cookie) : cookie posé, alerte comptée.
    let web = note_login_device(&state, u, &HeaderMap::new(), true, true).await;
    assert!(web.new_id.is_none() && web.cookie.is_some());
    assert_eq!(counter().await, before + 1);

    // Verrouillage par le lien de l'e-mail : usage unique, sessions fermées, appareils oubliés.
    sqlx::query("INSERT INTO user_sessions (user_id, refresh_token_hash) VALUES ($1, 'h')").bind(u).execute(&db).await.unwrap();
    let token = new_panic_token(&state, u).await.unwrap();
    let addr = axum::extract::ConnectInfo("127.0.0.1:1".parse::<std::net::SocketAddr>().unwrap());
    let body = || axum::Json(serde_json::json!({ "token": token }));
    let _ = panic_with_token(axum::extract::State(state.clone()), addr, HeaderMap::new(), body()).await.expect("verrouillage");
    assert!(panic_with_token(axum::extract::State(state.clone()), addr, HeaderMap::new(), body()).await.is_err(), "usage unique");
    let (locked, sessions, devices): (bool, i64, i64) = sqlx::query_as(
        "SELECT (SELECT locked_at IS NOT NULL FROM users WHERE id=$1),
                (SELECT count(*) FROM user_sessions WHERE user_id=$1),
                (SELECT count(*) FROM known_devices WHERE user_id=$1)",
    ).bind(u).fetch_one(&db).await.unwrap();
    assert!(locked);
    assert_eq!((sessions, devices), (0, 0));
}

#[tokio::test]
#[ignore]
async fn security_passkey_second_factor() {
    // Amélioration n° 3 (2026-10-12) : clé d'accès enregistrée puis utilisée à la connexion.
    use crate::webauthn::tests::{client_data, SoftKey};
    std::env::set_var("FRONTEND_URL", "https://forgechat.example");
    let (state, db) = setup().await;
    let u = user(&db).await;
    let claims = || axum::Extension(crate::middleware::auth::Claims { sub: u, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None });
    let origin = "https://forgechat.example";

    // Sans TOTP : refus (le code reste le secours).
    assert!(crate::handlers::passkeys::register_start(axum::extract::State(state.clone()), claims()).await.is_err());
    sqlx::query("UPDATE users SET totp_enabled=TRUE WHERE id=$1").bind(u).execute(&db).await.unwrap();
    let opts = crate::handlers::passkeys::register_start(axum::extract::State(state.clone()), claims()).await.unwrap().0;
    let ch = opts["challenge"].as_str().unwrap().to_string();
    assert_eq!(opts["rp"]["id"], "forgechat.example");
    let mut key = SoftKey::new();
    let b = crate::webauthn::b64u;
    let body = crate::handlers::passkeys::RegisterFinish {
        name: "Clé de test".into(),
        client_data_json: b(&client_data("webauthn.create", &ch, origin)),
        attestation_object: b(&key.attestation("forgechat.example")),
    };
    crate::handlers::passkeys::register_finish(axum::extract::State(state.clone()), claims(), axum::Json(body)).await.expect("enregistrée");

    // Connexion : options liées au compte, assertion acceptée une fois.
    let opts = crate::handlers::passkeys::login_options(&state, u).await.unwrap().expect("options");
    let ch = opts["challenge"].as_str().unwrap().to_string();
    let cd = client_data("webauthn.get", &ch, origin);
    let (ad, sig) = key.assert("forgechat.example", &cd);
    let a = crate::handlers::passkeys::Assertion { id: b(&key.id), client_data_json: b(&cd), authenticator_data: b(&ad), signature: b(&sig) };
    assert!(crate::handlers::passkeys::check_assertion(&state, u, &a).await.unwrap());
    assert!(!crate::handlers::passkeys::check_assertion(&state, u, &a).await.unwrap(), "défi à usage unique");
    // Défi d'un autre compte : refusé.
    let other = user(&db).await;
    sqlx::query("UPDATE users SET totp_enabled=TRUE WHERE id=$1").bind(other).execute(&db).await.unwrap();
    let ch = crate::webauthn::new_challenge();
    {
        let mut r = state.redis.lock().await;
        let _: () = redis::AsyncCommands::set_ex(&mut *r, format!("passkey_login:{ch}"), other.to_string(), 60).await.unwrap();
    }
    let cd = client_data("webauthn.get", &ch, origin);
    let (ad, sig) = key.assert("forgechat.example", &cd);
    let a = crate::handlers::passkeys::Assertion { id: b(&key.id), client_data_json: b(&cd), authenticator_data: b(&ad), signature: b(&sig) };
    assert!(!crate::handlers::passkeys::check_assertion(&state, u, &a).await.unwrap());
}

#[tokio::test]
#[ignore]
async fn security_key_transparency_log() {
    // Amélioration n° 10 (2026-10-12) : journal chaîné, en ajout seul, rattrapage des clés.
    use crate::key_log::*;
    let (_state, db) = setup().await;
    let u = user(&db).await;
    sqlx::query("INSERT INTO user_keys (user_id, public_key, fingerprint, wrapped) VALUES ($1, 'BAAAAA-test', 'fp', '{}')")
        .bind(u).execute(&db).await.unwrap();
    reconcile(&db).await.unwrap();
    let seq = latest_seq(&db, u).await.expect("clé inscrite");
    assert_eq!(reconcile(&db).await.unwrap(), 0, "rien de neuf au second passage");
    // Chaîne entière vérifiable de bout en bout.
    let rows: Vec<(i64, String, String, String, String)> =
        sqlx::query_as("SELECT seq, user_tag, key_hash, prev_hash, hash FROM key_transparency_log ORDER BY seq").fetch_all(&db).await.unwrap();
    let mut prev = GENESIS.to_string();
    for (i, (s, tag, kh, p, h)) in rows.iter().enumerate() {
        assert_eq!(*s, i as i64 + 1, "numérotation sans trou");
        assert_eq!(p, &prev);
        assert_eq!(h, &entry_hash(*s, tag, kh, p));
        prev = h.clone();
    }
    let (tag, kh): (String, String) = sqlx::query_as("SELECT user_tag, key_hash FROM key_transparency_log WHERE seq=$1")
        .bind(seq).fetch_one(&db).await.unwrap();
    assert_eq!((tag, kh), (user_tag(u), key_hash("BAAAAA-test")));
    // Ajout seul : ni modification ni suppression.
    assert!(sqlx::query("UPDATE key_transparency_log SET key_hash=key_hash WHERE seq=$1").bind(seq).execute(&db).await.is_err());
    assert!(sqlx::query("DELETE FROM key_transparency_log WHERE seq=$1").bind(seq).execute(&db).await.is_err());
    // Nouvelle clé (réinitialisation) : nouvelle entrée.
    sqlx::query("UPDATE user_keys SET public_key='BAAAAA-new' WHERE user_id=$1").bind(u).execute(&db).await.unwrap();
    reconcile(&db).await.unwrap();
    assert!(latest_seq(&db, u).await.unwrap() > seq);
}
