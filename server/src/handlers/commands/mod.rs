//! Commandes slash de ForgeChat : commandes natives (`native.rs`) et commandes de bots externes
//! (`bot_api.rs`), avec permissions vérifiées AU MOMENT de l'exécution et exceptions par serveur.
//! Contrat des bots : docs/BOT-COMMANDS.md.

pub mod args;
pub mod bot_api;
pub mod native;

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::servers::{require_member, require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};
use args::OptDef;

/// Nom affiché pour les commandes intégrées.
pub const NATIVE_BOT_NAME: &str = "ForgeBot";

// ─── Permissions ─────────────────────────────────────────────────────────────

const PERM_NAMES: &[(&str, i64)] = &[
    ("VIEW_CHANNEL", Permissions::VIEW_CHANNEL), ("SEND_MESSAGES", Permissions::SEND_MESSAGES),
    ("READ_HISTORY", Permissions::READ_HISTORY), ("MANAGE_MESSAGES", Permissions::MANAGE_MESSAGES),
    ("MANAGE_CHANNELS", Permissions::MANAGE_CHANNELS), ("MANAGE_ROLES", Permissions::MANAGE_ROLES),
    ("KICK_MEMBERS", Permissions::KICK_MEMBERS), ("BAN_MEMBERS", Permissions::BAN_MEMBERS),
    ("MANAGE_SERVER", Permissions::MANAGE_SERVER), ("MENTION_EVERYONE", Permissions::MENTION_EVERYONE),
    ("ATTACH_FILES", Permissions::ATTACH_FILES), ("EMBED_LINKS", Permissions::EMBED_LINKS),
    ("ADD_REACTIONS", Permissions::ADD_REACTIONS), ("CONNECT_VOICE", Permissions::CONNECT_VOICE),
    ("SPEAK_VOICE", Permissions::SPEAK_VOICE), ("MUTE_MEMBERS", Permissions::MUTE_MEMBERS),
    ("DEAFEN_MEMBERS", Permissions::DEAFEN_MEMBERS), ("MOVE_MEMBERS", Permissions::MOVE_MEMBERS),
    ("CREATE_CHANNELS", Permissions::CREATE_CHANNELS), ("EDIT_CHANNELS", Permissions::EDIT_CHANNELS),
    ("DELETE_CHANNELS", Permissions::DELETE_CHANNELS), ("BAN_TEMP", Permissions::BAN_TEMP),
    ("MANAGE_NICKNAMES", Permissions::MANAGE_NICKNAMES), ("STREAM", Permissions::STREAM),
    ("ADMINISTRATOR", Permissions::ADMINISTRATOR),
];

/// Exigence valide : `everyone`, `owner`, ou une ou plusieurs permissions (`A|B` = l'une ou l'autre).
pub fn valid_requirement(s: &str) -> bool {
    matches!(s, "everyone" | "owner") || (!s.is_empty() && s.split('|').all(|p| PERM_NAMES.iter().any(|(n, _)| *n == p)))
}

/// Qui appelle : droits effectifs (tout si propriétaire ou administrateur) et rôles.
pub struct Caller {
    pub perms: i64,
    pub is_owner: bool,
    pub role_ids: Vec<Uuid>,
}

impl Caller {
    pub fn meets(&self, req: &str) -> bool {
        match req {
            "everyone" => true,
            "owner" => self.is_owner,
            _ => req.split('|').any(|p| PERM_NAMES.iter().any(|(n, b)| *n == p && self.perms & b != 0)),
        }
    }
    fn is_admin(&self) -> bool {
        self.is_owner || self.perms == i64::MAX
    }
}

pub async fn caller(state: &AppState, server_id: Uuid, user_id: Uuid) -> Result<Caller> {
    let perms = crate::handlers::servers::effective_permissions(state, user_id, server_id).await?;
    let is_owner = crate::handlers::servers::require_owner(state, user_id, server_id).await.is_ok();
    let role_ids: Vec<Uuid> = sqlx::query_scalar("SELECT role_id FROM member_roles WHERE user_id=$1 AND server_id=$2")
        .bind(user_id).bind(server_id).fetch_all(&state.db).await?;
    Ok(Caller { perms, is_owner, role_ids })
}

