//! Connexion v2 contre un vrai PostgreSQL / Redis (ignorés par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://… FORGECHAT_TEST_REDIS_URL=redis://… cargo test -- --ignored auth_v2_`
//! ⚠ `auth_v2_counters` ARRÊTE le Redis de test à la fin (vérification du refus quand Redis tombe) :
//! lui donner une instance jetable.

use super::*;
use crate::{handlers::auth::login_credentials, models::user::{LoginRequest, User}};
use serde_json::json;

const AUTH: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const AUTH2: &str = "HxwdHh8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRo";
const SALT: &str = "MDEyMzQ1Njc4OTo7PD0-Pw";

async fn db() -> PgPool {
    let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let db = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    db
}

async fn user(db: &PgPool, id: Uuid) -> User {
    sqlx::query_as("SELECT * FROM users WHERE id=$1").bind(id).fetch_one(db).await.unwrap()
}

fn login(v: Value) -> LoginRequest {
    serde_json::from_value(v).unwrap()
}

#[tokio::test]
#[ignore]
async fn auth_v2_prelogin_and_migration() {
    let db = db().await;
    crate::email_crypto::init_for_tests();
    let secret = "secret de test";

    // E-mail inconnu : sel déterministe (même réponse à chaque fois, casse et espaces ignorés), `legacy`.
    let a = prelogin_lookup(&db, secret, " Personne-XYZ@Gmail.com ").await.unwrap();
    assert_eq!(a, prelogin_lookup(&db, secret, "personne-xyz@gmail.com").await.unwrap());
    assert!(a.1);
    assert_eq!(a.0, fake_salt(secret, "personne-xyz@gmail.com"));

    // Compte non migré : même forme de réponse qu'un inconnu.
    let tag = Uuid::new_v4().simple().to_string();
    let email = format!("{}@gmail.com", &tag[..16]);
    let id: Uuid = sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id")
        .bind(&tag[..20])
        .bind(&email)
        .bind(bcrypt::hash("ancien mot de passe", 4).unwrap())
        .fetch_one(&db)
        .await
        .unwrap();
    // Adresse encore en clair (compte d'avant la migration) : chiffrée au démarrage.
    crate::email_crypto::migrate_at_rest(&db).await.unwrap();
    assert_eq!(prelogin_lookup(&db, secret, &email).await.unwrap(), (fake_salt(secret, &email), true, "pbkdf2".to_string()));

    // Ancienne appli : {email, password} toujours accepté tant que le compte n'est pas migré.
    let u = user(&db, id).await;
    assert!(login_credentials(&login(json!({ "email": email, "password": "ancien mot de passe" })), Some(u.clone())).unwrap().is_some());
    assert!(login_credentials(&login(json!({ "email": email, "password": "faux" })), Some(u.clone())).unwrap().is_none());
    assert!(login_credentials(&login(json!({ "email": email, "auth": AUTH })), Some(u)).unwrap().is_none());

    // Migration (appli à jour), une seule fois.
    assert!(migrate_account(&db, id, AUTH, SALT, "argon2id").await.unwrap());
    assert!(!migrate_account(&db, id, AUTH2, SALT, "pbkdf2").await.unwrap());
    let u = user(&db, id).await;
    assert_eq!(u.password_hash, NO_PASSWORD);
    assert_eq!(prelogin_lookup(&db, secret, &email).await.unwrap(), (SALT.to_string(), false, "argon2id".to_string()));

    // Compte migré : auth seulement ; un mot de passe reçu = 426, jamais vérifié.
    assert!(login_credentials(&login(json!({ "email": email, "auth": AUTH })), Some(u.clone())).unwrap().is_some());
    assert!(login_credentials(&login(json!({ "email": email, "auth": AUTH2 })), Some(u.clone())).unwrap().is_none());
    let old_app = login_credentials(&login(json!({ "email": email, "password": "ancien mot de passe" })), Some(u.clone()));
    assert!(matches!(old_app, Err(AppError::UpgradeRequired(_))));
    let both = login_credentials(&login(json!({ "email": email, "auth": AUTH, "password": "x" })), Some(u));
    assert!(matches!(both, Err(AppError::UpgradeRequired(_))));
    // Inconnu : refus simple.
    assert!(login_credentials(&login(json!({ "email": "x@gmail.com", "auth": AUTH })), None).unwrap().is_none());

    sqlx::query("DELETE FROM users WHERE id=$1").bind(id).execute(&db).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn auth_v2_counters() {
    let db = db().await;
    let redis_url = std::env::var("FORGECHAT_TEST_REDIS_URL").expect("FORGECHAT_TEST_REDIS_URL");
    std::env::set_var("DATABASE_URL", "postgres://inutilise");
    std::env::set_var("JWT_SECRET", "secret-de-test-assez-long-pour-demarrer-0123456789");
    let config = crate::config::Config::from_env().unwrap();
    let conn = redis::Client::open(redis_url).unwrap().get_connection_manager().await.unwrap();
    let state = AppState::new(db, conn, config).await;

    // Par compte : 10 échecs passent, le 11e est refusé (429), quelle que soit l'IP.
    let key = account_key("login_acct", &format!("{}@gmail.com", Uuid::new_v4()));
    for _ in 0..10 {
        hit(&state, &key, 10, 900).await.unwrap();
    }
    assert!(matches!(hit(&state, &key, 10, 900).await, Err(AppError::TooManyRequests)));
    // Même adresse écrite autrement : même compteur.
    let key2 = account_key("t", " A@Gmail.com ");
    assert_eq!(key2, account_key("t", "a@gmail.com"));

    // Redis tombé : refus 503, jamais de passage libre.
    {
        let mut redis = state.redis.lock().await;
        let _: redis::RedisResult<()> = redis::cmd("SHUTDOWN").arg("NOSAVE").query_async(&mut *redis).await;
    }
    assert!(matches!(hit(&state, "x", 10, 900).await, Err(AppError::Unavailable(_))));
}

#[tokio::test]
#[ignore]
async fn auth_v2_totp_at_rest_migration() {
    use crate::handlers::totp::{hash_backup, migrate_at_rest, open_secret};
    let db = db().await;
    std::env::set_var("TOTP_ENC_KEY", "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=");
    crate::handlers::totp::init_enc_key().unwrap();
    let tag = Uuid::new_v4().simple().to_string();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (username, email, password_hash, totp_secret, totp_backup_codes, totp_enabled)
         VALUES ($1, $2, 'x', 'JBSWY3DPEHPK3PXP', ARRAY['abcd-ef01','1234-5678'], true) RETURNING id",
    )
    .bind(&tag[..20])
    .bind(format!("{tag}@test.local"))
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(migrate_at_rest(&db).await.unwrap() >= 1);
    assert_eq!(migrate_at_rest(&db).await.unwrap(), 0); // idempotent
    let (secret, codes): (String, Vec<String>) =
        sqlx::query_as("SELECT totp_secret, totp_backup_codes FROM users WHERE id=$1").bind(id).fetch_one(&db).await.unwrap();
    assert!(secret.starts_with("v1:"));
    assert_eq!(open_secret(id, &secret).as_deref(), Some("JBSWY3DPEHPK3PXP"));
    assert_eq!(codes, vec![hash_backup("abcd-ef01"), hash_backup("12345678")]);
    sqlx::query("DELETE FROM users WHERE id=$1").bind(id).execute(&db).await.unwrap();
}

