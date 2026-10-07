use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::require_owner,
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

// ─── Modèles ───────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ServerTemplate {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub creator_id: Option<Uuid>,
    pub server_id: Option<Uuid>,
    pub is_public: bool,
    pub usage_count: i32,
    pub template_data: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTemplateRequest {
    pub name: String,
    pub description: Option<String>,
    pub is_public: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UseTemplateRequest {
    pub name: String,
}

// ─── Format des modèles ────────────────────────────────────
// { categories: [{id, name, position, staff_only?}],
//   channels: [{name, type, topic?, position, category_id?, overrides?: [{role: "everyone"|<index dans roles>, allow, deny}]}],
//   roles: [{name, permissions, position, color}] }
// Structure seulement : jamais un message, un membre ni un fichier.

const CHANNEL_TYPES: &[&str] = &["text", "announcement", "forum", "media", "voice", "video", "stage"];

#[derive(Debug)]
pub struct TplCategory { pub key: String, pub name: String, pub staff_only: bool }
#[derive(Debug, PartialEq)]
pub enum RoleRef { Everyone, Index(usize) }
#[derive(Debug)]
pub struct TplChannel {
    pub name: String,
    pub kind: String,
    pub topic: Option<String>,
    pub category: Option<String>,
    pub overrides: Vec<(RoleRef, i64, i64)>,
}
#[derive(Debug)]
pub struct TplRole { pub name: String, pub permissions: i64, pub position: i32, pub color: i32 }
#[derive(Debug)]
pub struct ParsedTemplate { pub categories: Vec<TplCategory>, pub channels: Vec<TplChannel>, pub roles: Vec<TplRole> }

fn tpl_name(v: &serde_json::Value) -> Option<String> {
    let n = v.as_str()?.trim();
    (!n.is_empty() && n.len() <= 100).then(|| n.to_string())
}

fn key_of(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) if !s.is_empty() => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Lit un modèle (intégré, enregistré ou public, donc saisi par des tiers) en le validant.
pub fn parse_template(data: &serde_json::Value) -> std::result::Result<ParsedTemplate, String> {
    let arr = |k: &str| data[k].as_array().cloned().unwrap_or_default();
    let (cats, chans, roles) = (arr("categories"), arr("channels"), arr("roles"));
    if cats.len() > 50 || chans.len() > 200 || roles.len() > 50 {
        return Err("Modèle trop grand (50 catégories, 200 salons, 50 rôles au plus)".into());
    }
    let pos = |v: &serde_json::Value| v["position"].as_i64().unwrap_or(0);
    let mut cats_sorted: Vec<&serde_json::Value> = cats.iter().collect();
    cats_sorted.sort_by_key(|c| pos(c));
    let categories = cats_sorted.iter().enumerate().map(|(i, c)| Ok(TplCategory {
        key: key_of(&c["id"]).unwrap_or_else(|| format!("#{i}")),
        name: tpl_name(&c["name"]).ok_or("Nom de catégorie invalide")?,
        staff_only: c["staff_only"].as_bool().unwrap_or(false),
    })).collect::<std::result::Result<Vec<_>, String>>()?;
    let roles = roles.iter().enumerate().map(|(i, r)| Ok(TplRole {
        name: tpl_name(&r["name"]).filter(|n| n != "@everyone").ok_or("Nom de rôle invalide")?,
        permissions: r["permissions"].as_i64().unwrap_or(0),
        position: r["position"].as_i64().unwrap_or(i as i64 + 1).clamp(1, 1000) as i32,
        color: r["color"].as_i64().unwrap_or(0) as i32,
    })).collect::<std::result::Result<Vec<_>, String>>()?;
    let mut chans_sorted: Vec<&serde_json::Value> = chans.iter().collect();
    chans_sorted.sort_by_key(|c| pos(c));
    let channels = chans_sorted.iter().map(|c| {
        let kind = c["type"].as_str().unwrap_or("text");
        if !CHANNEL_TYPES.contains(&kind) {
            return Err(format!("Type de salon inconnu : {kind}"));
        }
        let overrides = c["overrides"].as_array().cloned().unwrap_or_default().iter().take(20).filter_map(|o| {
            let role = match &o["role"] {
                serde_json::Value::String(s) if s == "everyone" => RoleRef::Everyone,
                serde_json::Value::Number(n) => RoleRef::Index(n.as_u64().filter(|i| (*i as usize) < roles.len())? as usize),
                _ => return None,
            };
            Some((role, o["allow"].as_i64().unwrap_or(0), o["deny"].as_i64().unwrap_or(0)))
        }).collect();
        Ok(TplChannel {
            name: tpl_name(&c["name"]).ok_or("Nom de salon invalide")?,
            kind: kind.to_string(),
            topic: c["topic"].as_str().map(|t| t.chars().take(1024).collect()),
            category: key_of(&c["category_id"]),
            overrides,
        })
    }).collect::<std::result::Result<Vec<_>, String>>()?;
    Ok(ParsedTemplate { categories, channels, roles })
}

/// Permissions de @everyone d'un nouveau serveur.
pub const EVERYONE_PERMS: i64 = Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES
    | Permissions::READ_HISTORY | Permissions::ADD_REACTIONS | Permissions::ATTACH_FILES
    | Permissions::CONNECT_VOICE | Permissions::SPEAK_VOICE | Permissions::STREAM;

/// Crée un serveur (propriétaire, @everyone) puis sa structure, en une transaction.
/// Sans modèle, ou modèle vide : un salon « général ». Un modèle qui n'a que des
/// catégories (Jötunheim) ne crée AUCUN salon.
pub async fn create_server_from(
    state: &AppState,
    owner: Uuid,
    name: &str,
    description: Option<&str>,
    is_public: bool,
    tpl: Option<&ParsedTemplate>,
) -> Result<crate::models::server::Server> {
    if name.len() < 2 || name.len() > 100 {
        return Err(AppError::BadRequest("Nom serveur 2-100 chars".into()));
    }
    let owned: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE owner_id=$1")
        .bind(owner).fetch_one(&state.db).await?;
    if owned >= 100 {
        return Err(AppError::BadRequest("Limite de 100 serveurs atteinte".into()));
    }
    let mut tx = state.db.begin().await?;
    let server = sqlx::query_as::<_, crate::models::server::Server>(
        "INSERT INTO servers (name, description, owner_id, invite_code, is_public)
         VALUES ($1, $2, $3, $4, $5) RETURNING *"
    )
    .bind(name).bind(description).bind(owner)
    .bind(crate::handlers::servers::generate_invite_code())
    .bind(is_public)
    .fetch_one(&mut *tx).await?;
    let everyone: Uuid = sqlx::query_scalar(
        "INSERT INTO roles (server_id, name, permissions, position, is_everyone)
         VALUES ($1, '@everyone', $2, 0, true) RETURNING id"
    ).bind(server.id).bind(EVERYONE_PERMS).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, true)")
        .bind(owner).bind(server.id).execute(&mut *tx).await?;

    match tpl.filter(|t| !t.categories.is_empty() || !t.channels.is_empty()) {
        None => {
            sqlx::query("INSERT INTO channels (server_id, name, type, position, created_by) VALUES ($1, 'général', 'text', 0, $2)")
                .bind(server.id).bind(owner).execute(&mut *tx).await?;
        }
        Some(t) => {
            let mut role_ids = Vec::with_capacity(t.roles.len());
            for r in &t.roles {
                role_ids.push(sqlx::query_scalar::<_, Uuid>(
                    "INSERT INTO roles (server_id, name, permissions, position, color) VALUES ($1, $2, $3, $4, $5) RETURNING id"
                ).bind(server.id).bind(&r.name).bind(r.permissions).bind(r.position).bind(r.color)
                .fetch_one(&mut *tx).await?);
            }
            let mut cats: std::collections::HashMap<&str, (Uuid, bool)> = Default::default();
            for (i, c) in t.categories.iter().enumerate() {
                let id: Uuid = sqlx::query_scalar(
                    "INSERT INTO categories (server_id, name, position, created_by, staff_only) VALUES ($1, $2, $3, $4, $5) RETURNING id"
                ).bind(server.id).bind(&c.name).bind(i as i32).bind(owner).bind(c.staff_only)
                .fetch_one(&mut *tx).await?;
                cats.insert(c.key.as_str(), (id, c.staff_only));
            }
            for (i, ch) in t.channels.iter().enumerate() {
                let cat = ch.category.as_deref().and_then(|k| cats.get(k)).copied();
                let id: Uuid = sqlx::query_scalar(
                    "INSERT INTO channels (server_id, category_id, name, type, topic, position, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id"
                ).bind(server.id).bind(cat.map(|c| c.0)).bind(&ch.name).bind(&ch.kind)
                .bind(&ch.topic).bind(i as i32).bind(owner)
                .fetch_one(&mut *tx).await?;
                let mut overrides: Vec<(Uuid, i64, i64)> = ch.overrides.iter().map(|(r, a, d)| (match r {
                    RoleRef::Everyone => everyone,
                    RoleRef::Index(i) => role_ids[*i],
                }, *a, *d)).collect();
                // Salon d'une catégorie réservée au staff : invisible pour @everyone.
                if cat.is_some_and(|c| c.1) && !overrides.iter().any(|o| o.0 == everyone) {
                    overrides.push((everyone, 0, Permissions::VIEW_CHANNEL));
                }
                for (target, allow, deny) in overrides {
                    sqlx::query(
                        "INSERT INTO channel_permissions (channel_id, target_id, target_type, allow, deny)
                         VALUES ($1, $2, 'role', $3, $4) ON CONFLICT (channel_id, target_id) DO NOTHING"
                    ).bind(id).bind(target).bind(allow).bind(deny).execute(&mut *tx).await?;
                }
            }
        }
    }
    tx.commit().await?;
    Ok(server)
}