/// Exception d'un serveur pour une commande.
#[derive(Clone, Debug, Default)]
pub struct Override {
    pub enabled: bool,
    pub allowed_role_ids: Vec<Uuid>,
    pub required_permission: Option<String>,
}

pub enum Source {
    Native,
    Bot { token_id: Uuid, bot_name: String, bot_username: String, bot_avatar: Option<String>, callback_url: Option<String>, token_hash: String },
}

pub struct CmdSpec {
    pub name: String,
    pub description: String,
    pub category: String,
    /// Exigence par défaut (`everyone` | `owner` | permissions).
    pub required: String,
    pub dangerous: bool,
    pub options: Vec<OptDef>,
    pub source: Source,
}

/// Décision d'accès, calculée côté serveur à chaque exécution et pour la liste.
/// Une exception ne peut que RESTREINDRE : désactiver, relever l'exigence, limiter à des rôles
/// (propriétaire et administrateurs passent toujours la limite de rôles). Une commande native
/// garde en plus sa permission par défaut : les routes REST qu'elle réutilise la revérifient.
pub fn is_allowed(c: &Caller, spec: &CmdSpec, ov: Option<&Override>) -> bool {
    let (enabled, roles, req) = match ov {
        Some(o) => (o.enabled, o.allowed_role_ids.as_slice(), o.required_permission.as_deref()),
        None => (true, &[][..], None),
    };
    if !enabled || !c.meets(req.unwrap_or(&spec.required)) {
        return false;
    }
    if matches!(spec.source, Source::Native) && !c.meets(&spec.required) {
        return false;
    }
    roles.is_empty() || c.is_admin() || c.role_ids.iter().any(|r| roles.contains(r))
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

fn bot_spec(r: &sqlx::postgres::PgRow) -> CmdSpec {
    let options = args::opts_from_json(&r.get::<serde_json::Value, _>("options")).unwrap_or_default();
    CmdSpec {
        name: r.get("name"),
        description: r.get("description"),
        category: r.get("category"),
        required: r.get("required_permission"),
        dangerous: r.get("dangerous"),
        options,
        source: Source::Bot {
            token_id: r.get("token_id"),
            bot_name: r.get("bot_name"),
            bot_username: r.get("username"),
            bot_avatar: r.get("avatar"),
            callback_url: r.get("callback_url"),
            token_hash: r.get("token_hash"),
        },
    }
}

/// Seuls les bots toujours membres du serveur comptent (comme `is_bot_command`).
const BOT_CMD_SQL: &str = "SELECT bc.name, bc.description, bc.options, bc.required_permission, bc.category, bc.dangerous,
        bt.id AS token_id, bt.bot_user_id, bt.name AS bot_name, bt.callback_url, bt.token_hash, u.username, u.avatar
     FROM bot_commands bc
     JOIN bot_tokens bt ON bt.id = bc.bot_id AND bt.server_id = bc.server_id
     JOIN server_members sm ON sm.user_id = bt.bot_user_id AND sm.server_id = bc.server_id
     JOIN users u ON u.id = bt.bot_user_id AND u.is_bot
     WHERE bc.server_id=$1";

pub async fn lookup(state: &AppState, server_id: Uuid, name: &str) -> Result<Option<CmdSpec>> {
    if let Some(n) = native::find(name) {
        return Ok(Some(n.spec()));
    }
    let sql = format!("{BOT_CMD_SQL} AND bc.name=$2 ORDER BY bc.created_at LIMIT 1");
    let row = sqlx::query(&sql).bind(server_id).bind(name).fetch_optional(&state.db).await?;
    Ok(row.as_ref().map(bot_spec))
}

pub async fn all_specs(state: &AppState, server_id: Uuid) -> Result<Vec<CmdSpec>> {
    let mut out: Vec<CmdSpec> = native::NATIVES.iter().map(|n| n.spec()).collect();
    let sql = format!("{BOT_CMD_SQL} ORDER BY bc.created_at, bc.name");
    let rows = sqlx::query(&sql).bind(server_id).fetch_all(&state.db).await?;
    for r in &rows {
        let s = bot_spec(r);
        if !out.iter().any(|o| o.name == s.name) {
            out.push(s);
        }
    }
    Ok(out)
}

pub async fn overrides(state: &AppState, server_id: Uuid) -> Result<HashMap<String, Override>> {
    let rows = sqlx::query("SELECT command, enabled, allowed_role_ids, required_permission FROM server_command_overrides WHERE server_id=$1")
        .bind(server_id).fetch_all(&state.db).await?;
    Ok(rows.iter().map(|r| (r.get("command"), Override {
        enabled: r.get("enabled"),
        allowed_role_ids: r.get("allowed_role_ids"),
        required_permission: r.get("required_permission"),
    })).collect())
}

/// GET /servers/:id/commands : commandes natives et de bots, `allowed` calculé pour l'appelant.
pub async fn list_server_commands(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>> {
    require_member(&state, claims.sub, server_id).await?;
    let c = caller(&state, server_id, claims.sub).await?;
    let ovs = overrides(&state, server_id).await?;
    let mut specs = all_specs(&state, server_id).await?;
    specs.sort_by(|a, b| (&a.category, &a.name).cmp(&(&b.category, &b.name)));
    Ok(Json(specs.iter().map(|s| {
        let ov = ovs.get(&s.name);
        let (bot_name, bot_username, bot_avatar, is_native) = match &s.source {
            Source::Native => (NATIVE_BOT_NAME.to_string(), "forgebot".to_string(), None, true),
            Source::Bot { bot_name, bot_username, bot_avatar, .. } => (bot_name.clone(), bot_username.clone(), bot_avatar.clone(), false),
        };
        serde_json::json!({
            "name": s.name,
            "description": s.description,
            "category": s.category,
            "dangerous": s.dangerous,
            "native": is_native,
            "options": s.options.iter().map(OptDef::to_json).collect::<Vec<_>>(),
            "bot_name": bot_name,
            "bot_username": bot_username,
            "bot_avatar": bot_avatar,
            "default_permission": s.required,
            "required_permission": ov.and_then(|o| o.required_permission.clone()).unwrap_or_else(|| s.required.clone()),
            "enabled": ov.is_none_or(|o| o.enabled),
            "allowed_role_ids": ov.map(|o| o.allowed_role_ids.clone()).unwrap_or_default(),
            "allowed": is_allowed(&c, s, ov),
        })
    }).collect()))
}

#[derive(serde::Deserialize)]
pub struct OverrideBody {
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub allowed_role_ids: Vec<Uuid>,
    #[serde(default)]
    pub required_permission: Option<String>,
}
fn yes() -> bool { true }

/// PUT /servers/:id/commands/:name/override : MANAGE_SERVER. Un état par défaut supprime l'exception.
pub async fn put_override(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, name)): Path<(Uuid, String)>,
    Json(body): Json<OverrideBody>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let name = name.to_lowercase();
    if lookup(&state, server_id, &name).await?.is_none() {
        return Err(AppError::NotFound("Commande introuvable".into()));
    }
    let req = body.required_permission.as_deref().map(str::trim).filter(|r| !r.is_empty());
    if req.is_some_and(|r| !valid_requirement(r)) {
        return Err(AppError::BadRequest("Permission requise invalide".into()));
    }
    let mut roles = body.allowed_role_ids.clone();
    roles.sort();
    roles.dedup();
    if roles.len() > 25 {
        return Err(AppError::BadRequest("25 rôles au plus".into()));
    }
    let valid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE server_id=$1 AND NOT is_everyone AND id = ANY($2)")
        .bind(server_id).bind(&roles).fetch_one(&state.db).await?;
    if valid != roles.len() as i64 {
        return Err(AppError::BadRequest("Rôle inconnu".into()));
    }
    if body.enabled && roles.is_empty() && req.is_none() {
        sqlx::query("DELETE FROM server_command_overrides WHERE server_id=$1 AND command=$2")
            .bind(server_id).bind(&name).execute(&state.db).await?;
    } else {
        sqlx::query(
            "INSERT INTO server_command_overrides (server_id, command, enabled, allowed_role_ids, required_permission, updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (server_id, command) DO UPDATE SET enabled=EXCLUDED.enabled, allowed_role_ids=EXCLUDED.allowed_role_ids,
               required_permission=EXCLUDED.required_permission, updated_by=EXCLUDED.updated_by, updated_at=NOW()")
            .bind(server_id).bind(&name).bind(body.enabled).bind(&roles).bind(req).bind(claims.sub)
            .execute(&state.db).await?;
    }
    crate::handlers::audit::log_event(&state, server_id, "COMMAND_OVERRIDE", Some(claims.sub), None, Some(&name),
        Some(serde_json::json!({ "enabled": body.enabled, "roles": roles.len(), "required_permission": req }))).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_override(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, name)): Path<(Uuid, String)>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let name = name.to_lowercase();
    sqlx::query("DELETE FROM server_command_overrides WHERE server_id=$1 AND command=$2")
        .bind(server_id).bind(&name).execute(&state.db).await?;
    crate::handlers::audit::log_event(&state, server_id, "COMMAND_OVERRIDE", Some(claims.sub), None, Some(&name),
        Some(serde_json::json!({ "reset": true }))).await;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// ─── Exécution ───────────────────────────────────────────────────────────────

pub struct Ctx<'a> {
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub caller: &'a Caller,
}

