//! Interface des bots externes : enregistrement des commandes, URL de rappel, appel signé,
//! réponses d'interaction. Contrat : docs/BOT-COMMANDS.md.

use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, Path, State},
    http::HeaderMap,
    Extension, Json,
};
use serde::Deserialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::{args, Ctx, CmdSpec, Source, Vals};
use crate::{
    error::{AppError, Result},
    handlers::{bots::hash_bot_token, servers::require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

const MAX_COMMANDS_PER_BATCH: usize = 200;
const MAX_REPLIES: i32 = 5;
const CALLBACK_TIMEOUT_SECS: u64 = 4;
const CALLBACK_RESPONSE_MAX: usize = 16 * 1024;

/// Bot authentifié par `Authorization: Bot <jeton>`.
struct BotAuth {
    token_id: Uuid,
    server_id: Uuid,
    bot_user_id: Uuid,
}

/// Jeton → bot. Les échecs sont comptés par IP (30 / 15 min) comme pour `/api/bot/messages` ;
/// `token_id` impose en plus l'identifiant de jeton du chemin.
async fn authenticate(state: &AppState, headers: &HeaderMap, addr: &SocketAddr, token_id: Option<Uuid>) -> Result<BotAuth> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bot "))
        .ok_or(AppError::Unauthorized)?;
    let fail_key = format!("bot_auth_fail:{}", crate::privacy::client_key(headers, addr));
    {
        use redis::AsyncCommands;
        let n: Option<i64> = state.redis.lock().await.get(&fail_key).await
            .map_err(|_| AppError::Unavailable("Service momentanément indisponible, réessaie dans un instant".into()))?;
        if n.unwrap_or(0) >= 30 {
            return Err(AppError::TooManyRequests);
        }
    }
    let row = sqlx::query("SELECT id, server_id, bot_user_id FROM bot_tokens WHERE token_hash=$1 AND ($2::uuid IS NULL OR id=$2)")
        .bind(hash_bot_token(raw)).bind(token_id).fetch_optional(&state.db).await?;
    let Some(row) = row else {
        crate::handlers::auth_v2::hit(state, &fail_key, 30, 900).await?;
        return Err(AppError::Unauthorized);
    };
    Ok(BotAuth { token_id: row.get("id"), server_id: row.get("server_id"), bot_user_id: row.get("bot_user_id") })
}

/// URL de rappel : HTTPS, sans identifiants, hôte public (IP littérale privée refusée ici ;
/// la résolution DNS est refiltrée à chaque appel).
pub fn validate_callback_url(raw: &str) -> Result<String> {
    let bad = |m: &str| AppError::BadRequest(m.into());
    if raw.len() > 500 {
        return Err(bad("URL de rappel trop longue (500 caractères)"));
    }
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| bad("URL de rappel invalide"))?;
    if url.scheme() != "https" {
        return Err(bad("L'URL de rappel doit être en HTTPS"));
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(bad("URL de rappel : identifiants et fragment interdits"));
    }
    if !crate::net_guard::url_target_ok(&url) {
        return Err(bad("URL de rappel : adresse non autorisée"));
    }
    Ok(url.to_string())
}

// ─── Enregistrement des commandes ────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CommandDef {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub options: Option<serde_json::Value>,
    #[serde(default)]
    pub required_permission: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub dangerous: Option<bool>,
}

struct Valid {
    name: String,
    description: String,
    options: serde_json::Value,
    required: String,
    category: String,
    dangerous: bool,
}

