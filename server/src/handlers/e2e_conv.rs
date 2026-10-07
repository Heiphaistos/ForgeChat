//! Chiffrement de bout en bout des MP et groupes (docs/CHIFFREMENT-E2E.md §4.1, §6).
//!
//! Chaque conversation a des époques ; la clé d'une époque est enveloppée sur
//! l'appareil de l'émetteur pour chaque membre. Le serveur ne fait que ranger
//! ces enveloppes, contrôler qui y a accès, refuser le texte en clair quand
//! tous les membres ont une clé et refuser les envois sur une époque périmée.

use std::collections::{HashMap, HashSet};

use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::password_reset::over_limit,
    middleware::auth::Claims,
    state::AppState,
};

/// Texte chiffré d'un message, base64url : 4000 caractères (≤ 16 000 o) + JSON + tag.
const MAX_CT_B64: usize = 24 * 1024;
/// Refus du texte en clair : code puis explication pour les anciennes applis.
pub const PLAINTEXT_REFUSED: &str =
    "PLAINTEXT_REFUSED : cette conversation est chiffrée de bout en bout, mets à jour ForgeChat pour y écrire.";
/// Enveloppes acceptées par requête (groupes de 10 membres au plus).
const MAX_ENVELOPES: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conv {
    Dm(Uuid),
    Group(Uuid),
}

impl Conv {
    pub fn parse(kind: &str, id: Uuid) -> Result<Self> {
        match kind {
            "dm" => Ok(Conv::Dm(id)),
            "group" => Ok(Conv::Group(id)),
            _ => Err(AppError::NotFound("Conversation introuvable".into())),
        }
    }
    pub fn kind(self) -> &'static str {
        match self {
            Conv::Dm(_) => "dm",
            Conv::Group(_) => "group",
        }
    }
    pub fn id(self) -> Uuid {
        match self {
            Conv::Dm(id) | Conv::Group(id) => id,
        }
    }
}

fn b64_len(s: &str, max_chars: usize) -> Option<usize> {
    if s.len() > max_chars {
        return None;
    }
    URL_SAFE_NO_PAD.decode(s).ok().map(|b| b.len())
}

/// Contenu chiffré d'un message : {v:1, epoch, iv 12 o, ct}.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Enc {
    pub v: u8,
    pub epoch: i32,
    pub iv: String,
    pub ct: String,
}

impl Enc {
    pub fn parse(raw: &Value) -> Result<Self> {
        let bad = || AppError::BadRequest("Message chiffré invalide".into());
        let e: Enc = serde_json::from_value(raw.clone()).map_err(|_| bad())?;
        if e.v != 1 || e.epoch < 0 || b64_len(&e.iv, 16) != Some(12) {
            return Err(bad());
        }
        match b64_len(&e.ct, MAX_CT_B64) {
            Some(n) if n >= 17 => Ok(e),
            _ => Err(bad()),
        }
    }
    pub fn to_json(&self) -> Value {
        json!({ "v": self.v, "epoch": self.epoch, "iv": self.iv, "ct": self.ct })
    }
}

/// Clé de conversation enveloppée : {v:1, iv 12 o, ct 32 o + tag 16 o}.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyWrap {
    v: u8,
    iv: String,
    ct: String,
}

impl KeyWrap {
    fn validate(&self) -> Result<()> {
        if self.v != 1 || b64_len(&self.iv, 16) != Some(12) || b64_len(&self.ct, 64) != Some(48) {
            return Err(AppError::BadRequest("Enveloppe invalide".into()));
        }
        Ok(())
    }
}

// ─── Règles pures (testées plus bas) ────────────────────────────────────────

/// Texte en clair : refusé dès que tous les membres ont une clé de compte.
pub fn plaintext_allowed(all_keyed: bool) -> Result<()> {
    if all_keyed {
        // Code en tête (lu par les applis), phrase lisible pour les anciennes versions qui l'affichent.
        return Err(AppError::BadRequest(PLAINTEXT_REFUSED.into()));
    }
    Ok(())
}

