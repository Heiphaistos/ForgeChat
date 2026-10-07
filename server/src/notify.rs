//! Mentions résolues côté serveur et règle « doit notifier » (P1-7, P2-9, P3-11).
//!
//! Jetons stockés dans le contenu : `<@uuid>` (membre), `<@&uuid>` (rôle),
//! `@everyone`, `@here`. Les anciens clients envoient encore `@pseudo` : ce
//! texte est résolu par correspondance EXACTE du pseudo (plus de `@bob` qui
//! notifie `@bobby`). Les destinataires sont écrits dans `message_mentions`,
//! puis chacun reçoit `MENTION_CREATE` (avec `notify`) s'il est connecté, ou un
//! Web Push s'il ne l'est pas et que ses réglages l'autorisent.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{models::role::Permissions, state::AppState};

#[derive(Default, Debug)]
pub struct ParsedMentions {
    pub users: HashSet<Uuid>,
    pub roles: HashSet<Uuid>,
    /// Pseudos en texte libre (`@pseudo`), en minuscules.
    pub names: HashSet<String>,
    pub everyone: bool,
    pub here: bool,
}

impl ParsedMentions {
    pub fn is_empty(&self) -> bool {
        self.users.is_empty() && self.roles.is_empty() && self.names.is_empty() && !self.everyone && !self.here
    }

    /// Mentions déclarées en métadonnées par l'appli (message chiffré) : le
    /// serveur notifie sans lire le texte. Bornées : 100 membres, 20 rôles.
    pub fn from_meta(m: &crate::models::message::MentionMeta) -> Self {
        ParsedMentions {
            users: m.mentions.iter().flatten().take(100).copied().collect(),
            roles: m.mention_roles.iter().flatten().take(20).copied().collect(),
            names: HashSet::new(),
            everyone: m.mention_everyone.unwrap_or(false),
            here: m.mention_here.unwrap_or(false),
        }
    }

    /// Nombre de mentions (règle AutoMod « mentions max »).
    pub fn count(&self) -> usize {
        self.users.len() + self.roles.len() + self.names.len() + usize::from(self.everyone) + usize::from(self.here)
    }
}