/// Réponse d'une commande : visible du seul appelant, publique, ou rien.
pub enum Reply {
    Ephemeral(String),
    Public(String),
    Done,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    Str(String),
    Int(i64),
    Bool(bool),
    User(Uuid),
    Role(Uuid),
}

impl Val {
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Val::Str(s) => s.clone().into(),
            Val::Int(i) => (*i).into(),
            Val::Bool(b) => (*b).into(),
            Val::User(u) | Val::Role(u) => u.to_string().into(),
        }
    }
}

#[derive(Default)]
pub struct Vals(pub HashMap<String, Val>);

impl Vals {
    pub fn str(&self, k: &str) -> Option<&str> {
        match self.0.get(k) { Some(Val::Str(s)) => Some(s), _ => None }
    }
    pub fn int(&self, k: &str) -> Option<i64> {
        match self.0.get(k) { Some(Val::Int(i)) => Some(*i), _ => None }
    }
    pub fn user(&self, k: &str) -> Option<Uuid> {
        match self.0.get(k) { Some(Val::User(u)) => Some(*u), _ => None }
    }
    pub fn role(&self, k: &str) -> Option<Uuid> {
        match self.0.get(k) { Some(Val::Role(u)) => Some(*u), _ => None }
    }
}

/// Message d'erreur montrable à l'appelant : les erreurs internes ne fuient pas.
pub fn error_text(e: &AppError) -> String {
    match e {
        AppError::BadRequest(m) | AppError::ForbiddenMsg(m) | AppError::NotFound(m) | AppError::Conflict(m)
        | AppError::TooManyRequestsMsg(m) | AppError::Unavailable(m) | AppError::PayloadTooLarge(m) => m.clone(),
        AppError::Forbidden | AppError::Unauthorized => "Permission refusée.".into(),
        AppError::TooManyRequests => "Trop de tentatives, réessaie plus tard.".into(),
        AppError::SlowMode(s) => format!("Mode lent actif : attends {s} secondes."),
        other => {
            tracing::error!("Commande : erreur interne : {other}");
            "Erreur interne, réessaie plus tard.".into()
        }
    }
}