fn validate(def: &CommandDef) -> Result<Valid> {
    let bad = |m: String| AppError::BadRequest(m);
    let name = def.name.trim().to_lowercase();
    if !args::valid_ident(&name) {
        return Err(bad(format!("Nom de commande invalide « {name} » (1-32 caractères a-z 0-9 _ -)")));
    }
    if super::native::find(&name).is_some() || super::native::RESERVED_CLIENT.contains(&name.as_str()) {
        return Err(bad(format!("« {name} » est réservé à une commande intégrée")));
    }
    let description = def.description.trim().to_string();
    if description.is_empty() || description.chars().count() > 100 {
        return Err(bad(format!("Description invalide pour /{name} (1-100 caractères)")));
    }
    let options = def.options.clone().unwrap_or_else(|| serde_json::json!([]));
    if args::opts_from_json(&options).is_none() {
        return Err(bad(format!("Options invalides pour /{name} (25 max, noms uniques, obligatoires d'abord, types string|integer|boolean|user|role)")));
    }
    let required = def.required_permission.as_deref().map(str::trim).filter(|r| !r.is_empty()).unwrap_or("everyone").to_string();
    if !super::valid_requirement(&required) {
        return Err(bad(format!("required_permission invalide pour /{name}")));
    }
    let category = def.category.as_deref().map(str::trim).filter(|c| !c.is_empty()).unwrap_or("general").to_lowercase();
    if !args::valid_ident(&category) {
        return Err(bad(format!("Catégorie invalide pour /{name}")));
    }
    Ok(Valid { name, description, options, required, category, dangerous: def.dangerous.unwrap_or(false) })
}

async fn upsert<'e, E: sqlx::PgExecutor<'e>>(ex: E, bot: &BotAuth, v: &Valid) -> Result<()> {
    sqlx::query(
        "INSERT INTO bot_commands (bot_id, server_id, name, description, options, required_permission, category, dangerous)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (bot_id, server_id, name) DO UPDATE SET description=EXCLUDED.description, options=EXCLUDED.options,
           required_permission=EXCLUDED.required_permission, category=EXCLUDED.category, dangerous=EXCLUDED.dangerous")
        .bind(bot.token_id).bind(bot.server_id).bind(&v.name).bind(&v.description).bind(&v.options)
        .bind(&v.required).bind(&v.category).bind(v.dangerous)
        .execute(ex).await?;
    Ok(())
}

async fn registration_limit(state: &AppState, bot: &BotAuth) -> Result<()> {
    if crate::handlers::password_reset::over_limit(state, &format!("bot_reg:{}", bot.token_id), 30, 60).await {
        return Err(AppError::TooManyRequests);
    }
    Ok(())
}

/// POST /api/bots/:bot_id/commands : enregistre ou met à jour UNE commande (rétro-compatible :
/// seuls `name` et `description` sont obligatoires).
pub async fn register_command(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(bot_id): Path<Uuid>,
    Json(body): Json<CommandDef>,
) -> Result<Json<serde_json::Value>> {
    let bot = authenticate(&state, &headers, &addr, Some(bot_id)).await?;
    registration_limit(&state, &bot).await?;
    let v = validate(&body)?;
    upsert(&state.db, &bot, &v).await?;
    Ok(Json(serde_json::json!({ "ok": true, "name": v.name })))
}

#[derive(Deserialize)]
pub struct BatchBody {
    pub commands: Vec<CommandDef>,
    /// Vrai : les commandes absentes de la liste sont supprimées (synchronisation complète).
    #[serde(default)]
    pub replace: bool,
    /// Définit l'URL de rappel du bot en même temps (null/absent = inchangée).
    #[serde(default)]
    pub callback_url: Option<String>,
}

/// POST /api/bots/:bot_id/commands/batch : enregistrement en lot, tout ou rien (200 commandes max).
pub async fn register_batch(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(bot_id): Path<Uuid>,
    Json(body): Json<BatchBody>,
) -> Result<Json<serde_json::Value>> {
    let bot = authenticate(&state, &headers, &addr, Some(bot_id)).await?;
    registration_limit(&state, &bot).await?;
    if body.commands.len() > MAX_COMMANDS_PER_BATCH {
        return Err(AppError::BadRequest(format!("{MAX_COMMANDS_PER_BATCH} commandes au plus par lot")));
    }
    let valid: Vec<Valid> = body.commands.iter().map(validate).collect::<Result<_>>()?;
    let mut names: Vec<&str> = valid.iter().map(|v| v.name.as_str()).collect();
    names.sort_unstable();
    if names.windows(2).any(|w| w[0] == w[1]) {
        return Err(AppError::BadRequest("Nom de commande en double dans le lot".into()));
    }
    let callback = match body.callback_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => Some(validate_callback_url(u)?),
        None => None,
    };
    let mut tx = state.db.begin().await?;
    for v in &valid {
        upsert(&mut *tx, &bot, v).await?;
    }
    let mut removed = 0;
    if body.replace {
        let keep: Vec<String> = valid.iter().map(|v| v.name.clone()).collect();
        removed = sqlx::query("DELETE FROM bot_commands WHERE bot_id=$1 AND server_id=$2 AND NOT (name = ANY($3))")
            .bind(bot.token_id).bind(bot.server_id).bind(&keep).execute(&mut *tx).await?.rows_affected();
    }
    if let Some(url) = &callback {
        sqlx::query("UPDATE bot_tokens SET callback_url=$2 WHERE id=$1").bind(bot.token_id).bind(url).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({ "ok": true, "registered": valid.len(), "removed": removed })))
}

