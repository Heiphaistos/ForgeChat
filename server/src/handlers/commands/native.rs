//! Commandes intégrées de ForgeChat (« ForgeBot ») : modération et gestion (qui rappellent les
//! routes REST équivalentes, donc leurs contrôles de droits, de hiérarchie et d'audit) et petites
//! commandes ouvertes à tous. Chaque exécuteur revérifie lui-même les droits de l'appelant.

use axum::{extract::{Path, State}, Extension, Json};
use rand::Rng;
use uuid::Uuid;

use super::{defang, Ctx, CmdSpec, Reply, Source, Vals, args::OptDef};
use crate::{
    error::{AppError, Result},
    handlers::servers::{require_outranks, require_permission},
    middleware::auth::Claims,
    models::role::Permissions,
    state::AppState,
};

/// (nom, description, type, obligatoire)
pub struct NOpt(&'static str, &'static str, &'static str, bool);

pub struct NativeDef {
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub required: &'static str,
    pub dangerous: bool,
    pub options: &'static [NOpt],
}

impl NativeDef {
    pub fn spec(&self) -> CmdSpec {
        CmdSpec {
            name: self.name.into(),
            description: self.description.into(),
            category: self.category.into(),
            required: self.required.into(),
            dangerous: self.dangerous,
            options: self.options.iter().map(|o| OptDef {
                name: o.0.into(), description: o.1.into(), kind: o.2.into(), required: o.3, choices: vec![],
            }).collect(),
            source: Source::Native,
        }
    }
}

/// Commandes déjà gérées par le composeur des clients : un bot ne peut pas les prendre.
pub const RESERVED_CLIENT: &[&str] = &["me", "shrug", "tableflip", "unflip", "lenny", "clap", "spoiler", "giphy"];

const MOD: &str = "moderation";
const UTIL: &str = "utility";
const FUN: &str = "fun";
const USER: NOpt = NOpt("user", "Le membre (@mention ou pseudo)", "user", true);
const REASON: NOpt = NOpt("reason", "Motif", "string", false);
const EDIT_CH: &str = "EDIT_CHANNELS|MANAGE_CHANNELS";

pub static NATIVES: &[NativeDef] = &[
    NativeDef { name: "kick", description: "Expulse un membre du serveur", category: MOD, required: "KICK_MEMBERS", dangerous: true, options: &[USER, REASON] },
    NativeDef { name: "ban", description: "Bannit définitivement un membre", category: MOD, required: "BAN_MEMBERS", dangerous: true, options: &[USER, REASON] },
    NativeDef { name: "tempban", description: "Bannit un membre pour un nombre d'heures", category: MOD, required: "BAN_MEMBERS|BAN_TEMP", dangerous: true,
        options: &[USER, NOpt("hours", "Durée en heures (1 à 8760)", "integer", true), REASON] },
    NativeDef { name: "unban", description: "Lève le bannissement d'un membre", category: MOD, required: "BAN_MEMBERS|BAN_TEMP", dangerous: true,
        options: &[NOpt("user", "Pseudo, #identifiant ou id du membre banni", "string", true)] },
    NativeDef { name: "timeout", description: "Réduit un membre au silence pour une durée", category: MOD, required: "MANAGE_MESSAGES", dangerous: false,
        options: &[USER, NOpt("minutes", "Durée en minutes (1 à 10080)", "integer", true), REASON] },
    NativeDef { name: "untimeout", description: "Lève le silence d'un membre", category: MOD, required: "MANAGE_MESSAGES", dangerous: false, options: &[USER] },
    NativeDef { name: "purge", description: "Supprime les N derniers messages du salon (hors épinglés)", category: MOD, required: "MANAGE_MESSAGES", dangerous: true,
        options: &[NOpt("count", "Nombre de messages (1 à 100)", "integer", true), NOpt("user", "Ne supprimer que ceux de ce membre", "user", false)] },
    NativeDef { name: "slowmode", description: "Règle le mode lent du salon (0 = désactivé)", category: MOD, required: EDIT_CH, dangerous: false,
        options: &[NOpt("seconds", "Délai en secondes (0 à 21600)", "integer", true)] },
    NativeDef { name: "lock", description: "Verrouille le salon : plus personne n'écrit", category: MOD, required: EDIT_CH, dangerous: false, options: &[] },
    NativeDef { name: "unlock", description: "Déverrouille le salon", category: MOD, required: EDIT_CH, dangerous: false, options: &[] },
    NativeDef { name: "roleadd", description: "Donne un rôle à un membre", category: MOD, required: "MANAGE_ROLES", dangerous: true,
        options: &[USER, NOpt("role", "Le rôle (nom ou @rôle)", "role", true)] },
    NativeDef { name: "roleremove", description: "Retire un rôle à un membre", category: MOD, required: "MANAGE_ROLES", dangerous: true,
        options: &[USER, NOpt("role", "Le rôle (nom ou @rôle)", "role", true)] },
    NativeDef { name: "warn", description: "Avertit un membre (consigné)", category: MOD, required: "MANAGE_MESSAGES", dangerous: false,
        options: &[USER, NOpt("reason", "Motif", "string", true)] },
    NativeDef { name: "warnings", description: "Liste les avertissements d'un membre", category: MOD, required: "MANAGE_MESSAGES", dangerous: false, options: &[USER] },
    NativeDef { name: "nick", description: "Change le pseudo d'un membre (vide = retirer)", category: MOD, required: "MANAGE_NICKNAMES", dangerous: false,
        options: &[USER, NOpt("nickname", "Nouveau pseudo", "string", false)] },
    NativeDef { name: "help", description: "Liste les commandes que tu peux utiliser", category: UTIL, required: "everyone", dangerous: false,
        options: &[NOpt("topic", "Une commande ou une catégorie", "string", false)] },
    NativeDef { name: "ping", description: "Vérifie que le serveur répond", category: UTIL, required: "everyone", dangerous: false, options: &[] },
    NativeDef { name: "serverinfo", description: "Informations sur le serveur", category: UTIL, required: "everyone", dangerous: false, options: &[] },
    NativeDef { name: "userinfo", description: "Informations sur un membre", category: UTIL, required: "everyone", dangerous: false,
        options: &[NOpt("user", "Le membre (toi par défaut)", "user", false)] },
    NativeDef { name: "avatar", description: "Affiche l'avatar d'un membre", category: UTIL, required: "everyone", dangerous: false,
        options: &[NOpt("user", "Le membre (toi par défaut)", "user", false)] },
    NativeDef { name: "poll", description: "Sondage rapide : question | option 1 | option 2 …", category: UTIL, required: "everyone", dangerous: false,
        options: &[NOpt("poll", "question | option 1 | option 2 …", "string", true)] },
    NativeDef { name: "roll", description: "Lance des dés (ex. 2d6+3, par défaut 1d20)", category: FUN, required: "everyone", dangerous: false,
        options: &[NOpt("dice", "NdM+K, par exemple 2d6+3", "string", false)] },
    NativeDef { name: "coinflip", description: "Pile ou face", category: FUN, required: "everyone", dangerous: false, options: &[] },
    NativeDef { name: "choose", description: "Choisit au hasard : a | b | c", category: FUN, required: "everyone", dangerous: false,
        options: &[NOpt("choices", "a | b | c", "string", true)] },
    NativeDef { name: "8ball", description: "Pose une question à la boule magique", category: FUN, required: "everyone", dangerous: false,
        options: &[NOpt("question", "Ta question", "string", true)] },
    NativeDef { name: "quote", description: "Une citation au hasard", category: FUN, required: "everyone", dangerous: false, options: &[] },
];

pub fn find(name: &str) -> Option<&'static NativeDef> {
    NATIVES.iter().find(|n| n.name == name)
}

