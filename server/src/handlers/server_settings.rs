use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{audit::log_event, servers::require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

// ─── Bans ─────────────────────────────────────────────────────────────────────

pub async fn list_bans(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_permission(&state, claims.sub, server_id, Permissions::BAN_MEMBERS | Permissions::BAN_TEMP).await?;

    let rows = sqlx::query(
        "SELECT b.user_id, b.reason, b.banned_at, b.expires_at,
                u.username, u.discriminator, u.avatar
         FROM bans b
         JOIN users u ON u.id = b.user_id
         WHERE b.server_id=$1
         ORDER BY b.banned_at DESC",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "user_id": r.get::<Uuid, _>("user_id"),
                "username": r.get::<String, _>("username"),
                "discriminator": r.get::<String, _>("discriminator"),
                "avatar": r.get::<Option<String>, _>("avatar"),
                "reason": r.get::<Option<String>, _>("reason"),
                "banned_at": r.get::<chrono::DateTime<chrono::Utc>, _>("banned_at"),
                "expires_at": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at"),
            })
        })
        .collect();

    Ok(Json(result))
}

pub async fn unban_member(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::BAN_MEMBERS | Permissions::BAN_TEMP).await?;
    // Lever un ban définitif (expires_at NULL) exige BAN_MEMBERS.
    let expires: Option<Option<chrono::DateTime<chrono::Utc>>> = sqlx::query_scalar(
        "SELECT expires_at FROM bans WHERE server_id=$1 AND user_id=$2"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    if matches!(expires, Some(None))
        && require_permission(&state, claims.sub, server_id, Permissions::BAN_MEMBERS).await.is_err()
    {
        return Err(AppError::ForbiddenMsg(
            "Lever un bannissement définitif exige le droit « Bannir définitivement ».".into(),
        ));
    }

    let result = sqlx::query("DELETE FROM bans WHERE server_id=$1 AND user_id=$2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() > 0 {
        log_event(&state, server_id, "MEMBER_UNBAN", Some(claims.sub), Some(user_id), None, None).await;
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "MEMBER_UNBAN",
            "server_id": server_id,
            "user_id": user_id,
        }).to_string()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Tags de clan ─────────────────────────────────────────────────────────────

/// Fiche publique d'un tag (id, nom, couleur, style validé — models/profile_style::TagStyle).
fn tag_json(r: &sqlx::postgres::PgRow) -> serde_json::Value {
    use sqlx::Row;
    serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "color": r.get::<i32, _>("color"),
        "style": r.get::<Option<serde_json::Value>, _>("style"),
    })
}

/// Tags de clan des membres d'un serveur (d'un seul membre si `user` est donné),
/// pour les afficher à côté des pseudos (liste des membres, messages, profils).
pub async fn member_tags(state: &AppState, server_id: Uuid, user: Option<Uuid>) -> Result<std::collections::HashMap<Uuid, Vec<serde_json::Value>>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT mt.user_id, st.id, st.name, st.color, st.style
         FROM member_tags mt
         JOIN server_tags st ON st.id = mt.tag_id
         WHERE mt.server_id=$1 AND ($2::uuid IS NULL OR mt.user_id = $2)
         ORDER BY st.name",
    )
    .bind(server_id)
    .bind(user)
    .fetch_all(&state.db)
    .await?;
    let mut out: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = std::collections::HashMap::new();
    for r in &rows {
        out.entry(r.get("user_id")).or_default().push(tag_json(r));
    }
    Ok(out)
}

/// Nom de tag : 1 à 32 caractères visibles (pas de caractères invisibles ni de contrôle).
fn tag_name(v: &serde_json::Value) -> Result<String> {
    let raw = v.as_str().unwrap_or("");
    crate::models::profile_style::clean_label(raw, 32, "Nom du tag")
        .map_err(AppError::BadRequest)?
        .ok_or_else(|| AppError::BadRequest("name requis (1-32 chars)".into()))
}

/// Couleur 0xRRGGBB (avant : n'importe quel entier était stocké).
fn tag_color(v: &serde_json::Value) -> Result<Option<i32>> {
    match v {
        serde_json::Value::Null => Ok(None),
        v => v.as_i64()
            .filter(|c| (0..=0xFF_FFFF).contains(c))
            .map(|c| Some(c as i32))
            .ok_or_else(|| AppError::BadRequest("Couleur du tag invalide (0xRRGGBB)".into())),
    }
}

fn tag_style(v: &serde_json::Value) -> Result<Option<serde_json::Value>> {
    crate::models::profile_style::parse_tag_style(v).map_err(|e| AppError::BadRequest(e.into()))
}

pub async fn list_tags(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use crate::handlers::servers::require_member;
    require_member(&state, claims.sub, server_id).await?;

    let rows = sqlx::query(
        "SELECT id, name, color, style, created_at FROM server_tags WHERE server_id=$1 ORDER BY name",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = rows
        .iter()
        .map(|r| {
            let mut tag = tag_json(r);
            tag["created_at"] = serde_json::json!(r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"));
            tag
        })
        .collect();

    Ok(Json(result))
}

pub async fn create_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    let name = tag_name(&body["name"])?;
    let color = tag_color(&body["color"])?.unwrap_or(7506394);
    let style = tag_style(&body["style"])?;

    let row = sqlx::query(
        "INSERT INTO server_tags (server_id, name, color, style) VALUES ($1, $2, $3, $4)
         RETURNING id, name, color, style, created_at",
    )
    .bind(server_id)
    .bind(&name)
    .bind(color)
    .bind(style)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    let mut tag = tag_json(&row);
    tag["created_at"] = serde_json::json!(row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"));

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "SERVER_TAG_CREATE",
        "server_id": server_id,
        "tag": &tag,
    }).to_string()).await;

    Ok(Json(tag))
}

