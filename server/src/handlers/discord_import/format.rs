//! Format `export.json` d'ArchiveForge et conversions pures (sans base ni disque).
//!
//! Désérialisation tolérante : champs absents = valeur par défaut, `null` sur un
//! champ tableau/texte = vide, champs inconnus ignorés (anciens et nouveaux exports).

use std::collections::HashMap;

use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Deserializer};

use crate::models::role::Permissions as P;

/// `null` JSON -> valeur par défaut (serde `default` ne couvre que l'absence).
fn nd<'de, D: Deserializer<'de>, T: Default + Deserialize<'de>>(d: D) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GuildExport {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub icon_file: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub categories: Vec<CategoryData>,
    #[serde(deserialize_with = "nd")]
    pub channels: Vec<ChannelData>,
    #[serde(deserialize_with = "nd")]
    pub roles: Vec<RoleData>,
    pub everyone_permissions: Option<serde_json::Value>,
    #[serde(deserialize_with = "nd")]
    pub emojis: Vec<EmojiData>,
    #[serde(deserialize_with = "nd")]
    pub members: Vec<MemberData>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MemberData {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub username: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CategoryData {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub position: i64,
    pub permission_overwrites: Option<Vec<Overwrite>>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Overwrite {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    /// 0 / "role" = rôle, 1 / "member" = membre (anciens exports : chaîne)
    pub r#type: serde_json::Value,
    pub allow: serde_json::Value,
    pub deny: serde_json::Value,
}

impl Overwrite {
    pub fn is_role(&self) -> bool {
        matches!(&self.r#type, serde_json::Value::Number(n) if n.as_u64() == Some(0))
            || matches!(&self.r#type, serde_json::Value::String(s) if s == "role" || s == "0")
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChannelData {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub r#type: i64,
    pub parent_id: Option<String>,
    pub position: i64,
    pub topic: Option<String>,
    pub nsfw: Option<bool>,
    pub rate_limit_per_user: Option<i64>,
    pub permission_overwrites: Option<Vec<Overwrite>>,
    #[serde(deserialize_with = "nd")]
    pub messages: Vec<MessageData>,
    #[serde(deserialize_with = "nd")]
    pub threads: Vec<ThreadData>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ThreadData {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub archived: Option<bool>,
    pub created_at: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub messages: Vec<MessageData>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MessageData {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub content: String,
    #[serde(deserialize_with = "nd")]
    pub author_id: String,
    #[serde(deserialize_with = "nd")]
    pub author_name: String,
    pub author_avatar: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub timestamp: String,
    pub edited_timestamp: Option<String>,
    pub r#type: Option<i64>,
    pub pinned: Option<bool>,
    #[serde(deserialize_with = "nd")]
    pub attachments: Vec<AttachmentData>,
    #[serde(deserialize_with = "nd")]
    pub embeds: Vec<EmbedData>,
    #[serde(deserialize_with = "nd")]
    pub stickers: Vec<StickerData>,
    pub referenced_message_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AttachmentData {
    #[serde(deserialize_with = "nd")]
    pub filename: String,
    pub local_path: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EmbedData {
    pub title: Option<String>,
    pub description: Option<String>,
    pub url: Option<String>,
    #[serde(deserialize_with = "nd")]
    pub fields: Vec<EmbedField>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct EmbedField {
    #[serde(deserialize_with = "nd")]
    pub name: String,
    #[serde(deserialize_with = "nd")]
    pub value: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct StickerData {
    #[serde(deserialize_with = "nd")]
    pub name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RoleData {
    #[serde(deserialize_with = "nd")]
    pub id: String,
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub color: i64,
    pub permissions: serde_json::Value,
    pub position: i64,
    pub hoist: Option<bool>,
    pub mentionable: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EmojiData {
    #[serde(deserialize_with = "nd")]
    pub name: String,
    pub animated: Option<bool>,
    pub file: Option<String>,
}

// ─── Permissions ────────────────────────────────────────────────────────────

/// Bitfield Discord (chaîne décimale, ou nombre dans de vieux exports).
pub fn parse_bits(v: &serde_json::Value) -> u64 {
    match v {
        serde_json::Value::String(s) => s.trim().parse().unwrap_or(0),
        serde_json::Value::Number(n) => n.as_u64().unwrap_or(0),
        _ => 0,
    }
}

/// Bit Discord -> bit ForgeChat (`models::role::Permissions`, qui ne reprend
/// PAS la numérotation Discord). Les droits sans équivalent sont ignorés.
const DISCORD_TO_FORGECHAT: &[(u32, i64)] = &[
    (1, P::KICK_MEMBERS),
    (2, P::BAN_MEMBERS),
    (3, P::ADMINISTRATOR),
    (4, P::MANAGE_CHANNELS),
    (5, P::MANAGE_SERVER),
    (6, P::ADD_REACTIONS),
    (8, P::PRIORITY_SPEAKER),
    (9, P::STREAM),
    (10, P::VIEW_CHANNEL),
    (11, P::SEND_MESSAGES),
    (13, P::MANAGE_MESSAGES),
    (14, P::EMBED_LINKS),
    (15, P::ATTACH_FILES),
    (16, P::READ_HISTORY),
    (17, P::MENTION_EVERYONE),
    (20, P::CONNECT_VOICE),
    (21, P::SPEAK_VOICE),
    (22, P::MUTE_MEMBERS),
    (23, P::DEAFEN_MEMBERS),
    (24, P::MOVE_MEMBERS),
    (28, P::MANAGE_ROLES),
];

pub fn convert_permissions(discord: u64) -> i64 {
    DISCORD_TO_FORGECHAT
        .iter()
        .filter(|(bit, _)| discord & (1u64 << bit) != 0)
        .fold(0, |acc, (_, fc)| acc | fc)
}

/// Type de canal ForgeChat pour un type Discord ; `None` = pas un canal importable.
pub fn channel_kind(discord_type: i64) -> Option<&'static str> {
    match discord_type {
        0 => Some("text"),
        2 => Some("voice"),
        5 => Some("announcement"),
        13 => Some("stage"),
        15 | 16 => Some("forum"),
        4 | 10 | 11 | 12 => None, // catégorie, fils
        _ => Some("text"),
    }
}

// ─── Messages ───────────────────────────────────────────────────────────────

const DISCORD_EPOCH_MS: i64 = 1_420_070_400_000;

pub fn snowflake(id: &str) -> u64 {
    id.parse().unwrap_or(0)
}

/// Date ISO de l'export, sinon celle encodée dans l'identifiant Discord.
pub fn parse_ts(ts: &str, id: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(ts)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| {
            let ms = (snowflake(id) >> 22) as i64 + DISCORD_EPOCH_MS;
            Utc.timestamp_millis_opt(ms).single().unwrap_or_else(Utc::now)
        })
}

/// Messages d'un salon dans l'ordre chronologique (anciens exports non triés).
pub fn sort_messages(msgs: &mut [MessageData]) {
    msgs.sort_by_cached_key(|m| (parse_ts(&m.timestamp, &m.id), snowflake(&m.id)));
}

/// Messages système Discord (arrivée, épinglage, boost…) : ni contenu ni utilité.
/// 0 normal, 19 réponse, 20/23 réponses de commandes d'application (bots).
pub fn is_system(m: &MessageData) -> bool {
    !matches!(m.r#type.unwrap_or(0), 0 | 19 | 20 | 23) && m.content.trim().is_empty()
}

/// Noms lisibles pour les mentions `<@id>`, `<@&id>`, `<#id>`.
#[derive(Default)]
pub struct Names {
    pub users: HashMap<String, String>,
    pub roles: HashMap<String, String>,
    pub channels: HashMap<String, String>,
}

/// Remplace les mentions Discord par des noms et neutralise @everyone/@here
/// (espace insécable de largeur nulle) : un vieux message ne doit notifier personne.
pub fn rewrite_mentions(text: &str, names: &Names) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let replaced = tail.find('>').and_then(|end| {
            let inner = &tail[1..end];
            let (map, prefix, id) = if let Some(id) = inner.strip_prefix("@&") {
                (&names.roles, "@", id)
            } else if let Some(id) = inner.strip_prefix("@!") {
                (&names.users, "@", id)
            } else if let Some(id) = inner.strip_prefix('@') {
                (&names.users, "@", id)
            } else if let Some(id) = inner.strip_prefix('#') {
                (&names.channels, "#", id)
            } else {
                return None;
            };
            map.get(id).map(|n| (format!("{prefix}{n}"), end + 1))
        });
        match replaced {
            Some((s, len)) => { out.push_str(&s); rest = &tail[len..]; }
            None => { out.push('<'); rest = &tail[1..]; }
        }
    }
    out.push_str(rest);
    out.replace("@everyone", "@\u{200B}everyone").replace("@here", "@\u{200B}here")
}

fn quote(out: &mut Vec<String>, text: &str) {
    for line in text.lines() {
        out.push(format!("> {line}"));
    }
}

/// Contenu final : texte (mentions réécrites), embeds en citation, autocollants,
/// puis `extra` (pièces jointes non archivées, ou liens de médias pour les fils/forums).
pub fn build_content(m: &MessageData, names: &Names, extra: &[String]) -> String {
    let mut lines: Vec<String> = Vec::new();
    let text = rewrite_mentions(m.content.trim(), names);
    if !text.is_empty() {
        lines.push(text);
    }
    for e in &m.embeds {
        let mut q = Vec::new();
        if let Some(t) = e.title.as_deref().filter(|s| !s.trim().is_empty()) {
            quote(&mut q, &format!("**{}**", t.trim()));
        }
        if let Some(d) = e.description.as_deref().filter(|s| !s.trim().is_empty()) {
            quote(&mut q, &rewrite_mentions(d.trim(), names));
        }
        for f in &e.fields {
            quote(&mut q, &format!("**{}** : {}", f.name.trim(), rewrite_mentions(f.value.trim(), names)));
        }
        if let Some(u) = e.url.as_deref().filter(|s| !s.trim().is_empty()) {
            quote(&mut q, u.trim());
        }
        if !q.is_empty() {
            lines.push(q.join("\n"));
        }
    }
    for s in &m.stickers {
        lines.push(format!("[autocollant : {}]", s.name));
    }
    lines.extend(extra.iter().cloned());
    lines.join("\n")
}

// ─── Fichiers du ZIP ────────────────────────────────────────────────────────

/// Chemin de la pièce jointe dans le ZIP. Nouveaux exports : `localPath` relatif
/// (`attachments/<id>_<nom>`). Anciens : chemin absolu du conteneur ArchiveForge,
/// dont seul le nom de fichier sert (`attachments/<nom>`).
pub fn zip_path_for_attachment(local_path: Option<&str>) -> Option<String> {
    let lp = local_path?.trim().replace('\\', "/");
    if lp.is_empty() {
        return None;
    }
    let absolute = lp.starts_with('/') || lp.get(1..2) == Some(":");
    if absolute {
        let name = lp.rsplit('/').next().filter(|n| !n.is_empty())?;
        Some(format!("attachments/{name}"))
    } else {
        Some(lp.trim_start_matches("./").to_string())
    }
}

/// Nom de fichier affichable (jamais utilisé comme chemin disque).
pub fn clean_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if matches!(c, '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .take(200)
        .collect();
    if cleaned.trim().is_empty() { "fichier".into() } else { cleaned }
}

/// Extension retenue sur disque : celles de la liste blanche des uploads, sinon `bin`.
pub fn safe_ext(filename: &str) -> String {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if crate::handlers::uploads::ALLOWED_EXTENSIONS.contains(&ext.as_str()) { ext } else { "bin".into() }
}

pub fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Avatar d'auteur : URL https uniquement, sinon chaîne vide (= pas d'avatar,
/// voir migration 062).
pub fn avatar_or_empty(url: Option<&str>) -> String {
    url.filter(|u| u.starts_with("https://") && u.len() <= 500).unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEW_EXPORT: &str = r#"{
      "version": 2, "id": "100", "name": "Mon serveur", "icon": null, "iconFile": "assets/icon.png",
      "exportedAt": "2026-09-01T00:00:00.000Z",
      "categories": [{ "id": "200", "name": "Général", "position": 0,
        "permissionOverwrites": [{ "id": "100", "type": 0, "allow": "0", "deny": "1024" }] }],
      "channels": [{ "id": "300", "name": "privé", "type": 0, "parentId": "200", "position": 1,
        "topic": null, "nsfw": false, "rateLimitPerUser": 5,
        "permissionOverwrites": [
          { "id": "100", "type": 0, "allow": "0", "deny": "1024" },
          { "id": "400", "type": 0, "allow": "3072", "deny": "0" },
          { "id": "999", "type": 1, "allow": "1024", "deny": "0" }],
        "messages": [
          { "id": "2", "content": "second", "authorId": "9", "authorName": "Bob", "authorAvatar": null,
            "timestamp": "2024-01-02T00:00:00.000Z", "editedTimestamp": null, "type": 19,
            "attachments": [{ "id": "a", "url": "u", "filename": "x.png", "size": 1, "contentType": "image/png",
              "localPath": "attachments/a_x.png", "isAlive": true }],
            "embeds": [], "reactions": [{ "emoji": "👍", "count": 3 }], "referencedMessageId": "1" },
          { "id": "1", "content": "premier", "authorId": "8", "authorName": "Alice", "authorAvatar": null,
            "timestamp": "2024-01-01T00:00:00.000Z", "editedTimestamp": null,
            "attachments": [], "embeds": [], "reactions": [], "referencedMessageId": null }],
        "threads": [{ "id": "1", "name": "fil", "parentId": "300", "archived": true, "createdAt": null, "messages": [] }]
      }],
      "members": [{ "id": "8", "username": "alice", "displayName": "Alice", "avatar": null, "roles": [], "joinedAt": null }],
      "roles": [{ "id": "400", "name": "Modo", "color": 16711680, "permissions": "8", "position": 3, "hoist": true, "mentionable": false }],
      "everyonePermissions": "104324673",
      "emojis": [{ "id": "500", "name": "pepe", "animated": false, "url": "u", "file": "emojis/500.png" }],
      "unknownField": 42
    }"#;

    /// Export d'avant la v2 : ni overwrites, ni everyonePermissions, ni emojis,
    /// ni iconFile, localPath absolu, type de message absent, champs à null.
    const OLD_EXPORT: &str = r#"{
      "id": "100", "name": "Vieux", "icon": "https://cdn.discordapp.com/icons/1/a.png", "exportedAt": "2023-01-01",
      "categories": [{ "id": "200", "name": "Cat", "position": 0 }],
      "channels": [{ "id": "301", "name": "vocal", "type": 2, "parentId": null, "position": 0,
        "topic": null, "nsfw": false, "rateLimitPerUser": 0,
        "messages": [{ "id": "5", "content": "salut", "authorId": "1", "authorName": "Zed", "authorAvatar": null,
          "timestamp": "2023-01-01T10:00:00Z", "editedTimestamp": null,
          "attachments": [{ "id": "7", "url": "u", "filename": "doc.pdf", "size": 1, "contentType": null,
            "localPath": "/app/exports/job1/attachments/7_doc.pdf", "isAlive": false }],
          "embeds": null, "reactions": [], "referencedMessageId": null }],
        "threads": [] }],
      "members": [], "roles": []
    }"#;

    #[test]
    fn parses_new_export() {
        let g: GuildExport = serde_json::from_str(NEW_EXPORT).unwrap();
        assert_eq!(g.name, "Mon serveur");
        assert_eq!(g.icon_file.as_deref(), Some("assets/icon.png"));
        assert_eq!(g.channels[0].rate_limit_per_user, Some(5));
        let ow = g.channels[0].permission_overwrites.as_ref().unwrap();
        assert!(ow[0].is_role() && !ow[2].is_role());
        assert_eq!(parse_bits(&ow[1].allow), 3072);
        assert_eq!(g.emojis[0].file.as_deref(), Some("emojis/500.png"));
        assert_eq!(parse_bits(g.everyone_permissions.as_ref().unwrap()), 104324673);
        assert_eq!(g.channels[0].threads[0].archived, Some(true));
    }

    #[test]
    fn parses_old_export() {
        let g: GuildExport = serde_json::from_str(OLD_EXPORT).unwrap();
        assert!(g.everyone_permissions.is_none() && g.emojis.is_empty() && g.icon_file.is_none());
        assert!(g.categories[0].permission_overwrites.is_none());
        let m = &g.channels[0].messages[0];
        assert!(m.embeds.is_empty() && m.r#type.is_none() && !is_system(m));
        assert_eq!(
            zip_path_for_attachment(m.attachments[0].local_path.as_deref()).as_deref(),
            Some("attachments/7_doc.pdf")
        );
        assert_eq!(channel_kind(g.channels[0].r#type), Some("voice"));
    }

    #[test]
    fn sorts_and_filters_messages() {
        let mut g: GuildExport = serde_json::from_str(NEW_EXPORT).unwrap();
        sort_messages(&mut g.channels[0].messages);
        assert_eq!(g.channels[0].messages[0].id, "1");
        let sys = MessageData { r#type: Some(7), ..Default::default() };
        assert!(is_system(&sys));
        let reply = MessageData { r#type: Some(19), ..Default::default() };
        assert!(!is_system(&reply));
    }

    #[test]
    fn converts_discord_permissions() {
        // VIEW_CHANNEL (10) + SEND_MESSAGES (11)
        assert_eq!(convert_permissions(3072), P::VIEW_CHANNEL | P::SEND_MESSAGES);
        // ADMINISTRATOR (3)
        assert_eq!(convert_permissions(8), P::ADMINISTRATOR);
        // @everyone Discord par défaut : lecture, écriture, historique, réactions, vocal, stream
        let everyone = convert_permissions(104324673);
        for p in [P::VIEW_CHANNEL, P::SEND_MESSAGES, P::READ_HISTORY, P::ADD_REACTIONS,
                  P::CONNECT_VOICE, P::SPEAK_VOICE, P::STREAM, P::ATTACH_FILES, P::EMBED_LINKS] {
            assert!(everyone & p != 0, "bit manquant {p}");
        }
        assert_eq!(everyone & (P::ADMINISTRATOR | P::MANAGE_SERVER | P::BAN_MEMBERS), 0);
        // Droits sans équivalent (CREATE_INSTANT_INVITE=0, USE_VAD=25) ignorés
        assert_eq!(convert_permissions((1 << 0) | (1 << 25)), 0);
        assert_eq!(parse_bits(&serde_json::json!(1024)), 1024);
        assert_eq!(parse_bits(&serde_json::json!("abc")), 0);
    }

    #[test]
    fn builds_content() {
        let names = Names {
            users: [("8".to_string(), "Alice".to_string())].into(),
            roles: [("400".to_string(), "Modo".to_string())].into(),
            channels: [("300".to_string(), "général".to_string())].into(),
        };
        let m = MessageData {
            content: "@everyone <@8> <@!8> <@&400> <#300> <@77> a<b".into(),
            embeds: vec![EmbedData {
                title: Some("Titre".into()),
                description: Some("l1\nl2".into()),
                fields: vec![EmbedField { name: "k".into(), value: "v".into() }],
                ..Default::default()
            }],
            stickers: vec![StickerData { name: "chat".into() }],
            ..Default::default()
        };
        let c = build_content(&m, &names, &["📎 x.pdf (non archivé)".into()]);
        assert_eq!(
            c,
            "@\u{200B}everyone @Alice @Alice @Modo #général <@77> a<b\n> **Titre**\n> l1\n> l2\n> **k** : v\n[autocollant : chat]\n📎 x.pdf (non archivé)"
        );
    }

    #[test]
    fn file_helpers() {
        assert_eq!(zip_path_for_attachment(Some("attachments/1_a.png")).as_deref(), Some("attachments/1_a.png"));
        assert_eq!(zip_path_for_attachment(Some("C:\\x\\attachments\\1_a.png")).as_deref(), Some("attachments/1_a.png"));
        assert_eq!(zip_path_for_attachment(None), None);
        assert_eq!(clean_filename("../../etc/pa:ss"), "pa_ss");
        assert_eq!(safe_ext("a.PNG"), "png");
        assert_eq!(safe_ext("page.html"), "bin");
        assert_eq!(avatar_or_empty(Some("http://x")), "");
        assert_eq!(parse_ts("pas une date", "175928847299117063").timestamp(), 1462015105);
    }
}