fn eph(s: impl Into<String>) -> Result<Reply> {
    Ok(Reply::Ephemeral(s.into()))
}

fn need<T>(v: Option<T>) -> Result<T> {
    v.ok_or_else(|| AppError::BadRequest("Argument manquant.".into()))
}

async fn username(state: &AppState, id: Uuid) -> String {
    let n: Option<String> = sqlx::query_scalar("SELECT username FROM users WHERE id=$1").bind(id).fetch_optional(&state.db).await.ok().flatten();
    defang(&n.unwrap_or_else(|| "?".into()))
}

pub async fn run(state: &AppState, claims: &Claims, ctx: &Ctx<'_>, name: &str, v: &Vals) -> Result<Reply> {
    let (sid, cid) = (ctx.server_id, ctx.channel_id);
    let me = claims.sub;
    let (st, cl) = (State(state.clone()), Extension(claims.clone()));
    match name {
        "kick" => {
            let u = need(v.user("user"))?;
            let _ = crate::handlers::servers::kick_member(st, cl, Path((sid, u))).await?;
            eph(format!("{} a été expulsé.", username(state, u).await))
        }
        "ban" | "tempban" => {
            let u = need(v.user("user"))?;
            let mut body = serde_json::json!({ "reason": v.str("reason").map(|r| r.chars().take(300).collect::<String>()) });
            if name == "tempban" {
                body["duration_hours"] = need(v.int("hours"))?.clamp(1, 24 * 365).into();
            }
            let _ = crate::handlers::servers::ban_member(st, cl, Path((sid, u)), Json(body)).await?;
            eph(format!("{} a été banni.", username(state, u).await))
        }
        "unban" => unban(state, claims, sid, need(v.str("user"))?).await,
        "timeout" => {
            let u = need(v.user("user"))?;
            let minutes = i32::try_from(need(v.int("minutes"))?).unwrap_or(i32::MAX);
            let body = crate::handlers::moderation::CreateTimeout { duration_minutes: minutes, reason: v.str("reason").map(|r| r.chars().take(300).collect()) };
            let _ = crate::handlers::moderation::create_timeout(cl, Path((sid, u)), st, Json(body)).await?;
            eph(format!("{} est réduit au silence pour {minutes} min.", username(state, u).await))
        }
        "untimeout" => {
            let u = need(v.user("user"))?;
            let _ = crate::handlers::moderation::remove_timeout(cl, Path((sid, u)), st).await?;
            eph(format!("Silence levé pour {}.", username(state, u).await))
        }
        "purge" => purge(state, claims, ctx, need(v.int("count"))?, v.user("user")).await,
        "slowmode" => {
            let secs = need(v.int("seconds"))?;
            if !(0..=21600).contains(&secs) {
                return Err(AppError::BadRequest("Le mode lent va de 0 à 21600 secondes.".into()));
            }
            let body = serde_json::from_value(serde_json::json!({ "slowmode_delay": secs })).map_err(|e| AppError::Internal(e.into()))?;
            let _ = crate::handlers::channels::update_channel(st, cl, Path((sid, cid)), Json(body)).await?;
            eph(if secs == 0 { "Mode lent désactivé.".to_string() } else { format!("Mode lent : {secs} s entre deux messages.") })
        }
        "lock" | "unlock" => set_lock(state, claims, sid, cid, name == "lock").await,
        "roleadd" | "roleremove" => {
            let (u, r) = (need(v.user("user"))?, need(v.role("role"))?);
            if name == "roleadd" {
                let _ = crate::handlers::roles::assign_role(st, cl, Path((sid, u, r))).await?;
            } else {
                let _ = crate::handlers::roles::remove_role(st, cl, Path((sid, u, r))).await?;
            }
            let role: String = sqlx::query_scalar("SELECT name FROM roles WHERE id=$1").bind(r).fetch_one(&state.db).await?;
            eph(format!("Rôle « {} » {} {}.", defang(&role), if name == "roleadd" { "donné à" } else { "retiré à" }, username(state, u).await))
        }
        "warn" => warn(state, claims, ctx, need(v.user("user"))?, need(v.str("reason"))?).await,
        "warnings" => warnings(state, claims, sid, need(v.user("user"))?).await,
        "nick" => {
            let u = need(v.user("user"))?;
            let body = crate::handlers::nicknames::NicknameBody { nickname: v.str("nickname").map(String::from) };
            let _ = crate::handlers::nicknames::set_member_nickname(st, cl, Path((sid, u)), Json(body)).await?;
            eph(format!("Pseudo de {} mis à jour.", username(state, u).await))
        }
        "help" => help(state, ctx, v.str("topic")).await,
        "ping" => {
            let t = std::time::Instant::now();
            sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.db).await?;
            eph(format!("Pong ! Base de données : {} ms.", t.elapsed().as_millis()))
        }
        "serverinfo" => serverinfo(state, sid).await,
        "userinfo" => userinfo(state, sid, v.user("user").unwrap_or(me)).await,
        "avatar" => {
            let u = v.user("user").unwrap_or(me);
            let a: Option<String> = sqlx::query_scalar("SELECT avatar FROM users WHERE id=$1").bind(u).fetch_one(&state.db).await?;
            eph(match a { Some(a) => format!("Avatar de {} : {a}", username(state, u).await), None => format!("{} n'a pas d'avatar.", username(state, u).await) })
        }
        "poll" => {
            let mut parts = need(v.str("poll"))?.split('|').map(|p| p.trim().to_string());
            let question = parts.next().unwrap_or_default();
            let options: Vec<String> = parts.filter(|o| !o.is_empty()).collect();
            let body = crate::handlers::polls::CreatePollBody {
                question, options, enc: None, client_msg_id: None, multiple_choice: None, anonymous: None, ends_at: None,
            };
            let _ = crate::handlers::polls::create_poll_with(state.clone(), claims.clone(), sid, cid, body, true).await?;
            Ok(Reply::Done)
        }
        "roll" => {
            let expr = v.str("dice").unwrap_or("1d20");
            let (rolls, modifier, total) = roll_dice(expr, &mut rand::thread_rng())?;
            let list = rolls.iter().map(i64::to_string).collect::<Vec<_>>().join(", ");
            let m = if modifier != 0 { format!(" {} {}", if modifier > 0 { "+" } else { "-" }, modifier.abs()) } else { String::new() };
            Ok(Reply::Public(format!("🎲 {} lance {} : [{list}]{m} = **{total}**", username(state, me).await, defang(expr.trim()))))
        }
        "coinflip" => {
            let side = if rand::thread_rng().gen_bool(0.5) { "Pile" } else { "Face" };
            Ok(Reply::Public(format!("🪙 {} lance une pièce : **{side}**", username(state, me).await)))
        }
        "choose" => {
            let raw = need(v.str("choices"))?;
            let sep = if raw.contains('|') { '|' } else { ',' };
            let items: Vec<&str> = raw.split(sep).map(str::trim).filter(|s| !s.is_empty()).collect();
            if !(2..=20).contains(&items.len()) {
                return Err(AppError::BadRequest("Donne entre 2 et 20 choix séparés par | (ex. /choose pizza | sushi).".into()));
            }
            let pick = items[rand::thread_rng().gen_range(0..items.len())];
            Ok(Reply::Public(format!("🤔 {} hésite entre {} → **{}**", username(state, me).await, defang(&items.join(", ")), defang(pick))))
        }
        "8ball" => {
            const ANSWERS: &[&str] = &["C'est certain.", "Sans aucun doute.", "Oui, définitivement.", "Tu peux compter dessus.", "Très probable.",
                "Les signes disent oui.", "Floue, réessaie.", "Redemande plus tard.", "Mieux vaut ne pas te le dire maintenant.", "Impossible à prédire.",
                "Concentre-toi et redemande.", "N'y compte pas.", "Ma réponse est non.", "Mes sources disent non.", "Peu probable.", "Très douteux."];
            let a = ANSWERS[rand::thread_rng().gen_range(0..ANSWERS.len())];
            Ok(Reply::Public(format!("🎱 {} demande : « {} »\n**{a}**", username(state, me).await, defang(need(v.str("question"))?))))
        }
        "quote" => {
            const QUOTES: &[(&str, &str)] = &[
                ("La simplicité est la sophistication suprême.", "Léonard de Vinci"),
                ("Ce n'est pas parce que les choses sont difficiles que nous n'osons pas, c'est parce que nous n'osons pas qu'elles sont difficiles.", "Sénèque"),
                ("Le secret pour avancer, c'est de commencer.", "Mark Twain"),
                ("Tout ce qui est simple est faux, tout ce qui est compliqué est inutilisable.", "Paul Valéry"),
                ("Il faut toujours viser la lune, car même en cas d'échec, on atterrit dans les étoiles.", "Oscar Wilde"),
                ("L'imagination est plus importante que le savoir.", "Albert Einstein"),
                ("Celui qui déplace la montagne commence par déplacer de petites pierres.", "Confucius"),
                ("On ne voit bien qu'avec le cœur. L'essentiel est invisible pour les yeux.", "Antoine de Saint-Exupéry"),
                ("La seule façon de faire du bon travail est d'aimer ce que vous faites.", "Steve Jobs"),
                ("Rien ne se perd, rien ne se crée, tout se transforme.", "Antoine Lavoisier"),
                ("Le talent travaille, le génie crée.", "Robert Schumann"),
                ("Fais de ta vie un rêve, et d'un rêve, une réalité.", "Antoine de Saint-Exupéry"),
            ];
            let (q, a) = QUOTES[rand::thread_rng().gen_range(0..QUOTES.len())];
            Ok(Reply::Public(format!("💬 « {q} » : {a}")))
        }
        _ => Err(AppError::NotFound("Commande introuvable".into())),
    }
}