/// PATCH /servers/:server_id/tags/:tag_id { color?, style? } — couleur 0xRRGGBB et style
/// en liste blanche ; un champ absent reste inchangé, `style: {}` retire le style.
pub async fn update_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, tag_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;
    let color = tag_color(&body["color"])?;
    let has_style = body.get("style").is_some();
    let style = tag_style(&body["style"])?;

    let row = sqlx::query(
        "UPDATE server_tags SET color = COALESCE($3, color),
                style = CASE WHEN $4 THEN $5 ELSE style END
         WHERE id=$1 AND server_id=$2
         RETURNING id, name, color, style",
    )
    .bind(tag_id)
    .bind(server_id)
    .bind(color)
    .bind(has_style)
    .bind(style)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Tag introuvable".into()))?;
    let tag = tag_json(&row);

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "SERVER_TAG_UPDATE",
        "server_id": server_id,
        "tag": &tag,
    }).to_string()).await;

    Ok(Json(tag))
}

pub async fn delete_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    let deleted = sqlx::query("DELETE FROM server_tags WHERE id=$1 AND server_id=$2")
        .bind(tag_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;

    if deleted.rows_affected() > 0 {
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "SERVER_TAG_DELETE",
            "server_id": server_id,
            "tag_id": tag_id,
        }).to_string()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn assign_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id, tag_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    // Vérifier que la cible est bien membre du serveur (évite IDOR sur user_id arbitraire)
    let is_member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)"
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;
    if !is_member {
        return Err(crate::error::AppError::NotFound("Membre introuvable".into()));
    }

    // Vérifier que le tag appartient bien à ce serveur (IDOR)
    let tag_ok = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_tags WHERE id=$1 AND server_id=$2)"
    )
    .bind(tag_id)
    .bind(server_id)
    .fetch_one(&state.db)
    .await?;
    if !tag_ok {
        return Err(crate::error::AppError::NotFound("Tag introuvable".into()));
    }

    sqlx::query(
        "INSERT INTO member_tags (user_id, server_id, tag_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(tag_id)
    .execute(&state.db)
    .await?;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_TAG_ASSIGN",
        "server_id": server_id,
        "user_id": user_id,
        "tag_id": tag_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn remove_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, user_id, tag_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    sqlx::query(
        "DELETE FROM member_tags WHERE user_id=$1 AND server_id=$2 AND tag_id=$3",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(tag_id)
    .execute(&state.db)
    .await?;

    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_TAG_REMOVE",
        "server_id": server_id,
        "user_id": user_id,
        "tag_id": tag_id,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Membres avec rôles & tags (vue enrichie) ────────────────────────────────

pub async fn get_members_detailed(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use crate::handlers::servers::require_member;
    require_member(&state, claims.sub, server_id).await?;

    use sqlx::Row;

    // Membres avec rôles et tags en 3 requêtes parallèles (au lieu de 2N+1)
    let (members_res, roles_res, tags_res) = tokio::join!(
        sqlx::query(
            "SELECT sm.user_id, sm.nickname, sm.joined_at, sm.is_owner,
                    u.username, u.discriminator, COALESCE(sm.server_avatar, u.avatar) AS avatar, u.status
             FROM server_members sm
             JOIN users u ON u.id = sm.user_id
             WHERE sm.server_id=$1
             ORDER BY sm.is_owner DESC, u.username",
        )
        .bind(server_id)
        .fetch_all(&state.db),
        sqlx::query(
            "SELECT mr.user_id, r.id, r.name, r.color
             FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.server_id=$1",
        )
        .bind(server_id)
        .fetch_all(&state.db),
        member_tags(&state, server_id, None),
    );
    let members = members_res?;
    let roles_rows = roles_res.unwrap_or_default();
    let tags_by_user = tags_res.unwrap_or_default();

    use std::collections::HashMap;
    let mut roles_by_user: HashMap<Uuid, Vec<serde_json::Value>> = HashMap::new();
    for r in &roles_rows {
        let uid: Uuid = r.get("user_id");
        roles_by_user.entry(uid).or_default().push(serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "color": r.get::<i32, _>("color"),
        }));
    }

    let result: Vec<serde_json::Value> = members.iter().map(|m| {
        let uid: Uuid = m.get("user_id");
        serde_json::json!({
            "user_id": uid,
            "username": m.get::<String, _>("username"),
            "discriminator": m.get::<String, _>("discriminator"),
            "avatar": m.get::<Option<String>, _>("avatar"),
            "status": m.get::<String, _>("status"),
            "nickname": m.get::<Option<String>, _>("nickname"),
            "is_owner": m.get::<bool, _>("is_owner"),
            "joined_at": m.get::<chrono::DateTime<chrono::Utc>, _>("joined_at"),
            "roles": roles_by_user.get(&uid).cloned().unwrap_or_default(),
            "tags": tags_by_user.get(&uid).cloned().unwrap_or_default(),
        })
    }).collect();

    Ok(Json(result))
}
