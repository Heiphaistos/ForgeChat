//! Tests des conversations chiffrées contre un vrai PostgreSQL (ignorés par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... cargo test -- --ignored e2e_`

use super::*;

async fn user(db: &PgPool, keyed: bool) -> Uuid {
    let tag = Uuid::new_v4().simple().to_string();
    let id: Uuid = sqlx::query_scalar("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
        .bind(&tag[..20])
        .bind(format!("{tag}@test.local"))
        .fetch_one(db)
        .await
        .unwrap();
    if keyed {
        set_key(db, id, &format!("fp-{tag}")).await;
    }
    id
}

async fn set_key(db: &PgPool, id: Uuid, fp: &str) {
    sqlx::query(
        "INSERT INTO user_keys (user_id, public_key, fingerprint, wrapped) VALUES ($1, $2, $3, '{}')
         ON CONFLICT (user_id) DO UPDATE SET public_key=EXCLUDED.public_key, fingerprint=EXCLUDED.fingerprint",
    )
    .bind(id)
    .bind(format!("pub-{fp}"))
    .bind(fp)
    .execute(db)
    .await
    .unwrap();
}

async fn fp(db: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT fingerprint FROM user_keys WHERE user_id=$1").bind(id).fetch_one(db).await.unwrap()
}

async fn body(db: &PgPool, epoch: i32, create: bool, to: &[Uuid], fill: u8) -> PostEnvelopes {
    let mut envelopes = vec![];
    for m in to {
        envelopes.push(json!({
            "member_id": m, "member_fp": fp(db, *m).await,
            "wrapped": { "v": 1, "iv": URL_SAFE_NO_PAD.encode([fill; 12]), "ct": URL_SAFE_NO_PAD.encode([fill; 48]) },
        }));
    }
    serde_json::from_value(json!({ "epoch": epoch, "create": create, "envelopes": envelopes })).unwrap()
}

fn err(r: Result<impl std::fmt::Debug>) -> String {
    match r.unwrap_err() {
        AppError::BadRequest(m) | AppError::Conflict(m) => m,
        AppError::Forbidden => "FORBIDDEN".into(),
        e => e.to_string(),
    }
}

fn enc(epoch: i32) -> Value {
    json!({ "v": 1, "epoch": epoch, "iv": URL_SAFE_NO_PAD.encode([1u8; 12]), "ct": URL_SAFE_NO_PAD.encode([2u8; 40]) })
}

#[tokio::test]
#[ignore]
async fn e2e_conversations() {
    let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let db = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();

    // ── MP 1:1 ──
    let (a, b, x) = (user(&db, true).await, user(&db, false).await, user(&db, true).await);
    let (u1, u2) = if a < b { (a, b) } else { (b, a) };
    let dm: Uuid = sqlx::query_scalar("INSERT INTO dm_channels (user1_id, user2_id) VALUES ($1, $2) RETURNING id")
        .bind(u1).bind(u2).fetch_one(&db).await.unwrap();
    let conv = Conv::Dm(dm);
    let mem = members(&db, conv).await.unwrap();

    // Chiffrement obligatoire : clair refusé même si b n'a pas encore de clé.
    assert_eq!(err(check_message(&db, conv, true, None).await), PLAINTEXT_REFUSED);
    // Pièce jointe seule : rien en clair, accepté.
    assert!(check_message(&db, conv, false, None).await.is_ok());
    // Aucune époque encore : tout chiffré est périmé.
    assert_eq!(err(check_message(&db, conv, false, Some(&enc(0))).await), "EPOCH_STALE");
    // a chiffre seul (b sans clé) ; b reçoit l'époque après avoir créé sa clé (`missing`).
    store_envelopes(&db, conv, a, &body(&db, 0, true, &[a], 9).await).await.unwrap();
    assert!(check_message(&db, conv, false, Some(&enc(0))).await.unwrap().is_some());
    assert!(missing_members(&db, conv, &mem, Some((0, false))).await.unwrap().is_empty());
    set_key(&db, b, &format!("fp-b-{b}")).await;
    assert_eq!(missing_members(&db, conv, &mem, Some((0, false))).await.unwrap(), vec![b]);
    store_envelopes(&db, conv, a, &body(&db, 0, false, &[b], 9).await).await.unwrap();
    assert!(missing_members(&db, conv, &mem, Some((0, false))).await.unwrap().is_empty());
    // Remise à zéro pour la suite du scénario (création à deux).
    sqlx::query("DELETE FROM conversation_keys WHERE conv_kind='dm' AND conv_id=$1").bind(dm).execute(&db).await.unwrap();
    sqlx::query("DELETE FROM conversation_epochs WHERE conv_kind='dm' AND conv_id=$1").bind(dm).execute(&db).await.unwrap();

    // Création de l'époque 0 : un étranger ne peut rien déposer.
    assert_eq!(err(store_envelopes(&db, conv, x, &body(&db, 0, true, &[a, b], 9).await).await), "FORBIDDEN");
    // Il faut couvrir les deux participants.
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[a], 9).await).await), "MEMBERS_CHANGED");
    // Pas d'enveloppe pour un non-membre.
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[a, b, x], 9).await).await), "FORBIDDEN");
    store_envelopes(&db, conv, a, &body(&db, 0, true, &[a, b], 9).await).await.unwrap();
    // Un second créateur perd la course.
    assert_eq!(err(store_envelopes(&db, conv, b, &body(&db, 0, true, &[a, b], 8).await).await), "EPOCH_STALE");
    // MP : jamais d'époque 1.
    assert_eq!(err(store_envelopes(&db, conv, b, &body(&db, 1, true, &[a, b], 8).await).await), "EPOCH_STALE");

    // Chacun ne reçoit que SON enveloppe.
    let mine = my_envelopes(&db, conv, b).await.unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0]["wrapped_by"], json!(a));
    assert!(my_envelopes(&db, conv, x).await.unwrap().is_empty());

    assert!(check_message(&db, conv, false, Some(&enc(0))).await.unwrap().is_some());
    assert_eq!(err(check_message(&db, conv, false, Some(&enc(1))).await), "EPOCH_STALE");
    assert!(check_message(&db, conv, true, Some(&enc(0))).await.is_err()); // clair + chiffré

    // Nouvelle clé de b : son enveloppe périmée peut être remplacée, pas une enveloppe valide.
    assert_eq!(
        err(store_envelopes(&db, conv, a, &serde_json::from_value(json!({ "epoch": 0, "envelopes": [
            { "member_id": b, "member_fp": "ancienne", "wrapped": { "v": 1, "iv": URL_SAFE_NO_PAD.encode([3u8; 12]), "ct": URL_SAFE_NO_PAD.encode([3u8; 48]) } }
        ]})).unwrap()).await),
        "KEY_CHANGED"
    );
    store_envelopes(&db, conv, a, &body(&db, 0, false, &[b], 7).await).await.unwrap();
    assert_eq!(my_envelopes(&db, conv, b).await.unwrap()[0]["wrapped"]["iv"], json!(URL_SAFE_NO_PAD.encode([9u8; 12])));
    set_key(&db, b, "fp-b-nouvelle").await;
    store_envelopes(&db, conv, a, &body(&db, 0, false, &[b], 7).await).await.unwrap();
    assert_eq!(my_envelopes(&db, conv, b).await.unwrap()[0]["wrapped"]["iv"], json!(URL_SAFE_NO_PAD.encode([7u8; 12])));

    // Rechiffrement : seulement par l'auteur, seulement un message encore en clair.
    let msg: Uuid = sqlx::query_scalar("INSERT INTO dm_messages (dm_channel_id, sender_id, content) VALUES ($1, $2, 'ancien') RETURNING id")
        .bind(dm).bind(a).fetch_one(&db).await.unwrap();
    let req = |id| EncryptBody { enc: enc(0), client_msg_id: id };
    assert_eq!(err(encrypt_legacy(&db, conv, b, msg, req(Uuid::new_v4())).await), "NOT_LEGACY");
    let _ok = encrypt_legacy(&db, conv, a, msg, req(Uuid::new_v4())).await.unwrap();
    let content: Option<String> = sqlx::query_scalar("SELECT content FROM dm_messages WHERE id=$1").bind(msg).fetch_one(&db).await.unwrap();
    assert!(content.is_none());
    assert_eq!(err(encrypt_legacy(&db, conv, a, msg, req(Uuid::new_v4())).await), "NOT_LEGACY");

    // ── Groupe : rotation au départ ──
    let c = user(&db, true).await;
    let g: Uuid = sqlx::query_scalar("INSERT INTO group_dm_channels (owner_id) VALUES ($1) RETURNING id")
        .bind(a).fetch_one(&db).await.unwrap();
    for m in [a, b, c] {
        sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(m).execute(&db).await.unwrap();
    }
    let gconv = Conv::Group(g);
    store_envelopes(&db, gconv, a, &body(&db, 0, true, &[a, b, c], 5).await).await.unwrap();
    sqlx::query("DELETE FROM group_dm_members WHERE dm_id=$1 AND user_id=$2").bind(g).bind(c).execute(&db).await.unwrap();
    member_left(&db, g, c).await;
    assert_eq!(err(check_message(&db, gconv, false, Some(&enc(0))).await), "EPOCH_STALE");
    assert!(my_envelopes(&db, gconv, c).await.unwrap().is_empty());
    // L'exclu ne reçoit pas la nouvelle époque.
    assert_eq!(err(store_envelopes(&db, gconv, b, &body(&db, 1, true, &[a, b, c], 6).await).await), "FORBIDDEN");
    store_envelopes(&db, gconv, b, &body(&db, 1, true, &[a, b], 6).await).await.unwrap();
    assert!(check_message(&db, gconv, false, Some(&enc(1))).await.unwrap().is_some());
    assert_eq!(err(check_message(&db, gconv, false, Some(&enc(0))).await), "EPOCH_STALE");
    // Arrivée : redistribution des anciennes époques au nouveau membre.
    let d = user(&db, true).await;
    sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(d).execute(&db).await.unwrap();
    store_envelopes(&db, gconv, a, &body(&db, 0, false, &[d], 4).await).await.unwrap();
    store_envelopes(&db, gconv, a, &body(&db, 1, false, &[d], 4).await).await.unwrap();
    assert_eq!(my_envelopes(&db, gconv, d).await.unwrap().len(), 2);
    assert_eq!(err(store_envelopes(&db, gconv, a, &body(&db, 2, false, &[d], 4).await).await), "EPOCH_STALE");

    // Mes messages encore en clair, même si un membre n'a pas de clé ; rien pour un ancien membre.
    let old: Uuid = sqlx::query_scalar("INSERT INTO group_dm_messages (dm_id, sender_id, content) VALUES ($1, $2, 'vieux') RETURNING id")
        .bind(g).bind(b).fetch_one(&db).await.unwrap();
    let e = user(&db, false).await;
    sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(e).execute(&db).await.unwrap();
    let legacy = legacy_messages(&db, b, 50).await.unwrap();
    assert!(legacy.iter().any(|m| m["id"] == json!(old) && m["conv_kind"] == "group"));
    let left: Uuid = sqlx::query_scalar("INSERT INTO group_dm_messages (dm_id, sender_id, content) VALUES ($1, $2, 'parti') RETURNING id")
        .bind(g).bind(c).fetch_one(&db).await.unwrap();
    assert!(!legacy_messages(&db, c, 50).await.unwrap().iter().any(|m| m["id"] == json!(left)));
    purge_legacy(&db).await; // déploiement d'aujourd'hui : rien à purger
    let still: Option<String> = sqlx::query_scalar("SELECT content FROM group_dm_messages WHERE id=$1").bind(old).fetch_one(&db).await.unwrap();
    assert_eq!(still.as_deref(), Some("vieux"));
    sqlx::query("UPDATE e2e_rollout SET started_at = NOW() + INTERVAL '1 day' - INTERVAL '40 days'").execute(&db).await.unwrap();
    sqlx::query("UPDATE group_dm_messages SET created_at = NOW() - INTERVAL '45 days' WHERE id=$1").bind(old).execute(&db).await.unwrap();
    purge_legacy(&db).await;
    let (gone, purged): (Option<String>, bool) = sqlx::query_as("SELECT content, purged FROM group_dm_messages WHERE id=$1")
        .bind(old).fetch_one(&db).await.unwrap();
    assert!(gone.is_none() && purged);
    sqlx::query("UPDATE e2e_rollout SET started_at = NOW()").execute(&db).await.unwrap();
}