/// `NdM`, `NdM+K`, `dM`, `N` (un dé à N faces) : au plus 20 dés de 1000 faces. (jets, modificateur, total)
pub fn roll_dice(expr: &str, rng: &mut impl Rng) -> Result<(Vec<i64>, i64, i64)> {
    let bad = || AppError::BadRequest("Format : NdM ou NdM+K, par exemple 2d6+3 (20 dés et 1000 faces au plus).".into());
    let e: String = expr.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_lowercase();
    let (dice, modifier) = match e.find(['+', '-']) {
        Some(i) => (&e[..i], e[i..].parse::<i64>().map_err(|_| bad())?),
        None => (e.as_str(), 0),
    };
    let (n, m) = match dice.split_once('d') {
        Some((n, m)) => (if n.is_empty() { 1 } else { n.parse::<i64>().map_err(|_| bad())? }, m.parse::<i64>().map_err(|_| bad())?),
        None => (1, dice.parse::<i64>().map_err(|_| bad())?),
    };
    if !(1..=20).contains(&n) || !(2..=1000).contains(&m) || modifier.abs() > 1_000_000 {
        return Err(bad());
    }
    let rolls: Vec<i64> = (0..n).map(|_| rng.gen_range(1..=m)).collect();
    let total = rolls.iter().sum::<i64>() + modifier;
    Ok((rolls, modifier, total))
}

