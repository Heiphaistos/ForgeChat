//! Anonymat : ce que le serveur garde d'un client est réduit au strict nécessaire.

use axum::http::HeaderMap;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::{
    net::{IpAddr, SocketAddr},
    sync::{Mutex, OnceLock},
};

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

/// Réseaux dont l'adresse de pair est un proxy de confiance (nginx de l'hôte, serveur dans docker) :
/// `TRUSTED_PROXIES` (IP ou CIDR séparés par des virgules) ; par défaut boucle locale + réseaux privés.
const DEFAULT_TRUSTED: &str = "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7";

/// `(adresse, longueur du préfixe)` ; entrée invalide ignorée.
fn parse_nets(list: &str) -> Vec<(IpAddr, u8)> {
    list.split(',')
        .filter_map(|e| {
            let e = e.trim();
            let (ip, len) = match e.split_once('/') {
                Some((ip, l)) => (ip.parse::<IpAddr>().ok()?, l.parse::<u8>().ok()?),
                None => {
                    let ip = e.parse::<IpAddr>().ok()?;
                    (ip, if ip.is_ipv4() { 32 } else { 128 })
                }
            };
            (len <= if ip.is_ipv4() { 32 } else { 128 }).then_some((ip, len))
        })
        .collect()
}

fn in_net(ip: IpAddr, (net, len): (IpAddr, u8)) -> bool {
    let bits = |ip: IpAddr| match ip {
        IpAddr::V4(v) => (u128::from(u32::from(v)), 32u32),
        IpAddr::V6(v) => (u128::from(v), 128u32),
    };
    let ((a, w), (n, nw)) = (bits(ip), bits(net));
    if w != nw {
        return false;
    }
    let shift = w - u32::from(len);
    shift >= 128 || (a >> shift) == (n >> shift)
}

fn is_trusted_proxy(peer: IpAddr) -> bool {
    static NETS: OnceLock<Vec<(IpAddr, u8)>> = OnceLock::new();
    let nets = NETS.get_or_init(|| parse_nets(&std::env::var("TRUSTED_PROXIES").unwrap_or_else(|_| DEFAULT_TRUSTED.into())));
    // Adresse IPv4 mappée en IPv6 (::ffff:a.b.c.d) : comparée comme IPv4.
    let peer = match peer {
        IpAddr::V6(v) => v.to_ipv4_mapped().map_or(peer, IpAddr::V4),
        v4 => v4,
    };
    nets.iter().any(|n| in_net(peer, *n))
}

/// X-Real-IP n'est cru que si le pair TCP est un proxy de confiance ; sinon n'importe quel client
/// joignant le port directement choisirait son IP (contournement de tous les limiteurs par IP).
fn client_ip(headers: &HeaderMap, addr: &SocketAddr) -> String {
    if is_trusted_proxy(addr.ip()) {
        if let Some(ip) = headers
            .get("x-real-ip")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<IpAddr>().ok())
        {
            return ip.to_string();
        }
    }
    addr.ip().to_string()
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

    #[test]
    fn real_ip_only_from_trusted_proxy() {
        let mut h = axum::http::HeaderMap::new();
        h.insert("x-real-ip", "5.6.7.8".parse().unwrap());
        // Pair public : l'en-tête est choisi par le client, ignoré.
        let direct: std::net::SocketAddr = "203.0.113.9:1234".parse().unwrap();
        assert_eq!(super::client_ip(&h, &direct), "203.0.113.9");
        // Proxy local / docker (réseaux par défaut), y compris IPv4 mappée.
        for peer in ["127.0.0.1:1", "172.18.0.1:1", "192.168.1.5:1", "[::1]:1", "[::ffff:10.1.2.3]:1"] {
            assert_eq!(super::client_ip(&h, &peer.parse().unwrap()), "5.6.7.8", "{peer}");
        }
        // En-tête illisible : repli sur le pair.
        h.insert("x-real-ip", "pas-une-ip".parse().unwrap());
        assert_eq!(super::client_ip(&h, &"127.0.0.1:1".parse().unwrap()), "127.0.0.1");
    }

    #[test]
    fn trusted_proxy_list_parsing() {
        let nets = super::parse_nets("10.0.0.0/8, 1.2.3.4 ,bad,2001:db8::/32,1.1.1.1/99");
        assert_eq!(nets.len(), 3);
        let ip = |s: &str| s.parse().unwrap();
        assert!(super::in_net(ip("10.9.9.9"), nets[0]));
        assert!(!super::in_net(ip("11.0.0.1"), nets[0]));
        assert!(super::in_net(ip("1.2.3.4"), nets[1]) && !super::in_net(ip("1.2.3.5"), nets[1]));
        assert!(super::in_net(ip("2001:db8::1"), nets[2]) && !super::in_net(ip("10.0.0.1"), nets[2]));
        assert!(super::in_net(ip("1.2.3.4"), (ip("0.0.0.0"), 0)));
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