/// Structure d'un serveur, sans aucun contenu : catégories, salons (sujets et
/// surcharges de rôles comprises, pour qu'un salon privé le reste) et rôles.
async fn snapshot_server(state: &AppState, server_id: Uuid) -> Result<serde_json::Value> {
    use sqlx::Row;
    let roles_rows = sqlx::query(
        "SELECT id, name, permissions, position, color FROM roles WHERE server_id=$1 AND is_everyone=false ORDER BY position"
    ).bind(server_id).fetch_all(&state.db).await?;
    let everyone: Option<Uuid> = sqlx::query_scalar("SELECT id FROM roles WHERE server_id=$1 AND is_everyone")
        .bind(server_id).fetch_optional(&state.db).await?;
    let role_index: std::collections::HashMap<Uuid, usize> =
        roles_rows.iter().enumerate().map(|(i, r)| (r.get::<Uuid, _>("id"), i)).collect();
    let categories: Vec<serde_json::Value> = sqlx::query(
        "SELECT id, name, position, staff_only FROM categories WHERE server_id=$1 ORDER BY position"
    ).bind(server_id).fetch_all(&state.db).await?.iter().map(|r| serde_json::json!({
        "id": r.get::<Uuid, _>("id"),
        "name": r.get::<String, _>("name"),
        "position": r.get::<i32, _>("position"),
        "staff_only": r.get::<bool, _>("staff_only"),
    })).collect();
    let mut overrides: std::collections::HashMap<Uuid, Vec<serde_json::Value>> = Default::default();
    for r in sqlx::query(
        "SELECT cp.channel_id, cp.target_id, cp.allow, cp.deny FROM channel_permissions cp
         JOIN channels c ON c.id = cp.channel_id WHERE c.server_id=$1 AND cp.target_type='role'"
    ).bind(server_id).fetch_all(&state.db).await? {
        let target: Uuid = r.get("target_id");
        let role = if Some(target) == everyone { serde_json::json!("everyone") } else {
            match role_index.get(&target) { Some(i) => serde_json::json!(i), None => continue }
        };
        overrides.entry(r.get("channel_id")).or_default()
            .push(serde_json::json!({ "role": role, "allow": r.get::<i64, _>("allow"), "deny": r.get::<i64, _>("deny") }));
    }
    let channels: Vec<serde_json::Value> = sqlx::query(
        "SELECT id, name, type, topic, position, category_id FROM channels WHERE server_id=$1 ORDER BY position"
    ).bind(server_id).fetch_all(&state.db).await?.iter().map(|r| serde_json::json!({
        "name": r.get::<String, _>("name"),
        "type": r.get::<String, _>("type"),
        "topic": r.get::<Option<String>, _>("topic"),
        "position": r.get::<i32, _>("position"),
        "category_id": r.get::<Option<Uuid>, _>("category_id"),
        "overrides": overrides.remove(&r.get::<Uuid, _>("id")).unwrap_or_default(),
    })).collect();
    let roles: Vec<serde_json::Value> = roles_rows.iter().map(|r| serde_json::json!({
        "name": r.get::<String, _>("name"),
        "permissions": r.get::<i64, _>("permissions"),
        "position": r.get::<i32, _>("position"),
        "color": r.get::<i32, _>("color"),
    })).collect();
    Ok(serde_json::json!({ "categories": categories, "channels": channels, "roles": roles }))
}

