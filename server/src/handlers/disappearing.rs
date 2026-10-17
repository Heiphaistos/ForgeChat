//! Messages éphémères par conversation (MP, groupe, salon) et réglages de discussion
//! d'un salon (fils automatiques). Le serveur ne voit que du chiffré : à l'échéance,
//! il supprime la ligne et les fichiers joints, comme une suppression normale, et
//! prévient les membres (MESSAGE_DELETE, DM_MESSAGE_DELETE, GROUP_DM_MESSAGE_DELETE).

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{channel_access::CAN_EDIT, e2e_conv::Conv, password_reset::over_limit},
    middleware::auth::Claims,
    models::serde_helpers::deserialize_double_option,
    state::AppState,
};

/// Durées proposées : 1 h, 24 h, 7 jours. `0` = « après lecture » (MP et groupes seulement).
pub const DURATIONS: [i32; 3] = [3600, 86_400, 604_800];
/// Délai entre la lecture par tous les destinataires et la suppression d'un message « après lecture ».
pub const AFTER_READ_GRACE_SECS: i64 = 300;

/// Réglage accepté : `None` (désactivé), une durée proposée, ou `0` quand « après lecture » est permis.
pub fn validate(seconds: Option<i32>, allow_after_read: bool) -> Result<Option<i32>> {
    match seconds {
        None => Ok(None),
        Some(0) if allow_after_read => Ok(Some(0)),
        Some(s) if DURATIONS.contains(&s) => Ok(Some(s)),
        _ => Err(AppError::BadRequest("Durée invalide : 1 h, 24 h, 7 jours ou après lecture".into())),
    }
}

/// Échéance d'un nouveau message d'après le réglage de sa conversation : `(expires_at, expire_on_read)`.
pub fn expiry(setting: Option<i32>, now: DateTime<Utc>) -> (Option<DateTime<Utc>>, bool) {
    match setting {
        Some(0) => (None, true),
        Some(s) if s > 0 => (Some(now + Duration::seconds(i64::from(s))), false),
        _ => (None, false),
    }
}

/// Réglage courant d'une conversation (NULL si désactivé ou conversation inconnue).
pub async fn setting(db: &PgPool, conv: Conv) -> Result<Option<i32>> {
    let sql = match conv {
        Conv::Dm(_) => "SELECT disappear_seconds FROM dm_channels WHERE id=$1",
        Conv::Group(_) => "SELECT disappear_seconds FROM group_dm_channels WHERE id=$1",
        Conv::Channel(_) => "SELECT disappear_seconds FROM channels WHERE id=$1",
    };
    Ok(sqlx::query_scalar::<_, Option<i32>>(sql).bind(conv.id()).fetch_optional(db).await?.flatten())
}

/// MP ou groupe seulement (un salon se règle par ses réglages, avec permission).
fn private_conv(kind: &str, id: Uuid) -> Result<Conv> {
    match Conv::parse(kind, id)? {
        Conv::Channel(_) => Err(AppError::NotFound("Conversation introuvable".into())),
        c => Ok(c),
    }
}

/// GET /api/disappearing/:kind/:id (MP ou groupe, membres seulement)
pub async fn get_setting(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
) -> Result<Json<Value>> {
    let conv = private_conv(&kind, id)?;
    crate::handlers::e2e_conv::require_member(&state.db, conv, claims.sub).await?;
    Ok(Json(json!({ "seconds": setting(&state.db, conv).await? })))
}

#[derive(Deserialize)]
pub struct SetBody {
    pub seconds: Option<i32>,
}

/// PUT /api/disappearing/:kind/:id { seconds } : tout membre d'un MP ou d'un groupe (comme Signal).
pub async fn set_setting(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
    Json(body): Json<SetBody>,
) -> Result<Json<Value>> {
    let conv = private_conv(&kind, id)?;
    let members = crate::handlers::e2e_conv::require_member(&state.db, conv, claims.sub).await?;
    let seconds = validate(body.seconds, true)?;
    if over_limit(&state, &format!("disappear:{}", claims.sub), 20, 60).await {
        return Err(AppError::TooManyRequests);
    }
    let sql = match conv {
        Conv::Dm(_) => "UPDATE dm_channels SET disappear_seconds=$2 WHERE id=$1",
        _ => "UPDATE group_dm_channels SET disappear_seconds=$2 WHERE id=$1",
    };
    sqlx::query(sql).bind(id).bind(seconds).execute(&state.db).await?;
    let event = json!({
        "type": "DISAPPEARING_UPDATE",
        "conv_kind": conv.kind(),
        "conv_id": id,
        "seconds": seconds,
        "by": claims.sub,
    })
    .to_string();
    for uid in members {
        state.broadcast_to_user(uid, event.clone()).await;
    }
    Ok(Json(json!({ "seconds": seconds })))
}