/// Un message doit être chiffré avec l'époque courante, sans rotation en attente.
pub fn check_epoch(current: Option<(i32, bool)>, epoch: i32) -> Result<()> {
    match current {
        Some((cur, false)) if cur == epoch => Ok(()),
        _ => Err(AppError::Conflict("EPOCH_STALE".into())),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
    /// Nouvelle époque : enveloppes pour tous les membres qui ont une clé.
    NewEpoch,
    /// Époque existante distribuée à des membres qui ne l'ont pas (encore).
    Redistribute,
}

pub fn plan_envelopes(current: Option<(i32, bool)>, epoch: i32, create: bool) -> Result<Plan> {
    match (current, create) {
        (None, true) if epoch == 0 => Ok(Plan::NewEpoch),
        (Some((cur, true)), true) if epoch == cur + 1 => Ok(Plan::NewEpoch),
        (Some((cur, _)), false) if (0..=cur).contains(&epoch) => Ok(Plan::Redistribute),
        _ => Err(AppError::Conflict("EPOCH_STALE".into())),
    }
}

/// Une nouvelle époque doit être enveloppée pour exactement les membres munis d'une clé.
pub fn covers(keyed: &[Uuid], given: &[Uuid]) -> bool {
    let a: HashSet<_> = keyed.iter().collect();
    let b: HashSet<_> = given.iter().collect();
    a == b && b.len() == given.len()
}

// ─── Accès ───────────────────────────────────────────────────────────────────

pub async fn members(db: &PgPool, conv: Conv) -> Result<Vec<Uuid>> {
    Ok(match conv {
        Conv::Dm(id) => {
            let row: Option<(Uuid, Uuid)> = sqlx::query_as("SELECT user1_id, user2_id FROM dm_channels WHERE id=$1")
                .bind(id)
                .fetch_optional(db)
                .await?;
            row.map(|(a, b)| vec![a, b]).unwrap_or_default()
        }
        Conv::Group(id) => sqlx::query_scalar("SELECT user_id FROM group_dm_members WHERE dm_id=$1")
            .bind(id)
            .fetch_all(db)
            .await?,
    })
}

async fn require_member(db: &PgPool, conv: Conv, user: Uuid) -> Result<Vec<Uuid>> {
    let m = members(db, conv).await?;
    if !m.contains(&user) {
        return Err(AppError::Forbidden);
    }
    Ok(m)
}

/// Empreinte de la clé actuelle de chaque membre qui en a une.
async fn fingerprints(db: &PgPool, members: &[Uuid]) -> Result<HashMap<Uuid, String>> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as("SELECT user_id, fingerprint FROM user_keys WHERE user_id = ANY($1)")
        .bind(members)
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().collect())
}

pub async fn all_keyed(db: &PgPool, members: &[Uuid]) -> Result<bool> {
    Ok(!members.is_empty() && fingerprints(db, members).await?.len() == members.len())
}

/// Les médias (vocal, appel, caméra, écran) de cette conversation doivent être
/// chiffrés de bout en bout : même règle que le texte (tous les membres ont une
/// clé de compte). Générique sur `kind` : `dm`, `group`, et tout autre type de
/// conversation reconnu par `Conv::parse` (salons de serveur). Type inconnu :
/// pas de clé de conversation, donc média en clair. Erreur de base : chiffré
/// (les applis échouent proprement plutôt que de parler en clair).
pub async fn media_e2ee(db: &PgPool, kind: &str, id: Uuid) -> bool {
    let Ok(conv) = Conv::parse(kind, id) else { return false };
    match members(db, conv).await {
        Ok(m) => all_keyed(db, &m).await.unwrap_or(true),
        Err(_) => true,
    }
}

async fn current_epoch(db: &PgPool, conv: Conv) -> Result<Option<(i32, bool)>> {
    Ok(sqlx::query_as("SELECT current_epoch, rotate_needed FROM conversation_epochs WHERE conv_kind=$1 AND conv_id=$2")
        .bind(conv.kind())
        .bind(conv.id())
        .fetch_optional(db)
        .await?)
}

