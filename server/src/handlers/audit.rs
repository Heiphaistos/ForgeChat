use axum::{
    extract::{Path, Query, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{error::AppError, middleware::auth::Claims, state::AppState};

// Fonction utilitaire appelée par d'autres handlers pour logger un event
pub async fn log_event(
    state: &AppState,
    server_id: Uuid,
    action: &str,
    user_id: Option<Uuid>,
    username: Option<&str>,
    target_id: Option<Uuid>,
    target_name: Option<&str>,
    details: Option<serde_json::Value>,
) {
    let result = sqlx::query(
        "INSERT INTO audit_log (server_id, action, user_id, username, target_id, target_name, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7)"
    )
    .bind(server_id)
    .bind(action)
    .bind(user_id)
    .bind(username)
    .bind(target_id)
    .bind(target_name)
    .bind(details)
    .execute(&state.db)
    .await;
    // Fire-and-forget pour les appelants (log d'audit, pas critique pour la requête en
    // cours) mais une perte silencieuse ici est un vrai trou de traçabilité — au moins
    // la faire apparaître dans les logs serveur au lieu de disparaître sans trace.
    if let Err(e) = result {
        tracing::error!("Échec écriture audit_log (server={}, action={}): {}", server_id, action, e);
    }
}

// AutoMod
#[derive(Serialize, Deserialize)]
pub struct AutoModConfig {
    pub enabled: bool,
    pub blocked_words: Vec<String>,
    pub max_mentions: i32,
    pub max_links: i32,
    pub anti_spam: bool,
    pub anti_caps: bool,
    /// Domaines refusés par l'appli avant chiffrement (liste intégrée + serveur, 088).
    /// Réglés par PUT …/automod/advanced, jamais par ce PUT (anciennes applis).
    #[serde(default, skip_deserializing)]
    pub dangerous_domains: Vec<String>,
}

pub async fn get_automod(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<AutoModConfig>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    automod_config(&state, server_id).await
}

/// GET /servers/:server_id/automod/rules — règles lues par l'appli de chaque
/// membre, qui les applique AVANT de chiffrer (le serveur ne lit plus le texte).
pub async fn get_automod_rules(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
) -> Result<Json<AutoModConfig>, AppError> {
    crate::handlers::servers::require_member(&state, claims.sub, server_id).await?;
    automod_config(&state, server_id).await
}

async fn automod_config(state: &AppState, server_id: Uuid) -> Result<Json<AutoModConfig>, AppError> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT enabled, word_filter, max_mentions, max_links, anti_spam, anti_caps, block_dangerous_links, blocked_domains
         FROM automod_rules WHERE server_id=$1"
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await?;

    if let Some(r) = row {
        Ok(Json(AutoModConfig {
            enabled: r.get("enabled"),
            blocked_words: r.get::<Vec<String>, _>("word_filter"),
            max_mentions: r.get("max_mentions"),
            max_links: r.get("max_links"),
            anti_spam: r.get("anti_spam"),
            anti_caps: r.get("anti_caps"),
            dangerous_domains: crate::handlers::automod::dangerous_domains(
                r.get("block_dangerous_links"), &r.get::<Vec<String>, _>("blocked_domains"),
            ),
        }))
    } else {
        Ok(Json(AutoModConfig {
            enabled: false,
            blocked_words: vec![],
            max_mentions: 0,
            max_links: 0,
            anti_spam: false,
            anti_caps: false,
            dangerous_domains: Vec::new(),
        }))
    }
}

pub async fn set_automod(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<AutoModConfig>,
) -> Result<Json<serde_json::Value>, AppError> {
    _check_manage(claims.sub, server_id, &state).await?;
    if body.max_mentions < 0 || body.max_mentions > 50 {
        return Err(AppError::BadRequest("max_mentions doit être entre 0 et 50".into()));
    }
    if body.max_links < 0 || body.max_links > 20 {
        return Err(AppError::BadRequest("max_links doit être entre 0 et 20".into()));
    }
    if body.blocked_words.len() > 200 {
        return Err(AppError::BadRequest("Maximum 200 mots bloqués".into()));
    }
    sqlx::query(
        "INSERT INTO automod_rules
             (server_id, enabled, word_filter, max_mentions, max_links, anti_spam, anti_caps, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (server_id) DO UPDATE
         SET enabled=$2, word_filter=$3, max_mentions=$4, max_links=$5,
             anti_spam=$6, anti_caps=$7, updated_at=NOW()"
    )
    .bind(server_id)
    .bind(body.enabled)
    .bind(&body.blocked_words)
    .bind(body.max_mentions)
    .bind(body.max_links)
    .bind(body.anti_spam)
    .bind(body.anti_caps)
    .execute(&state.db)
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Cherche `needle` dans `haystack` comme mot/expression entière (frontières non
/// alphanumériques des deux côtés), pas comme simple sous-chaîne -- sinon bloquer
/// "hell" bloque aussi "hello", "shell", "michelle", etc. (problème de Scunthorpe).
/// Marche aussi pour une expression à espaces ("gros mot"), seuls les bords
/// extérieurs de l'expression doivent être des frontières de mot.
fn contains_word(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let mut search_from = 0usize;
    while let Some(rel) = haystack[search_from..].find(needle) {
        let idx = search_from + rel;
        let end = idx + needle.len();
        let before_ok = haystack[..idx].chars().next_back().is_none_or(|c| !c.is_alphanumeric());
        let after_ok = haystack[end..].chars().next().is_none_or(|c| !c.is_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
        // Avance d'un caractère (pas d'un octet) pour rester sur une frontière UTF-8 valide
        let step = haystack[idx..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
        search_from = idx + step;
        if search_from >= haystack.len() {
            break;
        }
    }
    false
}

/// Message chiffré : seule la règle « mentions max » reste vérifiable par le
/// serveur (mentions en métadonnées) ; les autres sont appliquées par l'appli.
pub async fn check_automod_mentions(state: &AppState, server_id: Uuid, count: usize) -> Option<AppError> {
    let max: i32 = sqlx::query_scalar("SELECT max_mentions FROM automod_rules WHERE server_id=$1 AND enabled")
        .bind(server_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()?;
    (max > 0 && count > max as usize).then(|| AppError::BadRequest(format!("Trop de mentions (max {})", max)))
}

/// Vérifie un contenu de message contre les règles AutoMod du serveur.
/// Retourne Some(AppError) si le message doit être rejeté.
pub async fn check_automod(state: &AppState, server_id: Uuid, user_id: Uuid, content: &str) -> Option<AppError> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT enabled, word_filter, max_mentions, max_links, anti_spam, anti_caps
         FROM automod_rules WHERE server_id=$1"
    )
    .bind(server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;

    if !row.get::<bool, _>("enabled") {
        return None;
    }

    let lower = content.to_lowercase();

    // Filtre de mots
    let blocked: Vec<String> = row.get("word_filter");
    for word in &blocked {
        if !word.is_empty() && contains_word(&lower, word.to_lowercase().as_str()) {
            return Some(AppError::BadRequest("Message bloqué par l'AutoMod (mot interdit)".into()));
        }
    }

    // Limite de mentions
    let max_mentions: i32 = row.get("max_mentions");
    if max_mentions > 0 {
        let mention_count = content.matches('@').count() as i32;
        if mention_count > max_mentions {
            return Some(AppError::BadRequest(
                format!("Trop de mentions (max {})", max_mentions)
            ));
        }
    }

    // Limite de liens
    let max_links: i32 = row.get("max_links");
    if max_links > 0 {
        let link_count = (lower.matches("http://").count() + lower.matches("https://").count()) as i32;
        if link_count > max_links {
            return Some(AppError::BadRequest(
                format!("Trop de liens (max {})", max_links)
            ));
        }
    }

    // Anti-spam : le champ existait en DB/UI depuis la création de cette feature mais
    // n'était jamais vérifié ici -- toggle complètement inerte. Bloque le 3e message
    // identique consécutif d'un même user sur ce serveur en moins de 8s.
    if row.get::<bool, _>("anti_spam") {
        use redis::AsyncCommands;
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        content.hash(&mut hasher);
        let content_hash = hasher.finish();
        let key = format!("automod_spam:{}:{}", server_id, user_id);
        let mut redis = state.redis.lock().await;
        let prev: Option<String> = redis.get(&key).await.unwrap_or(None);
        let prev_count = prev
            .as_deref()
            .and_then(|s| s.split_once(':'))
            .filter(|(h, _)| h.parse::<u64>() == Ok(content_hash))
            .and_then(|(_, c)| c.parse::<u32>().ok());
        let new_count = prev_count.map(|c| c + 1).unwrap_or(1);
        if new_count >= 3 {
            return Some(AppError::BadRequest("Message bloqué par l'AutoMod (spam détecté)".into()));
        }
        let _: () = redis
            .set_ex(&key, format!("{}:{}", content_hash, new_count), 8)
            .await
            .unwrap_or(());
    }

    // Anti-caps : rejet si >70% majuscules et message > 10 chars
    if row.get::<bool, _>("anti_caps") && content.len() > 10 {
        let alpha: Vec<char> = content.chars().filter(|c| c.is_alphabetic()).collect();
        if !alpha.is_empty() {
            let upper = alpha.iter().filter(|c| c.is_uppercase()).count();
            if upper * 10 > alpha.len() * 7 {
                return Some(AppError::BadRequest("Message bloqué par l'AutoMod (trop de majuscules)".into()));
            }
        }
    }

    None
}

// Réactions détaillées (qui a réagi)
#[derive(Deserialize)]
pub struct ReactionQuery {
    pub message_id: Uuid,
    pub emoji: String,
    /// Super réactions (074) : listées à part des réactions normales.
    #[serde(default)]
    pub is_super: bool,
}

#[derive(Serialize)]
pub struct ReactionUser {
    pub user_id: Uuid,
    pub username: String,
    pub avatar: Option<String>,
}

#[derive(Serialize)]
pub struct ReactionDetail {
    pub emoji: String,
    pub count: i64,
    pub users: Vec<ReactionUser>,
}

pub async fn get_reaction_detail(
    State(state): State<AppState>,
    claims: Extension<Claims>,
    Query(q): Query<ReactionQuery>,
) -> Result<Json<ReactionDetail>, AppError> {
    use sqlx::Row;
    // Le popup "qui a réagi" (MessageList.tsx, hover/long-press) est déclenché
    // sur toute réaction, canal serveur OU DM -- mais les réactions DM vivent
    // dans une table séparée `dm_reactions` (pas `reactions`), même pattern
    // d'architecture que attachments/pinned_messages. Vérifier membership
    // serveur d'abord, sinon retomber sur dm_reactions+dm_channels.
    let member_check = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM messages m
            JOIN channels c ON c.id = m.channel_id
            JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $2
            WHERE m.id = $1
        )"
    )
    .bind(q.message_id)
    .bind(claims.sub)
    .fetch_one(&state.db)
    .await?;

    let rows = if member_check {
        sqlx::query(
            "SELECT r.user_id, u.username, u.avatar
             FROM reactions r
             JOIN users u ON u.id=r.user_id
             WHERE r.message_id=$1 AND r.emoji=$2 AND r.is_super=$3
             LIMIT 100"
        )
        .bind(q.message_id)
        .bind(&q.emoji)
        .bind(q.is_super)
        .fetch_all(&state.db)
        .await?
    } else {
        let dm_ok: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                SELECT 1 FROM dm_messages dm
                JOIN dm_channels dc ON dc.id = dm.dm_channel_id
                WHERE dm.id = $1 AND (dc.user1_id = $2 OR dc.user2_id = $2)
             )"
        )
        .bind(q.message_id)
        .bind(claims.sub)
        .fetch_one(&state.db)
        .await?;
        if !dm_ok {
            return Err(AppError::Forbidden);
        }

        sqlx::query(
            "SELECT r.user_id, u.username, u.avatar
             FROM dm_reactions r
             JOIN users u ON u.id=r.user_id
             WHERE r.dm_message_id=$1 AND r.emoji=$2
             LIMIT 100"
        )
        .bind(q.message_id)
        .bind(&q.emoji)
        .fetch_all(&state.db)
        .await?
    };

    let users: Vec<ReactionUser> = rows.iter().map(|r| ReactionUser {
        user_id: r.get("user_id"),
        username: r.get("username"),
        avatar: r.get("avatar"),
    }).collect();
    let count = users.len() as i64;

    Ok(Json(ReactionDetail { emoji: q.emoji, count, users }))
}

// Nickname serveur
#[derive(Deserialize)]
pub struct NicknameBody {
    pub nickname: Option<String>,
}

pub async fn set_nickname(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(server_id): Path<Uuid>,
    Json(body): Json<NicknameBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if let Some(ref nick) = body.nickname {
        if nick.chars().count() > 32 {
            return Err(AppError::BadRequest("Surnom trop long (max 32)".into()));
        }
    }
    sqlx::query("UPDATE server_members SET nickname=$1 WHERE user_id=$2 AND server_id=$3")
        .bind(&body.nickname)
        .bind(claims.sub)
        .bind(server_id)
        .execute(&state.db).await?;

    // Jamais diffusé jusqu'ici -- le surnom se sauvegardait bien en DB mais ni
    // l'auteur du changement (pas d'invalidation locale) ni les autres membres
    // (aucun event WS) ne le voyaient sans recharger la page/renaviguer.
    state.broadcast_to_server_members(server_id, serde_json::json!({
        "type": "MEMBER_NICKNAME_UPDATE",
        "server_id": server_id,
        "user_id": claims.sub,
        "nickname": body.nickname,
    }).to_string()).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

// DM read receipts
pub async fn mark_dm_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Vérifier que l'user appartient au DM et récupérer l'autre participant
    let other_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT CASE WHEN user1_id=$1 THEN user2_id ELSE user1_id END
         FROM dm_channels WHERE id=$2 AND (user1_id=$1 OR user2_id=$1)"
    )
    .bind(claims.sub).bind(dm_id).fetch_optional(&state.db).await?;
    if other_id.is_none() { return Err(AppError::Forbidden); }

    let now = chrono::Utc::now();
    sqlx::query(
        "INSERT INTO dm_read_receipts (dm_id, user_id, last_read_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (dm_id, user_id) DO UPDATE SET last_read_at=NOW()"
    )
    .bind(dm_id).bind(claims.sub).execute(&state.db).await?;
    crate::handlers::reads::broadcast_read_state(&state, claims.sub, serde_json::json!({ "channel_id": dm_id, "server_id": null })).await;

    // Notifier l'autre participant que le DM a été lu
    if let Some(other) = other_id {
        let reader: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT username, avatar FROM users WHERE id=$1"
        ).bind(claims.sub).fetch_optional(&state.db).await.ok().flatten();
        let (username, avatar) = reader.unwrap_or_default();
        let event = serde_json::json!({
            "type": "DM_READ",
            "dm_id": dm_id,
            "user_id": claims.sub,
            "username": username,
            "avatar": avatar,
            "read_at": now,
        });
        state.broadcast_to_user(other, event.to_string()).await;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_dm_read(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(dm_id): Path<Uuid>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    use sqlx::Row;
    let (ok_res, rows) = tokio::join!(
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM dm_channels WHERE id=$1 AND (user1_id=$2 OR user2_id=$2))"
        ).bind(dm_id).bind(claims.sub).fetch_one(&state.db),
        sqlx::query(
            "SELECT user_id, last_read_at FROM dm_read_receipts WHERE dm_id=$1"
        ).bind(dm_id).fetch_all(&state.db),
    );
    if !ok_res.unwrap_or(false) { return Err(AppError::Forbidden); }
    let rows = rows.unwrap_or_default();
    let list: Vec<serde_json::Value> = rows.iter().map(|r| serde_json::json!({
        "user_id": r.get::<Uuid, _>("user_id"),
        "last_read_at": r.get::<DateTime<Utc>, _>("last_read_at"),
    })).collect();
    Ok(Json(list))
}