#[derive(Deserialize)]
pub struct ChannelMessagingBody {
    /// Absent : inchangé ; `null` : désactivé ; sinon une durée proposée (pas « après lecture »).
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub disappear_seconds: Option<Option<i32>>,
    pub auto_threads: Option<bool>,
}

/// PUT /api/servers/:server_id/channels/:channel_id/messaging : messages éphémères et
/// fils automatiques d'un salon, avec le droit de modifier les salons.
pub async fn set_channel_messaging(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<ChannelMessagingBody>,
) -> Result<Json<Value>> {
    crate::handlers::channel_access::require_channel_manage(&state, claims.sub, server_id, channel_id, CAN_EDIT).await?;
    let disappear = body.disappear_seconds.map(|s| validate(s, false)).transpose()?;
    let row = sqlx::query(
        "UPDATE channels SET
            disappear_seconds = CASE WHEN $3 THEN $4 ELSE disappear_seconds END,
            auto_threads = COALESCE($5, auto_threads)
         WHERE id=$1 AND server_id=$2 AND type IN ('text', 'announcement')
         RETURNING disappear_seconds, auto_threads",
    )
    .bind(channel_id)
    .bind(server_id)
    .bind(disappear.is_some())
    .bind(disappear.flatten())
    .bind(body.auto_threads)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Réglage réservé aux salons textuels".into()))?;
    let out = json!({
        "id": channel_id,
        "server_id": server_id,
        "disappear_seconds": row.get::<Option<i32>, _>("disappear_seconds"),
        "auto_threads": row.get::<bool, _>("auto_threads"),
    });
    let event = json!({ "type": "CHANNEL_UPDATE", "server_id": server_id, "channel": out });
    state.broadcast_to_channel_members(channel_id, event.to_string()).await;
    Ok(Json(out))
}

// ─── Purge (tâche de fond, toutes les 60 s) ───────────────────────────────────

/// MP et groupes : messages « après lecture » lus par tous les destinataires → échéance dans
/// AFTER_READ_GRACE_SECS ; puis suppression des messages échus, de leurs fichiers, et diffusion.
pub async fn purge_private(state: &AppState) {
    if let Err(e) = purge_private_inner(state).await {
        tracing::error!("Purge des messages éphémères privés : {e}");
    }
}

/// Messages supprimés par la purge : `(message, conversation, MP ?)` et adresses des fichiers.
pub struct Purged {
    pub messages: Vec<(Uuid, Uuid, bool)>,
    pub urls: Vec<String>,
}

/// « Après lecture » : un message lu par tous ses destinataires reçoit son échéance.
pub async fn arm_read_messages(db: &PgPool) -> Result<()> {
    let grace = format!("{AFTER_READ_GRACE_SECS} seconds");
    // MP : lu par l'autre participant (accusé de lecture postérieur au message).
    sqlx::query(
        "UPDATE dm_messages m SET expires_at = NOW() + $1::interval
         FROM dm_channels d
         JOIN dm_read_receipts r ON r.dm_id = d.id
         WHERE m.expire_on_read AND m.expires_at IS NULL AND d.id = m.dm_channel_id
           AND r.user_id = CASE WHEN d.user1_id = m.sender_id THEN d.user2_id ELSE d.user1_id END
           AND r.last_read_at >= m.created_at",
    )
    .bind(&grace)
    .execute(db)
    .await?;
    // Groupe : lu par tous les autres membres.
    sqlx::query(
        "UPDATE group_dm_messages m SET expires_at = NOW() + $1::interval
         WHERE m.expire_on_read AND m.expires_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM group_dm_members gm
             WHERE gm.dm_id = m.dm_id AND gm.user_id <> m.sender_id
               AND NOT EXISTS (
                 SELECT 1 FROM dm_read_receipts r
                 WHERE r.dm_id = gm.dm_id AND r.user_id = gm.user_id AND r.last_read_at >= m.created_at))",
    )
    .bind(&grace)
    .execute(db)
    .await?;
    Ok(())
}