/// Message visible du seul appelant (évènement WS ciblé, jamais stocké).
pub async fn send_ephemeral(state: &AppState, server_id: Uuid, channel_id: Uuid, user_id: Uuid, command: &str, content: &str, interaction_id: Option<Uuid>) {
    let content: String = content.chars().take(4000).collect();
    state.broadcast_to_user(user_id, serde_json::json!({
        "type": "COMMAND_RESPONSE",
        "server_id": server_id,
        "channel_id": channel_id,
        "command": command,
        "content": content,
        "ephemeral": true,
        "interaction_id": interaction_id,
    }).to_string()).await;
}

/// Neutralise les mentions (@everyone, <@id>) d'un texte saisi par un membre avant de le republier.
pub fn defang(s: &str) -> String {
    s.replace('@', "@\u{200b}").replace("<#", "<\u{200b}#")
}

async fn resolve_user(state: &AppState, server_id: Uuid, tok: &str) -> std::result::Result<Uuid, String> {
    let db_err = |_| "Erreur interne, réessaie plus tard.".to_string();
    match args::mention_or_name(tok) {
        Ok(id) => {
            let ok: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id=$1 AND user_id=$2)")
                .bind(server_id).bind(id).fetch_one(&state.db).await.map_err(db_err)?;
            if ok { Ok(id) } else { Err("Membre introuvable.".into()) }
        }
        Err(name) => {
            let (uname, disc) = match name.split_once('#') { Some((n, d)) => (n.to_string(), Some(d.to_string())), None => (name.clone(), None) };
            let ids: Vec<Uuid> = sqlx::query_scalar(
                "SELECT sm.user_id FROM server_members sm JOIN users u ON u.id = sm.user_id
                 WHERE sm.server_id=$1 AND (LOWER(u.username)=LOWER($2) OR LOWER(sm.nickname)=LOWER($2))
                   AND ($3::text IS NULL OR u.discriminator=$3)
                 LIMIT 3")
                .bind(server_id).bind(&uname).bind(&disc).fetch_all(&state.db).await.map_err(db_err)?;
            match ids.len() {
                0 => Err(format!("Membre introuvable : {}", defang(&name))),
                1 => Ok(ids[0]),
                _ => Err(format!("Plusieurs membres s'appellent {} : mentionne-le avec @ ou ajoute #0000.", defang(&name))),
            }
        }
    }
}

