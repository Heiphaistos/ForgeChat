//! Test de bout en bout contre un vrai PostgreSQL (ignoré par défaut) :
//! `FORGECHAT_TEST_DATABASE_URL=postgres://... cargo test -- --ignored import_end_to_end`

use std::{io::Write, path::Path};

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::importer::run;
use crate::models::role::Permissions as P;

fn build_zip(path: &Path, with_export: bool) {
    let export = include_str!("e2e_export.json");
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let o = zip::write::SimpleFileOptions::default();
    if with_export {
        z.start_file("export.json", o).unwrap();
        z.write_all(export.as_bytes()).unwrap();
    }
    for f in ["attachments/a1_photo.png", "attachments/a3_img.png", "emojis/500.png", "assets/icon.png"] {
        z.start_file(f, o).unwrap();
        z.write_all(b"PNG").unwrap();
    }
    z.finish().unwrap();
}

async fn mk_user(db: &PgPool, name: String) -> Uuid {
    sqlx::query_scalar::<_, Uuid>("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
        .bind(&name[..20])
        .bind(format!("{name}@test.local"))
        .fetch_one(db)
        .await
        .unwrap()
}

type MsgRow = (Uuid, Option<String>, String, Option<Uuid>, bool, DateTime<Utc>, Option<DateTime<Utc>>, String, String);

#[tokio::test]
#[ignore]
async fn import_end_to_end() {
    let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
    let db = PgPool::connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&db).await.unwrap();
    let tmp = std::env::temp_dir().join(format!("fc-import-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let uploads = tmp.join("uploads");
    let up = uploads.to_str().unwrap();
    let tag = Uuid::new_v4().simple().to_string();
    let owner = mk_user(&db, format!("o{tag}")).await;

    // Échec : pas d'export.json -> message clair, aucun serveur restant, aucun fichier restant
    let bad = tmp.join("bad.zip");
    build_zip(&bad, false);
    let iid: Uuid = sqlx::query_scalar("INSERT INTO server_imports (user_id) VALUES ($1) RETURNING id")
        .bind(owner).fetch_one(&db).await.unwrap();
    let err = run(&db, up, owner, iid, &bad).await.unwrap_err();
    assert!(super::user_message(&err).contains("export.json"), "{}", super::user_message(&err));
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE owner_id=$1").bind(owner).fetch_one(&db).await.unwrap();
    assert_eq!(n, 0);
    sqlx::query("UPDATE server_imports SET status='failed' WHERE id=$1").bind(iid).execute(&db).await.unwrap();

    // Un seul import actif par utilisateur (index unique partiel)
    let iid: Uuid = sqlx::query_scalar("INSERT INTO server_imports (user_id) VALUES ($1) RETURNING id")
        .bind(owner).fetch_one(&db).await.unwrap();
    let dup = sqlx::query("INSERT INTO server_imports (user_id) VALUES ($1)").bind(owner).execute(&db).await;
    assert!(matches!(dup, Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505")));

    // Succès
    let good = tmp.join("good.zip");
    build_zip(&good, true);
    let sid = run(&db, up, owner, iid, &good).await.unwrap();

    let (name, icon): (String, Option<String>) = sqlx::query_as("SELECT name, icon FROM servers WHERE id=$1")
        .bind(sid).fetch_one(&db).await.unwrap();
    assert_eq!(name, "Guilde test");
    assert!(icon.unwrap().starts_with("/uploads/server-icons/"));

    let roles: Vec<(String, i64, i32, bool)> = sqlx::query_as(
        "SELECT name, permissions, position, hoisted FROM roles WHERE server_id=$1 ORDER BY position")
        .bind(sid).fetch_all(&db).await.unwrap();
    assert_eq!(roles.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), ["@everyone", "Membre", "Modo"]);
    assert!(roles[0].1 & P::VIEW_CHANNEL != 0);
    assert_eq!(roles[2].1, P::MANAGE_MESSAGES);
    assert!(roles[2].3);

    let chans: Vec<(Uuid, String, String, Option<Uuid>, bool, i32)> = sqlx::query_as(
        "SELECT id, name, type, category_id, is_nsfw, slowmode_delay FROM channels WHERE server_id=$1 ORDER BY position, name")
        .bind(sid).fetch_all(&db).await.unwrap();
    let by = |n: &str| chans.iter().find(|c| c.1 == n).unwrap_or_else(|| panic!("salon {n} absent")).clone();
    let prive = by("prive");
    assert!(prive.3.is_some() && prive.4 && prive.5 == 10);
    assert_eq!(by("Vocal").2, "voice");
    assert_eq!(by("Vocal-discussion").2, "text");
    assert_eq!(by("forum").2, "forum");

    // Salon privé : @everyone refuse VIEW, Modo l'autorise, surcharge de membre ignorée
    let ow: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT r.name, cp.allow, cp.deny FROM channel_permissions cp JOIN roles r ON r.id=cp.target_id
         WHERE cp.channel_id=$1 ORDER BY r.name")
        .bind(prive.0).fetch_all(&db).await.unwrap();
    assert_eq!(ow, vec![("@everyone".into(), 0, P::VIEW_CHANNEL), ("Modo".into(), P::VIEW_CHANNEL, 0)]);

    // Visibilité : membre sans rôle -> salon masqué ; Modo et propriétaire -> visible
    let visitor = mk_user(&db, format!("v{tag}")).await;
    let modo = mk_user(&db, format!("m{tag}")).await;
    for u in [visitor, modo] {
        sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)").bind(u).bind(sid).execute(&db).await.unwrap();
    }
    let modo_role: Uuid = sqlx::query_scalar("SELECT id FROM roles WHERE server_id=$1 AND name='Modo'")
        .bind(sid).fetch_one(&db).await.unwrap();
    sqlx::query("INSERT INTO member_roles (user_id, server_id, role_id) VALUES ($1, $2, $3)")
        .bind(modo).bind(sid).bind(modo_role).execute(&db).await.unwrap();
    let hidden = |u: Uuid| crate::state::hidden_channels(&db, u, Some(sid), None);
    assert_eq!(hidden(visitor).await.unwrap(), [prive.0].into());
    assert!(hidden(modo).await.unwrap().is_empty());
    assert!(hidden(owner).await.unwrap().is_empty());
    assert_eq!(crate::state::hidden_channels(&db, visitor, None, Some(prive.0)).await.unwrap(), [prive.0].into());

    // Messages : triés, système ignoré, réponse liée, épinglé, @everyone neutralisé, mentions réécrites
    let msgs: Vec<MsgRow> = sqlx::query_as(
        "SELECT id, content, type, reply_to, pinned, created_at, edited_at, webhook_display_name, webhook_avatar_url
         FROM messages WHERE channel_id=$1 ORDER BY created_at")
        .bind(prive.0).fetch_all(&db).await.unwrap();
    assert_eq!(msgs.len(), 3, "bonjour, réponse, embed ; le message système est ignoré");
    assert_eq!(msgs[0].1.as_deref(), Some("bonjour"));
    assert_eq!((msgs[0].7.as_str(), msgs[0].8.as_str()), ("Alice", ""));
    let rep = &msgs[1];
    assert_eq!(rep.2, "webhook");
    assert_eq!(rep.3, Some(msgs[0].0));
    assert!(rep.4);
    assert_eq!(rep.5.to_rfc3339(), "2021-05-02T10:00:00+00:00");
    assert!(rep.6.is_some());
    assert_eq!(rep.1.as_deref(), Some("réponse @\u{200B}everyone @Alice D.\n📎 perdu.pdf (non archivé)"));
    assert_eq!(rep.8, "https://cdn.discordapp.com/avatars/9/a.png");
    assert_eq!(msgs[2].1.as_deref(), Some("> **Embed**"));
    let (fname, url): (String, String) = sqlx::query_as("SELECT filename, url FROM attachments WHERE message_id=$1")
        .bind(rep.0).fetch_one(&db).await.unwrap();
    assert_eq!(fname, "photo.png");
    assert_eq!(std::fs::read(uploads.join(url.trim_start_matches("/uploads/"))).unwrap(), b"PNG");
    let pinned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pinned_messages WHERE channel_id=$1")
        .bind(prive.0).fetch_one(&db).await.unwrap();
    assert_eq!(pinned, 1);
    let last: Option<Uuid> = sqlx::query_scalar("SELECT last_message_id FROM channels WHERE id=$1")
        .bind(prive.0).fetch_one(&db).await.unwrap();
    assert_eq!(last, Some(msgs[2].0));

    // Fil : rattaché au message d'origine, archivé, pièce jointe d'un ancien export en lien inline
    let (tid, parent, archived, count, tname): (Uuid, Option<Uuid>, bool, i32, Option<String>) = sqlx::query_as(
        "SELECT id, parent_message_id, archived, message_count, webhook_display_name FROM threads WHERE channel_id=$1")
        .bind(prive.0).fetch_one(&db).await.unwrap();
    assert_eq!((parent, archived, count, tname.as_deref()), (Some(msgs[0].0), true, 1, Some("Bob")));
    let tcontent: String = sqlx::query_scalar("SELECT content FROM thread_messages WHERE thread_id=$1")
        .bind(tid).fetch_one(&db).await.unwrap();
    assert!(tcontent.starts_with("dans le fil\n/uploads/") && tcontent.ends_with(".png"), "{tcontent}");

    // Vocal : historique dans le salon compagnon
    let vc: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE channel_id=$1")
        .bind(by("Vocal-discussion").0).fetch_one(&db).await.unwrap();
    assert_eq!(vc, 1);

    // Forum : message d'ouverture = contenu du post, le reste en réponses
    let (pid, title, content, creator, replies): (Uuid, String, Option<String>, Option<String>, i32) = sqlx::query_as(
        "SELECT id, title, content, webhook_display_name, reply_count FROM forum_posts WHERE channel_id=$1")
        .bind(by("forum").0).fetch_one(&db).await.unwrap();
    assert_eq!((title.as_str(), content.as_deref(), creator.as_deref(), replies), ("Premier post", Some("ouverture"), Some("Alice"), 1));
    let rname: String = sqlx::query_scalar("SELECT webhook_display_name FROM forum_replies WHERE post_id=$1")
        .bind(pid).fetch_one(&db).await.unwrap();
    assert_eq!(rname, "Bob");

    // Emoji : nom normalisé ForgeChat
    let emoji: String = sqlx::query_scalar("SELECT name FROM custom_emojis WHERE server_id=$1")
        .bind(sid).fetch_one(&db).await.unwrap();
    assert_eq!(emoji, "peperire");

    let status_sid: Option<Uuid> = sqlx::query_scalar("SELECT server_id FROM server_imports WHERE id=$1")
        .bind(iid).fetch_one(&db).await.unwrap();
    assert_eq!(status_sid, Some(sid));

    // FORGECHAT_TEST_KEEP=1 : garde le serveur importé pour inspecter l'API à la main
    if std::env::var("FORGECHAT_TEST_KEEP").is_ok() {
        println!("serveur importé conservé : {sid}");
        return;
    }
    sqlx::query("DELETE FROM servers WHERE id=$1").bind(sid).execute(&db).await.unwrap();
    let _ = std::fs::remove_dir_all(&tmp);
}
