//! Journal de transparence des clés de compte (audit 2026-10-12, amélioration n° 10).
//!
//! Chaque clé publique de compte publiée (création, réinitialisation) ajoute une entrée chaînée au
//! journal `key_transparency_log`. Les applis vérifient :
//! - que la chaîne qu'elles ont déjà vue n'a jamais été réécrite (chaque entrée scelle la
//!   précédente) ;
//! - qu'aucune clé inconnue n'a été publiée pour LEUR compte (elles connaissent leur `user_tag`) ;
//! - que la clé servie pour un contact figure bien au journal (`kt_seq` de /users/:id/keys/public).
//!
//! Un serveur compromis qui substituerait une clé devrait donc soit l'inscrire au journal (la
//! victime la voit), soit servir une clé hors journal (le contact le voit), soit réécrire la
//! chaîne (les deux le voient). Aucun identifiant en clair dans le journal.
use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::Claims,
    state::AppState,
};

pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";
/// Verrou consultatif : une seule écriture à la fois (numérotation sans trou).
const LOCK_ID: i64 = 0x006b_746c_6f67; // « ktlog »

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn user_tag(user_id: Uuid) -> String {
    sha256_hex(&format!("fc-kt-user|{user_id}"))
}

pub fn key_hash(public_b64u: &str) -> String {
    sha256_hex(public_b64u)
}

pub fn entry_hash(seq: i64, user_tag: &str, key_hash: &str, prev: &str) -> String {
    sha256_hex(&format!("fc-kt-v1|{seq}|{user_tag}|{key_hash}|{prev}"))
}

/// Ajoute la clé au journal, dans la transaction qui la publie.
pub async fn append(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, user_id: Uuid, public: &str) -> Result<i64> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)").bind(LOCK_ID).execute(&mut **tx).await?;
    let last: Option<(i64, String)> =
        sqlx::query_as("SELECT seq, hash FROM key_transparency_log ORDER BY seq DESC LIMIT 1").fetch_optional(&mut **tx).await?;
    let (seq, prev) = match last {
        Some((s, h)) => (s + 1, h),
        None => (1, GENESIS.to_string()),
    };
    let (tag, kh) = (user_tag(user_id), key_hash(public));
    let hash = entry_hash(seq, &tag, &kh, &prev);
    sqlx::query("INSERT INTO key_transparency_log (seq, user_tag, key_hash, prev_hash, hash) VALUES ($1, $2, $3, $4, $5)")
        .bind(seq)
        .bind(&tag)
        .bind(&kh)
        .bind(&prev)
        .bind(&hash)
        .execute(&mut **tx)
        .await?;
    Ok(seq)
}

/// Rattrapage (démarrage, puis chaque heure) : toute clé actuelle absente du journal y est
/// inscrite (clés créées avant le journal, ou chemin d'écriture oublié).
pub async fn reconcile(db: &PgPool) -> Result<u64> {
    let keys: Vec<(Uuid, String)> = sqlx::query_as("SELECT user_id, public_key FROM user_keys ORDER BY created_at, user_id")
        .fetch_all(db)
        .await?;
    let mut added = 0;
    for (user_id, public) in keys {
        let latest: Option<String> = sqlx::query_scalar(
            "SELECT key_hash FROM key_transparency_log WHERE user_tag=$1 ORDER BY seq DESC LIMIT 1",
        )
        .bind(user_tag(user_id))
        .fetch_optional(db)
        .await?;
        if latest.as_deref() == Some(key_hash(&public).as_str()) {
            continue;
        }
        let mut tx = db.begin().await?;
        append(&mut tx, user_id, &public).await?;
        tx.commit().await?;
        added += 1;
    }
    Ok(added)
}

/// Dernière entrée du journal pour ce compte (pour `kt_seq`).
pub async fn latest_seq(db: &PgPool, user_id: Uuid) -> Option<i64> {
    sqlx::query_scalar("SELECT seq FROM key_transparency_log WHERE user_tag=$1 ORDER BY seq DESC LIMIT 1")
        .bind(user_tag(user_id))
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
}

#[derive(Deserialize)]
pub struct LogQuery {
    pub after: Option<i64>,
    pub limit: Option<i64>,
}

fn entry_json(r: &(i64, String, String, String, String)) -> Value {
    json!({ "seq": r.0, "user_tag": r.1, "key_hash": r.2, "prev_hash": r.3, "hash": r.4 })
}

/// GET /api/keys/log?after=&limit= — entrées dans l'ordre (1000 au plus), pour tout compte connecté.
pub async fn list(State(state): State<AppState>, Extension(_): Extension<Claims>, Query(q): Query<LogQuery>) -> Result<Json<Value>> {
    let after = q.after.unwrap_or(0).max(0);
    let limit = q.limit.unwrap_or(500).clamp(1, 1000);
    let rows: Vec<(i64, String, String, String, String)> = sqlx::query_as(
        "SELECT seq, user_tag, key_hash, prev_hash, hash FROM key_transparency_log WHERE seq > $1 ORDER BY seq LIMIT $2",
    )
    .bind(after)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;
    let head: Option<(i64, String)> =
        sqlx::query_as("SELECT seq, hash FROM key_transparency_log ORDER BY seq DESC LIMIT 1").fetch_optional(&state.db).await?;
    Ok(Json(json!({
        "entries": rows.iter().map(entry_json).collect::<Vec<_>>(),
        "head": head.map(|(seq, hash)| json!({ "seq": seq, "hash": hash })),
    })))
}

/// GET /api/keys/log/:seq — une entrée (vérification d'un contact).
pub async fn get(State(state): State<AppState>, Extension(_): Extension<Claims>, Path(seq): Path<i64>) -> Result<Json<Value>> {
    let row: (i64, String, String, String, String) = sqlx::query_as(
        "SELECT seq, user_tag, key_hash, prev_hash, hash FROM key_transparency_log WHERE seq=$1",
    )
    .bind(seq)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Entrée introuvable".into()))?;
    Ok(Json(entry_json(&row)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vector_shared_with_clients() {
        // Même vecteur dans client/scripts/keyTransparency.test.mjs et mobile.
        let u = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
        let tag = user_tag(u);
        let kh = key_hash("BAAAAA");
        let h1 = entry_hash(1, &tag, &kh, GENESIS);
        assert_eq!(tag.len(), 64);
        assert_eq!(
            (tag.as_str(), kh.as_str(), h1.as_str()),
            (
                "a3bfd8fc613dcfa0c605346f0070e658278f0d4f7d4ed2e31a38fb780bb2753c",
                "acf2ba26ddbba999659054eae374dd3cd414bd1be9a733e2270df636e72e4424",
                "b32c588b8ca2c0326d9933bfb72b8a3b806d1ffbb465fc27dbf3d3a24e92e532"
            )
        );
    }
}
