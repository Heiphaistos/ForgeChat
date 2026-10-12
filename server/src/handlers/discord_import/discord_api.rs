//! Client minimal de l'API REST Discord (v10) pour la synchronisation, avec un
//! jeton de bot. Respecte les limites de débit : 429 -> attente `retry_after`,
//! seau épuisé (`X-RateLimit-Remaining: 0`) -> attente `X-RateLimit-Reset-After`.

use std::time::Duration;

use reqwest::{header::HeaderMap, StatusCode};
use serde::{de::DeserializeOwned, Deserialize};

use super::format::{EmbedData, StickerData};
use super::UserError;

const API: &str = "https://discord.com/api/v10";
const MAX_ATTEMPTS: u32 = 6;
/// Attente maximale acceptée sur un 429 ; au-delà, la synchronisation est reportée.
const MAX_WAIT_SECS: f64 = 120.0;

fn user_err(msg: impl Into<String>) -> anyhow::Error {
    anyhow::Error::new(UserError(msg.into()))
}

/// Erreur d'accès à une ressource précise (salon illisible pour le bot, etc.).
#[derive(Debug)]
pub enum ApiError {
    /// 403 / 404 : ressource ignorée, la synchronisation continue.
    NoAccess,
    Fatal(anyhow::Error),
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::Fatal(e)
    }
}