#[derive(Deserialize)]
pub struct CallbackBody {
    /// null ou vide = retirer l'URL (le bot ne reçoit plus de commandes).
    #[serde(default)]
    pub callback_url: Option<String>,
}

/// PUT /servers/:server_id/bots/:bot_id/callback : un administrateur règle l'URL de rappel du bot.
pub async fn set_callback(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path((server_id, bot_user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CallbackBody>,
) -> Result<Json<serde_json::Value>> {
    require_permission(&state, claims.sub, server_id, Permissions::MANAGE_SERVER).await?;
    let url = match body.callback_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => Some(validate_callback_url(u)?),
        None => None,
    };
    let done = sqlx::query("UPDATE bot_tokens SET callback_url=$3 WHERE bot_user_id=$1 AND server_id=$2")
        .bind(bot_user_id).bind(server_id).bind(&url).execute(&state.db).await?;
    if done.rows_affected() == 0 {
        return Err(AppError::NotFound("Bot introuvable".into()));
    }
    crate::handlers::audit::log_event(&state, server_id, "BOT_CALLBACK_SET", Some(claims.sub), Some(bot_user_id), None,
        Some(serde_json::json!({ "configured": url.is_some() }))).await;
    Ok(Json(serde_json::json!({ "ok": true, "has_callback": url.is_some() })))
}

// ─── Appel du bot ────────────────────────────────────────────────────────────

/// `sha256=<hex>` de HMAC-SHA256(clé, "<horodatage>.<corps>") ; la clé est `base64(sha256(jeton))`,
/// c'est-à-dire la valeur stockée (le jeton brut n'est jamais conservé).
pub fn sign(key: &str, timestamp: i64, body: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    let mut mac = Hmac::<sha2::Sha256>::new_from_slice(key.as_bytes()).expect("HMAC accepte toute longueur de clé");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    format!("sha256={}", data_encoding::HEXLOWER.encode(&mac.finalize().into_bytes()))
}

/// Crée l'interaction et POSTe la commande au bot en tâche de fond (le message de l'appelant
/// n'attend pas). Échec d'appel : message éphémère à l'appelant.
pub async fn forward(state: &AppState, claims: &Claims, ctx: &Ctx<'_>, spec: &CmdSpec, vals: &Vals, raw_args: &str) -> Result<()> {
    let Source::Bot { token_id, callback_url: Some(url), token_hash, .. } = &spec.source else {
        return Err(AppError::BadRequest("Ce bot n'a pas d'URL de rappel".into()));
    };
    let interaction_id: Uuid = sqlx::query_scalar(
        "INSERT INTO command_interactions (bot_token_id, server_id, channel_id, user_id, command) VALUES ($1,$2,$3,$4,$5) RETURNING id")
        .bind(token_id).bind(ctx.server_id).bind(ctx.channel_id).bind(claims.sub).bind(&spec.name)
        .fetch_one(&state.db).await?;
    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id=$1").bind(claims.sub).fetch_one(&state.db).await?;
    let options: serde_json::Map<String, serde_json::Value> = vals.0.iter().map(|(k, v)| (k.clone(), v.to_json())).collect();
    let payload = serde_json::json!({
        "version": 1,
        "interaction_id": interaction_id,
        "command": spec.name,
        "options": options,
        "args": raw_args,
        "channel_id": ctx.channel_id,
        "server_id": ctx.server_id,
        "user": {
            "id": claims.sub,
            "username": username,
            "role_ids": ctx.caller.role_ids,
            // Chaîne : l'entier dépasse 2^53 pour un administrateur (masque complet).
            "permissions": ctx.caller.perms.to_string(),
            "is_owner": ctx.caller.is_owner,
        },
    });
    let (state, url, key) = (state.clone(), url.clone(), token_hash.clone());
    let (server_id, channel_id, user_id, command, token_id) = (ctx.server_id, ctx.channel_id, claims.sub, spec.name.clone(), *token_id);
    tokio::spawn(async move {
        let result = call_bot(&url, &key, &payload).await;
        match result {
            Ok(Some((content, ephemeral))) => {
                if let Err(e) = deliver_interaction(&state, interaction_id, token_id, &content, ephemeral).await {
                    super::send_ephemeral(&state, server_id, channel_id, user_id, &command, &super::error_text(&e), Some(interaction_id)).await;
                }
            }
            Ok(None) => {}
            Err(why) => {
                tracing::warn!("Commande /{command} : rappel du bot en échec : {why}");
                super::send_ephemeral(&state, server_id, channel_id, user_id, &command,
                    "Le bot n'a pas répondu à la commande.", Some(interaction_id)).await;
            }
        }
    });
    Ok(())
}

/// POST signé ; Ok(Some) si le bot a répondu tout de suite `{content, ephemeral?}`.
async fn call_bot(url: &str, key: &str, payload: &serde_json::Value) -> std::result::Result<Option<(String, bool)>, String> {
    // Revérifié à chaque appel : l'URL a pu être enregistrée avant un durcissement des règles.
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || !crate::net_guard::url_target_ok(&parsed) {
        return Err("URL de rappel non autorisée".into());
    }
    let client = crate::net_guard::public_client(0, "ForgeChat-Commands/1")
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(CALLBACK_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;
    let body = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().timestamp();
    let resp = client.post(parsed)
        .header("Content-Type", "application/json")
        .header("X-ForgeChat-Timestamp", ts.to_string())
        .header("X-ForgeChat-Signature", sign(key, ts, &body))
        .body(body)
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("statut {}", resp.status()));
    }
    let Some(bytes) = crate::net_guard::read_capped(resp, CALLBACK_RESPONSE_MAX).await else { return Ok(None) };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Ok(None) };
    Ok(v.get("content").and_then(|c| c.as_str()).filter(|c| !c.trim().is_empty())
        .map(|c| (c.to_string(), v.get("ephemeral").and_then(|e| e.as_bool()).unwrap_or(false))))
}