async fn resolve_role(state: &AppState, server_id: Uuid, tok: &str) -> std::result::Result<Uuid, String> {
    let db_err = |_| "Erreur interne, réessaie plus tard.".to_string();
    let found: Option<Uuid> = match args::mention_or_name(tok) {
        Ok(id) => sqlx::query_scalar("SELECT id FROM roles WHERE id=$1 AND server_id=$2 AND NOT is_everyone")
            .bind(id).bind(server_id).fetch_optional(&state.db).await.map_err(db_err)?,
        Err(name) => sqlx::query_scalar("SELECT id FROM roles WHERE server_id=$1 AND NOT is_everyone AND LOWER(name)=LOWER($2) LIMIT 1")
            .bind(server_id).bind(&name).fetch_optional(&state.db).await.map_err(db_err)?,
    };
    found.ok_or_else(|| "Rôle introuvable.".to_string())
}

/// Texte brut → valeurs typées (membres et rôles résolus dans CE serveur).
pub async fn parse_vals(state: &AppState, server_id: Uuid, name: &str, opts: &[OptDef], raw_args: &str) -> std::result::Result<Vals, String> {
    let raws = args::split(raw_args, opts, name)?;
    let mut vals = Vals::default();
    for (o, raw) in opts.iter().zip(raws) {
        let Some(raw) = raw else { continue };
        if !o.choices.is_empty() {
            let Some((_, val)) = o.choices.iter().find(|(n, val)| val.eq_ignore_ascii_case(&raw) || n.eq_ignore_ascii_case(&raw)) else {
                return Err(format!("Valeur invalide pour « {} » : {}", o.name, o.choices.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", ")));
            };
            let v = if o.kind == "integer" { Val::Int(val.parse().map_err(|_| "Choix invalide.".to_string())?) } else { Val::Str(val.clone()) };
            vals.0.insert(o.name.clone(), v);
            continue;
        }
        let v = match o.kind.as_str() {
            "integer" => Val::Int(raw.parse().map_err(|_| format!("« {} » doit être un nombre entier.", o.name))?),
            "boolean" => Val::Bool(args::parse_bool(&raw).ok_or_else(|| format!("« {} » doit être oui ou non.", o.name))?),
            "user" => Val::User(resolve_user(state, server_id, &raw).await?),
            "role" => Val::Role(resolve_role(state, server_id, &raw).await?),
            _ => Val::Str(raw),
        };
        vals.0.insert(o.name.clone(), v);
    }
    Ok(vals)
}

enum Done {
    Reply(Reply),
    Forwarded,
    Legacy,
}