// OG preview (scraping basique)
#[derive(Deserialize)]
pub struct OgQuery {
    pub url: String,
}

#[derive(Serialize)]
pub struct OgMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
    pub url: String,
}

/// Vérifie qu'une URL n'est pas une adresse privée/locale (protection SSRF)
pub(crate) fn is_ssrf_safe_url(url: &str) -> bool {
    use std::net::IpAddr;

    // Doit commencer par https:// uniquement (pas http:// — pas de redirections non chiffrées)
    if !url.starts_with("https://") {
        return false;
    }

    // Extraire l'hôte
    let without_scheme = &url["https://".len()..];
    let host = without_scheme.split('/').next().unwrap_or("");
    // Retirer le port éventuel
    let host = host.split(':').next().unwrap_or("");

    if host.is_empty() || !crate::net_guard::url_str_target_ok(url) {
        return false;
    }

    // Bloquer les hostnames locaux évidents
    let blocked_hosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0",
        "metadata.google.internal", "169.254.169.254"];
    for bh in &blocked_hosts {
        if host.eq_ignore_ascii_case(bh) {
            return false;
        }
    }

    // Bloquer les domaines .local et .internal
    let lh = host.to_lowercase();
    if lh.ends_with(".local") || lh.ends_with(".internal") || lh.ends_with(".localhost") {
        return false;
    }

    // Bloquer les IPs privées / loopback
    if let Ok(ip) = host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                if v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_unspecified()
                {
                    return false;
                }
            }
            IpAddr::V6(v6) => {
                if v6.is_loopback() || v6.is_unspecified() {
                    return false;
                }
            }
        }
    }

    true
}

