//! Chiffrement de bout en bout des MP, groupes et salons (docs/CHIFFREMENT-E2E.md §4.1, §6, §10).
//!
//! Chaque conversation a des époques ; la clé d'une époque est enveloppée sur
//! l'appareil de l'émetteur pour chaque membre muni d'une clé de compte. Le
//! serveur ne fait que ranger ces enveloppes, contrôler qui y a accès, refuser
//! TOUT texte en clair d'un utilisateur (chiffrement obligatoire) et refuser les
//! envois sur une époque périmée. Un membre sans clé reçoit les époques après
//! avoir créé la sienne (`missing`, KEY_REQUEST).

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

/// Contenu chiffré d'un message, base64url : 4000 caractères (≤ 16 000 o) + JSON + tag,
/// plus jusqu'à 10 fichiers (clé, nom, type, miniature ≤ 8 Kio chacun, §12).
const MAX_CT_B64: usize = 128 * 1024;
/// Refus du texte en clair : code puis explication pour les anciennes applis.
pub const PLAINTEXT_REFUSED: &str =
    "PLAINTEXT_REFUSED : cette conversation est chiffrée de bout en bout, mets à jour ForgeChat pour y écrire.";
/// Enveloppes acceptées par requête : un grand salon se distribue en plusieurs lots.
const MAX_ENVELOPES: usize = 200;
/// Membres renvoyés par page (`GET …/members`).
const MEMBERS_PAGE: i64 = 1000;
/// Membres munis d'une clé auxquels l'époque courante manque, renvoyés à l'émetteur.
const MISSING_PAGE: i64 = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conv {
    Dm(Uuid),
    Group(Uuid),
    /// Salon de serveur (ses fils et publications de forum partagent sa clé).
    Channel(Uuid),
}

impl Conv {
    pub fn parse(kind: &str, id: Uuid) -> Result<Self> {
        match kind {
            "dm" => Ok(Conv::Dm(id)),
            "group" => Ok(Conv::Group(id)),
            "channel" => Ok(Conv::Channel(id)),
            _ => Err(AppError::NotFound("Conversation introuvable".into())),
        }
    }
    pub fn kind(self) -> &'static str {
        match self {
            Conv::Dm(_) => "dm",
            Conv::Group(_) => "group",
            Conv::Channel(_) => "channel",
        }
    }
    pub fn id(self) -> Uuid {
        match self {
            Conv::Dm(id) | Conv::Group(id) | Conv::Channel(id) => id,
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
    pub fn to_json(&self) -> Value {
        json!({ "v": self.v, "iv": self.iv, "ct": self.ct })
    }
    pub fn validate(&self) -> Result<()> {
        if self.v != 1 || b64_len(&self.iv, 16) != Some(12) || b64_len(&self.ct, 64) != Some(48) {
            return Err(AppError::BadRequest("Enveloppe invalide".into()));
        }
        Ok(())
    }
}

// ─── Règles pures (testées plus bas) ────────────────────────────────────────

/// Texte en clair d'un utilisateur : toujours refusé (chiffrement obligatoire).
/// Code en tête (lu par les applis), phrase lisible pour les anciennes versions qui l'affichent.
pub fn plaintext_refused() -> AppError {
    AppError::BadRequest(PLAINTEXT_REFUSED.into())
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

/// Nouvelle époque d'un salon : le créateur s'inclut ; les autres membres munis
/// d'une clé reçoivent la clé par lots (redistribution) ou à leur demande.
pub fn channel_epoch_ok(creator: Uuid, given: &[Uuid]) -> bool {
    given.contains(&creator)
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
        Conv::Channel(id) => crate::handlers::e2e_channel::viewers(db, id).await?,
    })
}

/// Membres de la conversation, si `user` en fait partie. Salon : membres du
/// serveur qui le voient (VIEW_CHANNEL, surcharges comprises), bots exclus.
pub(crate) async fn require_member(db: &PgPool, conv: Conv, user: Uuid) -> Result<Vec<Uuid>> {
    if let Conv::Channel(id) = conv {
        // Contrôle d'accès seul (bon marché) avant la liste complète.
        if crate::state::channel_audience_among(db, id, &[user]).await.is_empty() {
            return Err(AppError::Forbidden);
        }
    }
    let m = members(db, conv).await?;
    if !m.contains(&user) {
        return Err(AppError::Forbidden);
    }
    Ok(m)
}