/// Supprime les messages privés échus. Le SELECT externe lit l'instantané d'avant le
/// DELETE : les pièces jointes (supprimées en cascade) y sont encore visibles.
pub async fn delete_expired(db: &PgPool) -> Result<Purged> {
    let dms = sqlx::query(
        "WITH gone AS (
            DELETE FROM dm_messages WHERE expires_at IS NOT NULL AND expires_at < NOW()
            RETURNING id, dm_channel_id
         )
         SELECT g.id, g.dm_channel_id AS conv, TRUE AS dm, a.url
         FROM gone g LEFT JOIN attachments a ON a.dm_message_id = g.id",
    )
    .fetch_all(db)
    .await?;
    let groups = sqlx::query(
        "WITH gone AS (
            DELETE FROM group_dm_messages WHERE expires_at IS NOT NULL AND expires_at < NOW()
            RETURNING id, dm_id
         )
         SELECT g.id, g.dm_id AS conv, FALSE AS dm, a.url
         FROM gone g LEFT JOIN attachments a ON a.group_dm_message_id = g.id",
    )
    .fetch_all(db)
    .await?;
    let mut out = Purged { messages: Vec::new(), urls: Vec::new() };
    let mut seen = std::collections::HashSet::new();
    for r in dms.iter().chain(groups.iter()) {
        if let Some(u) = r.get::<Option<String>, _>("url") {
            out.urls.push(u);
        }
        let id: Uuid = r.get("id");
        if seen.insert(id) {
            out.messages.push((id, r.get("conv"), r.get("dm")));
        }
    }
    Ok(out)
}