/// Appelée par `send_message` pour chaque message « /commande … ». Vrai si la commande existe
/// (native ou de bot) : le message d'invocation est alors retiré du salon et la réponse part par
/// les canaux de la commande ; faux = texte ordinaire, rien n'est fait.
pub async fn handle_message(state: &AppState, claims: &Claims, server_id: Uuid, channel_id: Uuid, message_id: Uuid, content: &str) -> bool {
    let Some(name) = crate::handlers::e2e_channel::command_name(content) else { return false };
    let spec = match lookup(state, server_id, &name).await {
        Ok(Some(s)) => s,
        Ok(None) => return false,
        Err(e) => {
            tracing::error!("Commande /{name} : recherche impossible : {e}");
            return false;
        }
    };
    let arg_text = content.trim_start_matches('/').trim_start().get(name.len()..).unwrap_or("").trim().to_string();
    let user = claims.sub;
    let keep_message = match execute(state, claims, &spec, server_id, channel_id, message_id, &arg_text).await {
        Ok(Done::Reply(r)) => { deliver(state, claims, server_id, channel_id, &name, r).await; false }
        Ok(Done::Forwarded) => false,
        // Bot sans URL de rappel : ancien évènement WS diffusé, le message reste visible.
        Ok(Done::Legacy) => true,
        Err(e) => {
            send_ephemeral(state, server_id, channel_id, user, &name, &error_text(&e), None).await;
            false
        }
    };
    if !keep_message {
        remove_invocation(state, channel_id, message_id, user).await;
    }
    true
}

async fn execute(state: &AppState, claims: &Claims, spec: &CmdSpec, server_id: Uuid, channel_id: Uuid, message_id: Uuid, arg_text: &str) -> Result<Done> {
    let user = claims.sub;
    if crate::handlers::password_reset::over_limit(state, &format!("cmd:{server_id}:{user}"), 15, 30).await {
        return Err(AppError::TooManyRequestsMsg("Trop de commandes : attends quelques secondes.".into()));
    }
    let c = caller(state, server_id, user).await?;
    let ovs = overrides(state, server_id).await?;
    let ov = ovs.get(&spec.name);
    if !is_allowed(&c, spec, ov) {
        if spec.dangerous {
            crate::handlers::audit::log_event(state, server_id, "COMMAND_DENIED", Some(user), None, Some(&spec.name),
                Some(serde_json::json!({ "channel_id": channel_id }))).await;
        }
        let msg = if ov.is_some_and(|o| !o.enabled) { "Cette commande est désactivée sur ce serveur." } else { "Tu n'as pas la permission d'utiliser cette commande." };
        return Err(AppError::ForbiddenMsg(msg.into()));
    }
    if matches!(&spec.source, Source::Bot { callback_url: None, .. }) {
        state.broadcast_to_channel_members(channel_id, serde_json::json!({
            "type": "SLASH_COMMAND", "command": spec.name, "args": arg_text,
            "channel_id": channel_id, "server_id": server_id, "user_id": user,
        }).to_string()).await;
        return Ok(Done::Legacy);
    }
    let vals = parse_vals(state, server_id, &spec.name, &spec.options, arg_text).await.map_err(AppError::BadRequest)?;
    if spec.dangerous {
        crate::handlers::audit::log_event(state, server_id, "COMMAND_USE", Some(user), None, Some(&spec.name),
            Some(serde_json::json!({ "channel_id": channel_id, "args": arg_text.chars().take(200).collect::<String>() }))).await;
    }
    let ctx = Ctx { server_id, channel_id, message_id, caller: &c };
    match &spec.source {
        Source::Native => Ok(Done::Reply(native::run(state, claims, &ctx, &spec.name, &vals).await?)),
        Source::Bot { .. } => {
            bot_api::forward(state, claims, &ctx, spec, &vals, arg_text).await?;
            Ok(Done::Forwarded)
        }
    }
}

/// Publie une réponse publique (AutoMod appliqué) ou la montre au seul appelant.
async fn deliver(state: &AppState, claims: &Claims, server_id: Uuid, channel_id: Uuid, command: &str, reply: Reply) {
    match reply {
        Reply::Done => {}
        Reply::Ephemeral(t) => send_ephemeral(state, server_id, channel_id, claims.sub, command, &t, None).await,
        Reply::Public(t) => {
            let text: String = t.chars().take(2000).collect();
            if let Some(err) = crate::handlers::audit::check_automod(state, server_id, claims.sub, &text).await {
                send_ephemeral(state, server_id, channel_id, claims.sub, command, &error_text(&err), None).await;
                return;
            }
            if let Err(e) = crate::handlers::bots::post_plain_message(state, claims.sub, server_id, channel_id, text).await {
                send_ephemeral(state, server_id, channel_id, claims.sub, command, &error_text(&e), None).await;
            }
        }
    }
}