/// Contrôle le contenu d'un envoi ou d'une édition : rend le chiffré validé, ou
/// None pour du clair (permis seulement pendant la transition).
pub async fn check_message(
    db: &PgPool,
    conv: Conv,
    members: &[Uuid],
    has_text: bool,
    enc: Option<&Value>,
) -> Result<Option<Enc>> {
    match enc.filter(|v| !v.is_null()) {
        Some(raw) => {
            if has_text {
                return Err(AppError::BadRequest("Contenu en clair et chiffré à la fois".into()));
            }
            let e = Enc::parse(raw)?;
            check_epoch(current_epoch(db, conv).await?, e.epoch)?;
            Ok(Some(e))
        }
        None => {
            if has_text {
                plaintext_allowed(all_keyed(db, members).await?)?;
            }
            Ok(None)
        }
    }
}

pub fn parse_client_msg_id(v: &Value) -> Option<Uuid> {
    v.as_str().and_then(|s| s.parse().ok())
}

/// Demande de clé aux autres membres (KEY_REQUEST) : un client en ligne qui a
/// les clés les enveloppe pour `member` après avoir vérifié sa clé publique.
pub async fn key_request(state: &AppState, conv: Conv, member: Uuid, members: &[Uuid]) {
    let event = json!({ "type": "KEY_REQUEST", "conv_kind": conv.kind(), "conv_id": conv.id(), "member_id": member }).to_string();
    for uid in members.iter().filter(|u| **u != member) {
        state.broadcast_to_user(*uid, event.clone()).await;
    }
}

/// Départ ou exclusion d'un groupe : le prochain émetteur créera une nouvelle époque.
pub async fn member_left(db: &PgPool, group_id: Uuid, user_id: Uuid) {
    let r = sqlx::query("UPDATE conversation_epochs SET rotate_needed=TRUE, updated_at=NOW() WHERE conv_kind='group' AND conv_id=$1")
        .bind(group_id)
        .execute(db)
        .await;
    let d = sqlx::query("DELETE FROM conversation_keys WHERE conv_kind='group' AND conv_id=$1 AND member_id=$2")
        .bind(group_id)
        .bind(user_id)
        .execute(db)
        .await;
    if let Err(e) = r.and(d) {
        tracing::warn!("Rotation E2E du groupe {group_id} : {e}");
    }
}

/// Groupe supprimé : plus aucune clé à garder.
pub async fn forget_conversation(db: &PgPool, conv: Conv) {
    for sql in [
        "DELETE FROM conversation_keys WHERE conv_kind=$1 AND conv_id=$2",
        "DELETE FROM conversation_epochs WHERE conv_kind=$1 AND conv_id=$2",
    ] {
        if let Err(e) = sqlx::query(sql).bind(conv.kind()).bind(conv.id()).execute(db).await {
            tracing::warn!("Nettoyage E2E : {e}");
        }
    }
}

/// Enveloppes de `member` seulement : personne ne reçoit celles des autres.
pub async fn my_envelopes(db: &PgPool, conv: Conv, member: Uuid) -> Result<Vec<Value>> {
    let rows: Vec<(i32, Value, Option<Uuid>, String)> = sqlx::query_as(
        "SELECT epoch, wrapped, wrapped_by, wrapped_by_pub FROM conversation_keys
         WHERE conv_kind=$1 AND conv_id=$2 AND member_id=$3 ORDER BY epoch",
    )
    .bind(conv.kind())
    .bind(conv.id())
    .bind(member)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(epoch, wrapped, by, by_pub)| json!({ "epoch": epoch, "wrapped": wrapped, "wrapped_by": by, "wrapped_by_pub": by_pub }))
        .collect())
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/// GET /e2e/conversations/:kind/:id/keys — MES enveloppes seulement.
pub async fn get_my_envelopes(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
) -> Result<Json<Value>> {
    let conv = Conv::parse(&kind, id)?;
    let members = require_member(&state.db, conv, claims.sub).await?;
    let current = current_epoch(&state.db, conv).await?;
    let envelopes = my_envelopes(&state.db, conv, claims.sub).await?;
    Ok(Json(json!({
        "current_epoch": current.map(|c| c.0),
        "rotate_needed": current.map(|c| c.1).unwrap_or(false),
        "all_keyed": all_keyed(&state.db, &members).await?,
        "envelopes": envelopes,
    })))
}