async fn unban(state: &AppState, claims: &Claims, sid: Uuid, token: &str) -> Result<Reply> {
    let target: Option<Uuid> = match super::args::mention_or_name(token.trim()) {
        Ok(id) => Some(id),
        Err(name) => {
            let (uname, disc) = match name.split_once('#') { Some((n, d)) => (n.to_string(), Some(d.to_string())), None => (name, None) };
            sqlx::query_scalar(
                "SELECT b.user_id FROM bans b JOIN users u ON u.id = b.user_id
                 WHERE b.server_id=$1 AND LOWER(u.username)=LOWER($2) AND ($3::text IS NULL OR u.discriminator=$3) LIMIT 1")
                .bind(sid).bind(uname).bind(disc).fetch_optional(&state.db).await?
        }
    };
    let target = target.ok_or_else(|| AppError::NotFound("Aucun membre banni ne correspond.".into()))?;
    let banned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bans WHERE server_id=$1 AND user_id=$2)").bind(sid).bind(target).fetch_one(&state.db).await?;
    if !banned {
        return Err(AppError::NotFound("Ce membre n'est pas banni.".into()));
    }
    let _ = crate::handlers::server_settings::unban_member(State(state.clone()), Extension(claims.clone()), Path((sid, target))).await?;
    eph(format!("{} n'est plus banni.", username(state, target).await))
}