async fn purge_private_inner(state: &AppState) -> Result<()> {
    arm_read_messages(&state.db).await?;
    let purged = delete_expired(&state.db).await?;
    // ponytail: une requête de membres par message ; regrouper par conversation si la purge devient massive.
    for (id, conv, dm) in purged.messages {
        let (event, members) = if dm {
            let ev = json!({ "type": "DM_MESSAGE_DELETE", "dm_id": conv, "message_id": id, "expired": true });
            (ev, crate::handlers::e2e_conv::members(&state.db, Conv::Dm(conv)).await.unwrap_or_default())
        } else {
            let ev = json!({ "type": "GROUP_DM_MESSAGE_DELETE", "group_id": conv, "message_id": id, "expired": true });
            (ev, crate::handlers::e2e_conv::members(&state.db, Conv::Group(conv)).await.unwrap_or_default())
        };
        let event = event.to_string();
        for uid in members {
            state.broadcast_to_user(uid, event.clone()).await;
        }
    }
    crate::handlers::uploads::remove_upload_files(state, purged.urls);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepted_durations() {
        assert_eq!(validate(None, false).unwrap(), None);
        for s in DURATIONS {
            assert_eq!(validate(Some(s), false).unwrap(), Some(s));
        }
        assert_eq!(validate(Some(0), true).unwrap(), Some(0));
        assert!(validate(Some(0), false).is_err(), "salon : pas d'« après lecture »");
        for bad in [-1, 1, 59, 3599, 999_999_999] {
            assert!(validate(Some(bad), true).is_err());
        }
    }

    #[test]
    fn expiry_from_setting() {
        let now = Utc::now();
        assert_eq!(expiry(None, now), (None, false));
        assert_eq!(expiry(Some(0), now), (None, true));
        assert_eq!(expiry(Some(3600), now), (Some(now + Duration::hours(1)), false));
        assert_eq!(expiry(Some(-5), now), (None, false));
    }

    /// Contre un vrai PostgreSQL : `FORGECHAT_TEST_DATABASE_URL=postgres://... cargo test -- --ignored disappearing_`
    #[tokio::test]
    #[ignore]
    async fn disappearing_purge_db() {
        let url = std::env::var("FORGECHAT_TEST_DATABASE_URL").expect("FORGECHAT_TEST_DATABASE_URL");
        let db = PgPool::connect(&url).await.unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let mut users = Vec::new();
        for _ in 0..3 {
            let tag = Uuid::new_v4().simple().to_string();
            users.push(
                sqlx::query_scalar::<_, Uuid>("INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id")
                    .bind(&tag[..20]).bind(format!("{tag}@test.local")).fetch_one(&db).await.unwrap(),
            );
        }
        let (a, b, c) = (users[0], users[1], users[2]);
        let read = |conv: Uuid, who: Uuid| {
            let db = db.clone();
            async move {
                sqlx::query("INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at) VALUES ($1, $2, NOW())
                             ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at = NOW()")
                    .bind(conv).bind(who).execute(&db).await.unwrap();
            }
        };
        let send = |sql: &'static str, conv: Uuid, who: Uuid, exp: Option<DateTime<Utc>>, on_read: bool| {
            let db = db.clone();
            async move {
                sqlx::query_scalar::<_, Uuid>(sql).bind(conv).bind(who).bind(exp).bind(on_read).fetch_one(&db).await.unwrap()
            }
        };
        let expires = |sql: &'static str, id: Uuid| {
            let db = db.clone();
            async move { sqlx::query_scalar::<_, Option<DateTime<Utc>>>(sql).bind(id).fetch_one(&db).await.unwrap() }
        };
        const DM: &str = "INSERT INTO dm_messages (dm_channel_id, sender_id, expires_at, expire_on_read) VALUES ($1, $2, $3, $4) RETURNING id";
        const GR: &str = "INSERT INTO group_dm_messages (dm_id, sender_id, expires_at, expire_on_read) VALUES ($1, $2, $3, $4) RETURNING id";
        const DM_EXP: &str = "SELECT expires_at FROM dm_messages WHERE id=$1";
        const GR_EXP: &str = "SELECT expires_at FROM group_dm_messages WHERE id=$1";

        let dm: Uuid = sqlx::query_scalar("INSERT INTO dm_channels (user1_id, user2_id, disappear_seconds) VALUES ($1, $2, 0) RETURNING id")
            .bind(a).bind(b).fetch_one(&db).await.unwrap();
        assert_eq!(setting(&db, Conv::Dm(dm)).await.unwrap(), Some(0));
        let on_read = send(DM, dm, a, None, true).await;
        let past = send(DM, dm, a, Some(Utc::now() - Duration::seconds(5)), false).await;
        let future = send(DM, dm, a, Some(Utc::now() + Duration::hours(1)), false).await;
        let att_url = format!("/uploads/{}.enc", Uuid::new_v4());
        sqlx::query("INSERT INTO attachments (dm_message_id, filename, content_type, size, url) VALUES ($1, 'x.enc', 'application/octet-stream', 1, $2)")
            .bind(past).bind(&att_url).execute(&db).await.unwrap();

        // Non lu par le destinataire (l'auteur ne compte pas) : pas d'échéance.
        read(dm, a).await;
        arm_read_messages(&db).await.unwrap();
        assert!(expires(DM_EXP, on_read).await.is_none());
        let purged = delete_expired(&db).await.unwrap();
        assert!(purged.messages.contains(&(past, dm, true)));
        assert!(purged.urls.contains(&att_url), "fichier joint effacé du disque");
        assert!(!purged.messages.iter().any(|m| m.0 == future || m.0 == on_read));

        // Lu par le destinataire : échéance dans le délai de grâce.
        read(dm, b).await;
        arm_read_messages(&db).await.unwrap();
        let left = expires(DM_EXP, on_read).await.expect("échéance posée") - Utc::now();
        assert!(left > Duration::seconds(AFTER_READ_GRACE_SECS - 30) && left <= Duration::seconds(AFTER_READ_GRACE_SECS));

        // Groupe : seulement quand TOUS les autres membres ont lu.
        let g: Uuid = sqlx::query_scalar("INSERT INTO group_dm_channels (owner_id) VALUES ($1) RETURNING id").bind(a).fetch_one(&db).await.unwrap();
        for m in [a, b, c] {
            sqlx::query("INSERT INTO group_dm_members (dm_id, user_id) VALUES ($1, $2)").bind(g).bind(m).execute(&db).await.unwrap();
        }
        let gm = send(GR, g, a, None, true).await;
        read(g, b).await;
        arm_read_messages(&db).await.unwrap();
        assert!(expires(GR_EXP, gm).await.is_none(), "un membre n'a pas lu");
        read(g, c).await;
        arm_read_messages(&db).await.unwrap();
        assert!(expires(GR_EXP, gm).await.is_some());
        sqlx::query("UPDATE group_dm_messages SET expires_at = NOW() - INTERVAL '1 second' WHERE id=$1").bind(gm).execute(&db).await.unwrap();
        let purged = delete_expired(&db).await.unwrap();
        assert!(purged.messages.contains(&(gm, g, false)));
    }
}