async fn remove_invocation(state: &AppState, channel_id: Uuid, message_id: Uuid, author: Uuid) {
    let res = sqlx::query("DELETE FROM messages WHERE id=$1 AND channel_id=$2 AND user_id=$3")
        .bind(message_id).bind(channel_id).bind(author).execute(&state.db).await;
    if res.is_ok_and(|r| r.rows_affected() > 0) {
        state.broadcast_to_channel_members(channel_id, serde_json::json!({
            "type": "MESSAGE_DELETE", "message_id": message_id, "channel_id": channel_id,
        }).to_string()).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caller(perms: i64, owner: bool, roles: Vec<Uuid>) -> Caller {
        Caller { perms, is_owner: owner, role_ids: roles }
    }
    fn spec(req: &str, native: bool) -> CmdSpec {
        CmdSpec {
            name: "x".into(), description: String::new(), category: "c".into(), required: req.into(), dangerous: false, options: vec![],
            source: if native { Source::Native } else {
                Source::Bot { token_id: Uuid::nil(), bot_name: String::new(), bot_username: String::new(), bot_avatar: None, callback_url: None, token_hash: String::new() }
            },
        }
    }

    #[test]
    fn requirements() {
        assert!(valid_requirement("everyone") && valid_requirement("owner") && valid_requirement("KICK_MEMBERS"));
        assert!(valid_requirement("BAN_MEMBERS|BAN_TEMP"));
        assert!(!valid_requirement("") && !valid_requirement("kick") && !valid_requirement("KICK_MEMBERS|"));
        let m = caller(Permissions::BAN_TEMP, false, vec![]);
        assert!(m.meets("BAN_MEMBERS|BAN_TEMP") && !m.meets("BAN_MEMBERS") && !m.meets("owner") && m.meets("everyone"));
    }

    #[test]
    fn access_rules() {
        let member = caller(Permissions::VIEW_CHANNEL | Permissions::SEND_MESSAGES, false, vec![]);
        let modo = caller(Permissions::KICK_MEMBERS, false, vec![]);
        let admin = caller(i64::MAX, false, vec![]);
        let owner = caller(i64::MAX, true, vec![]);
        let kick = spec("KICK_MEMBERS", true);
        assert!(!is_allowed(&member, &kick, None), "un simple membre n'a jamais accès");
        assert!(is_allowed(&modo, &kick, None) && is_allowed(&admin, &kick, None) && is_allowed(&owner, &kick, None));
        // Une exception ne peut pas ouvrir une commande native dangereuse à un membre sans la permission.
        let open = Override { enabled: true, allowed_role_ids: vec![], required_permission: Some("everyone".into()) };
        assert!(!is_allowed(&member, &kick, Some(&open)));
        // Désactivée : personne, pas même le propriétaire.
        let off = Override { enabled: false, ..Default::default() };
        assert!(!is_allowed(&owner, &kick, Some(&off)) && !is_allowed(&owner, &spec("everyone", false), Some(&off)));
        // Limitée à un rôle : le rôle et les administrateurs passent, les autres non.
        let role = Uuid::new_v4();
        let only = Override { enabled: true, allowed_role_ids: vec![role], required_permission: None };
        let fun = spec("everyone", true);
        assert!(!is_allowed(&member, &fun, Some(&only)) && is_allowed(&admin, &fun, Some(&only)));
        assert!(is_allowed(&caller(0, false, vec![role]), &fun, Some(&only)));
        // Commande de bot : l'exception peut relever l'exigence (owner) ou l'ouvrir (everyone).
        let bot = spec("MANAGE_SERVER", false);
        assert!(!is_allowed(&member, &bot, None));
        assert!(is_allowed(&member, &bot, Some(&open)));
        let owner_only = Override { enabled: true, required_permission: Some("owner".into()), ..Default::default() };
        assert!(!is_allowed(&admin, &bot, Some(&owner_only)) && is_allowed(&owner, &bot, Some(&owner_only)));
    }

    #[test]
    fn defang_blocks_mentions() {
        assert!(!defang("@everyone <@x>").contains("@everyone"));
    }
}

#[cfg(test)]
mod db_tests;