async fn purge(state: &AppState, claims: &Claims, ctx: &Ctx<'_>, count: i64, only_user: Option<Uuid>) -> Result<Reply> {
    if !(1..=100).contains(&count) {
        return Err(AppError::BadRequest("Le nombre de messages va de 1 à 100.".into()));
    }
    crate::handlers::servers::require_permission_and_channel(state, claims.sub, ctx.server_id, ctx.channel_id, Permissions::MANAGE_MESSAGES).await?;
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM messages WHERE channel_id=$1 AND id <> $2 AND NOT pinned AND ($3::uuid IS NULL OR user_id=$3)
         ORDER BY created_at DESC LIMIT $4")
        .bind(ctx.channel_id).bind(ctx.message_id).bind(only_user).bind(count).fetch_all(&state.db).await?;
    if ids.is_empty() {
        return eph("Aucun message à supprimer.");
    }
    let urls: Vec<String> = sqlx::query_scalar("SELECT url FROM attachments WHERE message_id = ANY($1)").bind(&ids).fetch_all(&state.db).await.unwrap_or_default();
    sqlx::query("DELETE FROM messages WHERE id = ANY($1) AND channel_id=$2").bind(&ids).bind(ctx.channel_id).execute(&state.db).await?;
    crate::handlers::uploads::remove_upload_files(state, urls);
    for id in &ids {
        state.broadcast_to_channel_members(ctx.channel_id, serde_json::json!({
            "type": "MESSAGE_DELETE", "message_id": id, "channel_id": ctx.channel_id,
        }).to_string()).await;
    }
    crate::handlers::audit::log_event(state, ctx.server_id, "MESSAGE_PURGE", Some(claims.sub), only_user, None,
        Some(serde_json::json!({ "channel_id": ctx.channel_id, "count": ids.len() }))).await;
    eph(format!("{} message(s) supprimé(s).", ids.len()))
}