pub struct Discord {
    http: reqwest::Client,
    auth: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DGuild {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
pub struct DOverwrite {
    pub id: String,
    /// 0 rôle, 1 membre
    pub r#type: i64,
    pub allow: String,
    pub deny: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DChannel {
    pub id: String,
    pub r#type: i64,
    pub name: Option<String>,
    pub parent_id: Option<String>,
    pub position: i64,
    pub topic: Option<String>,
    pub nsfw: Option<bool>,
    pub rate_limit_per_user: Option<i64>,
    pub permission_overwrites: Vec<DOverwrite>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DRole {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DEmoji {
    pub id: Option<String>,
    pub name: Option<String>,
    pub animated: Option<bool>,
    pub available: Option<bool>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
pub struct DUser {
    pub id: String,
    pub username: String,
    pub global_name: Option<String>,
    pub avatar: Option<String>,
}

impl DUser {
    pub fn display(&self) -> String {
        self.global_name.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| self.username.clone())
    }

    pub fn avatar_url(&self) -> Option<String> {
        let h = self.avatar.as_deref()?;
        let ok = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
        (ok(h) && ok(&self.id)).then(|| format!("https://cdn.discordapp.com/avatars/{}/{}.png", self.id, h))
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DAttachment {
    pub filename: String,
    pub url: String,
    pub size: u64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DReference {
    pub message_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct DMessage {
    pub id: String,
    pub r#type: i64,
    pub content: String,
    pub author: DUser,
    pub timestamp: String,
    pub edited_timestamp: Option<String>,
    pub pinned: bool,
    pub attachments: Vec<DAttachment>,
    pub embeds: Vec<EmbedData>,
    pub sticker_items: Vec<StickerData>,
    pub message_reference: Option<DReference>,
    pub mentions: Vec<DUser>,
}

fn header_f64(h: &HeaderMap, name: &str) -> Option<f64> {
    h.get(name)?.to_str().ok()?.trim().parse().ok()
}

impl Discord {
    pub fn new(token: &str) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .user_agent(format!("DiscordBot (https://forgechat.app, {}) ForgeChat-sync", crate::state::APP_VERSION))
            .build()?;
        Ok(Self { http, auth: format!("Bot {token}") })
    }

    /// GET JSON avec reprises (429, 5xx, coupures réseau).
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, ApiError> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let res = self.http.get(format!("{API}{path}")).header("Authorization", &self.auth).send().await;
            let resp = match res {
                Ok(r) => r,
                Err(e) if attempt < MAX_ATTEMPTS => {
                    tracing::debug!("Synchro Discord : {path} : {e}");
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                    continue;
                }
                Err(_) => return Err(user_err("Discord ne répond pas : synchronisation reportée.").into()),
            };
            let status = resp.status();
            let headers = resp.headers().clone();
            match status {
                s if s.is_success() => {
                    // Seau épuisé : on attend sa remise à zéro avant la requête suivante.
                    if headers.get("x-ratelimit-remaining").and_then(|v| v.to_str().ok()) == Some("0") {
                        let wait = header_f64(&headers, "x-ratelimit-reset-after").unwrap_or(1.0).clamp(0.0, MAX_WAIT_SECS);
                        tokio::time::sleep(Duration::from_secs_f64(wait)).await;
                    }
                    return resp
                        .json::<T>()
                        .await
                        .map_err(|e| ApiError::Fatal(anyhow::anyhow!("réponse Discord illisible ({path}) : {e}")));
                }
                StatusCode::TOO_MANY_REQUESTS => {
                    #[derive(Deserialize, Default)]
                    #[serde(default)]
                    struct Limited {
                        retry_after: f64,
                    }
                    let body: Limited = resp.json().await.unwrap_or_default();
                    let wait = if body.retry_after > 0.0 { body.retry_after } else { header_f64(&headers, "retry-after").unwrap_or(5.0) };
                    if wait > MAX_WAIT_SECS || attempt >= MAX_ATTEMPTS {
                        return Err(user_err("Limite de requêtes Discord atteinte : synchronisation reportée.").into());
                    }
                    tracing::info!("Synchro Discord : limite de débit, attente de {wait:.1} s");
                    tokio::time::sleep(Duration::from_secs_f64(wait + 0.25)).await;
                }
                StatusCode::UNAUTHORIZED => {
                    return Err(user_err("Jeton du bot Discord refusé (révoqué ou régénéré) : saisissez-en un nouveau.").into());
                }
                StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => return Err(ApiError::NoAccess),
                s if s.is_server_error() && attempt < MAX_ATTEMPTS => {
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                }
                s => return Err(ApiError::Fatal(anyhow::anyhow!("Discord a répondu HTTP {} sur {path}", s.as_u16()))),
            }
        }
    }

    /// Comme `get`, mais un accès refusé est une erreur pour l'utilisateur.
    pub async fn get_required<T: DeserializeOwned>(&self, path: &str, denied: &str) -> anyhow::Result<T> {
        match self.get(path).await {
            Ok(v) => Ok(v),
            Err(ApiError::NoAccess) => Err(user_err(denied)),
            Err(ApiError::Fatal(e)) => Err(e),
        }
    }

    pub async fn guild(&self, guild_id: &str) -> anyhow::Result<DGuild> {
        self.get_required(
            &format!("/guilds/{guild_id}"),
            "Le bot n'a pas accès à ce serveur Discord : invitez-le sur le serveur, puis vérifiez l'identifiant.",
        )
        .await
    }

    pub async fn channels(&self, guild_id: &str) -> anyhow::Result<Vec<DChannel>> {
        self.get_required(&format!("/guilds/{guild_id}/channels"), "Le bot ne peut pas lister les salons du serveur Discord.").await
    }

    pub async fn roles(&self, guild_id: &str) -> anyhow::Result<Vec<DRole>> {
        self.get_required(&format!("/guilds/{guild_id}/roles"), "Le bot ne peut pas lister les rôles du serveur Discord.").await
    }

    pub async fn emojis(&self, guild_id: &str) -> Result<Vec<DEmoji>, ApiError> {
        self.get(&format!("/guilds/{guild_id}/emojis")).await
    }

    /// Jusqu'à 100 messages postés après `after` (ordre de Discord : du plus récent au plus ancien).
    pub async fn messages_after(&self, channel_id: &str, after: u64) -> Result<Vec<DMessage>, ApiError> {
        self.get(&format!("/channels/{channel_id}/messages?after={after}&limit={}", super::sync_rules::PAGE)).await
    }

    /// Téléchargement d'un fichier du CDN Discord (pièce jointe, émoji), plafonné à `max` octets.
    /// `None` : hôte non autorisé, fichier trop gros ou introuvable.
    pub async fn download(&self, url: &str, max: u64) -> Option<Vec<u8>> {
        let parsed = reqwest::Url::parse(url).ok()?;
        let host_ok = matches!(parsed.host_str(), Some("cdn.discordapp.com" | "media.discordapp.net"));
        if parsed.scheme() != "https" || !host_ok {
            return None;
        }
        let mut resp = self.http.get(parsed).send().await.ok()?;
        if !resp.status().is_success() || resp.content_length().is_some_and(|l| l > max) {
            return None;
        }
        let mut buf = Vec::new();
        while let Some(chunk) = resp.chunk().await.ok()? {
            if (buf.len() + chunk.len()) as u64 > max {
                return None;
            }
            buf.extend_from_slice(&chunk);
        }
        Some(buf)
    }
}
