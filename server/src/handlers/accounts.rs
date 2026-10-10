//! Plusieurs comptes dans le même navigateur (appli web) avec bascule rapide.
//!
//! Le compte actif garde ses cookies HttpOnly `access_token` / `refresh_token`. Les autres
//! comptes gardent chacun leur jeton de rafraîchissement dans un cookie HttpOnly
//! `fc_alt_<id du compte>` (Path=/api/auth, SameSite=Strict) : aucun jeton n'est lisible par
//! le JavaScript de la page, aucun mot de passe n'est retenu. Le bureau et le mobile, qui
//! n'utilisent pas de cookies, gardent ces jetons dans leur propre stockage sécurisé.
use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue, header::SET_COOKIE},
    Json,
};
use chrono::Utc;
use redis::AsyncCommands;
use serde::Deserialize;
use std::net::SocketAddr;
use uuid::Uuid;

use super::auth::{hash_token, is_secure, rotate_refresh_token, session_cookie_headers};
use crate::{
    error::{AppError, Result},
    state::AppState,
};

/// Comptes mis de côté au plus (en plus du compte actif).
pub const MAX_ALT_ACCOUNTS: usize = 4;
const ALT_PREFIX: &str = "fc_alt_";

/// Cookies `nom=valeur` de la requête.
fn cookies(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(';'))
        .filter_map(|p| p.trim().split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

/// Comptes mis de côté : (id annoncé par le nom du cookie, jeton).
pub fn alt_cookies(headers: &HeaderMap) -> Vec<(Uuid, String)> {
    cookies(headers)
        .into_iter()
        .filter_map(|(k, v)| Some((Uuid::parse_str(k.strip_prefix(ALT_PREFIX)?).ok()?, v)))
        .filter(|(_, v)| !v.is_empty() && v.len() <= 128)
        .collect()
}

fn alt_cookie(user_id: Uuid, token: &str, secure: bool) -> String {
    let flag = if secure { "; Secure" } else { "" };
    let max_age = if token.is_empty() { 0 } else { 30 * 86400 };
    format!("{ALT_PREFIX}{}={token}; HttpOnly{flag}; SameSite=Strict; Path=/api/auth; Max-Age={max_age}", user_id.simple())
}

fn push_cookie(headers: &mut HeaderMap, cookie: &str) {
    if let Ok(v) = HeaderValue::from_str(cookie) {
        headers.append(SET_COOKIE, v);
    }
}

/// Compte d'un jeton de rafraîchissement encore valide (sans le consommer).
async fn token_owner(state: &AppState, token: &str) -> Result<Option<Uuid>> {
    Ok(sqlx::query_scalar("SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > $2")
        .bind(hash_token(token))
        .bind(Utc::now())
        .fetch_optional(&state.db)
        .await?)
}

async fn rate_limit(state: &AppState, headers: &HeaderMap, addr: &SocketAddr) -> Result<()> {
    // Adresse du client (derrière nginx, `addr` est celle du proxy : tout le monde partageait un compteur).
    let key = format!("acct_switch:{}", crate::privacy::client_key(headers, addr));
    let mut redis = state.redis.lock().await;
    let count: i64 = redis.incr(&key, 1i64).await.unwrap_or(0);
    if count == 1 {
        let _: () = redis.expire(&key, 60).await.unwrap_or(());
    }
    if count > 30 {
        return Err(AppError::TooManyRequests);
    }
    Ok(())
}

/// GET /api/auth/accounts — comptes mis de côté dans ce navigateur (jetons encore valides).
pub async fn list(State(state): State<AppState>, headers: HeaderMap) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    let mut out = Vec::new();
    let mut resp = HeaderMap::new();
    let secure = is_secure(&state);
    for (id, token) in alt_cookies(&headers) {
        if token_owner(&state, &token).await? != Some(id) {
            // Jeton expiré, révoqué ou ne correspondant pas au nom du cookie : on l'efface.
            push_cookie(&mut resp, &alt_cookie(id, "", secure));
            continue;
        }
        let user = sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT username, discriminator, avatar FROM users WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
        if let Some((username, discriminator, avatar)) = user {
            out.push(serde_json::json!({ "id": id, "username": username, "discriminator": discriminator, "avatar": avatar }));
        }
    }
    Ok((resp, Json(serde_json::json!(out))))
}