/// Verrouillage = refus de SEND_MESSAGES pour @everyone sur ce salon, via la route des surcharges
/// (mêmes droits requis : modifier le salon, rôle sous celui de l'acteur).
async fn set_lock(state: &AppState, claims: &Claims, sid: Uuid, cid: Uuid, lock: bool) -> Result<Reply> {
    use crate::handlers::channels::{delete_channel_permission, put_channel_permission, ChannelPermOverride};
    let everyone: Uuid = sqlx::query_scalar("SELECT id FROM roles WHERE server_id=$1 AND is_everyone").bind(sid).fetch_one(&state.db).await?;
    let (allow, deny): (i64, i64) = sqlx::query_as("SELECT allow, deny FROM channel_permissions WHERE channel_id=$1 AND target_id=$2")
        .bind(cid).bind(everyone).fetch_optional(&state.db).await?.unwrap_or((0, 0));
    let send = Permissions::SEND_MESSAGES;
    let (allow, deny) = if lock { (allow & !send, deny | send) } else { (allow, deny & !send) };
    let (st, cl) = (State(state.clone()), Extension(claims.clone()));
    if allow == 0 && deny == 0 {
        let _ = delete_channel_permission(st, cl, Path((cid, everyone))).await?;
    } else {
        let _ = put_channel_permission(st, cl, Path((cid, everyone)), Json(ChannelPermOverride { target_type: "role".into(), allow, deny })).await?;
    }
    // Un « refuser » posé sur @everyone l'emporte aussi sur les droits de base des autres rôles : sans
    // « autoriser » par rôle, la modération elle-même ne pourrait plus écrire (ni déverrouiller).
    let staff = Permissions::ADMINISTRATOR | Permissions::MANAGE_MESSAGES | Permissions::MANAGE_CHANNELS;
    let roles: Vec<(Uuid, i64)> = sqlx::query_as("SELECT id, permissions FROM roles WHERE server_id=$1 AND NOT is_everyone")
        .bind(sid).fetch_all(&state.db).await?;
    for (rid, perms) in roles.into_iter().filter(|(_, p)| p & staff != 0) {
        let (a, d): (i64, i64) = sqlx::query_as("SELECT allow, deny FROM channel_permissions WHERE channel_id=$1 AND target_id=$2")
            .bind(cid).bind(rid).fetch_optional(&state.db).await?.unwrap_or((0, 0));
        let a = if lock { a | send } else { a & !send };
        let (st, cl) = (State(state.clone()), Extension(claims.clone()));
        if a == 0 && d == 0 {
            let _ = delete_channel_permission(st, cl, Path((cid, rid))).await;
        } else {
            let _ = put_channel_permission(st, cl, Path((cid, rid)), Json(ChannelPermOverride { target_type: "role".into(), allow: a, deny: d })).await;
        }
    }
    eph(if lock { "Salon verrouillé." } else { "Salon déverrouillé." })
}

