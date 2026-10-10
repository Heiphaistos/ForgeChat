use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, HeaderValue, header::SET_COOKIE},
    Json,
};
use bcrypt::verify;
use chrono::Utc;
use rand::Rng;
use redis::AsyncCommands;
use std::net::SocketAddr;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    handlers::auth_v2::{self, account_key, check_auth, check_salt, email_norm, hash_auth, hit, NO_PASSWORD, UPGRADE_MSG},
    middleware::auth::create_token,
    models::user::{AuthResponse, LoginRequest, PendingRegistration, RegisterRequest},
    state::AppState,
};

/// Fournisseurs d'e-mail acceptés à l'inscription (choix de Momo, 2026-10-09) : de vraies boîtes,
/// pas d'adresses jetables ni de mail.ru. FORGECHAT_EMAIL_DOMAINS remplace la liste
/// (domaines séparés par des virgules ; « * » accepte tout, pour les serveurs de test).
const EMAIL_DOMAINS: &[&str] = &[
    "gmail.com", "googlemail.com",
    "outlook.fr", "outlook.com", "hotmail.fr", "hotmail.com", "live.fr", "live.com", "msn.com",
    "proton.me", "protonmail.com", "pm.me",
    "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "neuf.fr", "bbox.fr",
];

fn email_domain_allowed(email: &str) -> bool {
    let domain = email.rsplit_once('@').map(|(_, d)| d).unwrap_or("");
    match std::env::var("FORGECHAT_EMAIL_DOMAINS") {
        Ok(v) if v.trim() == "*" => true,
        Ok(v) => v.split(',').any(|d| d.trim().eq_ignore_ascii_case(domain)),
        Err(_) => EMAIL_DOMAINS.contains(&domain),
    }
}

#[cfg(test)]
mod email_domain_tests {
    #[test]
    fn real_providers_only() {
        if std::env::var("FORGECHAT_EMAIL_DOMAINS").is_ok() { return }
        for ok in ["a@gmail.com", "loan.89@live.fr", "x@proton.me", "y@orange.fr", "z@bbox.fr", "w@outlook.fr"] {
            assert!(super::email_domain_allowed(ok), "{ok}");
        }
        for ko in ["stvor@ro.ru", "beata@mail.ru", "a@yopmail.com", "t@test.local", "x@gmail.com.ru", "x@evilgmail.com"] {
            assert!(!super::email_domain_allowed(ko), "{ko}");
        }
    }
}

/// Construit les headers Set-Cookie pour access_token et refresh_token.
/// Les tokens sont aussi retournés dans le corps JSON pour la compatibilité Tauri.
fn auth_cookie_headers(auth: &AuthResponse, secure: bool) -> HeaderMap {
    session_cookie_headers(&auth.access_token, &auth.refresh_token, secure)
}

/// `X-ForgeChat-Tokens: cookie` : l'appli (web) ne veut ses jetons qu'en cookies HttpOnly ; le
/// corps JSON ne les contient pas. Sans l'en-tête (bureau, mobile) : jetons aussi dans le corps.
pub(crate) fn cookie_only(headers: &HeaderMap) -> bool {
    headers
        .get("x-forgechat-tokens")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("cookie"))
}

/// Cookies de session posés, puis jetons retirés du corps si l'appli ne veut que les cookies.
fn auth_reply(req_headers: &HeaderMap, mut auth: AuthResponse, secure: bool) -> (HeaderMap, Json<AuthResponse>) {
    let headers = auth_cookie_headers(&auth, secure);
    if cookie_only(req_headers) {
        auth.access_token.clear();
        auth.refresh_token.clear();
    }
    (headers, Json(auth))
}

/// Cookies HttpOnly de session (accès + rafraîchissement).
pub(crate) fn session_cookie_headers(access_token: &str, refresh_token: &str, secure: bool) -> HeaderMap {
    let flag = if secure { "; Secure" } else { "" };
    let access = format!("access_token={}; HttpOnly{}; SameSite=Strict; Path=/; Max-Age=86400", access_token, flag);
    let refresh = format!(
        "refresh_token={}; HttpOnly{}; SameSite=Strict; Path=/api/auth; Max-Age={}",
        refresh_token, flag, 30 * 86400
    );
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&access) {
        headers.insert(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&refresh) {
        headers.append(SET_COOKIE, v);
    }
    headers
}