/// POST /api/auth/accounts/stash — met le compte actif de côté (pour en ajouter un autre).
pub async fn stash(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    rate_limit(&state, &headers, &addr).await?;
    let current = cookies(&headers).into_iter().find(|(k, _)| k == "refresh_token").map(|(_, v)| v);
    let current = current.ok_or(AppError::Unauthorized)?;
    let owner = token_owner(&state, &current).await?.ok_or(AppError::Unauthorized)?;
    let others = alt_cookies(&headers).into_iter().filter(|(id, _)| *id != owner).count();
    if others >= MAX_ALT_ACCOUNTS {
        return Err(AppError::BadRequest("Nombre maximal de comptes atteint".into()));
    }
    let secure = is_secure(&state);
    let mut resp = HeaderMap::new();
    push_cookie(&mut resp, &alt_cookie(owner, &current, secure));
    push_cookie(&mut resp, "access_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    push_cookie(&mut resp, "refresh_token=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0");
    Ok((resp, Json(serde_json::json!({ "ok": true }))))
}

#[derive(Deserialize)]
pub struct AccountBody {
    pub user_id: Uuid,
}

/// POST /api/auth/accounts/switch — bascule vers un compte mis de côté ; l'actif est mis de côté.
pub async fn switch(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<AccountBody>,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    rate_limit(&state, &headers, &addr).await?;
    let target = alt_cookies(&headers).into_iter().find(|(id, _)| *id == body.user_id).map(|(_, t)| t);
    let target = target.ok_or_else(|| AppError::NotFound("Compte inconnu sur ce navigateur".into()))?;
    // Le nom du cookie n'est qu'une annonce : le jeton doit bien appartenir à ce compte.
    if token_owner(&state, &target).await? != Some(body.user_id) {
        return Err(AppError::Unauthorized);
    }
    let (user_id, refresh, access) = rotate_refresh_token(&state, &target).await?;
    let secure = is_secure(&state);
    let mut resp = session_cookie_headers(&access, &refresh, secure);
    push_cookie(&mut resp, &alt_cookie(user_id, "", secure));
    // Compte actif encore valide : mis de côté à son tour.
    if let Some(current) = cookies(&headers).into_iter().find(|(k, _)| k == "refresh_token").map(|(_, v)| v) {
        if let Some(owner) = token_owner(&state, &current).await? {
            if owner != user_id {
                push_cookie(&mut resp, &alt_cookie(owner, &current, secure));
            }
        }
    }
    Ok((resp, Json(serde_json::json!({ "ok": true, "user_id": user_id }))))
}

/// POST /api/auth/accounts/forget — retire un compte mis de côté et ferme sa session.
pub async fn forget(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AccountBody>,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    if let Some((_, token)) = alt_cookies(&headers).into_iter().find(|(id, _)| *id == body.user_id) {
        let hash = hash_token(&token);
        sqlx::query("DELETE FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2")
            .bind(&hash)
            .bind(body.user_id)
            .execute(&state.db)
            .await?;
        sqlx::query("DELETE FROM user_sessions WHERE refresh_token_hash = $1 AND user_id = $2")
            .bind(&hash)
            .bind(body.user_id)
            .execute(&state.db)
            .await?;
    }
    let mut resp = HeaderMap::new();
    push_cookie(&mut resp, &alt_cookie(body.user_id, "", is_secure(&state)));
    Ok((resp, Json(serde_json::json!({ "ok": true }))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alt_cookies_are_parsed_strictly() {
        let id = Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
        let mut h = HeaderMap::new();
        h.insert(
            "cookie",
            HeaderValue::from_str(&format!(
                "refresh_token=abc; fc_alt_{}=tok1; fc_alt_pasunid=tok2; fc_alt_{}=",
                id.simple(),
                Uuid::nil().simple()
            ))
            .unwrap(),
        );
        assert_eq!(alt_cookies(&h), vec![(id, "tok1".to_string())]);
    }

    #[test]
    fn alt_cookie_is_httponly_and_scoped() {
        let id = Uuid::nil();
        let c = alt_cookie(id, "tok", true);
        assert!(c.starts_with("fc_alt_00000000000000000000000000000000=tok;"));
        assert!(c.contains("HttpOnly") && c.contains("Secure") && c.contains("SameSite=Strict") && c.contains("Path=/api/auth"));
        assert!(alt_cookie(id, "", false).contains("Max-Age=0"));
    }
}