/// Empreinte de la clé actuelle de chaque membre qui en a une.
pub(crate) async fn fingerprints(db: &PgPool, members: &[Uuid]) -> Result<HashMap<Uuid, String>> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as("SELECT user_id, fingerprint FROM user_keys WHERE user_id = ANY($1)")
        .bind(members)
        .fetch_all(db)
        .await?;
    Ok(rows.into_iter().collect())
}

pub async fn all_keyed(db: &PgPool, members: &[Uuid]) -> Result<bool> {
    Ok(!members.is_empty() && fingerprints(db, members).await?.len() == members.len())
}

pub async fn has_key(db: &PgPool, user: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_keys WHERE user_id=$1)")
        .bind(user)
        .fetch_one(db)
        .await?)
}

/// Membres munis d'une clé auxquels l'époque courante manque (arrivés, ou clé
/// créée depuis) : l'appli d'un détenteur la leur enveloppe.
pub async fn missing_members(db: &PgPool, conv: Conv, members: &[Uuid], current: Option<(i32, bool)>) -> Result<Vec<Uuid>> {
    let Some((epoch, false)) = current else { return Ok(vec![]) };
    Ok(sqlx::query_scalar(
        "SELECT k.user_id FROM user_keys k
         WHERE k.user_id = ANY($1) AND NOT EXISTS(
             SELECT 1 FROM conversation_keys ck WHERE ck.conv_kind=$2 AND ck.conv_id=$3
               AND ck.epoch=$4 AND ck.member_id=k.user_id AND ck.member_fp=k.fingerprint)
         LIMIT $5",
    )
    .bind(members)
    .bind(conv.kind())
    .bind(conv.id())
    .bind(epoch)
    .bind(MISSING_PAGE)
    .fetch_all(db)
    .await?)
}

pub(crate) async fn current_epoch(db: &PgPool, conv: Conv) -> Result<Option<(i32, bool)>> {
    Ok(sqlx::query_as("SELECT current_epoch, rotate_needed FROM conversation_epochs WHERE conv_kind=$1 AND conv_id=$2")
        .bind(conv.kind())
        .bind(conv.id())
        .fetch_optional(db)
        .await?)
}

