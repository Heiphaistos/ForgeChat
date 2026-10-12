//! Cookies de session de l'appli web (audit 2026-10-12, durcissement web).
//!
//! En HTTPS, les noms portent un préfixe que le navigateur fait respecter :
//! - `__Host-access_token` (Path=/) : ni posable ni écrasable par un autre sous-domaine ;
//! - `__Secure-refresh_token` et `__Secure-fc_alt_<id>` (Path=/api/auth) : jamais posés en clair.
//!
//! Sans préfixe, un sous-domaine compromis de heiphaistos.org pouvait poser son propre
//! `access_token` (« cookie tossing ») et faire travailler la victime dans le compte de l'attaquant.
//! Les anciens noms restent lus jusqu'à `LEGACY_UNTIL` (sessions ouvertes avant le changement :
//! le jeton de rafraîchissement est alors réémis sous le nouveau nom et l'ancien effacé), sauf
//! l'ancien `access_token`, jamais accepté en HTTPS : l'appli se rafraîchit d'elle-même sur 401.
//! En HTTP (développement local), les préfixes sont interdits par les navigateurs : anciens noms.
use axum::http::{header::SET_COOKIE, HeaderMap, HeaderValue};

/// 2026-11-12 00:00 UTC : au-delà, plus aucun ancien nom n'est lu (un mois après le passage).
pub const LEGACY_UNTIL: i64 = 1_794_441_600;

const ACCESS_SECURE: &str = "__Host-access_token";
const REFRESH_SECURE: &str = "__Secure-refresh_token";
const ALT_SECURE: &str = "__Secure-fc_alt_";
const ACCESS_LEGACY: &str = "access_token";
const REFRESH_LEGACY: &str = "refresh_token";
const ALT_LEGACY: &str = "fc_alt_";

fn legacy_ok(now: i64) -> bool {
    now < LEGACY_UNTIL
}