// ─── Salons de serveur (§10) et clé de récupération du serveur (§11) ─────────

fn wrap(fill: u8) -> Value {
    json!({ "v": 1, "iv": URL_SAFE_NO_PAD.encode([fill; 12]), "ct": URL_SAFE_NO_PAD.encode([fill; 48]) })
}

fn with_server(mut b: Value, fp: &str) -> PostEnvelopes {
    b["server_envelope"] = json!({ "server_fp": fp, "wrapped": wrap(1) });
    serde_json::from_value(b).unwrap()
}

/// Un superviseur (modération de l'instance par El Patron) n'est jamais destinataire de clés d'un salon chiffré :
/// il ne peut ni lire l'état des clés, ni en recevoir, ni en poser.
#[tokio::test]
#[ignore]
async fn e2e_supervisor_never_holds_keys() {
    use crate::handlers::e2e_channel as ch;
    let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let db = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();

    let (o, a, sup) = (user(&db, true).await, user(&db, true).await, user(&db, true).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('supervise', $1) RETURNING id")
        .bind(o).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', 0, TRUE)")
        .bind(s).execute(&db).await.unwrap();
    for (m, owner, supervisor) in [(o, true, false), (a, false, false), (sup, false, true)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner, supervisor) VALUES ($1, $2, $3, $4)")
            .bind(m).bind(s).bind(owner).bind(supervisor).execute(&db).await.unwrap();
    }
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'général') RETURNING id")
        .bind(s).fetch_one(&db).await.unwrap();
    let conv = Conv::Channel(chan);

    let mut mem = members(&db, conv).await.unwrap();
    mem.sort();
    let mut want = vec![o, a];
    want.sort();
    assert_eq!(mem, want, "le superviseur n'est pas un détenteur possible de clé");
    assert!(ch::viewers(&db, chan).await.unwrap().iter().all(|u| *u != sup));
    assert!(require_member(&db, conv, sup).await.is_err(), "pas d'accès à l'état des clés du salon");
    // Ni pour lui-même, ni offerte par un membre : les enveloppes n'ont que des membres pour destinataires.
    assert_eq!(err(store_envelopes(&db, conv, sup, &body(&db, 0, true, &[sup], 9).await).await), "FORBIDDEN");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[a, sup], 9).await).await), "FORBIDDEN");
}