/// Contrôle le contenu d'un envoi ou d'une édition : rend le chiffré validé, ou
/// None sans texte (pièces jointes seules) ; tout texte en clair est refusé.
pub async fn check_message(db: &PgPool, conv: Conv, has_text: bool, enc: Option<&Value>) -> Result<Option<Enc>> {
    match enc.filter(|v| !v.is_null()) {
        Some(raw) => {
            if has_text {
                return Err(AppError::BadRequest("Contenu en clair et chiffré à la fois".into()));
            }
            let e = Enc::parse(raw)?;
            check_epoch(current_epoch(db, conv).await?, e.epoch)?;
            Ok(Some(e))
        }
        None if has_text => Err(plaintext_refused()),
        None => Ok(None),
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
    let current = match conv {
        // Salon : un membre a perdu l'accès depuis la dernière époque → rotation.
        Conv::Channel(c) => crate::handlers::e2e_channel::channel_epoch(&state.db, c).await?,
        _ => current_epoch(&state.db, conv).await?,
    };
    let envelopes = my_envelopes(&state.db, conv, claims.sub).await?;
    let mut out = json!({
        "current_epoch": current.map(|c| c.0),
        "rotate_needed": current.map(|c| c.1).unwrap_or(false),
        "all_keyed": all_keyed(&state.db, &members).await?,
        // Chiffrement obligatoire : il faut chiffrer dès que j'ai une clé (sans clé, je ne peux pas écrire).
        "encrypt": has_key(&state.db, claims.sub).await?,
        "missing": missing_members(&state.db, conv, &members, current).await?,
        "envelopes": envelopes,
    });
    if let Conv::Channel(c) = conv {
        crate::handlers::e2e_channel::extend_keys(&state.db, c, claims.sub, &mut out).await?;
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct MembersQuery {
    /// Page suivante : membres d'identifiant supérieur.
    after: Option<Uuid>,
    /// Un seul membre (réponse à KEY_REQUEST).
    member: Option<Uuid>,
}

/// GET /e2e/conversations/:kind/:id/members — membres et clés publiques actuelles.
pub async fn get_members(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((kind, id)): Path<(String, Uuid)>,
    Query(q): Query<MembersQuery>,
) -> Result<Json<Value>> {
    let conv = Conv::parse(&kind, id)?;
    let members = require_member(&state.db, conv, claims.sub).await?;
    // Salon : seuls les membres munis d'une clé intéressent l'appli (enveloppes).
    let rows: Vec<(Uuid, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.username, k.public_key, k.fingerprint FROM users u
         LEFT JOIN user_keys k ON k.user_id = u.id
         WHERE u.id = ANY($1) AND ($2::uuid IS NULL OR u.id > $2) AND ($3::uuid IS NULL OR u.id = $3)
           AND (NOT $4 OR k.public_key IS NOT NULL)
         ORDER BY u.id LIMIT $5",
    )
    .bind(&members)
    .bind(q.after)
    .bind(q.member)
    .bind(matches!(conv, Conv::Channel(_)))
    .bind(MEMBERS_PAGE)
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

/// Enveloppe de la clé d'époque d'un salon pour la clé de récupération du serveur.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerEnvelope {
    pub server_fp: String,
    pub wrapped: KeyWrap,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PostEnvelopes {
    epoch: i32,
    /// true : création de l'époque (`epoch` = 0 ou courante + 1 après un départ).
    #[serde(default)]
    create: bool,
    #[serde(default)]
    envelopes: Vec<Envelope>,
    /// Salon d'un serveur muni d'une clé de récupération : obligatoire à la création.
    #[serde(default)]
    server_envelope: Option<ServerEnvelope>,
}

/// Range des enveloppes faites par `user` (membre muni d'une clé) pour des membres de la conversation.
pub async fn store_envelopes(db: &PgPool, conv: Conv, user: Uuid, body: &PostEnvelopes) -> Result<()> {
    let members = require_member(db, conv, user).await?;
    let server_only = body.envelopes.is_empty() && body.server_envelope.is_some();
    if (body.envelopes.is_empty() && !server_only) || body.envelopes.len() > MAX_ENVELOPES {
        return Err(AppError::BadRequest("Nombre d'enveloppes invalide".into()));
    }
    if body.server_envelope.is_some() && !matches!(conv, Conv::Channel(_)) {
        return Err(AppError::BadRequest("Enveloppe de serveur réservée aux salons".into()));
    }
    if let Conv::Channel(c) = conv {
        // Rotation paresseuse : marque l'époque périmée si un détenteur a perdu l'accès.
        crate::handlers::e2e_channel::channel_epoch(db, c).await?;
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
        let ok = match conv {
            Conv::Channel(c) => {
                crate::handlers::e2e_channel::require_server_envelope(db, c, body.server_envelope.as_ref()).await?;
                channel_epoch_ok(user, &given)
            }
            _ => covers(&keyed, &given),
        };
        if !ok {
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
    if let (Conv::Channel(c), Some(se)) = (conv, &body.server_envelope) {
        crate::handlers::e2e_channel::store_server_envelope(&mut tx, c, body.epoch, user, &my_pub, se).await?;
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
    // Salon : quelques détenteurs connectés suffisent (pas tout le serveur).
    let asked = match conv {
        Conv::Channel(c) => crate::handlers::e2e_channel::key_holders_online(&state, c, claims.sub).await?,
        _ => members,
    };
    key_request(&state, conv, claims.sub, &asked).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct LegacyQuery {
    limit: Option<i64>,
}

/// GET /e2e/legacy — mes messages encore en clair dans les MP et les groupes
/// dont je suis encore membre, à rechiffrer par lots.
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
          WHERE m.sender_id=$1 AND m.enc IS NULL AND m.content IS NOT NULL
          ORDER BY m.created_at LIMIT $2)
         UNION ALL
         (SELECT 'group', m.dm_id, m.id, m.content FROM group_dm_messages m
          WHERE m.sender_id=$1 AND m.enc IS NULL AND m.content IS NOT NULL
            AND EXISTS(SELECT 1 FROM group_dm_members gm WHERE gm.dm_id=m.dm_id AND gm.user_id=$1)
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
        Conv::Channel(_) => return Err(AppError::NotFound("Conversation introuvable".into())),
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
/// clair antérieur encore présent dans les MP et groupes est effacé (nombre seul
/// journalisé). Les salons de serveur ne sont JAMAIS purgés : leur ancien
/// contenu est rechiffré par les applis (`e2e_legacy`).
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
    fn plaintext_always_refused() {
        assert!(code(plaintext_refused()).starts_with("PLAINTEXT_REFUSED "));
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
    fn channel_epoch_includes_its_creator() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        assert!(channel_epoch_ok(a, &[a]));
        assert!(channel_epoch_ok(a, &[b, a]));
        assert!(!channel_epoch_ok(a, &[b]));
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
        assert_eq!(Conv::parse("channel", id).unwrap(), Conv::Channel(id));
        assert!(Conv::parse("server", id).is_err());
    }
}

#[cfg(test)]
#[path = "e2e_db_tests.rs"]
mod db_tests;
