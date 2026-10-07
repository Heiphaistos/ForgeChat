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

    // Transition : b sans clé → le clair passe encore.
    assert!(check_message(&db, conv, &mem, true, None).await.unwrap().is_none());
    set_key(&db, b, &format!("fp-b-{b}")).await;
    assert_eq!(err(check_message(&db, conv, &mem, true, None).await), PLAINTEXT_REFUSED);
    // Pièce jointe seule : rien en clair, accepté.
    assert!(check_message(&db, conv, &mem, false, None).await.is_ok());
    // Aucune époque encore : tout chiffré est périmé.
    assert_eq!(err(check_message(&db, conv, &mem, false, Some(&enc(0))).await), "EPOCH_STALE");

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

    assert!(check_message(&db, conv, &mem, false, Some(&enc(0))).await.unwrap().is_some());
    assert_eq!(err(check_message(&db, conv, &mem, false, Some(&enc(1))).await), "EPOCH_STALE");
    assert!(check_message(&db, conv, &mem, true, Some(&enc(0))).await.is_err()); // clair + chiffré

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
    let gm = members(&db, gconv).await.unwrap();
    assert_eq!(err(check_message(&db, gconv, &gm, false, Some(&enc(0))).await), "EPOCH_STALE");
    assert!(my_envelopes(&db, gconv, c).await.unwrap().is_empty());
    // L'exclu ne reçoit pas la nouvelle époque.
    assert_eq!(err(store_envelopes(&db, gconv, b, &body(&db, 1, true, &[a, b, c], 6).await).await), "FORBIDDEN");
    store_envelopes(&db, gconv, b, &body(&db, 1, true, &[a, b], 6).await).await.unwrap();
    assert!(check_message(&db, gconv, &gm, false, Some(&enc(1))).await.unwrap().is_some());
    assert_eq!(err(check_message(&db, gconv, &gm, false, Some(&enc(0))).await), "EPOCH_STALE");
    // Arrivée : redistribution des anciennes époques au nouveau membre.
    let d = user(&db, true).await;
    sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(d).execute(&db).await.unwrap();
    store_envelopes(&db, gconv, a, &body(&db, 0, false, &[d], 4).await).await.unwrap();
    store_envelopes(&db, gconv, a, &body(&db, 1, false, &[d], 4).await).await.unwrap();
    assert_eq!(my_envelopes(&db, gconv, d).await.unwrap().len(), 2);
    assert_eq!(err(store_envelopes(&db, gconv, a, &body(&db, 2, false, &[d], 4).await).await), "EPOCH_STALE");

    // Mes messages encore en clair, seulement là où tout le monde a une clé.
    let old: Uuid = sqlx::query_scalar("INSERT INTO group_dm_messages (dm_id, sender_id, content) VALUES ($1, $2, 'vieux') RETURNING id")
        .bind(g).bind(b).fetch_one(&db).await.unwrap();
    let legacy = legacy_messages(&db, b, 50).await.unwrap();
    assert!(legacy.iter().any(|m| m["id"] == json!(old) && m["conv_kind"] == "group"));
    let e = user(&db, false).await;
    sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(e).execute(&db).await.unwrap();
    assert!(!legacy_messages(&db, b, 50).await.unwrap().iter().any(|m| m["id"] == json!(old)));
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