#[tokio::test]
#[ignore]
async fn e2e_channels() {
    use crate::handlers::{e2e_channel as ch, e2e_legacy as lg, e2e_server_key as sk};
    let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let db = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();

    let (o, a, b, c, x) = (user(&db, true).await, user(&db, true).await, user(&db, false).await, user(&db, true).await, user(&db, true).await);
    let s: Uuid = sqlx::query_scalar("INSERT INTO servers (name, owner_id) VALUES ('e2e', $1) RETURNING id")
        .bind(o).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO roles (server_id, name, permissions, is_everyone) VALUES ($1, '@everyone', 0, TRUE)")
        .bind(s).execute(&db).await.unwrap();
    for (m, owner) in [(o, true), (a, false), (b, false), (c, false)] {
        sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, $3)")
            .bind(m).bind(s).bind(owner).execute(&db).await.unwrap();
    }
    let chan: Uuid = sqlx::query_scalar("INSERT INTO channels (server_id, name) VALUES ($1, 'général') RETURNING id")
        .bind(s).fetch_one(&db).await.unwrap();
    let conv = Conv::Channel(chan);
    let mut mem = members(&db, conv).await.unwrap();
    mem.sort();
    let mut want = vec![o, a, b, c];
    want.sort();
    assert_eq!(mem, want);

    // Clair toujours refusé (même à un membre sans clé), sauf commande de bot.
    let cid = Some(Uuid::new_v4());
    assert_eq!(err(ch::check_content(&db, chan, true, None, None, false).await), PLAINTEXT_REFUSED);
    assert!(ch::check_content(&db, chan, true, None, None, true).await.unwrap().is_none());
    assert!(ch::check_content(&db, chan, false, None, None, false).await.unwrap().is_none()); // pièce jointe seule
    assert_eq!(err(ch::check_content(&db, chan, false, Some(&enc(0)), cid, false).await), "EPOCH_STALE");
    assert!(ch::check_content(&db, chan, false, Some(&enc(0)), None, false).await.is_err()); // sans client_msg_id

    // Époque 0 : le créateur s'inclut et couvre les membres munis d'une clé (petit salon) ;
    // un non-membre ne fait rien, le créateur ne garde pas l'époque pour lui seul.
    assert_eq!(err(store_envelopes(&db, conv, x, &body(&db, 0, true, &[x], 9).await).await), "FORBIDDEN");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[c], 9).await).await), "MEMBERS_CHANGED");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[a], 9).await).await), "MEMBERS_CHANGED");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[a, c], 9).await).await), "MEMBERS_CHANGED");
    store_envelopes(&db, conv, a, &body(&db, 0, true, &[a, c, o], 9).await).await.unwrap();
    assert_eq!(err(store_envelopes(&db, conv, c, &body(&db, 0, true, &[c], 9).await).await), "EPOCH_STALE");
    // Enveloppe empoisonnée par c pour o : ignorée tant que celle de o existe ; o la signale,
    // elle disparaît et c ne peut plus lui en redonner, a si.
    assert!(forget_unreadable(&db, conv, o, 0).await.unwrap()); // posée par a
    assert!(!forget_unreadable(&db, conv, o, 0).await.unwrap());
    store_envelopes(&db, conv, a, &body(&db, 0, false, &[o], 5).await).await.unwrap(); // a signalé : ignorée
    assert!(my_envelopes(&db, conv, o).await.unwrap().is_empty());
    store_envelopes(&db, conv, c, &body(&db, 0, false, &[o], 9).await).await.unwrap();
    assert_eq!(my_envelopes(&db, conv, o).await.unwrap().len(), 1);
    // b n'a pas de clé : pas d'enveloppe pour lui, et un étranger n'en reçoit pas.
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, false, &[x], 9).await).await), "FORBIDDEN");
    assert_eq!(my_envelopes(&db, conv, c).await.unwrap().len(), 1);
    assert!(my_envelopes(&db, conv, b).await.unwrap().is_empty());
    assert!(ch::check_content(&db, chan, false, Some(&enc(0)), cid, false).await.unwrap().is_some());

    // Salon rendu privé pour c (surcharge) : rotation au prochain envoi, c exclu de la suivante.
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, deny) VALUES ($1, $2, 'member', $3)")
        .bind(chan).bind(c).bind(crate::models::role::Permissions::VIEW_CHANNEL).execute(&db).await.unwrap();
    assert_eq!(err(ch::check_content(&db, chan, false, Some(&enc(0)), cid, false).await), "EPOCH_STALE");
    assert_eq!(err(store_envelopes(&db, conv, c, &body(&db, 1, true, &[c], 8).await).await), "FORBIDDEN");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 1, true, &[a, c], 8).await).await), "FORBIDDEN");
    store_envelopes(&db, conv, a, &body(&db, 1, true, &[a, o], 8).await).await.unwrap();
    assert!(ch::check_content(&db, chan, false, Some(&enc(1)), cid, false).await.unwrap().is_some());
    assert_eq!(err(ch::check_content(&db, chan, false, Some(&enc(0)), cid, false).await), "EPOCH_STALE");

    // Clé de récupération du serveur : créée par le propriétaire seul, lue en entier par lui seul.
    let key: sk::CreateServerKey = serde_json::from_value(json!({
        "public": "BOICWfpxS3xMFy1Hk9p-Od4Lx4J_0RTvujHlEL1uqLnjS1OXGYcw8PD4ah_Is1vmLjum1Xl-EcrukfhXNWmLIGE", // point P-256 valide (docs/e2e-vectors.json)
        "recovery": { "v": 1, "salt": URL_SAFE_NO_PAD.encode([5u8; 16]), "iv": URL_SAFE_NO_PAD.encode([5u8; 12]), "ct": URL_SAFE_NO_PAD.encode([5u8; 48]) },
        "owner_wrapped": wrap(6),
    })).unwrap();
    assert_eq!(err(sk::create_key(&db, s, a, &key).await), "FORBIDDEN");
    let sfp = sk::create_key(&db, s, o, &key).await.unwrap();
    assert_eq!(err(sk::create_key(&db, s, o, &key).await), "SERVER_KEY_EXISTS");
    let seen_by_a = sk::read_server_key(&db, s, a).await.unwrap();
    assert!(seen_by_a["public"].is_string() && seen_by_a.get("recovery").is_none() && seen_by_a.get("owner_wrapped").is_none());
    let seen_by_o = sk::read_server_key(&db, s, o).await.unwrap();
    assert!(seen_by_o["recovery"].is_object() && seen_by_o["owner_wrapped"].is_object());
    assert_eq!(err(sk::read_server_key(&db, s, x).await), "FORBIDDEN");
    assert_eq!(err(sk::recovery_envelopes(&db, s, a).await), "FORBIDDEN");

    // a quitte le serveur : rotation, et la nouvelle époque exige l'enveloppe du serveur.
    sqlx::query("DELETE FROM server_members WHERE server_id=$1 AND user_id=$2").bind(s).bind(a).execute(&db).await.unwrap();
    assert_eq!(err(ch::check_content(&db, chan, false, Some(&enc(1)), cid, false).await), "EPOCH_STALE");
    let b2 = json!({ "epoch": 2, "create": true, "envelopes": [
        { "member_id": o, "member_fp": fp(&db, o).await, "wrapped": wrap(7) } ] });
    assert_eq!(err(store_envelopes(&db, conv, o, &serde_json::from_value(b2.clone()).unwrap()).await), "SERVER_KEY_REQUIRED");
    assert_eq!(err(store_envelopes(&db, conv, o, &with_server(b2.clone(), "autre")).await), "SERVER_KEY_REQUIRED");
    store_envelopes(&db, conv, o, &with_server(b2, &sfp)).await.unwrap();
    // Complément d'une ancienne époque pour la clé du serveur : propriétaire / MANAGE_SERVER seulement.
    assert_eq!(err(store_envelopes(&db, conv, c, &with_server(json!({ "epoch": 1, "envelopes": [] }), &sfp)).await), "FORBIDDEN");
    store_envelopes(&db, conv, o, &with_server(json!({ "epoch": 1, "envelopes": [] }), &sfp)).await.unwrap();
    let rec = sk::recovery_envelopes(&db, s, o).await.unwrap();
    let epochs: Vec<i64> = rec["channels"][0]["epochs"].as_array().unwrap().iter().map(|e| e["epoch"].as_i64().unwrap()).collect();
    assert_eq!(epochs, vec![1, 2]);

    // Rechiffrement de l'ancien contenu (jamais purgé) : auteur, propriétaire ou modérateur seulement.
    let d = user(&db, true).await; // membre ordinaire muni d'une clé
    let m = user(&db, true).await; // modérateur (MANAGE_MESSAGES)
    let mod_role: Uuid = sqlx::query_scalar("INSERT INTO roles (server_id, name, permissions) VALUES ($1, 'modo', $2) RETURNING id")
        .bind(s).bind(crate::models::role::Permissions::MANAGE_MESSAGES).fetch_one(&db).await.unwrap();
    for u in [d, m] {
        sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)").bind(u).bind(s).execute(&db).await.unwrap();
    }
    sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)").bind(m).bind(s).bind(mod_role)
        .execute(&db).await.unwrap();
    let mine: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'ancien') RETURNING id")
        .bind(chan).bind(o).fetch_one(&db).await.unwrap();
    let old: Uuid = sqlx::query_scalar(
        "INSERT INTO messages (channel_id, user_id, content, created_at) VALUES ($1, $2, 'vieux', NOW() - INTERVAL '45 days') RETURNING id")
        .bind(chan).bind(d).fetch_one(&db).await.unwrap();
    let hook: Uuid = sqlx::query_scalar(
        "INSERT INTO messages (channel_id, user_id, content, type, webhook_display_name, created_at)
         VALUES ($1, $2, 'webhook', 'webhook', 'CI', NOW() - INTERVAL '45 days') RETURNING id")
        .bind(chan).bind(o).fetch_one(&db).await.unwrap();
    let th: Uuid = sqlx::query_scalar("INSERT INTO threads (channel_id, title, creator_id) VALUES ($1, 'sujet', $2) RETURNING id")
        .bind(chan).bind(d).fetch_one(&db).await.unwrap();
    let th_cid: Uuid = sqlx::query_scalar("SELECT client_id FROM threads WHERE id=$1").bind(th).fetch_one(&db).await.unwrap();
    let poll: Uuid = sqlx::query_scalar(
        "INSERT INTO polls (channel_id, server_id, creator_id, question) VALUES ($1, $2, $3, 'pizza ?') RETURNING id")
        .bind(chan).bind(s).bind(d).fetch_one(&db).await.unwrap();
    for (i, t) in ["oui", "non"].iter().enumerate() {
        sqlx::query("INSERT INTO poll_options (poll_id, text, position) VALUES ($1, $2, $3)").bind(poll).bind(t).bind(i as i32)
            .execute(&db).await.unwrap();
    }
    let ids = |v: Vec<Value>| v.iter().map(|m| m["id"].as_str().unwrap().parse::<Uuid>().unwrap()).collect::<Vec<_>>();
    // Mes anciens textes (auteur), partout.
    assert!(ids(lg::my_items(&db, o, 50).await.unwrap()).contains(&mine));
    // Membre ordinaire : seulement les siens ; modérateur et propriétaire : tous (jamais le webhook).
    let seen_d = ids(lg::channel_items(&db, d, chan, None, 50).await.unwrap());
    assert!(seen_d.contains(&old) && seen_d.contains(&th) && seen_d.contains(&poll) && !seen_d.contains(&mine));
    let seen_m = ids(lg::channel_items(&db, m, chan, None, 50).await.unwrap());
    assert!(seen_m.contains(&old) && seen_m.contains(&mine) && !seen_m.contains(&hook));
    let all = lg::server_items(&db, o, s, None, 50).await.unwrap();
    assert!(ids(all.clone()).contains(&mine) && !ids(all.clone()).contains(&hook));
    let p = all.iter().find(|m| m["id"] == json!(poll)).unwrap();
    assert_eq!(p["options"], json!(["oui", "non"]));
    assert_eq!(p["author_id"], json!(d));
    assert_eq!(err(lg::server_items(&db, m, s, None, 50).await), "FORBIDDEN");
    assert_eq!(err(lg::channel_items(&db, x, chan, None, 50).await), "FORBIDDEN");
    // Pagination par curseur.
    let first = ids(lg::server_items(&db, o, s, None, 1).await.unwrap());
    assert_eq!(first.len(), 1);
    assert!(!ids(lg::server_items(&db, o, s, Some(first[0]), 50).await.unwrap()).contains(&first[0]));

    let req = |id: Uuid| serde_json::from_value::<lg::EncryptItemBody>(json!({ "enc": enc(2), "client_msg_id": id })).unwrap();
    // Le texte d'autrui : interdit à un membre ordinaire, permis au modérateur, une seule fois.
    assert_eq!(err(lg::encrypt_item(&db, d, lg::Item::Message, mine, req(Uuid::new_v4())).await), "FORBIDDEN");
    assert_eq!(err(lg::encrypt_item(&db, d, lg::Item::Message, hook, req(Uuid::new_v4())).await), "NOT_LEGACY");
    lg::encrypt_item(&db, m, lg::Item::Message, mine, req(Uuid::new_v4())).await.unwrap();
    assert_eq!(err(lg::encrypt_item(&db, o, lg::Item::Message, mine, req(Uuid::new_v4())).await), "NOT_LEGACY");
    let gone: Option<String> = sqlx::query_scalar("SELECT content FROM messages WHERE id=$1").bind(mine).fetch_one(&db).await.unwrap();
    assert!(gone.is_none());
    // Le propriétaire rechiffre le titre du fil (id client imposé) et le sondage d'un membre.
    assert_eq!(err(lg::encrypt_item(&db, o, lg::Item::ThreadTitle, th, req(Uuid::new_v4())).await), "NOT_LEGACY");
    lg::encrypt_item(&db, o, lg::Item::ThreadTitle, th, req(th_cid)).await.unwrap();
    lg::encrypt_item(&db, o, lg::Item::Poll, poll, req(Uuid::new_v4())).await.unwrap();
    let texts: Vec<String> = sqlx::query_scalar("SELECT text FROM poll_options WHERE poll_id=$1").bind(poll).fetch_all(&db).await.unwrap();
    assert!(texts.iter().all(String::is_empty));
    let (title, q): (String, String) = sqlx::query_as("SELECT t.title, p.question FROM threads t, polls p WHERE t.id=$1 AND p.id=$2")
        .bind(th).bind(poll).fetch_one(&db).await.unwrap();
    assert!(title.is_empty() && q.is_empty());
    // L'auteur lui-même ; jamais de purge des salons, même 40 jours après le déploiement.
    sqlx::query("UPDATE e2e_rollout SET channels_started_at = NOW() - INTERVAL '40 days', started_at = NOW() - INTERVAL '40 days'")
        .execute(&db).await.unwrap();
    purge_legacy(&db).await;
    sqlx::query("UPDATE e2e_rollout SET channels_started_at = NOW(), started_at = NOW()").execute(&db).await.unwrap();
    let kept: Option<String> = sqlx::query_scalar("SELECT content FROM messages WHERE id=$1").bind(old).fetch_one(&db).await.unwrap();
    assert_eq!(kept.as_deref(), Some("vieux"));
    lg::encrypt_item(&db, d, lg::Item::Message, old, req(Uuid::new_v4())).await.unwrap();
}