async fn warn(state: &AppState, claims: &Claims, ctx: &Ctx<'_>, target: Uuid, reason: &str) -> Result<Reply> {
    require_permission(state, claims.sub, ctx.server_id, Permissions::MANAGE_MESSAGES).await?;
    if target == claims.sub {
        return Err(AppError::BadRequest("Tu ne peux pas t'avertir toi-même.".into()));
    }
    require_outranks(state, claims.sub, target, ctx.server_id).await?;
    let reason: String = reason.trim().chars().take(300).collect();
    sqlx::query("INSERT INTO member_warnings (server_id, user_id, moderator_id, reason) VALUES ($1,$2,$3,$4)")
        .bind(ctx.server_id).bind(target).bind(claims.sub).bind(&reason).execute(&state.db).await?;
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM member_warnings WHERE server_id=$1 AND user_id=$2")
        .bind(ctx.server_id).bind(target).fetch_one(&state.db).await?;
    crate::handlers::audit::log_event(state, ctx.server_id, "MEMBER_WARN", Some(claims.sub), Some(target), None,
        Some(serde_json::json!({ "reason": reason }))).await;
    super::send_ephemeral(state, ctx.server_id, ctx.channel_id, target, "warn",
        &format!("⚠️ Avertissement de la modération : {reason}"), None).await;
    eph(format!("Avertissement enregistré pour {} ({total} au total).", username(state, target).await))
}