pub(crate) fn is_secure(state: &AppState) -> bool {
    state.config.frontend_url.starts_with("https")
}

/// Durée de validité du code de vérification d'e-mail.
const PENDING_TTL_MIN: i64 = 15;

fn mail_html(title: &str, body: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html><body style="font-family:sans-serif;background:#1e1f22;color:#dbdee1;padding:32px">
<div style="max-width:480px;margin:auto;background:#313338;border-radius:12px;padding:32px">
  <h2 style="color:#5865f2;margin-top:0">{title}</h2>{body}</div></body></html>"#
    )
}

fn send_in_background(state: &AppState, to: String, subject: &'static str, html: String) {
    let config = state.config.clone();
    tokio::spawn(async move {
        if let Err(e) = crate::email::send_email(&config, &to, subject, html).await {
            tracing::warn!("envoi e-mail d'inscription échoué : {}", crate::privacy::redact_emails(&e.to_string()));
        }
    });
}

/// POST /api/auth/register {username, email, auth, kdf_salt, invite_code?} → {pending: true}
/// Aucun compte n'est créé ici : un code est envoyé à l'adresse, le compte naît à verify_email.
/// Réponse identique si l'adresse a déjà un compte (son propriétaire reçoit alors un avertissement).
pub async fn register(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>> {
    hit(&state, &format!("register_attempts:{}", crate::privacy::client_key(&headers, &addr)), 5, 900).await?;
    let (Some(auth), Some(kdf_salt)) = (body.auth.as_deref(), body.kdf_salt.as_deref()) else {
        if body.password.is_some() {
            return Err(AppError::UpgradeRequired("Mets à jour ForgeChat pour créer un compte".into()));
        }
        return Err(AppError::BadRequest("auth et kdf_salt requis".into()));
    };
    if body.username.len() < 2 || body.username.len() > 32 {
        return Err(AppError::BadRequest("Nom d'utilisateur 2-32 chars".into()));
    }
    if !body.username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::BadRequest("Nom : lettres, chiffres, _ ou - uniquement".into()));
    }
    check_auth(auth)?;
    check_salt(kdf_salt)?;

    let email_lower = email_norm(&body.email);
    if email_lower.len() > 254 || !email_lower.contains('@') || !email_lower.contains('.') {
        return Err(AppError::BadRequest("Email invalide".into()));
    }
    if !email_domain_allowed(&email_lower) {
        return Err(AppError::BadRequest(
            "Adresse refusée : inscris-toi avec une vraie boîte mail (Gmail, Outlook/Hotmail/Live, Proton, Orange, Free, SFR ou Bouygues)".into(),
        ));
    }
    hit(&state, &account_key("register_acct", &email_lower), 3, 3600).await?;

    // Cercle privé : inscription sur invitation. Tant qu'aucun compte n'existe, la première
    // inscription est libre et donne les droits d'administrateur du site.
    let first_user: bool = sqlx::query_scalar(crate::handlers::site_admin::NO_REAL_USERS_SQL).fetch_one(&state.db).await?;
    let mode = if first_user { "open".to_string() } else { crate::handlers::site_admin::registration_mode(&state).await };
    let invite_code = body.invite_code.as_deref().map(str::trim).filter(|c| !c.is_empty());
    match mode.as_str() {
        "closed" => return Err(AppError::ForbiddenMsg("Les inscriptions sont fermées".into())),
        "invite" => {
            let Some(code) = invite_code else {
                return Err(AppError::ForbiddenMsg("Un code d'invitation est nécessaire pour créer un compte".into()));
            };
            // Code vérifié tout de suite, consommé seulement à la création du compte (transaction annulée).
            let mut probe = state.db.begin().await?;
            crate::handlers::site_admin::consume_invite(&mut probe, code).await?;
            probe.rollback().await?;
        }
        _ => {}
    }

    // Haché avant de savoir si l'adresse existe : même durée dans les deux cas.
    let auth_hash = hash_auth(auth)?;
    let ok = Json(serde_json::json!({ "pending": true }));

    let email_hmac = crate::email_crypto::hmac(&email_lower);
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email_hmac=$1)")
        .bind(&email_hmac)
        .fetch_one(&state.db)
        .await?;
    if exists {
        let html = mail_html(
            "Tentative d'inscription avec ton adresse",
            "<p>Quelqu'un a essayé de créer un compte ForgeChat avec cette adresse, qui a déjà un compte. \
             Aucun compte n'a été créé.</p><p style=\"color:#949ba4;font-size:13px\">Si c'était toi, connecte-toi \
             ou utilise « Mot de passe oublié ». Sinon, tu peux ignorer cet e-mail.</p>",
        );
        send_in_background(&state, email_lower, "Tentative d'inscription — ForgeChat", html);
        return Ok(ok);
    }

    let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000));
    let discriminator = format!("{:04}", rand::thread_rng().gen_range(1..=9999));
    sqlx::query(
        "INSERT INTO pending_registrations (email_hmac, username, password_hash, discriminator, code, expires_at, auth_hash, kdf_salt, invite_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (email_hmac) DO UPDATE SET username=EXCLUDED.username, discriminator=EXCLUDED.discriminator,
            code=EXCLUDED.code, expires_at=EXCLUDED.expires_at, auth_hash=EXCLUDED.auth_hash,
            kdf_salt=EXCLUDED.kdf_salt, invite_code=EXCLUDED.invite_code, created_at=NOW()",
    )
    .bind(&email_hmac)
    .bind(&body.username)
    .bind(NO_PASSWORD)
    .bind(&discriminator)
    .bind(&code)
    .bind(Utc::now() + chrono::Duration::minutes(PENDING_TTL_MIN))
    .bind(&auth_hash)
    .bind(kdf_salt)
    .bind(invite_code)
    .execute(&state.db)
    .await?;
    let html = mail_html(
        "Confirme ton adresse",
        &format!(
            "<p>Ton code de vérification ForgeChat :</p><p style=\"font-size:32px;letter-spacing:6px;text-align:center;color:#fff\">{code}</p>\
             <p style=\"color:#949ba4;font-size:13px\">Il expire dans {PENDING_TTL_MIN} minutes. Si tu n'es pas à l'origine de cette inscription, ignore cet e-mail.</p>"
        ),
    );
    send_in_background(&state, email_lower, "Ton code de vérification — ForgeChat", html);
    Ok(ok)
}

