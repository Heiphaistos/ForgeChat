use axum::{
    extract::State,
    Extension,
    http::header,
    response::IntoResponse,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

/// Bornes mémoire des sections ajoutées à l'export (aucune requête non bornée).
const EXPORT_SECTION_LIMIT: i64 = 50_000;

/// Sections « données personnelles » ajoutées à l'export. Chaque requête choisit ses colonnes :
/// jamais de hash de mot de passe, de jeton de session, de clé publique/privée ni de secret TOTP.
async fn extra_sections(state: &AppState, uid: Uuid) -> Result<serde_json::Value> {
    let q = |sql: &'static str| {
        let db = state.db.clone();
        async move {
            let sql = format!("SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM ({sql} LIMIT {EXPORT_SECTION_LIMIT}) t");
            sqlx::query_scalar::<_, serde_json::Value>(&sql).bind(uid).fetch_one(&db).await
        }
    };
    let (saved, threads, posts, replies, reports, dm_reports, sessions, reminders, settings, passkeys, linked) = tokio::try_join!(
        q("SELECT content, author_username, channel_id, saved_at FROM saved_messages WHERE user_id=$1 ORDER BY saved_at DESC"),
        q("SELECT content, thread_id, created_at FROM thread_messages WHERE user_id=$1 ORDER BY created_at DESC"),
        q("SELECT title, content, tags, channel_id, created_at FROM forum_posts WHERE creator_id=$1 ORDER BY created_at DESC"),
        q("SELECT content, post_id, created_at FROM forum_replies WHERE user_id=$1 ORDER BY created_at DESC"),
        q("SELECT reason, comment, status, created_at FROM message_reports WHERE reporter_id=$1 ORDER BY created_at DESC"),
        q("SELECT reason, comment, status, created_at FROM dm_reports WHERE reporter_id=$1 ORDER BY created_at DESC"),
        q("SELECT device_info, last_seen, created_at FROM user_sessions WHERE user_id=$1 ORDER BY last_seen DESC"),
        q("SELECT message_id, remind_at, sent, created_at FROM message_reminders WHERE user_id=$1 ORDER BY remind_at DESC"),
        q("SELECT (to_jsonb(s) - 'user_id') AS settings FROM user_settings s WHERE user_id=$1"),
        q("SELECT name, created_at, last_used_at FROM webauthn_credentials WHERE user_id=$1 ORDER BY created_at"),
        q("SELECT platform, platform_username, platform_url, verified, created_at FROM connected_accounts WHERE user_id=$1 ORDER BY created_at"),
    )?;
    Ok(serde_json::json!({
        "saved_messages": saved,
        "thread_messages": threads,
        "forum_posts": posts,
        "forum_replies": replies,
        "reports_made": reports,
        "dm_reports_made": dm_reports,
        "sessions": sessions,
        "reminders": reminders,
        "settings": settings,
        "passkeys": passkeys,
        "connected_accounts": linked,
    }))
}

/// Lignes lues par requête pour les grosses tables : la mémoire ne dépend plus du nombre de messages.
const EXPORT_PAGE: i64 = 2_000;

/// Une grosse section de l'export : requête paginée (`$1` = compte, `$2` = LIMIT, `$3` = OFFSET) et mise en JSON d'une ligne.
struct BigSection {
    key: &'static str,
    sql: &'static str,
    row: fn(&sqlx::postgres::PgRow) -> serde_json::Value,
}

fn date(r: &sqlx::postgres::PgRow) -> String {
    use sqlx::Row;
    r.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339()
}

const BIG_SECTIONS: [BigSection; 3] = [
    BigSection {
        key: "messages",
        sql: "SELECT m.content, m.enc IS NOT NULL AS encrypted, m.created_at, c.name as channel_name
              FROM messages m JOIN channels c ON c.id = m.channel_id
              WHERE m.user_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2 OFFSET $3",
        row: |m| {
            use sqlx::Row;
            // Chiffré de bout en bout : le serveur n'en a pas le texte.
            serde_json::json!({ "content": m.get::<Option<String>, _>("content"), "channel": m.get::<String, _>("channel_name"),
                "encrypted": m.get::<bool, _>("encrypted"), "date": date(m) })
        },
    },
    BigSection {
        key: "dm_messages",
        sql: "SELECT dm.content, dm.enc IS NOT NULL AS encrypted, dm.created_at, u.username as other_username
              FROM dm_messages dm
              JOIN dm_channels dc ON dc.id = dm.dm_channel_id
              JOIN users u ON u.id = (CASE WHEN dc.user1_id = $1 THEN dc.user2_id ELSE dc.user1_id END)
              WHERE dm.sender_id = $1 ORDER BY dm.created_at DESC, dm.id DESC LIMIT $2 OFFSET $3",
        row: |m| {
            use sqlx::Row;
            serde_json::json!({ "content": m.get::<Option<String>, _>("content"), "with": m.get::<String, _>("other_username"),
                "encrypted": m.get::<bool, _>("encrypted"), "date": date(m) })
        },
    },
    BigSection {
        key: "group_dm_messages",
        sql: "SELECT gm.content, gm.enc IS NOT NULL AS encrypted, gm.created_at, gc.name as group_name
              FROM group_dm_messages gm JOIN group_dm_channels gc ON gc.id = gm.dm_id
              WHERE gm.sender_id = $1 ORDER BY gm.created_at DESC, gm.id DESC LIMIT $2 OFFSET $3",
        row: |m| {
            use sqlx::Row;
            serde_json::json!({ "content": m.get::<Option<String>, _>("content"), "group": m.get::<String, _>("group_name"),
                "encrypted": m.get::<bool, _>("encrypted"), "date": date(m) })
        },
    },
];