/// GET /e2e/conversations/:kind/:id/members — membres et clés publiques actuelles.
pub async fn get_members(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
) -> Result<Json<Value>> {
    let conv = Conv::parse(&kind, id)?;
    let members = require_member(&state.db, conv, claims.sub).await?;
    let rows: Vec<(Uuid, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.username, k.public_key, k.fingerprint FROM users u
         LEFT JOIN user_keys k ON k.user_id = u.id WHERE u.id = ANY($1)",
    )
    .bind(&members)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!(rows
        .into_iter()
        .map(|(id, name, public, fp)| json!({ "user_id": id, "username": name, "public": public, "fingerprint": fp }))
        .collect::<Vec<_>>())))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    member_id: Uuid,
    member_fp: String,
    wrapped: KeyWrap,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostEnvelopes {
    epoch: i32,
    /// true : création de l'époque (`epoch` = 0 ou courante + 1 après un départ).
    #[serde(default)]
    create: bool,
    envelopes: Vec<Envelope>,
}

/// Range des enveloppes faites par `user` (membre muni d'une clé) pour des membres de la conversation.
pub async fn store_envelopes(db: &PgPool, conv: Conv, user: Uuid, body: &PostEnvelopes) -> Result<()> {
    let members = require_member(db, conv, user).await?;
    if body.envelopes.is_empty() || body.envelopes.len() > MAX_ENVELOPES {
        return Err(AppError::BadRequest("Nombre d'enveloppes invalide".into()));
    }
    let fps = fingerprints(db, &members).await?;
    let my_pub: String = sqlx::query_scalar("SELECT public_key FROM user_keys WHERE user_id=$1")
        .bind(user)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::BadRequest("NO_KEY".into()))?;
    let mut given = Vec::with_capacity(body.envelopes.len());
    for e in &body.envelopes {
        e.wrapped.validate()?;
        // Seulement des membres, et pour leur clé ACTUELLE.
        match fps.get(&e.member_id) {
            Some(fp) if *fp == e.member_fp => {}
            Some(_) => return Err(AppError::Conflict("KEY_CHANGED".into())),
            None => return Err(AppError::Forbidden),
        }
        if given.contains(&e.member_id) {
            return Err(AppError::BadRequest("Enveloppe en double".into()));
        }
        given.push(e.member_id);
    }

    let mut tx = db.begin().await?;
    let current: Option<(i32, bool)> = sqlx::query_as(
        "SELECT current_epoch, rotate_needed FROM conversation_epochs WHERE conv_kind=$1 AND conv_id=$2 FOR UPDATE",
    )
    .bind(conv.kind())
    .bind(conv.id())
    .fetch_optional(&mut *tx)
    .await?;
    let plan = plan_envelopes(current, body.epoch, body.create)?;
    if plan == Plan::NewEpoch {
        let keyed: Vec<Uuid> = fps.keys().copied().collect();
        if !covers(&keyed, &given) {
            return Err(AppError::Conflict("MEMBERS_CHANGED".into()));
        }
        // Deux créateurs simultanés : un seul gagne, l'autre recharge (409).
        let created = sqlx::query(
            "INSERT INTO conversation_epochs (conv_kind, conv_id, current_epoch) VALUES ($1, $2, $3)
             ON CONFLICT (conv_kind, conv_id) DO UPDATE SET current_epoch=$3, rotate_needed=FALSE, updated_at=NOW()
             WHERE conversation_epochs.rotate_needed AND conversation_epochs.current_epoch = $3 - 1",
        )
        .bind(conv.kind())
        .bind(conv.id())
        .bind(body.epoch)
        .execute(&mut *tx)
        .await?;
        if created.rows_affected() != 1 {
            return Err(AppError::Conflict("EPOCH_STALE".into()));
        }
    }
    for e in &body.envelopes {
        // Une enveloppe existante n'est remplacée que si elle visait une ancienne clé du membre.
        sqlx::query(
            "INSERT INTO conversation_keys (conv_kind, conv_id, epoch, member_id, member_fp, wrapped, wrapped_by, wrapped_by_pub)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (conv_kind, conv_id, epoch, member_id) DO UPDATE
               SET member_fp=EXCLUDED.member_fp, wrapped=EXCLUDED.wrapped, wrapped_by=EXCLUDED.wrapped_by,
                   wrapped_by_pub=EXCLUDED.wrapped_by_pub, created_at=NOW()
             WHERE conversation_keys.member_fp <> EXCLUDED.member_fp",
        )
        .bind(conv.kind())
        .bind(conv.id())
        .bind(body.epoch)
        .bind(e.member_id)
        .bind(&e.member_fp)
        .bind(json!({ "v": e.wrapped.v, "iv": e.wrapped.iv, "ct": e.wrapped.ct }))
        .bind(user)
        .bind(&my_pub)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// POST /e2e/conversations/:kind/:id/keys — enveloppes pour des membres de la conversation.
pub async fn post_envelopes(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
    Json(body): Json<PostEnvelopes>,
) -> Result<Json<Value>> {
    let conv = Conv::parse(&kind, id)?;
    store_envelopes(&state.db, conv, claims.sub, &body).await?;
    // Les destinataires en attente rechargent leurs clés et rouvrent les messages verrouillés.
    let event = json!({ "type": "E2E_KEYS", "conv_kind": conv.kind(), "conv_id": conv.id(), "epoch": body.epoch }).to_string();
    for e in body.envelopes.iter().filter(|e| e.member_id != claims.sub) {
        state.broadcast_to_user(e.member_id, event.clone()).await;
    }
    Ok(Json(json!({ "ok": true, "epoch": body.epoch })))
}

/// POST /e2e/conversations/:kind/:id/keys/request — « il me manque des clés ».
pub async fn request_keys(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
) -> Result<Json<Value>> {
    let conv = Conv::parse(&kind, id)?;
    let members = require_member(&state.db, conv, claims.sub).await?;
    if over_limit(&state, &format!("e2e_keyreq:{}:{}", claims.sub, conv.id()), 3, 60).await {
        return Err(AppError::TooManyRequests);
    }
    key_request(&state, conv, claims.sub, &members).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct LegacyQuery {
    limit: Option<i64>,
}

/// GET /e2e/legacy — mes messages encore en clair dans les conversations
/// désormais chiffrables (tous les membres ont une clé), à rechiffrer par lots.
pub async fn my_legacy_messages(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<LegacyQuery>,
) -> Result<Json<Value>> {
    Ok(Json(json!(legacy_messages(&state.db, claims.sub, q.limit.unwrap_or(50).clamp(1, 100)).await?)))
}

pub async fn legacy_messages(db: &PgPool, user: Uuid, limit: i64) -> Result<Vec<Value>> {
    let rows: Vec<(String, Uuid, Uuid, String)> = sqlx::query_as(
        "(SELECT 'dm', m.dm_channel_id, m.id, m.content FROM dm_messages m
          JOIN dm_channels dc ON dc.id = m.dm_channel_id
          WHERE m.sender_id=$1 AND m.enc IS NULL AND m.content IS NOT NULL
            AND EXISTS(SELECT 1 FROM user_keys WHERE user_id=dc.user1_id)
            AND EXISTS(SELECT 1 FROM user_keys WHERE user_id=dc.user2_id)
          ORDER BY m.created_at LIMIT $2)
         UNION ALL
         (SELECT 'group', m.dm_id, m.id, m.content FROM group_dm_messages m
          WHERE m.sender_id=$1 AND m.enc IS NULL AND m.content IS NOT NULL
            AND EXISTS(SELECT 1 FROM group_dm_members gm WHERE gm.dm_id=m.dm_id AND gm.user_id=$1)
            AND NOT EXISTS(SELECT 1 FROM group_dm_members gm WHERE gm.dm_id=m.dm_id
                           AND NOT EXISTS(SELECT 1 FROM user_keys k WHERE k.user_id=gm.user_id))
          ORDER BY m.created_at LIMIT $2)
         LIMIT $2",
    )
    .bind(user)
    .bind(limit)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(kind, conv_id, id, content)| json!({ "conv_kind": kind, "conv_id": conv_id, "id": id, "content": content }))
        .collect())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncryptBody {
    enc: Value,
    client_msg_id: Uuid,
}