#[tokio::test]
#[ignore]
async fn e2e_channels() {
    use crate::handlers::{e2e_channel as ch, e2e_server_key as sk};
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

    // Clair refusé dès que l'AUTEUR a une clé ; permis sans clé (transition) et pour une commande de bot.
    let cid = Some(Uuid::new_v4());
    assert_eq!(err(ch::check_content(&db, chan, a, true, None, None, false).await), PLAINTEXT_REFUSED);
    assert!(ch::check_content(&db, chan, b, true, None, None, false).await.unwrap().is_none());
    assert!(ch::check_content(&db, chan, a, true, None, None, true).await.unwrap().is_none());
    assert_eq!(err(ch::check_content(&db, chan, a, false, Some(&enc(0)), cid, false).await), "EPOCH_STALE");
    assert!(ch::check_content(&db, chan, a, false, Some(&enc(0)), None, false).await.is_err()); // sans client_msg_id

    // Époque 0 : le créateur s'inclut, les autres par lots ; un non-membre ne fait rien.
    assert_eq!(err(store_envelopes(&db, conv, x, &body(&db, 0, true, &[x], 9).await).await), "FORBIDDEN");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, true, &[c], 9).await).await), "MEMBERS_CHANGED");
    store_envelopes(&db, conv, a, &body(&db, 0, true, &[a], 9).await).await.unwrap();
    assert_eq!(err(store_envelopes(&db, conv, c, &body(&db, 0, true, &[c], 9).await).await), "EPOCH_STALE");
    store_envelopes(&db, conv, a, &body(&db, 0, false, &[c, o], 9).await).await.unwrap();
    // b n'a pas de clé : pas d'enveloppe pour lui, et un étranger n'en reçoit pas.
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 0, false, &[x], 9).await).await), "FORBIDDEN");
    assert_eq!(my_envelopes(&db, conv, c).await.unwrap().len(), 1);
    assert!(my_envelopes(&db, conv, b).await.unwrap().is_empty());
    assert!(ch::check_content(&db, chan, a, false, Some(&enc(0)), cid, false).await.unwrap().is_some());

    // Salon rendu privé pour c (surcharge) : rotation au prochain envoi, c exclu de la suivante.
    sqlx::query("INSERT INTO channel_permissions (channel_id, target_id, target_type, deny) VALUES ($1, $2, 'member', $3)")
        .bind(chan).bind(c).bind(crate::models::role::Permissions::VIEW_CHANNEL).execute(&db).await.unwrap();
    assert_eq!(err(ch::check_content(&db, chan, a, false, Some(&enc(0)), cid, false).await), "EPOCH_STALE");
    assert_eq!(err(store_envelopes(&db, conv, c, &body(&db, 1, true, &[c], 8).await).await), "FORBIDDEN");
    assert_eq!(err(store_envelopes(&db, conv, a, &body(&db, 1, true, &[a, c], 8).await).await), "FORBIDDEN");
    store_envelopes(&db, conv, a, &body(&db, 1, true, &[a, o], 8).await).await.unwrap();
    assert!(ch::check_content(&db, chan, a, false, Some(&enc(1)), cid, false).await.unwrap().is_some());
    assert_eq!(err(ch::check_content(&db, chan, a, false, Some(&enc(0)), cid, false).await), "EPOCH_STALE");

    // Clé de récupération du serveur : créée par le propriétaire seul, lue en entier par lui seul.
    let key: sk::CreateServerKey = serde_json::from_value(json!({
        "public": URL_SAFE_NO_PAD.encode([4u8; 65]),
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
    assert_eq!(err(ch::check_content(&db, chan, o, false, Some(&enc(1)), cid, false).await), "EPOCH_STALE");
    let b2 = json!({ "epoch": 2, "create": true, "envelopes": [
        { "member_id": o, "member_fp": fp(&db, o).await, "wrapped": wrap(7) } ] });
    assert_eq!(err(store_envelopes(&db, conv, o, &serde_json::from_value(b2.clone()).unwrap()).await), "SERVER_KEY_REQUIRED");
    assert_eq!(err(store_envelopes(&db, conv, o, &with_server(b2.clone(), "autre")).await), "SERVER_KEY_REQUIRED");
    store_envelopes(&db, conv, o, &with_server(b2, &sfp)).await.unwrap();
    // Complément d'une ancienne époque pour la clé du serveur (sans enveloppe de membre).
    store_envelopes(&db, conv, o, &with_server(json!({ "epoch": 1, "envelopes": [] }), &sfp)).await.unwrap();
    let rec = sk::recovery_envelopes(&db, s, o).await.unwrap();
    let epochs: Vec<i64> = rec["channels"][0]["epochs"].as_array().unwrap().iter().map(|e| e["epoch"].as_i64().unwrap()).collect();
    assert_eq!(epochs, vec![1, 2]);

    // Rechiffrement par l'auteur seulement, puis purge J+30 (webhooks gardés).
    let mine: Uuid = sqlx::query_scalar("INSERT INTO messages (channel_id, user_id, content) VALUES ($1, $2, 'ancien') RETURNING id")
        .bind(chan).bind(o).fetch_one(&db).await.unwrap();
    assert!(ch::legacy_items(&db, o, 50).await.unwrap().iter().any(|m| m["id"] == json!(mine) && m["item"] == "message"));
    let req = || serde_json::from_value::<ch::EncryptItemBody>(json!({ "enc": enc(2), "client_msg_id": Uuid::new_v4() })).unwrap();
    assert_eq!(err(ch::encrypt_item(&db, b, ch::Item::Message, mine, req()).await), "NOT_LEGACY");
    ch::encrypt_item(&db, o, ch::Item::Message, mine, req()).await.unwrap();
    let gone: Option<String> = sqlx::query_scalar("SELECT content FROM messages WHERE id=$1").bind(mine).fetch_one(&db).await.unwrap();
    assert!(gone.is_none());
    let old: Uuid = sqlx::query_scalar(
        "INSERT INTO messages (channel_id, user_id, content, created_at) VALUES ($1, $2, 'vieux', NOW() - INTERVAL '45 days') RETURNING id")
        .bind(chan).bind(b).fetch_one(&db).await.unwrap();
    let hook: Uuid = sqlx::query_scalar(
        "INSERT INTO messages (channel_id, user_id, content, type, webhook_display_name, created_at)
         VALUES ($1, $2, 'webhook', 'webhook', 'CI', NOW() - INTERVAL '45 days') RETURNING id")
        .bind(chan).bind(o).fetch_one(&db).await.unwrap();
    sqlx::query("UPDATE e2e_rollout SET channels_started_at = NOW() - INTERVAL '40 days'").execute(&db).await.unwrap();
    crate::handlers::e2e_channel::purge_legacy(&db).await;
    sqlx::query("UPDATE e2e_rollout SET channels_started_at = NOW()").execute(&db).await.unwrap();
    let (c1, p1): (Option<String>, bool) = sqlx::query_as("SELECT content, purged FROM messages WHERE id=$1").bind(old).fetch_one(&db).await.unwrap();
    assert!(c1.is_none() && p1);
    let c2: Option<String> = sqlx::query_scalar("SELECT content FROM messages WHERE id=$1").bind(hook).fetch_one(&db).await.unwrap();
    assert_eq!(c2.as_deref(), Some("webhook"));
}
