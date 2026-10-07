//! Clé de récupération d'un serveur (docs/CHIFFREMENT-E2E.md §11).
//!
//! L'appli du propriétaire génère une paire ECDH P-256 « clé de serveur ». La
//! plateforme ne garde que la clé publique et deux enveloppes opaques de la clé
//! privée : l'une ouverte par le code de récupération du serveur, l'autre par la
//! clé de compte du propriétaire. Chaque époque de salon est aussi enveloppée
//! pour la clé publique du serveur : le propriétaire peut tout relire (salons
//! privés compris), la plateforme rien. Les MP et groupes ne sont pas concernés.

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::{e2e_conv::KeyWrap, user_keys::{public_fingerprint, Wrapped}},
    middleware::auth::Claims,
    state::AppState,
};

async fn owner_of(db: &PgPool, server_id: Uuid) -> Result<Uuid> {
    sqlx::query_scalar("SELECT owner_id FROM servers WHERE id=$1")
        .bind(server_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Serveur introuvable".into()))
}

async fn require_owner(db: &PgPool, server_id: Uuid, user: Uuid) -> Result<()> {
    if owner_of(db, server_id).await? != user {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

fn wrapped_json(w: &Wrapped) -> Value {
    json!({ "v": w.v, "salt": w.salt, "iv": w.iv, "ct": w.ct })
}

/// Clé du serveur vue par `user` : la partie publique pour tout membre, les
/// enveloppes de la clé privée pour le propriétaire seulement.
pub async fn read_server_key(db: &PgPool, server_id: Uuid, user: Uuid) -> Result<Value> {
    let member: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)")
        .bind(server_id)
        .bind(user)
        .fetch_one(db)
        .await?;
    if !member {
        return Err(AppError::Forbidden);
    }
    type Row = (String, String, Value, Option<Uuid>, Option<Value>);
    let row: Option<Row> = sqlx::query_as(
        "SELECT public_key, fingerprint, recovery, owner_id, owner_wrapped FROM server_keys WHERE server_id=$1",
    )
    .bind(server_id)
    .fetch_optional(db)
    .await?;
    let Some((public, fingerprint, recovery, wrapped_for, owner_wrapped)) = row else {
        return Ok(json!({ "exists": false }));
    };
    let mut out = json!({ "exists": true, "public": public, "fingerprint": fingerprint });
    if owner_of(db, server_id).await? == user {
        out["recovery"] = recovery;
        // Enveloppe faite pour un ancien propriétaire : inutilisable, le code est demandé.
        out["owner_wrapped"] = if wrapped_for == Some(user) { owner_wrapped.unwrap_or(Value::Null) } else { Value::Null };
    }
    Ok(out)
}

/// GET /servers/:server_id/e2e/server-key
pub async fn get_server_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    Ok(Json(read_server_key(&state.db, server_id, claims.sub).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateServerKey {
    public: String,
    recovery: Wrapped,
    owner_wrapped: KeyWrap,
}

pub async fn create_key(db: &PgPool, server_id: Uuid, user: Uuid, body: &CreateServerKey) -> Result<String> {
    require_owner(db, server_id, user).await?;
    body.recovery.validate()?;
    body.owner_wrapped.validate()?;
    let fp = public_fingerprint(&body.public)?;
    let done = sqlx::query(
        "INSERT INTO server_keys (server_id, public_key, fingerprint, recovery, owner_id, owner_wrapped)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (server_id) DO NOTHING",
    )
    .bind(server_id)
    .bind(&body.public)
    .bind(&fp)
    .bind(wrapped_json(&body.recovery))
    .bind(user)
    .bind(body.owner_wrapped.to_json())
    .execute(db)
    .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("SERVER_KEY_EXISTS".into()));
    }
    Ok(fp)
}

/// PUT /servers/:server_id/e2e/server-key — création seulement (409 SERVER_KEY_EXISTS).
pub async fn put_server_key(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateServerKey>,
) -> Result<Json<Value>> {
    let fp = create_key(&state.db, server_id, claims.sub, &body).await?;
    // Les membres en ligne enveloppent pour elle les époques qu'ils connaissent.
    state
        .broadcast_to_server_members(server_id, json!({ "type": "SERVER_KEY", "server_id": server_id }).to_string())
        .await;
    Ok(Json(json!({ "ok": true, "fingerprint": fp })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryBody {
    recovery: Wrapped,
}

/// PUT /servers/:server_id/e2e/server-key/recovery — nouveau code (même clé).
pub async fn put_recovery(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<RecoveryBody>,
) -> Result<Json<Value>> {
    require_owner(&state.db, server_id, claims.sub).await?;
    body.recovery.validate()?;
    let done = sqlx::query("UPDATE server_keys SET recovery=$2, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(wrapped_json(&body.recovery))
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("NO_SERVER_KEY".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerBody {
    owner_wrapped: KeyWrap,
}

/// PUT /servers/:server_id/e2e/server-key/owner — le propriétaire (nouveau, ou
/// qui a changé de clé de compte) ré-enveloppe la clé du serveur pour lui.
pub async fn put_owner_wrapped(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<OwnerBody>,
) -> Result<Json<Value>> {
    require_owner(&state.db, server_id, claims.sub).await?;
    body.owner_wrapped.validate()?;
    let done = sqlx::query("UPDATE server_keys SET owner_id=$2, owner_wrapped=$3, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(claims.sub)
        .bind(body.owner_wrapped.to_json())
        .execute(&state.db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("NO_SERVER_KEY".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// Toutes les enveloppes d'époques pour la clé du serveur, par salon (propriétaire seulement).
pub async fn recovery_envelopes(db: &PgPool, server_id: Uuid, user: Uuid) -> Result<Value> {
    require_owner(db, server_id, user).await?;
    type Row = (Uuid, String, String, i32, Value, Option<Uuid>, String);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT c.id, c.name, c.type, s.epoch, s.wrapped, s.wrapped_by, s.wrapped_by_pub
         FROM server_epoch_keys s JOIN channels c ON c.id = s.channel_id
         JOIN server_keys k ON k.server_id = c.server_id AND k.fingerprint = s.server_fp
         WHERE c.server_id = $1 ORDER BY c.position, c.id, s.epoch",
    )
    .bind(server_id)
    .fetch_all(db)
    .await?;
    let mut channels: Vec<Value> = Vec::new();
    for (id, name, kind, epoch, wrapped, by, by_pub) in rows {
        let env = json!({ "epoch": epoch, "wrapped": wrapped, "wrapped_by": by, "wrapped_by_pub": by_pub });
        match channels.last_mut() {
            Some(c) if c["channel_id"] == json!(id) => c["epochs"].as_array_mut().into_iter().for_each(|a| a.push(env.clone())),
            _ => channels.push(json!({ "channel_id": id, "name": name, "type": kind, "epochs": [env] })),
        }
    }
    Ok(json!({ "channels": channels }))
}

/// GET /servers/:server_id/e2e/recovery
pub async fn get_recovery(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Value>> {
    Ok(Json(recovery_envelopes(&state.db, server_id, claims.sub).await?))
}

/// Transfert de propriété : l'enveloppe du propriétaire suit (`wrapped` fait par
/// l'ancien propriétaire pour le nouveau), sinon le nouveau saisira le code.
pub async fn transfer(tx: &mut Transaction<'_, Postgres>, server_id: Uuid, new_owner: Uuid, wrapped: Option<&Value>) -> Result<()> {
    let wrapped = match wrapped.filter(|v| !v.is_null()) {
        Some(v) => {
            let w: KeyWrap = serde_json::from_value(v.clone()).map_err(|_| AppError::BadRequest("Enveloppe invalide".into()))?;
            w.validate()?;
            Some(w.to_json())
        }
        None => None,
    };
    sqlx::query("UPDATE server_keys SET owner_id=$2, owner_wrapped=$3, updated_at=NOW() WHERE server_id=$1")
        .bind(server_id)
        .bind(new_owner)
        .bind(wrapped)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