async fn warnings(state: &AppState, claims: &Claims, sid: Uuid, target: Uuid) -> Result<Reply> {
    require_permission(state, claims.sub, sid, Permissions::MANAGE_MESSAGES).await?;
    let rows: Vec<(chrono::DateTime<chrono::Utc>, String, Option<String>)> = sqlx::query_as(
        "SELECT w.created_at, w.reason, u.username FROM member_warnings w LEFT JOIN users u ON u.id = w.moderator_id
         WHERE w.server_id=$1 AND w.user_id=$2 ORDER BY w.created_at DESC LIMIT 10")
        .bind(sid).bind(target).fetch_all(&state.db).await?;
    let name = username(state, target).await;
    if rows.is_empty() {
        return eph(format!("{name} n'a aucun avertissement."));
    }
    let lines: Vec<String> = rows.iter().map(|(at, reason, by)| format!("• {} par {} : {}", at.format("%d/%m/%Y"), defang(by.as_deref().unwrap_or("?")), defang(reason))).collect();
    eph(format!("Avertissements de {name} (10 derniers) :\n{}", lines.join("\n")))
}

async fn help(state: &AppState, ctx: &Ctx<'_>, topic: Option<&str>) -> Result<Reply> {
    let specs = super::all_specs(state, ctx.server_id).await?;
    let ovs = super::overrides(state, ctx.server_id).await?;
    let usable: Vec<&CmdSpec> = specs.iter().filter(|s| super::is_allowed(ctx.caller, s, ovs.get(&s.name))).collect();
    if let Some(t) = topic.map(|t| t.trim().trim_start_matches('/').to_lowercase()).filter(|t| !t.is_empty()) {
        if let Some(s) = usable.iter().find(|s| s.name == t) {
            let opts: Vec<String> = s.options.iter().map(|o| format!("{}{} ({}) : {}", o.name, if o.required { "" } else { " (facultatif)" }, o.kind, o.description)).collect();
            return eph(format!("{}\n{}\n{}", super::args::usage(&s.name, &s.options), s.description, opts.join("\n")).trim().to_string());
        }
        let in_cat: Vec<String> = usable.iter().filter(|s| s.category == t).map(|s| format!("/{} : {}", s.name, s.description)).collect();
        if in_cat.is_empty() {
            return Err(AppError::NotFound("Aucune commande ou catégorie de ce nom à ta disposition.".into()));
        }
        return eph(in_cat.join("\n"));
    }
    let mut cats: Vec<&str> = usable.iter().map(|s| s.category.as_str()).collect();
    cats.sort_unstable();
    cats.dedup();
    let lines: Vec<String> = cats.iter().map(|c| {
        let names: Vec<String> = usable.iter().filter(|s| s.category == *c).map(|s| format!("/{}", s.name)).collect();
        format!("**{c}** : {}", names.join(" "))
    }).collect();
    eph(format!("Commandes disponibles ({}) :\n{}\n/help <commande ou catégorie> pour le détail.", usable.len(), lines.join("\n")))
}

async fn serverinfo(state: &AppState, sid: Uuid) -> Result<Reply> {
    let (name, members, created, owner): (String, i32, chrono::DateTime<chrono::Utc>, String) = sqlx::query_as(
        "SELECT s.name, s.member_count, s.created_at, u.username FROM servers s JOIN users u ON u.id = s.owner_id WHERE s.id=$1")
        .bind(sid).fetch_one(&state.db).await?;
    let channels: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM channels WHERE server_id=$1").bind(sid).fetch_one(&state.db).await?;
    let roles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM roles WHERE server_id=$1 AND NOT is_everyone").bind(sid).fetch_one(&state.db).await?;
    eph(format!("**{}**\nPropriétaire : {}\nMembres : {members}\nSalons : {channels}\nRôles : {roles}\nCréé le {}",
        defang(&name), defang(&owner), created.format("%d/%m/%Y")))
}

async fn userinfo(state: &AppState, sid: Uuid, target: Uuid) -> Result<Reply> {
    type InfoRow = (String, String, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>, bool);
    let row: Option<InfoRow> = sqlx::query_as(
        "SELECT u.username, u.discriminator, u.created_at, sm.joined_at, u.is_bot FROM users u
         JOIN server_members sm ON sm.user_id = u.id AND sm.server_id=$2 WHERE u.id=$1")
        .bind(target).bind(sid).fetch_optional(&state.db).await?;
    let (name, disc, created, joined, bot) = row.ok_or_else(|| AppError::NotFound("Membre introuvable.".into()))?;
    let roles: Vec<String> = sqlx::query_scalar(
        "SELECT r.name FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.user_id=$1 AND mr.server_id=$2 ORDER BY r.position DESC")
        .bind(target).bind(sid).fetch_all(&state.db).await?;
    eph(format!("**{}#{disc}**{}\nCompte créé le {}\nA rejoint le {}\nRôles : {}",
        defang(&name), if bot { " (bot)" } else { "" }, created.format("%d/%m/%Y"), joined.format("%d/%m/%Y"),
        if roles.is_empty() { "aucun".into() } else { defang(&roles.join(", ")) }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::StdRng, SeedableRng};

    #[test]
    fn registry_is_consistent() {
        let mut seen = std::collections::HashSet::new();
        for n in NATIVES {
            assert!(seen.insert(n.name), "doublon {}", n.name);
            assert!(super::super::args::valid_ident(n.name), "{}", n.name);
            assert!(super::super::valid_requirement(n.required), "{}", n.name);
            assert!(!RESERVED_CLIENT.contains(&n.name), "{} collisionne avec une commande du client", n.name);
            assert!(n.description.chars().count() <= 100);
            // Obligatoires avant facultatives, sinon l'analyse positionnelle est ambiguë.
            let opts = n.spec().options;
            assert!(super::super::args::opts_from_json(&serde_json::Value::Array(opts.iter().map(OptDef::to_json).collect())).is_some(), "{}", n.name);
            // Tout ce qui est destructeur exige une vraie permission, jamais « everyone ».
            if n.dangerous {
                assert_ne!(n.required, "everyone", "{}", n.name);
            }
        }
        for danger in ["kick", "ban", "tempban", "unban", "purge", "roleadd", "roleremove"] {
            let n = find(danger).unwrap();
            assert!(n.dangerous && n.required != "everyone");
        }
    }

    #[test]
    fn dice() {
        let mut rng = StdRng::seed_from_u64(7);
        let (r, m, t) = roll_dice("2d6+3", &mut rng).unwrap();
        assert_eq!((r.len(), m), (2, 3));
        assert_eq!(t, r.iter().sum::<i64>() + 3);
        assert!(r.iter().all(|x| (1..=6).contains(x)));
        assert!(roll_dice(" D20 ", &mut rng).is_ok() && roll_dice("6", &mut rng).is_ok() && roll_dice("1d6-2", &mut rng).is_ok());
        for bad in ["0d6", "21d6", "1d1", "1d1001", "abc", "2d", "1d6+x", "1d6+99999999"] {
            assert!(roll_dice(bad, &mut rng).is_err(), "{bad}");
        }
    }
}