/// Rechiffrement d'un ancien message en clair par son AUTEUR : le texte est effacé.
async fn encrypt_legacy(db: &PgPool, conv: Conv, user: Uuid, msg_id: Uuid, body: EncryptBody) -> Result<Json<Value>> {
    require_member(db, conv, user).await?;
    let enc = Enc::parse(&body.enc)?;
    check_epoch(current_epoch(db, conv).await?, enc.epoch)?;
    let sql = match conv {
        Conv::Dm(_) => {
            "UPDATE dm_messages SET enc=$1, client_msg_id=$2, content=NULL
             WHERE id=$3 AND dm_channel_id=$4 AND sender_id=$5 AND enc IS NULL AND content IS NOT NULL"
        }
        Conv::Group(_) => {
            "UPDATE group_dm_messages SET enc=$1, client_msg_id=$2, content=NULL
             WHERE id=$3 AND dm_id=$4 AND sender_id=$5 AND enc IS NULL AND content IS NOT NULL"
        }
    };
    let done = sqlx::query(sql)
        .bind(enc.to_json())
        .bind(body.client_msg_id)
        .bind(msg_id)
        .bind(conv.id())
        .bind(user)
        .execute(db)
        .await?;
    if done.rows_affected() == 0 {
        return Err(AppError::Conflict("NOT_LEGACY".into()));
    }
    // L'historique des éditions et les messages enregistrés gardaient aussi le texte en clair.
    sqlx::query("DELETE FROM message_edits WHERE message_id=$1").bind(msg_id).execute(db).await?;
    sqlx::query("UPDATE saved_messages SET content=NULL WHERE message_id=$1").bind(msg_id).execute(db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// PUT /dms/:dm_id/messages/:msg_id/encrypt
pub async fn encrypt_dm_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((dm_id, msg_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<EncryptBody>,
) -> Result<Json<Value>> {
    encrypt_legacy(&state.db, Conv::Dm(dm_id), claims.sub, msg_id, body).await
}

/// PUT /dms/groups/:group_id/messages/:msg_id/encrypt
pub async fn encrypt_group_message(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((group_id, msg_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<EncryptBody>,
) -> Result<Json<Value>> {
    encrypt_legacy(&state.db, Conv::Group(group_id), claims.sub, msg_id, body).await
}

/// Tâche horaire : 30 jours après le déploiement (`e2e_rollout`), le texte en
/// clair antérieur encore présent est effacé. Seul le nombre est journalisé.
pub async fn purge_legacy(db: &PgPool) {
    const SQL: &[&str] = &[
        "UPDATE dm_messages m SET content=NULL, purged=TRUE FROM e2e_rollout r
         WHERE r.started_at < NOW() - INTERVAL '30 days' AND m.created_at < r.started_at
           AND m.enc IS NULL AND m.content IS NOT NULL",
        "UPDATE group_dm_messages m SET content=NULL, purged=TRUE FROM e2e_rollout r
         WHERE r.started_at < NOW() - INTERVAL '30 days' AND m.created_at < r.started_at
           AND m.enc IS NULL AND m.content IS NOT NULL",
        "DELETE FROM message_edits e USING dm_messages m
         WHERE e.message_id = m.id AND (m.purged OR m.enc IS NOT NULL)",
        "UPDATE saved_messages s SET content=NULL FROM dm_messages m
         WHERE s.message_id = m.id AND s.content IS NOT NULL AND (m.purged OR m.enc IS NOT NULL)",
    ];
    let mut n = 0;
    for sql in SQL {
        match sqlx::query(sql).execute(db).await {
            Ok(r) => n += r.rows_affected(),
            Err(e) => tracing::warn!("Purge du clair E2E : {e}"),
        }
    }
    if n > 0 {
        tracing::info!("Purge du clair E2E : {n} lignes effacées");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enc(iv: &str, ct: &str) -> Value {
        json!({ "v": 1, "epoch": 0, "iv": iv, "ct": ct })
    }
    // Vecteur aesgcm de docs/e2e-vectors.json.
    const IV: &str = "ZGVmZ2hpamtsbW5v";
    const CT: &str = "G30Hbqug7xiUItu4OQw7u5W_e6OWgJFzxfLd34l-feNd_bICdtAhzDuWj4wNzH1Oi-0";

    fn code(e: AppError) -> String {
        match e {
            AppError::BadRequest(m) | AppError::Conflict(m) => m,
            other => other.to_string(),
        }
    }

    #[test]
    fn enc_format() {
        assert!(Enc::parse(&enc(IV, CT)).is_ok());
        assert!(Enc::parse(&json!({ "v": 2, "epoch": 0, "iv": IV, "ct": CT })).is_err());
        assert!(Enc::parse(&json!({ "v": 1, "epoch": -1, "iv": IV, "ct": CT })).is_err());
        assert!(Enc::parse(&enc("AAAA", CT)).is_err()); // IV de 3 o
        assert!(Enc::parse(&enc(IV, "AAAA")).is_err()); // plus court qu'un tag
        assert!(Enc::parse(&enc(IV, &"A".repeat(MAX_CT_B64 + 4))).is_err());
        assert!(Enc::parse(&json!({ "v": 1, "epoch": 0, "iv": IV, "ct": CT, "t": "fuite" })).is_err());
    }

    #[test]
    fn key_wrap_format() {
        let ok = KeyWrap { v: 1, iv: IV.into(), ct: URL_SAFE_NO_PAD.encode([7u8; 48]) };
        assert!(ok.validate().is_ok());
        assert!(KeyWrap { ct: URL_SAFE_NO_PAD.encode([7u8; 47]), ..ok }.validate().is_err());
        let extra = r#"{"v":1,"iv":"a","ct":"b","key":"fuite"}"#;
        assert!(serde_json::from_str::<KeyWrap>(extra).is_err());
    }

    #[test]
    fn plaintext_refused_when_everyone_has_a_key() {
        assert!(code(plaintext_allowed(true).unwrap_err()).starts_with("PLAINTEXT_REFUSED "));
        assert!(plaintext_allowed(false).is_ok());
    }

    #[test]
    fn stale_epoch_refused() {
        assert!(check_epoch(Some((2, false)), 2).is_ok());
        assert_eq!(code(check_epoch(Some((2, false)), 1).unwrap_err()), "EPOCH_STALE");
        assert_eq!(code(check_epoch(Some((2, true)), 2).unwrap_err()), "EPOCH_STALE"); // départ : rotation
        assert_eq!(code(check_epoch(Some((2, false)), 3).unwrap_err()), "EPOCH_STALE");
        assert_eq!(code(check_epoch(None, 0).unwrap_err()), "EPOCH_STALE");
    }

    #[test]
    fn envelope_plans() {
        assert_eq!(plan_envelopes(None, 0, true).unwrap(), Plan::NewEpoch);
        assert!(plan_envelopes(None, 1, true).is_err());
        assert!(plan_envelopes(None, 0, false).is_err());
        assert_eq!(plan_envelopes(Some((1, true)), 2, true).unwrap(), Plan::NewEpoch);
        // Sans départ, pas de nouvelle époque (le MP 1:1 reste à l'époque 0).
        assert!(plan_envelopes(Some((1, false)), 2, true).is_err());
        assert!(plan_envelopes(Some((0, false)), 0, true).is_err());
        assert_eq!(plan_envelopes(Some((1, false)), 0, false).unwrap(), Plan::Redistribute);
        assert_eq!(plan_envelopes(Some((1, true)), 1, false).unwrap(), Plan::Redistribute);
        assert!(plan_envelopes(Some((1, false)), 2, false).is_err());
    }

    #[test]
    fn new_epoch_must_cover_every_keyed_member() {
        let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
        assert!(covers(&[a, b], &[b, a]));
        assert!(!covers(&[a, b, c], &[a, b])); // un membre oublié
        assert!(!covers(&[a, b], &[a, b, c])); // un étranger
        assert!(!covers(&[a, b], &[a, a, b]));
    }

    #[test]
    fn conv_kinds() {
        let id = Uuid::new_v4();
        assert_eq!(Conv::parse("dm", id).unwrap(), Conv::Dm(id));
        assert_eq!(Conv::parse("group", id).unwrap().kind(), "group");
        assert!(Conv::parse("channel", id).is_err());
    }
}

/// Contre un vrai PostgreSQL (ignoré par défaut) :
/// `FORGECHAT_TEST_DATABASE_URL=postgres://... cargo test -- --ignored e2e_conversations`
#[cfg(test)]
mod db_tests {
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
}