// ─── Réponses d'interaction ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ReplyBody {
    pub content: String,
    /// Vrai : visible du seul appelant de la commande (rien n'est stocké).
    #[serde(default)]
    pub ephemeral: bool,
}

/// Compte une réponse (5 au plus, 15 min) puis publie ou montre le message. Contrôles d'un
/// message de bot ordinaire pour le cas public (salon visible, écriture permise, anti-spam, AutoMod).
async fn deliver_interaction(state: &AppState, interaction_id: Uuid, token_id: Uuid, content: &str, ephemeral: bool) -> Result<()> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::BadRequest("Contenu vide".into()));
    }
    let content: String = content.chars().take(if ephemeral { 4000 } else { 2000 }).collect();
    let row = sqlx::query(
        "UPDATE command_interactions ci SET replies = replies + 1
         WHERE ci.id=$1 AND ci.bot_token_id=$2 AND ci.replies < $3 AND ci.created_at > NOW() - INTERVAL '15 minutes'
         RETURNING ci.server_id, ci.channel_id, ci.user_id, ci.command,
           (SELECT bot_user_id FROM bot_tokens WHERE id = ci.bot_token_id) AS bot_user_id")
        .bind(interaction_id).bind(token_id).bind(MAX_REPLIES).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::BadRequest("Interaction inconnue, expirée ou limite de réponses atteinte".into()))?;
    let (server_id, channel_id, user_id): (Uuid, Uuid, Uuid) = (row.get("server_id"), row.get("channel_id"), row.get("user_id"));
    if ephemeral {
        super::send_ephemeral(state, server_id, channel_id, user_id, &row.get::<String, _>("command"), &content, Some(interaction_id)).await;
        return Ok(());
    }
    let bot_id: Uuid = row.get("bot_user_id");
    crate::handlers::servers::require_can_post(state, bot_id, server_id, channel_id, false).await?;
    crate::handlers::post_guard::check_spam(&state.db, bot_id, channel_id).await?;
    if let Some(err) = crate::handlers::audit::check_automod(state, server_id, bot_id, &content).await {
        return Err(err);
    }
    crate::handlers::bots::post_plain_message(state, bot_id, server_id, channel_id, content).await?;
    Ok(())
}