pub async fn og_preview(
    State(state): State<AppState>,
    _claims: Extension<Claims>,
    Query(q): Query<OgQuery>,
) -> Result<Json<OgMeta>, AppError> {
    // Validation URL anti-SSRF
    if !is_ssrf_safe_url(&q.url) {
        return Err(AppError::BadRequest("URL invalide ou non autorisée".into()));
    }

    // Domaines autorisés : liste fixe + sites d'actualité relayés par un bot (page Actualités).
    const ALLOWED_DOMAINS: &[&str] = &[
        "github.com", "youtube.com", "youtu.be", "twitter.com", "x.com",
        "reddit.com", "stackoverflow.com", "wikipedia.org", "medium.com",
        "heiphaistos.org", "forgechat.heiphaistos.org",
    ];
    let parsed_url = q.url.parse::<reqwest::Url>()
        .map_err(|_| AppError::BadRequest("URL invalide".into()))?;
    let host = parsed_url.host_str().unwrap_or("").to_ascii_lowercase();
    let listed = ALLOWED_DOMAINS.iter().any(|d| host == *d || host.ends_with(&format!(".{}", d)));
    let news_site = !listed && sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM news_articles WHERE lower(split_part(link, '/', 3)) = $1)",
    ).bind(&host).fetch_one(&state.db).await.unwrap_or(false);
    if !listed && !news_site {
        return Err(AppError::BadRequest("Domaine non autorisé pour l'aperçu".into()));
    }
    let meta = fetch_og(&state, &q.url).await.ok_or_else(|| AppError::NotFound("Aucune métadonnée".into()))?;
    Ok(Json(meta))
}

