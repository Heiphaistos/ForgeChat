use axum::{extract::{Path, State}, Extension, Json};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_permission,
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
    require_permission(&state, claims.sub, server_id, Permissions::BAN_MEMBERS).await?;

    let rows = sqlx::query(
        "SELECT b.user_id, b.reason, b.banned_at,
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
    require_permission(&state, claims.sub, server_id, Permissions::BAN_MEMBERS).await?;

    let result = sqlx::query("DELETE FROM bans WHERE server_id=$1 AND user_id=$2")
        .bind(server_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() > 0 {
        state.broadcast_to_server_members(server_id, serde_json::json!({
            "type": "MEMBER_UNBAN",
            "server_id": server_id,
            "user_id": user_id,
        }).to_string()).await;
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Tags de clan ─────────────────────────────────────────────────────────────

pub async fn list_tags(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    use crate::handlers::servers::require_member;
    require_member(&state, claims.sub, server_id).await?;

    let rows = sqlx::query(
        "SELECT id, name, color, created_at FROM server_tags WHERE server_id=$1 ORDER BY name",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    use sqlx::Row;
    let result = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.get::<Uuid, _>("id"),
                "name": r.get::<String, _>("name"),
                "color": r.get::<i32, _>("color"),
                "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
            })
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

    let name = body["name"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 32)
        .ok_or_else(|| AppError::BadRequest("name requis (1-32 chars)".into()))?;

    let color: i32 = body["color"].as_i64().unwrap_or(7506394) as i32;

    let row = sqlx::query(
        "INSERT INTO server_tags (server_id, name, color) VALUES ($1, $2, $3)
         RETURNING id, name, color, created_at",
    )
    .bind(server_id)
    .bind(name)
    .bind(color)
    .fetch_one(&state.db)
    .await?;

    use sqlx::Row;
    Ok(Json(serde_json::json!({
        "id": row.get::<Uuid, _>("id"),
        "name": row.get::<String, _>("name"),
        "color": row.get::<i32, _>("color"),
        "created_at": row.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
    })))
}

pub async fn delete_tag(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_ROLES).await?;

    sqlx::query("DELETE FROM server_tags WHERE id=$1 AND server_id=$2")
        .bind(tag_id)
        .bind(server_id)
        .execute(&state.db)
        .await?;

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

    // Membres avec rôles et tags en 3 requêtes (au lieu de 2N+1)
    let members = sqlx::query(
        "SELECT sm.user_id, sm.nickname, sm.joined_at, sm.is_owner,
                u.username, u.discriminator, u.avatar, u.status
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id=$1
         ORDER BY sm.is_owner DESC, u.username",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let roles_rows = sqlx::query(
        "SELECT mr.user_id, r.id, r.name, r.color
         FROM member_roles mr
         JOIN roles r ON r.id = mr.role_id
         WHERE mr.server_id=$1",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

    let tags_rows = sqlx::query(
        "SELECT mt.user_id, st.id, st.name, st.color
         FROM member_tags mt
         JOIN server_tags st ON st.id = mt.tag_id
         WHERE mt.server_id=$1",
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?;

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

    let mut tags_by_user: HashMap<Uuid, Vec<serde_json::Value>> = HashMap::new();
    for t in &tags_rows {
        let uid: Uuid = t.get("user_id");
        tags_by_user.entry(uid).or_default().push(serde_json::json!({
            "id": t.get::<Uuid, _>("id"),
            "name": t.get::<String, _>("name"),
            "color": t.get::<i32, _>("color"),
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