// ─── POST /servers/:id/template ────────────────────────────
/// Enregistre la structure d'un serveur comme modèle (propriétaire uniquement).
pub async fn create_template_from_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateTemplateRequest>,
) -> Result<Json<ServerTemplate>> {
    require_owner(&state, claims.sub, server_id).await?;
    let name = body.name.trim();
    if name.len() < 2 || name.len() > 100 {
        return Err(AppError::BadRequest("Nom template 2-100 chars".into()));
    }
    if body.description.as_ref().is_some_and(|d| d.len() > 500) {
        return Err(AppError::BadRequest("Description trop longue (500 max)".into()));
    }
    let mine: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM server_templates WHERE creator_id=$1")
        .bind(claims.sub).fetch_one(&state.db).await?;
    if mine >= 50 {
        return Err(AppError::BadRequest("Limite de 50 modèles atteinte".into()));
    }
    let template_data = snapshot_server(&state, server_id).await?;
    parse_template(&template_data).map_err(AppError::BadRequest)?;

    let template = sqlx::query_as::<_, ServerTemplate>(
        "INSERT INTO server_templates (name, description, creator_id, server_id, is_public, template_data)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(name)
    .bind(&body.description)
    .bind(claims.sub)
    .bind(server_id)
    .bind(body.is_public.unwrap_or(false))
    .bind(&template_data)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(template))
}

