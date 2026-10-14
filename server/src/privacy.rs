//! Anonymat : ce que le serveur garde d'un client est réduit au strict nécessaire.

use axum::http::HeaderMap;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::{net::SocketAddr, sync::Mutex};

/// Pseudonyme d'une valeur (IP, e-mail) pour les clés Redis de limitation de débit :
/// HMAC-SHA256 avec un sel aléatoire tiré chaque jour et gardé en mémoire seulement.
/// Redis ne contient donc jamais la valeur en clair, et d'un jour à l'autre (ou après
/// un redémarrage) les pseudonymes ne se recoupent plus. Les compteurs repartent alors
/// de zéro : sans effet notable, leurs fenêtres durent au plus une heure.
pub fn pseudonym(value: &str) -> String {
    static SALT: Mutex<Option<(i64, [u8; 32])>> = Mutex::new(None);
    let day = chrono::Utc::now().timestamp().div_euclid(86_400);
    let salt = {
        let mut slot = SALT.lock().unwrap_or_else(|e| e.into_inner());
        match *slot {
            Some((d, s)) if d == day => s,
            _ => {
                let s: [u8; 32] = rand::random();
                *slot = Some((day, s));
                s
            }
        }
    };
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&salt).expect("HMAC accepte toute longueur de clé");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// Pseudonyme de l'IP du client. Seul X-Real-IP compte : nginx l'écrase avec `$remote_addr`.
/// X-Forwarded-For est choisi par le client (une IP différente à chaque essai) : ignoré.
pub fn client_key(headers: &HeaderMap, addr: &SocketAddr) -> String {
    pseudonym(&client_ip(headers, addr))
}

fn client_ip(headers: &HeaderMap, addr: &SocketAddr) -> String {
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| addr.ip().to_string())
}

#[cfg(test)]
mod client_ip_tests {
    #[test]
    fn forwarded_for_is_ignored() {
        let addr: std::net::SocketAddr = "10.0.0.9:1234".parse().unwrap();
        let mut h = axum::http::HeaderMap::new();
        h.insert("x-forwarded-for", "1.2.3.4".parse().unwrap());
        assert_eq!(super::client_ip(&h, &addr), "10.0.0.9");
        h.insert("x-real-ip", "5.6.7.8".parse().unwrap());
        assert_eq!(super::client_ip(&h, &addr), "5.6.7.8");
    }
}

/// Étiquette d'appareil tirée du user-agent (« Chrome · Windows », « ForgeChat Android »…),
/// gardée à la place du user-agent brut. `version` ajoute la version majeure du navigateur.
pub fn device_label(user_agent: &str, version: bool) -> String {
    let ua = user_agent.to_ascii_lowercase();
    // Application de bureau (userAgent de tauri.conf.json) et appli mobile (React Native).
    if ua.contains("cfnetwork/") {
        return "ForgeChat iOS".into();
    }
    if ua.starts_with("okhttp/") {
        return "ForgeChat Android".into();
    }
    if ua.starts_with("forgechat/") {
        return "ForgeChat bureau".into();
    }
    let browser = [
        ("edg/", "Edge"),
        ("opr/", "Opera"),
        ("firefox/", "Firefox"),
        ("fxios/", "Firefox"),
        ("crios/", "Chrome"),
        ("chrome/", "Chrome"),
        ("version/", "Safari"),
    ]
    .iter()
    .find_map(|(token, name)| {
        let rest = &ua[ua.find(token)? + token.len()..];
        let major: String = rest.chars().take_while(char::is_ascii_digit).collect();
        Some(if version && !major.is_empty() { format!("{name} {major}") } else { (*name).to_string() })
    })
    .unwrap_or_else(|| "Navigateur".into());
    let os = [
        ("android", "Android"),
        ("iphone", "iOS"),
        ("ipad", "iOS"),
        ("windows", "Windows"),
        ("mac os", "macOS"),
        ("cros", "ChromeOS"),
        ("linux", "Linux"),
    ]
    .iter()
    .find(|(token, _)| ua.contains(token))
    .map(|(_, name)| *name);
    match os {
        Some(os) => format!("{browser} · {os}"),
        None => browser,
    }
}

/// Remplace les adresses e-mail d'un texte (erreur SMTP…) avant de le journaliser.
pub fn redact_emails(text: &str) -> String {
    text.split(' ').map(|w| if w.contains('@') { "[e-mail]" } else { w }).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pseudonyme_stable_et_opaque() {
        let a = pseudonym("203.0.113.7");
        assert_eq!(a, pseudonym("203.0.113.7"));
        assert_ne!(a, pseudonym("203.0.113.8"));
        assert_eq!(a.len(), 64);
        assert!(!a.contains("203.0.113.7"));
    }

    #[test]
    fn masque_les_adresses() {
        assert_eq!(redact_emails("550 5.1.1 <bob@exemple.fr>: rejected"), "550 5.1.1 [e-mail] rejected");
    }

    #[test]
    fn etiquettes_d_appareil() {
        let chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
        assert_eq!(device_label(chrome, false), "Chrome · Windows");
        assert_eq!(device_label(chrome, true), "Chrome 129 · Windows");
        let firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0";
        assert_eq!(device_label(firefox, false), "Firefox · Linux");
        let edge = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0";
        assert_eq!(device_label(edge, false), "Edge · Windows");
        let safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1";
        assert_eq!(device_label(safari, false), "Safari · iOS");
        let android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";
        assert_eq!(device_label(android, false), "Chrome · Android");
        assert_eq!(device_label("ForgeChat/3.27.0 (Desktop)", false), "ForgeChat bureau");
        assert_eq!(device_label("okhttp/4.12.0", false), "ForgeChat Android");
        assert_eq!(device_label("ForgeChat/12 CFNetwork/1490 Darwin/23.5.0", false), "ForgeChat iOS");
        assert_eq!(device_label("curl/8.0", false), "Navigateur");
    }
}