/// POST /api/bot/interactions/:interaction_id/reply : réponse du bot à une commande.
pub async fn interaction_reply(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(interaction_id): Path<Uuid>,
    Json(body): Json<ReplyBody>,
) -> Result<Json<serde_json::Value>> {
    let bot = authenticate(&state, &headers, &addr, None).await?;
    let _ = (bot.server_id, bot.bot_user_id);
    deliver_interaction(&state, interaction_id, bot.token_id, &body.content, body.ephemeral).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Interactions de plus d'un jour : inutiles (réponses possibles 15 min).
pub async fn purge_old_interactions(db: &PgPool) {
    if let Err(e) = sqlx::query("DELETE FROM command_interactions WHERE created_at < NOW() - INTERVAL '1 day'").execute(db).await {
        tracing::warn!("Purge des interactions de commandes : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_urls() {
        assert!(validate_callback_url("https://bot.example.com/forgechat").is_ok());
        for bad in ["http://bot.example.com/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://u:p@bot.example.com/", "ftp://x.com", "pas une url", "https://[::1]/x", "https://169.254.169.254/latest"] {
            assert!(validate_callback_url(bad).is_err(), "{bad}");
        }
        assert!(validate_callback_url(&format!("https://a.com/{}", "x".repeat(600))).is_err());
    }

    #[test]
    fn signature_is_stable_and_bound_to_timestamp() {
        let a = sign("cle", 1000, b"{\"a\":1}");
        assert!(a.starts_with("sha256=") && a.len() == 7 + 64);
        assert_eq!(a, sign("cle", 1000, b"{\"a\":1}"));
        assert_ne!(a, sign("cle", 1001, b"{\"a\":1}"));
        assert_ne!(a, sign("autre", 1000, b"{\"a\":1}"));
        assert_ne!(a, sign("cle", 1000, b"{\"a\":2}"));
    }

    #[test]
    fn command_definitions() {
        let ok = |j: serde_json::Value| validate(&serde_json::from_value::<CommandDef>(j).unwrap());
        assert!(ok(serde_json::json!({"name":"Fun-Cat","description":"Chat"})).is_ok());
        assert_eq!(ok(serde_json::json!({"name":"Fun-Cat","description":"Chat"})).unwrap().name, "fun-cat");
        assert!(ok(serde_json::json!({"name":"ban","description":"d"})).is_err(), "nom natif réservé");
        assert!(ok(serde_json::json!({"name":"me","description":"d"})).is_err(), "commande intégrée du client");
        assert!(ok(serde_json::json!({"name":"x y","description":"d"})).is_err());
        assert!(ok(serde_json::json!({"name":"x","description":""})).is_err());
        assert!(ok(serde_json::json!({"name":"x","description":"d","required_permission":"ROOT"})).is_err());
        assert!(ok(serde_json::json!({"name":"x","description":"d","required_permission":"KICK_MEMBERS","dangerous":true})).is_ok());
        assert!(ok(serde_json::json!({"name":"x","description":"d","options":[{"name":"q","type":"string","required":true}]})).is_ok());
        assert!(ok(serde_json::json!({"name":"x","description":"d","options":"nope"})).is_err());
    }
}