type ChunkTx = tokio::sync::mpsc::Sender<std::result::Result<bytes::Bytes, std::io::Error>>;

/// Écrit les grosses sections dans le corps de la réponse, page par page. Une erreur en cours de route
/// coupe la réponse (fichier JSON invalide) : mieux vaut un export qui échoue franchement qu'un export
/// qui se prétend complet sans l'être.
async fn stream_big_sections(db: sqlx::PgPool, uid: Uuid, head: String, tx: ChunkTx) -> std::result::Result<(), ()> {
    async fn send(tx: &ChunkTx, s: String) -> std::result::Result<(), ()> {
        tx.send(Ok(bytes::Bytes::from(s))).await.map_err(|_| ())
    }
    send(&tx, head).await?;
    for sec in &BIG_SECTIONS {
        send(&tx, format!(",\"{}\":[", sec.key)).await?;
        let mut offset = 0i64;
        loop {
            let rows = sqlx::query(sec.sql).bind(uid).bind(EXPORT_PAGE).bind(offset).fetch_all(&db).await.map_err(|e| {
                tracing::error!("export de données : {e}");
            })?;
            let chunk: Vec<String> = rows.iter().map(|r| (sec.row)(r).to_string()).collect();
            if !chunk.is_empty() {
                send(&tx, format!("{}{}", if offset > 0 { "," } else { "" }, chunk.join(","))).await?;
            }
            if (rows.len() as i64) < EXPORT_PAGE {
                break;
            }
            offset += EXPORT_PAGE;
        }
        send(&tx, "]".into()).await?;
    }
    send(&tx, "}".into()).await
}

/// POST /users/me/data-export { auth } (ou { password } pour un compte pas encore migré) : exige la preuve
/// du mot de passe (un jeton volé ne suffit plus à aspirer toutes les conversations) ; réponse en flux.
pub async fn export_user_data(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<impl IntoResponse> {
    use sqlx::Row;

    let uid: Uuid = claims.sub;
    // Export complet et sans borne (tous les messages) : 3 par heure et par compte, sinon un jeton
    // suffisait à répéter la requête la plus lourde du serveur. Redis KO : 503.
    crate::handlers::auth_v2::hit(&state, &format!("data_export:{uid}"), 3, 3600).await?;
    crate::handlers::auth_v2::verify_proof(&state, uid, body["auth"].as_str(), body["password"].as_str()).await?;

    let (user_res, servers, friends) = tokio::join!(
        sqlx::query(
            "SELECT username, email_enc, bio, pronouns, created_at FROM users WHERE id=$1"
        ).bind(uid).fetch_one(&state.db),
        sqlx::query(
            "SELECT s.name FROM servers s
             JOIN server_members sm ON sm.server_id = s.id
             WHERE sm.user_id = $1 ORDER BY s.name"
        ).bind(uid).fetch_all(&state.db),
        sqlx::query(
            "SELECT u.username FROM users u
             JOIN friendships f ON (f.user_id = u.id AND f.friend_id = $1) OR (f.friend_id = u.id AND f.user_id = $1)
             WHERE f.status = 'accepted'
             ORDER BY u.username"
        ).bind(uid).fetch_all(&state.db),
    );
    let user = user_res.map_err(|_| AppError::NotFound("Utilisateur introuvable".into()))?;
    let servers = servers?;
    let friends = friends?;

    let extra = extra_sections(&state, uid).await?;
    let mut export = serde_json::json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "profile": {
            "username": user.get::<String, _>("username"),
            "email": user.get::<Option<String>, _>("email_enc").and_then(|e| crate::email_crypto::open(uid, &e)),
            "bio": user.get::<Option<String>, _>("bio"),
            "pronouns": user.get::<Option<String>, _>("pronouns"),
            "created_at": user.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        },
        "servers": servers.iter().map(|s| s.get::<String, _>("name")).collect::<Vec<String>>(),
        "friends": friends.iter().map(|f| f.get::<String, _>("username")).collect::<Vec<String>>(),
    });
    if let (Some(e), Some(x)) = (export.as_object_mut(), extra.as_object()) {
        e.extend(x.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    // Début de l'objet JSON sans son accolade fermante : les grosses sections suivent dans le flux.
    let mut head = serde_json::to_string(&export).map_err(|e| AppError::Internal(anyhow::anyhow!("Sérialisation: {}", e)))?;
    head.pop();

    let (tx, rx) = tokio::sync::mpsc::channel(4);
    let db = state.db.clone();
    tokio::spawn(async move {
        if stream_big_sections(db, uid, head, tx.clone()).await.is_err() {
            let _ = tx.send(Err(std::io::Error::other("export interrompu"))).await;
        }
    });
    Ok((
        [
            (header::CONTENT_TYPE, "application/json; charset=utf-8"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"forgechat-mes-donnees.json\""),
        ],
        axum::body::Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn big_sections_are_paginated_and_stable() {
        for s in &BIG_SECTIONS {
            assert!(s.sql.contains("LIMIT $2 OFFSET $3"), "{}", s.key);
            assert!(s.sql.contains(".id DESC"), "tri stable : {}", s.key);
        }
    }
}