/// POST /api/auth/verify-email {email, code} : crée le compte (et consomme l'invitation).
pub async fn verify_email(
    State(state): State<AppState>,
    req_headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<AuthResponse>)> {
    let email = body["email"]
        .as_str()
        .map(email_norm)
        .ok_or_else(|| AppError::BadRequest("email requis".into()))?;
    let code = body["code"]
        .as_str()
        .map(str::trim)
        .ok_or_else(|| AppError::BadRequest("code requis".into()))?;
    hit(&state, &account_key("verify_attempts", &email), 5, 900).await?;

    let bad = || AppError::BadRequest("Code incorrect ou expiré".into());
    let pending = sqlx::query_as::<_, PendingRegistration>("SELECT * FROM pending_registrations WHERE email_hmac=$1")
        .bind(crate::email_crypto::hmac(&email))
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(bad)?;
    if pending.expires_at < Utc::now() || pending.auth_hash.is_empty() {
        return Err(bad());
    }
    if !constant_time_eq(pending.code.as_bytes(), code.as_bytes()) {
        return Err(bad());
    }

    let mut tx = state.db.begin().await?;
    // Usage unique, même en course : seul celui qui supprime la ligne crée le compte.
    let taken = sqlx::query("DELETE FROM pending_registrations WHERE id=$1")
        .bind(pending.id)
        .execute(&mut *tx)
        .await?;
    if taken.rows_affected() != 1 {
        return Err(bad());
    }
    let first_user: bool = sqlx::query_scalar(crate::handlers::site_admin::NO_REAL_USERS_SQL).fetch_one(&mut *tx).await?;
    let mode = if first_user { "open".to_string() } else { crate::handlers::site_admin::registration_mode(&state).await };
    let invite = match mode.as_str() {
        "closed" => return Err(AppError::ForbiddenMsg("Les inscriptions sont fermées".into())),
        "invite" => {
            let code = pending.invite_code.as_deref()
                .ok_or_else(|| AppError::ForbiddenMsg("Un code d'invitation est nécessaire pour créer un compte".into()))?;
            Some(crate::handlers::site_admin::consume_invite(&mut tx, code).await?)
        }
        _ => None,
    };
    // Adresse prouvée par le code : seulement son empreinte et sa version chiffrée sont gardées.
    let user_id = Uuid::new_v4();
    let user = sqlx::query_as::<_, crate::models::user::User>(
        "INSERT INTO users (id, username, discriminator, email_hmac, email_enc, password_hash, auth_hash, kdf_salt, is_verified, invited_by, registration_invite_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10) RETURNING *",
    )
    .bind(user_id)
    .bind(&pending.username)
    .bind(&pending.discriminator)
    .bind(crate::email_crypto::hmac(&email))
    .bind(crate::email_crypto::seal(user_id, &email))
    .bind(NO_PASSWORD)
    .bind(&pending.auth_hash)
    .bind(&pending.kdf_salt)
    .bind(invite.and_then(|(_, by)| by))
    .bind(invite.map(|(id, _)| id))
    .fetch_one(&mut *tx)
    .await?;
    if let Some((invite_id, _)) = invite {
        sqlx::query("INSERT INTO registration_invite_uses (invite_id, user_id) VALUES ($1, $2)")
            .bind(invite_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
    }
    // Propriétaire du site : lié une fois pour toutes au premier compte qui prouve l'adresse du
    // propriétaire, puis à son UUID seulement (un compte recréé avec l'adresse n'hérite de rien).
    if email == crate::handlers::site_admin::admin_email() {
        sqlx::query("INSERT INTO site_settings (key, value) VALUES ('owner_user_id', $1) ON CONFLICT (key) DO NOTHING")
            .bind(user.id.to_string())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    let access_token = create_token(user.id, None, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(AppError::Internal)?;
    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    let auth = AuthResponse { access_token, refresh_token, user: user.into_self_public() };
    Ok(auth_reply(&req_headers, auth, is_secure(&state)))
}

/// Vérifie la preuve de connexion selon l'état du compte (voir LoginRequest). `Ok(None)` = refus.
pub(crate) fn login_credentials(
    body: &LoginRequest,
    user_opt: Option<crate::models::user::User>,
) -> Result<Option<crate::models::user::User>> {
    // Hash constant pour égaliser le timing même quand l'email n'existe pas
    const DUMMY_HASH: &str = "$2b$12$KIkwRMJIlEHNBFdnfwDnSOkypZs5yWjn7KDSnT5hHUH2EPT3HCVNS";
    let Some(user) = user_opt else {
        let _ = verify(body.auth.as_deref().or(body.password.as_deref()).unwrap_or(""), DUMMY_HASH);
        return Ok(None);
    };
    if user.auth_hash.is_some() && body.password.is_some() {
        // Ancienne appli sur un compte migré : le champ n'est ni vérifié ni journalisé.
        return Err(AppError::UpgradeRequired(UPGRADE_MSG.into()));
    }
    let ok = auth_v2::check_proof(&user.password_hash, user.auth_hash.as_deref(), body.auth.as_deref(), body.password.as_deref())
        == auth_v2::ProofCheck::Ok;
    Ok(ok.then_some(user))
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<AuthResponse>)> {
    let email = email_norm(&body.email);
    // Par IP (toutes les tentatives) et par compte (réussites décomptées : l'attaquant ne réussit
    // jamais sur le compte visé). Plus de remise à zéro par IP après une connexion réussie.
    hit(&state, &format!("login_attempts:{}", crate::privacy::client_key(&headers, &addr)), 20, 900).await?;
    let acct_key = account_key("login_acct", &email);
    hit(&state, &acct_key, 10, 900).await?;
    // Migration annoncée : format vérifié avant toute écriture.
    let migration = match (body.auth_new.as_deref(), body.kdf_salt_new.as_deref()) {
        (Some(a), Some(s)) => {
            check_auth(a)?;
            check_salt(s)?;
            Some((a, s))
        }
        _ => None,
    };

    let user_opt = sqlx::query_as::<_, crate::models::user::User>("SELECT * FROM users WHERE email_hmac=$1")
        .bind(crate::email_crypto::hmac(&email))
        .fetch_optional(&state.db)
        .await?;
    let user = login_credentials(&body, user_opt)?.ok_or(AppError::Unauthorized)?;

    // Compte banni du site : le mot de passe est bon, l'accès est refusé avec le motif.
    let (banned_at, ban_reason): (Option<chrono::DateTime<Utc>>, Option<String>) =
        sqlx::query_as("SELECT site_banned_at, site_ban_reason FROM users WHERE id=$1")
            .bind(user.id)
            .fetch_one(&state.db)
            .await?;
    if banned_at.is_some() {
        return Err(AppError::ForbiddenMsg(match ban_reason {
            Some(r) => format!("Ce compte a été suspendu : {r}"),
            None => "Ce compte a été suspendu".into(),
        }));
    }

    // Double authentification : anti-rejeu, codes de secours, 5 échecs / 15 min par compte.
    if user.totp_enabled {
        let Some(code) = body.totp_code.as_deref() else { return Err(AppError::TotpRequired) };
        if !crate::handlers::totp::check_code(&state, user.id, code).await? {
            return Err(AppError::Unauthorized);
        }
    }

    if user.auth_hash.is_none() {
        if let Some((auth_new, salt_new)) = migration {
            auth_v2::migrate_account(&state.db, user.id, auth_new, salt_new).await?;
        }
    }
    {
        let mut redis = state.redis.lock().await;
        let _: () = redis.decr(&acct_key, 1).await.unwrap_or(());
    }

    // Le statut en direct est posé par la connexion WebSocket (presence.rs) :
    // l'écrire ici à « online » rendait visible un utilisateur invisible.

    let refresh_token = generate_refresh_token();
    store_refresh_token(&state, user.id, &refresh_token).await?;

    // Session : même hachage que refresh_tokens.token_hash, pour que revoke_session la retrouve.
    let sid: Option<Uuid> = {
        let token_hash = hash_token(&refresh_token);
        // Étiquette d'appareil seulement, ni user-agent brut ni IP.
        let device = headers.get("user-agent")
            .and_then(|v| v.to_str().ok())
            .map(|ua| crate::privacy::device_label(ua, false));
        sqlx::query_scalar(
            "INSERT INTO user_sessions (user_id, refresh_token_hash, device_info) VALUES ($1, $2, $3) RETURNING id"
        )
        .bind(user.id)
        .bind(&token_hash)
        .bind(&device)
        .fetch_one(&state.db)
        .await
        .ok()
    };
    let access_token = create_token(user.id, sid, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(AppError::Internal)?;

    let auth = AuthResponse { access_token, refresh_token, user: user.into_self_public() };
    Ok(auth_reply(&headers, auth, is_secure(&state)))
}

pub async fn refresh(
    State(state): State<AppState>,
    req_headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    // Accepter le refresh_token depuis le cookie OU le corps JSON (compatibilité Tauri)
    let token = req_headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| {
            s.split(';').find_map(|p| {
                p.trim().strip_prefix("refresh_token=").map(|t| t.to_string())
            })
        })
        .or_else(|| body["refresh_token"].as_str().map(|s| s.to_string()))
        .ok_or_else(|| AppError::BadRequest("refresh_token requis".into()))?;

    let (_, new_refresh_token, access_token) = rotate_refresh_token(&state, &token).await?;
    let resp_headers = session_cookie_headers(&access_token, &new_refresh_token, is_secure(&state));
    if cookie_only(&req_headers) {
        return Ok((resp_headers, Json(serde_json::json!({ "ok": true }))));
    }
    Ok((resp_headers, Json(serde_json::json!({
        "access_token": access_token,
        "refresh_token": new_refresh_token,
    }))))
}

/// Rotation RTR d'un jeton de rafraîchissement : l'ancien est consommé, un nouveau et un
/// jeton d'accès sont émis. Renvoie (compte, nouveau jeton de rafraîchissement, jeton d'accès).
/// Un jeton de rafraîchissement déjà consommé reste accepté ce nombre de secondes : deux fenêtres
/// de l'appli qui se rafraîchissent en même temps, ou une réponse perdue (réseau coupé, appli
/// fermée au mauvais moment), ne doivent pas déconnecter l'utilisateur. Chacun repart avec son
/// propre nouveau jeton : aucun secret n'est conservé, seulement « ce jeton vient de tourner ».
const REFRESH_GRACE_SECS: u64 = 60;

pub(crate) async fn rotate_refresh_token(state: &AppState, token: &str) -> Result<(Uuid, String, String)> {
    let token_hash = hash_token(token);
    let grace_key = format!("rtgrace:{token_hash}");
    // RTR atomique : DELETE RETURNING garantit qu'un seul thread invalide le token
    let row = sqlx::query_as::<_, (Uuid, chrono::DateTime<Utc>)>(
        "DELETE FROM refresh_tokens WHERE token_hash=$1 RETURNING user_id, expires_at",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await?;

    let user_id = match row {
        Some((user_id, expires_at)) => {
            if expires_at < Utc::now() {
                return Err(AppError::Unauthorized);
            }
            user_id
        }
        None => {
            // Jeton déjà tourné il y a moins d'une minute ?
            let recent: Option<String> = {
                let mut redis = state.redis.lock().await;
                redis.get(&grace_key).await.unwrap_or(None)
            };
            let user_id = recent.and_then(|v| v.parse::<Uuid>().ok()).ok_or(AppError::Unauthorized)?;
            // Déconnexion, bannissement ou « déconnecter partout » entre-temps : plus aucun jeton, plus de tolérance.
            let still_signed_in: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM refresh_tokens WHERE user_id=$1)")
                .bind(user_id)
                .fetch_one(&state.db)
                .await?;
            if !still_signed_in {
                return Err(AppError::Unauthorized);
            }
            user_id
        }
    };
    if crate::handlers::site_admin::is_banned(state, user_id).await {
        return Err(AppError::Unauthorized);
    }
    {
        let mut redis = state.redis.lock().await;
        let _: () = redis.set_ex(&grace_key, user_id.to_string(), REFRESH_GRACE_SECS).await.unwrap_or(());
    }

    let new_refresh_token = generate_refresh_token();
    store_refresh_token(state, user_id, &new_refresh_token).await?;

    // Garder user_sessions synchronisé avec la rotation RTR (sinon refresh_token_hash
    // devient obsolète dès ce premier refresh, et revoke_session ne retrouve plus
    // jamais la bonne ligne refresh_tokens à invalider). Met aussi last_seen à jour.
    let new_hash = hash_token(&new_refresh_token);
    let sid: Option<Uuid> = sqlx::query_scalar(
        "UPDATE user_sessions SET refresh_token_hash=$1, last_seen=NOW() WHERE refresh_token_hash=$2 AND user_id=$3 RETURNING id"
    )
    .bind(&new_hash)
    .bind(&token_hash)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let access_token = create_token(user_id, sid, &state.config.jwt_secret, &state.config.jwt_issuer)
        .map_err(AppError::Internal)?;
    Ok((user_id, new_refresh_token, access_token))
}

/// POST /auth/change-password {old_auth, new_auth, new_kdf_salt, wrapped?}
/// (`old_password` au lieu de `old_auth` seulement pour un compte pas encore migré).
/// Atomique : nouvelle preuve, nouveau sel et clé E2E ré-enveloppée (v2) ensemble ; toutes les
/// sessions sont révoquées.
pub async fn change_password(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::Extension(raw_token): axum::Extension<crate::middleware::auth::RawToken>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>> {
    let (Some(new_auth), Some(new_salt)) = (body["new_auth"].as_str(), body["new_kdf_salt"].as_str()) else {
        if body.get("new_password").is_some() {
            return Err(AppError::UpgradeRequired(UPGRADE_MSG.into()));
        }
        return Err(AppError::BadRequest("new_auth et new_kdf_salt requis".into()));
    };
    check_auth(new_auth)?;
    check_salt(new_salt)?;
    // Clé E2E ré-enveloppée par l'appli avec la nouvelle clé : enregistrée dans la même
    // transaction, sinon elle resterait scellée par l'ancienne.
    let wrapped = match body.get("wrapped") {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => {
            let w: crate::handlers::user_keys::Wrapped = serde_json::from_value(v.clone())
                .map_err(|_| AppError::BadRequest("wrapped invalide".into()))?;
            w.validate()?;
            Some(serde_json::to_value(&w).map_err(|e| AppError::Internal(e.into()))?)
        }
    };
    auth_v2::verify_proof(&state, claims.sub, body["old_auth"].as_str(), body["old_password"].as_str()).await?;
    let new_hash = hash_auth(new_auth)?;

    // Blocklister le token actuel pour sa durée de vie restante
    let remaining_secs = (claims.exp - Utc::now().timestamp()).max(0) as u64;
    if remaining_secs > 0 {
        let access_hash = crate::middleware::auth::hash_token(&raw_token.0);
        let blocklist_key = format!("jwtblock:{}", access_hash);
        let mut redis = state.redis.lock().await;
        let _: () = redis.set_ex(&blocklist_key, "1", remaining_secs).await.unwrap_or(());
        drop(redis);
    }

    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM refresh_tokens WHERE user_id=$1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM user_sessions WHERE user_id=$1")
        .bind(claims.sub)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET auth_hash=$2, kdf_salt=$3, password_hash=$4, updated_at=NOW() WHERE id=$1")
        .bind(claims.sub)
        .bind(&new_hash)
        .bind(new_salt)
        .bind(NO_PASSWORD)
        .execute(&mut *tx)
        .await?;
    if let Some(w) = wrapped {
        sqlx::query("UPDATE user_keys SET wrapped=$2 WHERE user_id=$1")
            .bind(claims.sub)
            .bind(w)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    // Tous les appareils sont déconnectés, pas seulement celui-ci : c'est le but
    // d'un changement de mot de passe après un vol de session.
    crate::middleware::auth::revoke_all_tokens(&state, claims.sub).await;
    state.disconnect_user_sockets(claims.sub).await;

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn ws_ticket(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<Json<serde_json::Value>> {
    use redis::AsyncCommands;
    let ticket: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    let key = format!("ws_ticket:{}", ticket);
    // La session suit la socket : déconnecter ou révoquer cette session ferme ses sockets seulement.
    let user_id_str = match claims.sid {
        Some(sid) => format!("{}:{sid}", claims.sub),
        None => claims.sub.to_string(),
    };
    let mut redis = state.redis.lock().await;
    redis.set_ex::<_, _, ()>(&key, &user_id_str, 30)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Redis error: {e}")))?;
    Ok(Json(serde_json::json!({ "ticket": ticket })))
}

pub async fn logout(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
    axum::Extension(raw_token): axum::Extension<crate::middleware::auth::RawToken>,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<serde_json::Value>)> {
    // Blocklist l'access token courant pour sa durée de vie restante
    let remaining_secs = (claims.exp - Utc::now().timestamp()).max(0) as u64;
    if remaining_secs > 0 {
        let access_hash = crate::middleware::auth::hash_token(&raw_token.0);
        let blocklist_key = format!("jwtblock:{}", access_hash);
        let mut redis = state.redis.lock().await;
        let _: () = redis.set_ex(&blocklist_key, "1", remaining_secs).await.unwrap_or(());
    }

    // `scope: "current"` (appli mobile) : seulement la session de cet appareil. Sinon (défaut
    // historique, appli web) : toutes les sessions du compte.
    match (body["scope"].as_str(), claims.sid) {
        (Some("current"), Some(sid)) => end_session(&state, claims.sub, sid).await?,
        _ => {
            sqlx::query("DELETE FROM refresh_tokens WHERE user_id=$1")
                .bind(claims.sub)
                .execute(&state.db)
                .await?;
            // Plus aucun jeton de rafraîchissement : les lignes de session ne désignent plus rien.
            sqlx::query("DELETE FROM user_sessions WHERE user_id=$1")
                .bind(claims.sub)
                .execute(&state.db)
                .await?;
            sqlx::query("UPDATE users SET status='offline', updated_at=NOW() WHERE id=$1")
                .bind(claims.sub)
                .execute(&state.db)
                .await?;
            // Jetons d'accès des autres appareils et leurs sockets : coupés tout de suite.
            crate::middleware::auth::revoke_all_tokens(&state, claims.sub).await;
            state.disconnect_user_sockets(claims.sub).await;
        }
    }

    // Effacer les cookies côté client
    let clear = "access_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
    let clear_refresh = "refresh_token=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0";
    let mut resp_headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(clear) {
        resp_headers.insert(SET_COOKIE, v);
    }
    if let Ok(v) = HeaderValue::from_str(clear_refresh) {
        resp_headers.append(SET_COOKIE, v);
    }

    Ok((resp_headers, Json(serde_json::json!({ "ok": true }))))
}

fn generate_refresh_token() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub(crate) fn hash_token(token: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::STANDARD.encode(digest)
}

pub async fn list_sessions(
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<axum::Json<serde_json::Value>> {
    let sessions = sqlx::query(
        "SELECT id, device_info, last_seen, created_at FROM user_sessions WHERE user_id = $1 ORDER BY last_seen DESC LIMIT 20",
    )
    .bind(claims.sub)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<serde_json::Value> = sessions.iter().map(|s| {
        use sqlx::Row;
        serde_json::json!({
            "id": s.get::<uuid::Uuid, _>("id").to_string(),
            "current": claims.sid == Some(s.get::<uuid::Uuid, _>("id")),
            "device": s.get::<Option<String>, _>("device_info"),
            "last_seen": s.get::<chrono::DateTime<chrono::Utc>, _>("last_seen").to_rfc3339(),
            "created_at": s.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        })
    }).collect();

    Ok(axum::Json(serde_json::json!(result)))
}

pub async fn revoke_session(
    axum::extract::Path(session_id): axum::extract::Path<Uuid>,
    State(state): State<AppState>,
    axum::Extension(claims): axum::Extension<crate::middleware::auth::Claims>,
) -> Result<axum::http::StatusCode> {
    // Ne supprimait avant QUE la ligne d'affichage user_sessions -- le refresh_token
    // réel de cet appareil restait valide dans `refresh_tokens` (table distincte,
    // jamais consultée ici), donc l'appareil "révoqué" pouvait continuer à rafraîchir
    // indéfiniment son access token (jusqu'à l'expiration naturelle du refresh token,
    // 30 jours). Bouton de sécurité 100% cosmétique. Fix : supprimer aussi la ligne
    // refresh_tokens correspondante avant de retirer l'entrée d'affichage.
    end_session(&state, claims.sub, session_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Termine UNE session du compte : ligne d'affichage, jeton de rafraîchissement, jetons
/// d'accès déjà émis (révocation par `sid` jusqu'à leur expiration) et WebSocket ouvertes.
pub(crate) async fn end_session(state: &AppState, user_id: Uuid, sid: Uuid) -> Result<()> {
    let hash: Option<String> = sqlx::query_scalar(
        "DELETE FROM user_sessions WHERE id = $1 AND user_id = $2 RETURNING refresh_token_hash",
    )
    .bind(sid)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    let Some(hash) = hash else { return Ok(()) };
    sqlx::query("DELETE FROM refresh_tokens WHERE token_hash=$1 AND user_id=$2")
        .bind(&hash)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    crate::middleware::auth::revoke_session_tokens(state, sid).await;
    state.disconnect_session_sockets(user_id, sid).await;
    Ok(())
}

async fn store_refresh_token(state: &AppState, user_id: Uuid, token: &str) -> Result<()> {
    let token_hash = hash_token(token);
    let expires_at = Utc::now() + chrono::Duration::days(30);
    sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod cookie_only_tests {
    use super::*;

    fn reply(header: Option<&str>) -> (HeaderMap, serde_json::Value) {
        let mut req = HeaderMap::new();
        if let Some(h) = header {
            req.insert("x-forgechat-tokens", HeaderValue::from_str(h).unwrap());
        }
        let user: crate::models::user::User = serde_json::from_value(serde_json::json!({
            "id": Uuid::nil(), "username": "u", "discriminator": "0001", "password_hash": "x",
            "avatar": null, "banner": null, "bio": null, "status": "online", "custom_status": null,
            "custom_status_emoji": null, "activity_type": null, "activity_name": null, "activity_detail": null,
            "is_bot": false, "focus_mode": false, "is_verified": true, "birthday": null,
            "created_at": Utc::now(), "updated_at": Utc::now(), "totp_enabled": false, "pronouns": null,
        })).unwrap();
        let auth = AuthResponse { access_token: "acc".into(), refresh_token: "ref".into(), user: user.into_self_public() };
        let (h, Json(body)) = auth_reply(&req, auth, true);
        (h, serde_json::to_value(body).unwrap())
    }

    #[test]
    fn tokens_left_out_of_the_body_for_cookie_apps() {
        let (h, body) = reply(Some("cookie"));
        assert!(body.get("access_token").is_none() && body.get("refresh_token").is_none());
        assert_eq!(body["user"]["username"], "u");
        let cookies: Vec<_> = h.get_all(SET_COOKIE).iter().map(|v| v.to_str().unwrap().to_string()).collect();
        assert!(cookies.iter().any(|c| c.starts_with("access_token=acc;")), "cookies toujours posés");
        assert!(cookies.iter().any(|c| c.starts_with("refresh_token=ref;")));
        // Sans l'en-tête (bureau, mobile) : inchangé.
        let (_, body) = reply(None);
        assert_eq!(body["access_token"], "acc");
        assert_eq!(body["refresh_token"], "ref");
        let (_, body) = reply(Some("bearer"));
        assert_eq!(body["access_token"], "acc");
    }
}