/// Adresses chiffrées au repos : inscription, vérification, prelogin, connexion et mot de passe
/// oublié passent par l'empreinte ; plus aucune adresse en clair en base après migration.
#[tokio::test]
#[ignore]
async fn auth_v2_email_at_rest() {
    use axum::extract::{ConnectInfo, State};
    let db = db().await;
    crate::email_crypto::init_for_tests();
    let redis_url = std::env::var("FORGECHAT_TEST_REDIS_URL").expect("FORGECHAT_TEST_REDIS_URL");
    std::env::set_var("DATABASE_URL", "postgres://inutilise");
    std::env::set_var("JWT_SECRET", "secret-de-test-assez-long-pour-demarrer-0123456789");
    let mut config = crate::config::Config::from_env().unwrap();
    let mailbox = std::env::temp_dir().join(format!("fc-mails-{}", Uuid::new_v4()));
    config.test_mailbox = Some(mailbox.to_string_lossy().into_owned());
    let conn = redis::Client::open(redis_url).unwrap().get_connection_manager().await.unwrap();
    let state = AppState::new(db.clone(), conn, config).await;
    sqlx::query("INSERT INTO site_settings (key, value) VALUES ('registration_mode', 'open') ON CONFLICT (key) DO UPDATE SET value='open'")
        .execute(&db).await.unwrap();
    let ip = || ConnectInfo(std::net::SocketAddr::from(([10, rand::random(), rand::random(), rand::random()], 1)));
    let tag = Uuid::new_v4().simple().to_string();
    let email = format!("Test.{}@Gmail.com", &tag[..12]);
    let norm = email.to_lowercase();

    // Inscription : en attente, sans adresse en clair.
    let reg: crate::models::user::RegisterRequest = serde_json::from_value(json!({
        "username": &tag[..20], "email": email, "auth": AUTH, "kdf_salt": SALT,
    })).unwrap();
    let _ = crate::handlers::auth::register(State(state.clone()), ip(), HeaderMap::new(), Json(reg)).await.unwrap();
    let h = crate::email_crypto::hmac(&email);
    let (stored, clear): (String, Option<String>) =
        sqlx::query_as("SELECT code, email FROM pending_registrations WHERE email_hmac=$1").bind(&h).fetch_one(&db).await.unwrap();
    assert_eq!(clear, None);
    // Le code n'arrive que par e-mail (ici la boîte de test) ; la base n'en garde qu'une empreinte.
    let code = mailed_code(&mailbox, &norm).await;
    assert_eq!(stored.len(), 64);
    assert!(!stored.contains(&code));

    // Vérification : compte créé avec empreinte et adresse chiffrée.
    let (_, Json(created)) = crate::handlers::auth::verify_email(State(state.clone()), HeaderMap::new(), Json(json!({ "email": norm, "code": code })))
        .await
        .unwrap();
    let id = created.user.id;
    let (clear, enc, mac): (Option<String>, String, String) =
        sqlx::query_as("SELECT email, email_enc, email_hmac FROM users WHERE id=$1").bind(id).fetch_one(&db).await.unwrap();
    assert_eq!(clear, None);
    assert_eq!(mac, h);
    assert!(!enc.contains(&tag[..12]));
    assert_eq!(crate::email_crypto::open(id, &enc).as_deref(), Some(norm.as_str()));

    // Prelogin et connexion (casse quelconque).
    assert_eq!(prelogin_lookup(&db, "s", &email.to_uppercase()).await.unwrap().0, SALT.to_string());
    let (_, Json(logged)) = crate::handlers::auth::login(State(state.clone()), ip(), HeaderMap::new(), Json(login(json!({ "email": email, "auth": AUTH }))))
        .await
        .unwrap();
    assert_eq!(logged.user.id, id);

    // Mot de passe oublié : le jeton est émis pour ce compte.
    let _ = crate::handlers::password_reset::forgot_password(State(state.clone()), ip(), HeaderMap::new(), Json(json!({ "email": norm })))
        .await
        .unwrap();
    {
        use redis::AsyncCommands;
        let mut r = state.redis.lock().await;
        let t: Option<String> = r.get(format!("pwreset_user:{id}")).await.unwrap();
        assert!(t.is_some(), "lien de réinitialisation émis");
    }

    // Ancien compte en clair : chiffré puis effacé par la migration, rejouable.
    let old: Uuid = sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
        .bind(&tag[12..32]).bind(format!("old-{tag}@gmail.com")).fetch_one(&db).await.unwrap();
    crate::email_crypto::migrate_at_rest(&db).await.unwrap();
    crate::email_crypto::migrate_at_rest(&db).await.unwrap();
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email IS NOT NULL").fetch_one(&db).await.unwrap();
    assert_eq!(left, 0, "aucune adresse en clair");
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_registrations WHERE email IS NOT NULL").fetch_one(&db).await.unwrap();
    assert_eq!(left, 0);
    let enc: String = sqlx::query_scalar("SELECT email_enc FROM users WHERE id=$1").bind(old).fetch_one(&db).await.unwrap();
    assert_eq!(crate::email_crypto::open(old, &enc), Some(format!("old-{tag}@gmail.com")));
    for u in [id, old] {
        sqlx::query("DELETE FROM users WHERE id=$1").bind(u).execute(&db).await.unwrap();
    }

    // 5 mauvais codes : la demande est annulée, même le bon code ne passe plus.
    let email2 = format!("t2.{}@gmail.com", &tag[..12]);
    let reg: crate::models::user::RegisterRequest = serde_json::from_value(json!({
        "username": format!("b{}", &tag[..19]), "email": email2, "auth": AUTH, "kdf_salt": SALT,
    })).unwrap();
    let _ = crate::handlers::auth::register(State(state.clone()), ip(), HeaderMap::new(), Json(reg)).await.unwrap();
    let good = mailed_code(&mailbox, &email2).await;
    let wrong = if good == "000000" { "000001" } else { "000000" };
    for _ in 0..5 {
        let r = crate::handlers::auth::verify_email(State(state.clone()), HeaderMap::new(), Json(json!({ "email": email2, "code": wrong }))).await;
        assert!(r.is_err());
    }
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_registrations WHERE email_hmac=$1")
        .bind(crate::email_crypto::hmac(&email2)).fetch_one(&db).await.unwrap();
    assert_eq!(left, 0, "demande annulée au 5e mauvais code");
    let _ = std::fs::remove_dir_all(&mailbox);
}