// ─── GET /templates ────────────────────────────────────────
/// Modèles intégrés, publics et personnels de l'utilisateur.
pub async fn list_templates(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>> {
    let public_templates = sqlx::query_as::<_, ServerTemplate>(
        "SELECT * FROM server_templates WHERE is_public=true ORDER BY usage_count DESC, created_at DESC LIMIT 50"
    )
    .fetch_all(&state.db)
    .await?;

    let my_templates = sqlx::query_as::<_, ServerTemplate>(
        "SELECT * FROM server_templates WHERE creator_id=$1 ORDER BY created_at DESC"
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let builtin: Vec<serde_json::Value> = super::template_builtin::IDS.iter()
        .filter_map(|id| super::template_builtin::get(id).map(|d| serde_json::json!({ "id": id, "template_data": d })))
        .collect();

    Ok(Json(serde_json::json!({
        "builtin": builtin,
        "public": public_templates,
        "mine": my_templates,
    })))
}

// ─── POST /templates/:id/use ───────────────────────────────
/// Crée un nouveau serveur depuis un modèle enregistré (public ou à soi).
pub async fn use_template(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(template_id): Path<Uuid>,
    Json(body): Json<UseTemplateRequest>,
) -> Result<Json<crate::models::server::Server>> {
    let template = sqlx::query_as::<_, ServerTemplate>(
        "SELECT * FROM server_templates WHERE id=$1 AND (is_public=true OR creator_id=$2)"
    )
    .bind(template_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Template introuvable".into()))?;

    let parsed = parse_template(&template.template_data).map_err(AppError::BadRequest)?;
    let server = create_server_from(&state, claims.sub, body.name.trim(), None, false, Some(&parsed)).await?;

    sqlx::query("UPDATE server_templates SET usage_count = usage_count + 1 WHERE id=$1")
        .bind(template_id)
        .execute(&state.db)
        .await?;

    Ok(Json(server))
}

// ─── DELETE /templates/:id ─────────────────────────────────
/// Supprimer son propre template
pub async fn delete_template(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(template_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let affected = sqlx::query(
        "DELETE FROM server_templates WHERE id=$1 AND creator_id=$2"
    )
    .bind(template_id)
    .bind(claims.sub)
    .execute(&state.db)
    .await?
    .rows_affected();

    if affected == 0 {
        return Err(AppError::NotFound("Template introuvable ou non autorisé".into()));
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saved_template_keeps_private_channels_private() {
        let t = parse_template(&json!({
            "categories": [{"id": "b", "name": "Deux", "position": 1}, {"id": "a", "name": "Un", "position": 0, "staff_only": true}],
            "channels": [{"name": "admin", "type": "text", "position": 0, "category_id": "a",
                          "overrides": [{"role": "everyone", "allow": 0, "deny": 1}, {"role": 0, "allow": 1, "deny": 0}, {"role": 9, "allow": 1, "deny": 0}]}],
            "roles": [{"name": "Staff", "permissions": 8, "position": 1, "color": 0}],
        })).unwrap();
        assert_eq!(t.categories[0].name, "Un");
        assert!(t.categories[0].staff_only);
        assert_eq!(t.channels[0].overrides, vec![(RoleRef::Everyone, 0, 1), (RoleRef::Index(0), 1, 0)]);
    }

    #[test]
    fn rejects_bad_templates() {
        assert!(parse_template(&json!({"channels": [{"name": "x", "type": "script"}]})).is_err());
        assert!(parse_template(&json!({"categories": [{"name": " "}]})).is_err());
        assert!(parse_template(&json!({"roles": [{"name": "@everyone"}]})).is_err());
        let many: Vec<_> = (0..201).map(|i| json!({"name": format!("s{i}")})).collect();
        assert!(parse_template(&json!({"channels": many})).is_err());
        assert!(parse_template(&json!({})).unwrap().channels.is_empty());
    }
}