/// Cookies `nom=valeur` de la requête (tous les en-têtes Cookie).
pub fn parse(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .get_all("cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(';'))
        .filter_map(|p| p.trim().split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

fn get(headers: &HeaderMap, name: &str) -> Option<String> {
    parse(headers).into_iter().find(|(k, v)| k == name && !v.is_empty()).map(|(_, v)| v)
}

/// Jeton d'accès du cookie. HTTPS : seulement `__Host-access_token`.
pub fn access_token(headers: &HeaderMap, secure: bool) -> Option<String> {
    get(headers, if secure { ACCESS_SECURE } else { ACCESS_LEGACY })
}

/// Jeton de rafraîchissement du cookie (`now` : instant présent, pour la fin de la transition).
pub fn refresh_token(headers: &HeaderMap, secure: bool, now: i64) -> Option<String> {
    if !secure {
        return get(headers, REFRESH_LEGACY);
    }
    get(headers, REFRESH_SECURE).or_else(|| legacy_ok(now).then(|| get(headers, REFRESH_LEGACY)).flatten())
}

/// Nom du cookie d'un compte mis de côté, selon le mode.
pub fn alt_name(user_simple: &str, secure: bool) -> String {
    format!("{}{user_simple}", if secure { ALT_SECURE } else { ALT_LEGACY })
}

/// Comptes mis de côté : (id annoncé par le nom du cookie, jeton). Anciens noms pendant la transition.
pub fn alt_tokens(headers: &HeaderMap, secure: bool, now: i64) -> Vec<(String, String)> {
    let legacy = !secure || legacy_ok(now);
    parse(headers)
        .into_iter()
        .filter_map(|(k, v)| {
            let id = if secure { k.strip_prefix(ALT_SECURE) } else { None }
                .or_else(|| if legacy { k.strip_prefix(ALT_LEGACY) } else { None })?;
            Some((id.to_string(), v))
        })
        .collect()
}

fn flag(secure: bool) -> &'static str {
    if secure { "; Secure" } else { "" }
}

fn push(h: &mut HeaderMap, c: String) {
    if let Ok(v) = HeaderValue::from_str(&c) {
        h.append(SET_COOKIE, v);
    }
}

/// Efface les anciens noms (sans préfixe) au passage, en HTTPS.
fn clear_legacy(h: &mut HeaderMap, secure: bool) {
    if secure {
        push(h, format!("{ACCESS_LEGACY}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"));
        push(h, format!("{REFRESH_LEGACY}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0"));
    }
}

/// Cookies HttpOnly de session (accès + rafraîchissement).
pub fn session(access: &str, refresh: &str, secure: bool) -> HeaderMap {
    let mut h = HeaderMap::new();
    let (a, r) = if secure { (ACCESS_SECURE, REFRESH_SECURE) } else { (ACCESS_LEGACY, REFRESH_LEGACY) };
    push(&mut h, format!("{a}={access}; HttpOnly{}; SameSite=Strict; Path=/; Max-Age=86400", flag(secure)));
    push(&mut h, format!("{r}={refresh}; HttpOnly{}; SameSite=Strict; Path=/api/auth; Max-Age={}", flag(secure), 30 * 86400));
    clear_legacy(&mut h, secure);
    h
}

/// Efface les cookies de session (nouveaux et anciens noms).
pub fn clear_session(secure: bool) -> HeaderMap {
    let mut h = HeaderMap::new();
    let (a, r) = if secure { (ACCESS_SECURE, REFRESH_SECURE) } else { (ACCESS_LEGACY, REFRESH_LEGACY) };
    push(&mut h, format!("{a}=; HttpOnly{}; SameSite=Strict; Path=/; Max-Age=0", flag(secure)));
    push(&mut h, format!("{r}=; HttpOnly{}; SameSite=Strict; Path=/api/auth; Max-Age=0", flag(secure)));
    clear_legacy(&mut h, secure);
    h
}

/// Cookie d'un compte mis de côté (`token` vide : effacé, ancien nom compris en HTTPS).
pub fn alt(h: &mut HeaderMap, user_simple: &str, token: &str, secure: bool) {
    let max_age = if token.is_empty() { 0 } else { 30 * 86400 };
    push(h, format!("{}={token}; HttpOnly{}; SameSite=Strict; Path=/api/auth; Max-Age={max_age}", alt_name(user_simple, secure), flag(secure)));
    if secure {
        push(h, format!("{ALT_LEGACY}{user_simple}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(cookie: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("cookie", HeaderValue::from_str(cookie).unwrap());
        h
    }
    const BEFORE: i64 = LEGACY_UNTIL - 1;
    const AFTER: i64 = LEGACY_UNTIL;

    #[test]
    fn https_only_trusts_prefixed_access_cookie() {
        // Un `access_token` posé par un sous-domaine (cookie tossing) n'est jamais lu en HTTPS.
        assert_eq!(access_token(&req("access_token=tossed"), true), None);
        assert_eq!(access_token(&req("access_token=tossed; __Host-access_token=mine"), true).as_deref(), Some("mine"));
        assert_eq!(access_token(&req("access_token=dev"), false).as_deref(), Some("dev"));
        assert_eq!(access_token(&req("__Host-access_token="), true), None);
    }

    #[test]
    fn refresh_transition_then_prefixed_only() {
        let h = req("refresh_token=old");
        assert_eq!(refresh_token(&h, true, BEFORE).as_deref(), Some("old"));
        assert_eq!(refresh_token(&h, true, AFTER), None);
        let both = req("refresh_token=tossed; __Secure-refresh_token=mine");
        assert_eq!(refresh_token(&both, true, BEFORE).as_deref(), Some("mine"), "le nom préfixé l'emporte");
        assert_eq!(refresh_token(&req("refresh_token=dev"), false, AFTER).as_deref(), Some("dev"));
    }

    #[test]
    fn alt_cookies_transition() {
        let h = req("__Secure-fc_alt_abc=t1; fc_alt_def=t2");
        assert_eq!(alt_tokens(&h, true, BEFORE).len(), 2);
        assert_eq!(alt_tokens(&h, true, AFTER), vec![("abc".to_string(), "t1".to_string())]);
        assert_eq!(alt_tokens(&req("fc_alt_def=t2"), false, AFTER).len(), 1);
    }

    #[test]
    fn set_cookie_flags() {
        let h = session("A", "R", true);
        let v: Vec<_> = h.get_all(SET_COOKIE).iter().map(|v| v.to_str().unwrap().to_string()).collect();
        assert!(v[0].starts_with("__Host-access_token=A;") && v[0].contains("Secure") && v[0].contains("Path=/;") && !v[0].contains("Domain"));
        assert!(v[1].starts_with("__Secure-refresh_token=R;") && v[1].contains("Secure"));
        assert!(v.iter().any(|c| c.starts_with("access_token=;") && c.contains("Max-Age=0")), "ancien nom effacé");
        let dev: Vec<_> = session("A", "R", false).get_all(SET_COOKIE).iter().map(|v| v.to_str().unwrap().to_string()).collect();
        assert_eq!(dev.len(), 2);
        assert!(dev[0].starts_with("access_token=A;") && !dev[0].contains("Secure"));
    }
}
