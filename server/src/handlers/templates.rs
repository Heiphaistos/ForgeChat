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

// ─── POST /servers/:id/template ────────────────────────────
/// Crée un template depuis un serveur existant (owner uniquement)
pub async fn create_template_from_server(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateTemplateRequest>,
) -> Result<Json<ServerTemplate>> {
    require_owner(&state, claims.sub, server_id).await?;

    if body.name.len() < 2 || body.name.len() > 100 {
        return Err(AppError::BadRequest("Nom template 2-100 chars".into()));
    }

    // Snapshot des canaux
    let channels: Vec<serde_json::Value> = sqlx::query(
        "SELECT id, name, type, topic, position, category_id FROM channels WHERE server_id=$1 ORDER BY position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "type": r.get::<String, _>("type"),
            "topic": r.get::<Option<String>, _>("topic"),
            "position": r.get::<i32, _>("position"),
            "category_id": r.get::<Option<Uuid>, _>("category_id"),
        })
    })
    .collect();

    // Snapshot des catégories
    let categories: Vec<serde_json::Value> = sqlx::query(
        "SELECT id, name, position FROM categories WHERE server_id=$1 ORDER BY position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "id": r.get::<Uuid, _>("id"),
            "name": r.get::<String, _>("name"),
            "position": r.get::<i32, _>("position"),
        })
    })
    .collect();

    // Snapshot des rôles (hors @everyone)
    let roles: Vec<serde_json::Value> = sqlx::query(
        "SELECT name, permissions, position, color FROM roles WHERE server_id=$1 AND is_everyone=false ORDER BY position"
    )
    .bind(server_id)
    .fetch_all(&state.db)
    .await?
    .iter()
    .map(|r| {
        use sqlx::Row;
        serde_json::json!({
            "name": r.get::<String, _>("name"),
            "permissions": r.get::<i64, _>("permissions"),
            "position": r.get::<i32, _>("position"),
            "color": r.get::<i32, _>("color"),
        })
    })
    .collect();

    let template_data = serde_json::json!({
        "channels": channels,
        "categories": categories,
        "roles": roles,
    });

    let template = sqlx::query_as::<_, ServerTemplate>(
        "INSERT INTO server_templates (name, description, creator_id, server_id, is_public, template_data)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *"
    )
    .bind(&body.name)
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
/// Liste les templates publics + templates perso de l'utilisateur
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

    Ok(Json(serde_json::json!({
        "public": public_templates,
        "mine": my_templates,
    })))
}

// ─── POST /templates/:id/use ───────────────────────────────
/// Crée un nouveau serveur depuis un template
pub async fn use_template(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(template_id): Path<Uuid>,
    Json(body): Json<UseTemplateRequest>,
) -> Result<Json<crate::models::server::Server>> {
    if body.name.len() < 2 || body.name.len() > 100 {
        return Err(AppError::BadRequest("Nom serveur 2-100 chars".into()));
    }

    let template = sqlx::query_as::<_, ServerTemplate>(
        "SELECT * FROM server_templates WHERE id=$1 AND (is_public=true OR creator_id=$2)"
    )
    .bind(template_id)
    .bind(claims.sub)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Template introuvable".into()))?;

    // Créer le serveur
    let invite_code: String = rand::Rng::sample_iter(rand::thread_rng(), &rand::distributions::Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let server = sqlx::query_as::<_, crate::models::server::Server>(
        "INSERT INTO servers (name, owner_id, invite_code, is_public)
         VALUES ($1, $2, $3, false) RETURNING *"
    )
    .bind(&body.name)
    .bind(claims.sub)
    .bind(&invite_code)
    .fetch_one(&state.db)
    .await?;

    // Rôle @everyone
    sqlx::query(
        "INSERT INTO roles (server_id, name, permissions, position, is_everyone)
         VALUES ($1, '@everyone', $2, 0, true)"
    )
    .bind(server.id)
    .bind(
        crate::models::role::Permissions::VIEW_CHANNEL
            | crate::models::role::Permissions::SEND_MESSAGES
            | crate::models::role::Permissions::READ_HISTORY
            | crate::models::role::Permissions::ADD_REACTIONS
            | crate::models::role::Permissions::ATTACH_FILES,
    )
    .execute(&state.db)
    .await?;

    // Membre owner
    sqlx::query(
        "INSERT INTO server_members (user_id, server_id, is_owner) VALUES ($1, $2, true)"
    )
    .bind(claims.sub)
    .bind(server.id)
    .execute(&state.db)
    .await?;

    // Recréer les catégories
    let categories = template.template_data["categories"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Map ancien_id → nouvel_id (pour retrouver les catégories des canaux)
    let mut cat_id_map: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();

    for cat in &categories {
        let cat_name = cat["name"].as_str().unwrap_or("Catégorie");
        let cat_pos = cat["position"].as_i64().unwrap_or(0) as i32;
        let old_id = cat["id"].as_str().unwrap_or("").to_string();

        let new_cat = sqlx::query(
            "INSERT INTO categories (server_id, name, position) VALUES ($1, $2, $3) RETURNING id"
        )
        .bind(server.id)
        .bind(cat_name)
        .bind(cat_pos)
        .fetch_optional(&state.db)
        .await;

        if let Ok(Some(row)) = new_cat {
            use sqlx::Row;
            let new_id: Uuid = row.get("id");
            cat_id_map.insert(old_id, new_id);
        }
    }

    // Recréer les canaux
    let channels = template.template_data["channels"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    // S'il n'y a pas de canaux dans le template, créer un canal général par défaut
    if channels.is_empty() {
        sqlx::query(
            "INSERT INTO channels (server_id, name, type, position) VALUES ($1, 'général', 'text', 0)"
        )
        .bind(server.id)
        .execute(&state.db)
        .await?;
    } else {
        for ch in &channels {
            let ch_name = ch["name"].as_str().unwrap_or("général");
            let ch_type = ch["type"].as_str().unwrap_or("text");
            let ch_pos = ch["position"].as_i64().unwrap_or(0) as i32;
            let ch_topic = ch["topic"].as_str();
            let old_cat_id = ch["category_id"].as_str().unwrap_or("").to_string();
            let new_cat_id = cat_id_map.get(&old_cat_id).copied();

            sqlx::query(
                "INSERT INTO channels (server_id, category_id, name, type, topic, position)
                 VALUES ($1, $2, $3, $4, $5, $6)"
            )
            .bind(server.id)
            .bind(new_cat_id)
            .bind(ch_name)
            .bind(ch_type)
            .bind(ch_topic)
            .bind(ch_pos)
            .execute(&state.db)
            .await?;
        }
    }

    // Recréer les rôles (hors @everyone)
    let roles = template.template_data["roles"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    for role in &roles {
        let role_name = role["name"].as_str().unwrap_or("Rôle");
        let role_perms = role["permissions"].as_i64().unwrap_or(0);
        let role_pos = role["position"].as_i64().unwrap_or(1) as i32;
        let role_color = role["color"].as_i64().unwrap_or(0) as i32;

        sqlx::query(
            "INSERT INTO roles (server_id, name, permissions, position, color)
             VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(server.id)
        .bind(role_name)
        .bind(role_perms)
        .bind(role_pos)
        .bind(role_color)
        .execute(&state.db)
        .await?;
    }

    // Incrémenter usage_count
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