/// Attributs d'une balise (`name="v"`, `name='v'` ou `name=v`), noms en minuscules.
fn tag_attrs(tag: &str) -> Vec<(String, String)> {
    let b = tag.as_bytes();
    let mut out = Vec::new();
    let mut i = tag.find(char::is_whitespace).unwrap_or(tag.len());
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') { i += 1 }
        let ns = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' { i += 1 }
        let name = tag[ns..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1 }
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1 }
            let (vs, ve);
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                vs = i + 1;
                let mut j = vs;
                while j < b.len() && b[j] != q { j += 1 }
                ve = j;
                i = (j + 1).min(b.len());
            } else {
                vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() { i += 1 }
                ve = i;
            }
            if !name.is_empty() { out.push((name, tag[vs..ve].to_string())) }
        } else if name.is_empty() {
            i += 1;
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&#039;", "'").replace("&apos;", "'")
        .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// Balises <meta> d'une page : property ou name (en minuscules) -> content.
pub(crate) fn meta_tags(html: &str) -> std::collections::HashMap<String, String> {
    let lower = html.to_ascii_lowercase();
    let mut out = std::collections::HashMap::new();
    let mut i = 0;
    while let Some(p) = lower[i..].find("<meta") {
        let start = i + p;
        let Some(e) = lower[start..].find('>') else { break };
        let end = start + e;
        let (mut key, mut content) = (None, None);
        for (k, v) in tag_attrs(&html[start..end]) {
            match k.as_str() {
                "property" | "name" | "itemprop" if key.is_none() => key = Some(v.to_ascii_lowercase()),
                "content" => content = Some(v),
                _ => {}
            }
        }
        if let (Some(k), Some(c)) = (key, content) {
            let c = decode_entities(c.trim());
            if !c.is_empty() { out.entry(k).or_insert(c); }
        }
        i = end;
        if out.len() > 300 { break }
    }
    out
}

/// Métadonnées d'une page (titre, description, image absolue en https), lues en français.
pub(crate) async fn fetch_og(state: &AppState, url: &str) -> Option<OgMeta> {
    if !is_ssrf_safe_url(url) { return None }
    let resp = state.public_http.get(url)
        .header("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.5")
        .timeout(std::time::Duration::from_secs(6))
        .send().await.ok()?;
    let final_url = resp.url().clone();
    if !is_ssrf_safe_url(final_url.as_str()) { return None }
    let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !ct.contains("text/html") && !ct.contains("text/plain") { return None }
    // Limiter la taille de réponse pour éviter un DOS
    const MAX_HTML_SIZE: usize = 1024 * 1024;
    let bytes = resp.bytes().await.ok()?;
    if bytes.len() > MAX_HTML_SIZE { return None }
    let html = String::from_utf8_lossy(&bytes);
    let m = meta_tags(&html);
    let pick = |keys: &[&str]| keys.iter().find_map(|k| m.get(*k).cloned());
    let title = pick(&["og:title", "twitter:title"]).or_else(|| {
        let start = html.find("<title")?;
        let after = &html[start..];
        let s = &after[after.find('>')? + 1..];
        let t = decode_entities(s[..s.find("</title")?].trim());
        (!t.is_empty()).then_some(t)
    });
    let description = pick(&["og:description", "twitter:description", "description"]);
    let image = pick(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"])
        .and_then(|raw| final_url.join(&raw).ok())
        .filter(|u| u.scheme() == "https")
        .map(|u| u.to_string());
    let site_name = pick(&["og:site_name", "application-name"]);
    if title.is_none() && description.is_none() && image.is_none() { return None }
    Some(OgMeta { title, description, image, site_name, url: url.to_string() })
}

#[cfg(test)]
mod og_tests {
    #[test]
    fn meta_parsing_any_style() {
        let html = r#"<head><meta content="Titre &amp; co" property="og:title"><META NAME='description' CONTENT='Résumé'>
            <meta property=og:image content=https://a.fr/i.jpg /><meta name="twitter:image" content="/rel.png"></head>"#;
        let m = super::meta_tags(html);
        assert_eq!(m.get("og:title").map(String::as_str), Some("Titre & co"));
        assert_eq!(m.get("description").map(String::as_str), Some("Résumé"));
        assert_eq!(m.get("og:image").map(String::as_str), Some("https://a.fr/i.jpg"));
        assert_eq!(m.get("twitter:image").map(String::as_str), Some("/rel.png"));
    }
}

async fn _check_manage(user_id: Uuid, server_id: Uuid, state: &AppState) -> Result<(), AppError> {
    use crate::handlers::servers::require_permission;
    use crate::models::role::Permissions;
    // Déléguer à require_permission qui gère owner + ADMINISTRATOR + MANAGE_SERVER
    require_permission(state, user_id, server_id, Permissions::MANAGE_SERVER).await
}

#[cfg(test)]
mod automod_word_filter_tests {
    use super::contains_word;

    #[test]
    fn blocks_the_exact_word() {
        assert!(contains_word("hello hell world", "hell"));
    }

    #[test]
    fn does_not_block_word_as_substring() {
        assert!(!contains_word("hello world", "hell"));
        assert!(!contains_word("this is a shell script", "hell"));
        assert!(!contains_word("michelle said hi", "hell"));
    }

    #[test]
    fn blocks_at_start_and_end_of_string() {
        assert!(contains_word("hell yeah", "hell"));
        assert!(contains_word("go to hell", "hell"));
    }

    #[test]
    fn blocks_multi_word_phrase_respecting_outer_boundaries() {
        assert!(contains_word("that is a gros mot right there", "gros mot"));
        assert!(!contains_word("un grosminet mot passe", "gros mot"));
    }

    #[test]
    fn punctuation_counts_as_a_boundary() {
        assert!(contains_word("hell, really?", "hell"));
        assert!(contains_word("(hell)", "hell"));
    }

    #[test]
    fn handles_multibyte_utf8_without_panicking() {
        assert!(!contains_word("café hello monde", "hell"));
        assert!(contains_word("café hell monde", "hell"));
    }
}
