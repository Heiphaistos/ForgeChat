//! Plusieurs comptes dans le même navigateur (appli web) avec bascule rapide.
//!
//! Le compte actif garde ses cookies HttpOnly `access_token` / `refresh_token`. Les autres
//! comptes gardent chacun leur jeton de rafraîchissement dans un cookie HttpOnly
//! `fc_alt_<id du compte>` (Path=/api/auth, SameSite=Strict) : aucun jeton n'est lisible par
//! le JavaScript de la page, aucun mot de passe n'est retenu. Le bureau et le mobile, qui
//! n'utilisent pas de cookies, gardent ces jetons dans leur propre stockage sécurisé.
use axum::{
    extract::{ConnectInfo, State},
    http::HeaderMap,
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
/// Comptes mis de côté : (id annoncé par le nom du cookie, jeton). Noms préfixés en HTTPS
/// (`__Secure-fc_alt_<id>`, crate::cookies), anciens noms pendant la transition.
pub fn alt_cookies(headers: &HeaderMap, secure: bool) -> Vec<(Uuid, String)> {
    crate::cookies::alt_tokens(headers, secure, Utc::now().timestamp())
        .into_iter()
        .filter_map(|(id, v)| Some((Uuid::parse_str(&id).ok()?, v)))
        .filter(|(_, v)| !v.is_empty() && v.len() <= 128)
        .collect()
}

/// Jeton de rafraîchissement du compte actif (cookie de session).
fn current_refresh(headers: &HeaderMap, secure: bool) -> Option<String> {
    crate::cookies::refresh_token(headers, secure, Utc::now().timestamp())
}

fn set_alt(headers: &mut HeaderMap, user_id: Uuid, token: &str, secure: bool) {
    crate::cookies::alt(headers, &user_id.simple().to_string(), token, secure)
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
    for (id, token) in alt_cookies(&headers, secure) {
        if token_owner(&state, &token).await? != Some(id) {
            // Jeton expiré, révoqué ou ne correspondant pas au nom du cookie : on l'efface.
            set_alt(&mut resp, id, "", secure);
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
    // POST sans corps : pas de pré-vol CORS, l'origine est vérifiée ici.
    if !crate::middleware::auth::same_origin_headers(&headers, &state.config.frontend_url) {
        return Err(AppError::Forbidden);
    }
    rate_limit(&state, &headers, &addr).await?;
    let secure = is_secure(&state);
    let current = current_refresh(&headers, secure).ok_or(AppError::Unauthorized)?;
    let owner = token_owner(&state, &current).await?.ok_or(AppError::Unauthorized)?;
    let others = alt_cookies(&headers, secure).into_iter().filter(|(id, _)| *id != owner).count();
    if others >= MAX_ALT_ACCOUNTS {
        return Err(AppError::BadRequest("Nombre maximal de comptes atteint".into()));
    }
    let mut resp = crate::cookies::clear_session(secure);
    set_alt(&mut resp, owner, &current, secure);
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
    let secure = is_secure(&state);
    let target = alt_cookies(&headers, secure).into_iter().find(|(id, _)| *id == body.user_id).map(|(_, t)| t);
    let target = target.ok_or_else(|| AppError::NotFound("Compte inconnu sur ce navigateur".into()))?;
    // Le nom du cookie n'est qu'une annonce : le jeton doit bien appartenir à ce compte.
    if token_owner(&state, &target).await? != Some(body.user_id) {
        return Err(AppError::Unauthorized);
    }
    let (user_id, refresh, access) = rotate_refresh_token(&state, &target).await?;
    let mut resp = session_cookie_headers(&access, &refresh, secure);
    set_alt(&mut resp, user_id, "", secure);
    // Compte actif encore valide : mis de côté à son tour.
    if let Some(current) = current_refresh(&headers, secure) {
        if let Some(owner) = token_owner(&state, &current).await? {
            if owner != user_id {
                set_alt(&mut resp, owner, &current, secure);
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
    let secure = is_secure(&state);
    if let Some((_, token)) = alt_cookies(&headers, secure).into_iter().find(|(id, _)| *id == body.user_id) {
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
    set_alt(&mut resp, body.user_id, "", secure);
    Ok((resp, Json(serde_json::json!({ "ok": true }))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header::SET_COOKIE, HeaderValue};

    #[test]
    fn alt_cookies_are_parsed_strictly() {
        let id = Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap();
        let mut h = HeaderMap::new();
        h.insert(
            "cookie",
            HeaderValue::from_str(&format!(
                "refresh_token=abc; __Secure-fc_alt_{}=tok1; __Secure-fc_alt_pasunid=tok2; __Secure-fc_alt_{}=",
                id.simple(),
                Uuid::nil().simple()
            ))
            .unwrap(),
        );
        assert_eq!(alt_cookies(&h, true), vec![(id, "tok1".to_string())]);
    }

    #[test]
    fn alt_cookie_is_httponly_and_scoped() {
        let mut h = HeaderMap::new();
        set_alt(&mut h, Uuid::nil(), "tok", true);
        let c = h.get_all(SET_COOKIE).iter().next().unwrap().to_str().unwrap().to_string();
        assert!(c.starts_with("__Secure-fc_alt_00000000000000000000000000000000=tok;"));
        assert!(c.contains("HttpOnly") && c.contains("Secure") && c.contains("SameSite=Strict") && c.contains("Path=/api/auth"));
    }
}