/// Membres retenus (clé changée, pas encore acceptée) : l'époque se crée sans eux, ils restent
/// « manquants » ; refusé si leur clé n'a pas changé récemment, pour le créateur ou un non-membre.
#[tokio::test]
#[ignore]
async fn e2e_withheld_members() {
    let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let db = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    let (a, b, c, x) = (user(&db, true).await, user(&db, true).await, user(&db, true).await, user(&db, true).await);
    let g: Uuid = sqlx::query_scalar("INSERT INTO group_dm_channels (owner_id) VALUES ($1) RETURNING id")
        .bind(a).fetch_one(&db).await.unwrap();
    for m in [a, b, c] {
        sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(m).execute(&db).await.unwrap();
    }
    let conv = Conv::Group(g);
    let with = |mut body: PostEnvelopes, w: &[Uuid]| {
        body.withheld = w.to_vec();
        body
    };
    // Clé de b vieille de 40 jours : il ne peut pas être retenu.
    sqlx::query("UPDATE user_keys SET created_at = NOW() - INTERVAL '40 days' WHERE user_id=$1").bind(b).execute(&db).await.unwrap();
    assert_eq!(err(store_envelopes(&db, conv, a, &with(body(&db, 0, true, &[a, c], 9).await, &[b])).await), "WITHHELD_NOT_ALLOWED");
    // Sans withheld : couverture incomplète.
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[a, c], 9).await).await), "MEMBERS_CHANGED");
    // Ni le créateur, ni un non-membre.
    assert_eq!(err(store_envelopes(&db, conv, a, &with(body(&db, 0, true, &[b, c], 9).await, &[a])).await), "WITHHELD_NOT_ALLOWED");
    assert_eq!(err(store_envelopes(&db, conv, a, &with(body(&db, 0, true, &[a, b, c], 9).await, &[x])).await), "WITHHELD_NOT_ALLOWED");
    // b vient de changer de clé : retenu, l'époque se crée pour a et c.
    set_key(&db, b, &format!("fp-b2-{b}")).await;
    sqlx::query("UPDATE user_keys SET created_at = NOW() WHERE user_id=$1").bind(b).execute(&db).await.unwrap();
    store_envelopes(&db, conv, a, &with(body(&db, 0, true, &[a, c], 9).await, &[b])).await.unwrap();
    let mem = members(&db, conv).await.unwrap();
    assert_eq!(missing_members(&db, conv, &mem, Some((0, false))).await.unwrap(), vec![b], "b servi plus tard par KEY_REQUEST");
    // c, qui a accepté la nouvelle clé de b, la lui donne.
    store_envelopes(&db, conv, c, &body(&db, 0, false, &[b], 9).await).await.unwrap();
    assert!(missing_members(&db, conv, &mem, Some((0, false))).await.unwrap().is_empty());
}