/// Code à 6 chiffres du dernier e-mail écrit pour `to` dans la boîte de test (envoi en tâche de fond).
async fn mailed_code(dir: &std::path::Path, to: &str) -> String {
    for _ in 0..100 {
        let mut names: Vec<_> = std::fs::read_dir(dir).into_iter().flatten().flatten()
            .map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
        names.sort();
        for p in names.iter().rev() {
            let mail: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
            if mail["to"] == to {
                let body = mail["body"].as_str().unwrap();
                let i = body.find("color:#fff\">").expect("code dans l'e-mail") + "color:#fff\">".len();
                return body[i..i + 6].to_string();
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("aucun e-mail pour {to}");
}

/// Passage à Argon2id (audit 2026-10-12, M3) : preuve, sel, dérivation et enveloppe E2E ensemble.
#[tokio::test]
#[ignore]
async fn auth_v2_upgrade_kdf() {
    let db = db().await;
    let redis_url = std::env::var("FORGECHAT_TEST_REDIS_URL").expect("FORGECHAT_TEST_REDIS_URL");
    std::env::set_var("DATABASE_URL", "postgres://inutilise");
    std::env::set_var("JWT_SECRET", "secret-de-test-assez-long-pour-demarrer-0123456789");
    let config = crate::config::Config::from_env().unwrap();
    let conn = redis::Client::open(redis_url).unwrap().get_connection_manager().await.unwrap();
    let state = AppState::new(db.clone(), conn, config).await;
    let tag = Uuid::new_v4().simple().to_string();
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (username, email, password_hash, auth_hash, kdf_salt) VALUES ($1, $2, '!v2', $3, $4) RETURNING id",
    )
    .bind(&tag[..20]).bind(format!("{tag}@test.local")).bind(bcrypt::hash(AUTH, 4).unwrap()).bind(SALT)
    .fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO user_keys (user_id, public_key, fingerprint, wrapped) VALUES ($1, 'p', 'f', '{\"v\":2}')")
        .bind(id).execute(&db).await.unwrap();
    let claims = Claims { sub: id, exp: i64::MAX, iss: "forgechat".into(), iat: 0, sid: None };
    let wrapped = json!({ "v": 2, "iv": URL_SAFE_NO_PAD.encode([1u8; 12]), "ct": URL_SAFE_NO_PAD.encode([2u8; 48]) });
    let body = |old: &str, wrapped: Value| -> UpgradeKdfBody {
        serde_json::from_value(json!({ "old_auth": old, "new_auth": AUTH2, "new_kdf_salt": "QUJDREVGR0hJSktMTU5PUA", "kdf": "argon2id", "wrapped": wrapped })).unwrap()
    };
    // Mauvaise preuve, ou compte avec clé E2E sans nouvelle enveloppe : refusé, rien ne change.
    assert!(upgrade_kdf(State(state.clone()), Extension(claims.clone()), Json(body(AUTH2, wrapped.clone()))).await.is_err());
    assert!(upgrade_kdf(State(state.clone()), Extension(claims.clone()), Json(body(AUTH, Value::Null))).await.is_err());
    let kdf: String = sqlx::query_scalar("SELECT kdf FROM users WHERE id=$1").bind(id).fetch_one(&db).await.unwrap();
    assert_eq!(kdf, "pbkdf2");
    // Bonne preuve : tout bascule ensemble.
    let _ = upgrade_kdf(State(state.clone()), Extension(claims.clone()), Json(body(AUTH, wrapped.clone()))).await.expect("bascule");
    let u = user(&db, id).await;
    assert!(bcrypt::verify(AUTH2, u.auth_hash.as_deref().unwrap()).unwrap());
    let (kdf, salt, w): (String, String, Value) =
        sqlx::query_as("SELECT u.kdf, u.kdf_salt, k.wrapped FROM users u JOIN user_keys k ON k.user_id=u.id WHERE u.id=$1")
            .bind(id).fetch_one(&db).await.unwrap();
    assert_eq!((kdf.as_str(), salt.as_str()), ("argon2id", "QUJDREVGR0hJSktMTU5PUA"));
    assert_eq!(w["ct"], wrapped["ct"]);
    // Une seule fois (jamais de retour vers PBKDF2 par cette route).
    assert!(upgrade_kdf(State(state.clone()), Extension(claims), Json(body(AUTH2, wrapped))).await.is_err());
}