/// Retire les blocs ``` et `code` : une mention citée en code ne notifie pas.
fn strip_code(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(i) = rest.find('`') {
        let delim = if rest[i..].starts_with("```") { "```" } else { "`" };
        out.push_str(&rest[..i]);
        let after = &rest[i + delim.len()..];
        match after.find(delim) {
            Some(j) => {
                out.push(' ');
                rest = &after[j + delim.len()..];
            }
            None => {
                out.push_str(&rest[i..]);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

pub fn parse_mentions(content: &str) -> ParsedMentions {
    let text = strip_code(content);
    let mut p = ParsedMentions::default();
    let mut from = 0;
    while let Some(off) = text[from..].find('@') {
        let at = from + off;
        from = at + 1;
        let before = text[..at].chars().next_back();
        let rest = &text[at + 1..];
        if before == Some('<') {
            let (is_role, id_part) = match rest.strip_prefix('&') {
                Some(r) => (true, r),
                None => (false, rest.strip_prefix('!').unwrap_or(rest)),
            };
            if let Some(id) = id_part.split_once('>').and_then(|(id, _)| id.parse::<Uuid>().ok()) {
                if is_role { p.roles.insert(id); } else { p.users.insert(id); }
            }
            continue;
        }
        // Pas au milieu d'un mot : `nom@domaine.fr` n'est pas une mention.
        if before.is_some_and(is_name_char) { continue; }
        let word: String = rest.chars().take_while(|c| is_name_char(*c)).collect();
        match word.as_str() {
            "" => {}
            "everyone" => p.everyone = true,
            "here" => p.here = true,
            w => { p.names.insert(w.to_lowercase()); }
        }
    }
    p
}

/// Réglages de notification d'un destinataire pour un salon donné.
#[derive(Debug, Default)]
pub struct NotifPrefs {
    pub status: String,
    pub channel_level: Option<String>,
    pub channel_muted: bool,
    pub server_level: Option<String>,
    pub server_muted: bool,
    pub suppress_everyone: bool,
    pub default_level: String,
}

/// `None` : la mention est ignorée (« ignorer @everyone » et seule une mention
/// de masse vise l'utilisateur). `Some(notify)` : la mention est enregistrée ;
/// `notify` dit s'il faut une alerte (son, notification système, push).
/// Priorité : niveau du salon > niveau du serveur > défaut du serveur ;
/// muet (même temporaire, déjà filtré par `muted_until`) et Ne pas déranger
/// coupent l'alerte mais pas le badge, comme Discord.
pub fn decide(p: &NotifPrefs, mass_mention_only: bool) -> Option<bool> {
    if mass_mention_only && p.suppress_everyone {
        return None;
    }
    let level = [p.channel_level.as_deref(), p.server_level.as_deref()]
        .into_iter()
        .flatten()
        .find(|l| *l != "inherit")
        .unwrap_or(p.default_level.as_str());
    Some(!p.channel_muted && !p.server_muted && level != "nothing" && p.status != "dnd")
}

/// Remplace les jetons par des noms lisibles (corps d'une notification push).
fn humanize(content: &str, names: &HashMap<Uuid, String>) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(i) = rest.find("<@") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let id_part = after.trim_start_matches(['&', '!']);
        match id_part.split_once('>').and_then(|(id, tail)| id.parse::<Uuid>().ok().map(|u| (u, tail))) {
            Some((id, tail)) => {
                out.push('@');
                out.push_str(names.get(&id).map(String::as_str).unwrap_or("inconnu"));
                rest = tail;
            }
            None => {
                out.push_str("<@");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

pub struct ChannelMessage<'a> {
    pub server_id: Uuid,
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub author_id: Uuid,
    pub author_username: &'a str,
    pub author_avatar: Option<&'a str>,
    /// Texte en clair ; None pour un message chiffré (jamais lu par le serveur).
    pub content: Option<&'a str>,
    /// Mentions résolues (texte en clair analysé, ou métadonnées d'un message chiffré).
    pub mentions: ParsedMentions,
    /// Contenu chiffré transmis tel quel dans MENTION_CREATE (aperçu déchiffré par l'appli).
    pub enc: Option<&'a serde_json::Value>,
    pub client_msg_id: Option<Uuid>,
    /// Auteur du message cité : une réponse le notifie (comportement Discord).
    pub reply_author: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Résout les mentions d'un message de salon, les enregistre et prévient les
/// destinataires. Appelée AVANT la diffusion de `MESSAGE_CREATE` : le client
/// reçoit `MENTION_CREATE` d'abord et ne double pas la notification.
pub async fn dispatch_channel_mentions(state: &AppState, m: ChannelMessage<'_>) -> anyhow::Result<()> {
    use sqlx::Row;
    let parsed = &m.mentions;
    if parsed.is_empty() && m.reply_author.is_none() {
        return Ok(());
    }

    let perms = state
        .effective_channel_permissions(m.author_id, m.channel_id)
        .await
        .map(|(_, p)| p)
        .unwrap_or(0);
    let can_mass = perms & Permissions::MENTION_EVERYONE != 0;

    let mut names: HashMap<Uuid, String> = HashMap::new();
    let mut direct: HashSet<Uuid> = parsed.users.iter().copied().collect();
    direct.extend(m.reply_author);

    if !parsed.users.is_empty() {
        let ids: Vec<Uuid> = parsed.users.iter().copied().collect();
        for r in sqlx::query("SELECT id, username FROM users WHERE id = ANY($1)")
            .bind(&ids)
            .fetch_all(&state.db)
            .await?
        {
            names.insert(r.get("id"), r.get("username"));
        }
    }
    if !parsed.names.is_empty() {
        let wanted: Vec<String> = parsed.names.iter().cloned().collect();
        let rows = sqlx::query(
            "SELECT u.id FROM users u
             JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = $1
             WHERE LOWER(u.username) = ANY($2)"
        )
        .bind(m.server_id)
        .bind(&wanted)
        .fetch_all(&state.db)
        .await?;
        direct.extend(rows.iter().map(|r| r.get::<Uuid, _>("id")));
    }
    if !parsed.roles.is_empty() {
        let ids: Vec<Uuid> = parsed.roles.iter().copied().collect();
        // Rôle mentionnable, ou auteur autorisé à mentionner tout le monde.
        let roles = sqlx::query(
            "SELECT id, name, (mentionable OR $3) AS allowed FROM roles
             WHERE server_id = $1 AND id = ANY($2) AND NOT is_everyone"
        )
        .bind(m.server_id)
        .bind(&ids)
        .bind(can_mass)
        .fetch_all(&state.db)
        .await?;
        let allowed: Vec<Uuid> = roles.iter().filter(|r| r.get::<bool, _>("allowed")).map(|r| r.get("id")).collect();
        for r in &roles {
            names.insert(r.get("id"), r.get("name"));
        }
        if !allowed.is_empty() {
            let members: Vec<Uuid> = sqlx::query_scalar(
                "SELECT DISTINCT user_id FROM member_roles WHERE server_id = $1 AND role_id = ANY($2)"
            )
            .bind(m.server_id)
            .bind(&allowed)
            .fetch_all(&state.db)
            .await?;
            direct.extend(members);
        }
    }

    let mut broad: HashSet<Uuid> = HashSet::new();
    if can_mass && parsed.everyone {
        broad.extend(
            sqlx::query_scalar::<_, Uuid>("SELECT user_id FROM server_members WHERE server_id = $1")
                .bind(m.server_id)
                .fetch_all(&state.db)
                .await?,
        );
    } else if can_mass && parsed.here {
        // @here : membres connectés et visibles (ni hors ligne ni invisibles).
        let connected: Vec<Uuid> = state.clients.read().await.keys().copied().collect();
        broad.extend(
            sqlx::query_scalar::<_, Uuid>(
                "SELECT sm.user_id FROM server_members sm JOIN users u ON u.id = sm.user_id
                 WHERE sm.server_id = $1 AND sm.user_id = ANY($2) AND u.status NOT IN ('offline', 'invisible')"
            )
            .bind(m.server_id)
            .bind(&connected)
            .fetch_all(&state.db)
            .await?,
        );
    }

    let mut candidates: HashSet<Uuid> = direct.union(&broad).copied().collect();
    candidates.remove(&m.author_id);
    if candidates.is_empty() {
        return Ok(());
    }
    let candidates: Vec<Uuid> = candidates.into_iter().collect();
    // Jamais notifier quelqu'un qui ne voit pas le salon (ou n'est pas membre).
    let visible = state.channel_audience_among(m.channel_id, &candidates).await;
    if visible.is_empty() {
        return Ok(());
    }

    let rows = sqlx::query(
        "SELECT u.id, u.status, co.level AS ch_level,
                COALESCE(co.muted AND (co.muted_until IS NULL OR co.muted_until > NOW()), FALSE) AS ch_muted,
                so.level AS sv_level,
                COALESCE(so.muted AND (so.muted_until IS NULL OR so.muted_until > NOW()), FALSE) AS sv_muted,
                COALESCE(so.suppress_everyone, FALSE) AS suppress_everyone,
                s.default_notification_level
         FROM users u
         JOIN servers s ON s.id = $2
         LEFT JOIN notification_overrides_channel co ON co.user_id = u.id AND co.channel_id = $3
         LEFT JOIN notification_overrides_server so ON so.user_id = u.id AND so.server_id = $2
         WHERE u.id = ANY($1)"
    )
    .bind(&visible)
    .bind(m.server_id)
    .bind(m.channel_id)
    .fetch_all(&state.db)
    .await?;

    let mut kept: Vec<(Uuid, bool)> = Vec::with_capacity(rows.len());
    for r in &rows {
        let uid: Uuid = r.get("id");
        let prefs = NotifPrefs {
            status: r.get("status"),
            channel_level: r.get("ch_level"),
            channel_muted: r.get("ch_muted"),
            server_level: r.get("sv_level"),
            server_muted: r.get("sv_muted"),
            suppress_everyone: r.get("suppress_everyone"),
            default_level: r.get("default_notification_level"),
        };
        if let Some(notify) = decide(&prefs, !direct.contains(&uid)) {
            kept.push((uid, notify));
        }
    }
    if kept.is_empty() {
        return Ok(());
    }

    let ids: Vec<Uuid> = kept.iter().map(|(u, _)| *u).collect();
    sqlx::query(
        "INSERT INTO message_mentions (message_id, user_id, channel_id, created_at)
         SELECT $1, uid, $2, $3 FROM UNNEST($4::uuid[]) AS uid
         ON CONFLICT DO NOTHING"
    )
    .bind(m.message_id)
    .bind(m.channel_id)
    .bind(m.created_at)
    .bind(&ids)
    .execute(&state.db)
    .await?;

    let place = sqlx::query("SELECT c.name AS channel_name, s.name AS server_name FROM channels c JOIN servers s ON s.id = c.server_id WHERE c.id = $1")
        .bind(m.channel_id)
        .fetch_optional(&state.db)
        .await?;
    let (channel_name, server_name) = place
        .map(|r| (r.get::<String, _>("channel_name"), r.get::<String, _>("server_name")))
        .unwrap_or_default();

    let mention = serde_json::json!({
        "message_id": m.message_id,
        "channel_id": m.channel_id,
        "channel_name": channel_name,
        "server_id": m.server_id,
        "server_name": server_name,
        "author_id": m.author_id,
        "author_username": m.author_username,
        "author_avatar": m.author_avatar,
        "content": m.content,
        "enc": m.enc,
        "client_msg_id": m.client_msg_id,
        "created_at": m.created_at,
    });
    let mut offline: Vec<Uuid> = Vec::new();
    {
        let clients = state.clients.read().await;
        for (uid, notify) in &kept {
            match clients.get(uid) {
                Some(tx) => {
                    let ev = serde_json::json!({ "type": "MENTION_CREATE", "notify": notify, "mention": mention });
                    let _ = tx.send(ev.to_string());
                }
                None if *notify => offline.push(*uid),
                None => {}
            }
        }
    }
    // Message chiffré : aucun texte dans les notifications poussées par le serveur.
    let body: String = match m.content {
        Some(c) => humanize(c, &names).chars().take(200).collect(),
        None => "Message chiffré".into(),
    };
    crate::mobile_push::spawn_send(state, offline.clone(), crate::mobile_push::Notice::new(
        format!("{} · #{}", server_name, channel_name),
        &format!("{} : {}", m.author_username, body),
        format!("{} t'a mentionné", m.author_username),
        crate::mobile_push::Target::Channel { server_id: m.server_id, channel_id: m.channel_id },
    ).with_message(m.message_id));
    crate::push::spawn_send_if_offline(state, offline, serde_json::json!({
        "title": format!("{} (#{}, {})", m.author_username, channel_name, server_name),
        "body": body,
        "url": format!("/servers/{}/channels/{}?highlight={}", m.server_id, m.channel_id, m.message_id),
        "tag": m.channel_id,
    }));
    Ok(())
}

/// Web Push et push mobile d'un message privé ou d'un appel : destinataires
/// hors ligne, hors « Ne pas déranger » et n'ayant pas rendu ce DM muet
/// (`dm_user_settings`).
pub fn push_direct(
    state: &AppState,
    recipients: Vec<Uuid>,
    dm_id: Option<Uuid>,
    payload: serde_json::Value,
    mobile: crate::mobile_push::Notice,
) {
    if (state.push.is_none() && state.mobile_push.is_none()) || recipients.is_empty() { return; }
    let state = state.clone();
    tokio::spawn(async move {
        for uid in recipients {
            if state.clients.read().await.contains_key(&uid) { continue; }
            let silenced: bool = sqlx::query_scalar(
                "SELECT u.status = 'dnd' OR COALESCE(ds.muted, FALSE)
                 FROM users u
                 LEFT JOIN dm_user_settings ds ON ds.user_id = u.id AND ds.dm_channel_id = $2
                 WHERE u.id = $1"
            )
            .bind(uid)
            .bind(dm_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(true);
            if !silenced {
                crate::push::send_if_offline(&state, uid, &payload).await;
                crate::mobile_push::send(&state, uid, &mobile).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_message_mentions_come_from_metadata_only() {
        use crate::models::message::MentionMeta;
        let (u, r) = (Uuid::new_v4(), Uuid::new_v4());
        let meta = MentionMeta {
            mentions: Some(vec![u; 3]),
            mention_roles: Some(vec![r]),
            mention_everyone: Some(true),
            mention_here: None,
        };
        let p = ParsedMentions::from_meta(&meta);
        assert_eq!(p.users, HashSet::from([u]));
        assert_eq!(p.roles, HashSet::from([r]));
        assert!(p.everyone && !p.here && p.names.is_empty());
        assert_eq!(p.count(), 3);
        // Bornes : 100 membres au plus.
        let many = MentionMeta { mentions: Some((0..500).map(|_| Uuid::new_v4()).collect()), ..Default::default() };
        assert_eq!(ParsedMentions::from_meta(&many).users.len(), 100);
        assert!(ParsedMentions::from_meta(&MentionMeta::default()).is_empty());
    }

    #[test]
    fn parses_tokens_and_legacy_text() {
        let u = Uuid::new_v4();
        let r = Uuid::new_v4();
        let p = parse_mentions(&format!("salut <@{u}> et <@&{r}> @everyone @Bob, mail a@b.fr `@here` <@!{u}>"));
        assert!(p.users.contains(&u) && p.users.len() == 1);
        assert!(p.roles.contains(&r));
        assert!(p.everyone);
        assert!(!p.here, "une mention dans du code ne compte pas");
        assert!(p.names.contains("bob"));
        assert!(!p.names.contains("b"), "une adresse e-mail n'est pas une mention");
        assert!(parse_mentions("```\n@everyone\n```").is_empty());
        assert!(parse_mentions("<@pas-un-uuid>").is_empty());
        assert!(parse_mentions("@here").here);
    }

    #[test]
    fn decide_follows_priority() {
        let base = NotifPrefs { status: "online".into(), default_level: "all".into(), ..Default::default() };
        assert_eq!(decide(&base, false), Some(true));
        let nothing_srv = NotifPrefs { server_level: Some("nothing".into()), ..base_clone(&base) };
        assert_eq!(decide(&nothing_srv, false), Some(false));
        // Le salon prime sur le serveur
        let ch_all = NotifPrefs { channel_level: Some("mentions".into()), ..nothing_srv };
        assert_eq!(decide(&ch_all, false), Some(true));
        let inherit = NotifPrefs { channel_level: Some("inherit".into()), server_level: Some("inherit".into()), default_level: "nothing".into(), ..base_clone(&base) };
        assert_eq!(decide(&inherit, false), Some(false));
        assert_eq!(decide(&NotifPrefs { channel_muted: true, ..base_clone(&base) }, false), Some(false));
        assert_eq!(decide(&NotifPrefs { server_muted: true, ..base_clone(&base) }, false), Some(false));
        assert_eq!(decide(&NotifPrefs { status: "dnd".into(), ..base_clone(&base) }, false), Some(false));
        let sup = NotifPrefs { suppress_everyone: true, ..base_clone(&base) };
        assert_eq!(decide(&sup, true), None);
        assert_eq!(decide(&sup, false), Some(true));
    }

    fn base_clone(p: &NotifPrefs) -> NotifPrefs {
        NotifPrefs { status: p.status.clone(), default_level: p.default_level.clone(), ..Default::default() }
    }

    #[test]
    fn humanize_replaces_tokens() {
        let u = Uuid::new_v4();
        let names: HashMap<Uuid, String> = [(u, "bob".to_string())].into_iter().collect();
        assert_eq!(humanize(&format!("hé <@{u}> <@&{}> <@x", Uuid::nil()), &names), "hé @bob @inconnu <@x");
    }
}
