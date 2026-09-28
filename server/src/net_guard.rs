//! Requêtes sortantes vers des URL fournies par les utilisateurs (flux RSS,
//! aperçus de lien, Web Push) : jamais vers le réseau interne.
//!
//! Vérifier la chaîne de l'URL ne suffit pas : un nom public peut résoudre
//! vers 127.0.0.1 ou `livekit`, et une redirection peut viser une adresse
//! interne. Le filtrage se fait donc à la résolution DNS (chaque connexion,
//! y compris après redirection) et sur chaque saut de redirection.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

/// Adresse joignable sur Internet (ni boucle locale, ni privée, ni lien local,
/// ni CGNAT, ni réservée, ni IPv6 locale ; IPv4 mappée en IPv6 vérifiée en IPv4).
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || v4.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 (CGNAT)
                || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
                || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18.0.0/15
                || o[0] >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // fc00::/7 (ULA)
                || (s[0] & 0xffc0) == 0xfe80 // fe80::/10 (lien local)
                || (s[0] == 0x64 && s[1] == 0xff9b) // NAT64
                || (s[0] == 0x2001 && s[1] == 0x0db8)) // documentation
        }
    }
}

/// http(s) seulement ; si l'hôte est une IP littérale (que reqwest ne résout
/// pas, donc que le résolveur ne voit jamais), elle doit être publique.
pub fn url_target_ok(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    match url.host_str() {
        None | Some("") => false,
        Some(h) => match h.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>() {
            Ok(ip) => is_public_ip(ip),
            Err(_) => true, // nom de domaine : filtré par `PublicOnlyResolver`
        },
    }
}

/// Même règle sur une chaîne.
pub fn url_str_target_ok(url: &str) -> bool {
    reqwest::Url::parse(url).map(|u| url_target_ok(&u)).unwrap_or(false)
}

/// Résolveur DNS qui ne rend que des adresses publiques.
struct PublicOnlyResolver;

impl reqwest::dns::Resolve for PublicOnlyResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|a| is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err(format!("{host} : aucune adresse publique").into());
            }
            Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// Client pour les URL d'utilisateurs : DNS filtré, chaque redirection
/// revalidée (au plus `max_redirects`).
pub fn public_client(max_redirects: usize, user_agent: &str) -> reqwest::ClientBuilder {
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() > max_redirects {
            attempt.error("trop de redirections")
        } else if !url_target_ok(attempt.url()) {
            attempt.error("redirection vers une adresse non autorisée")
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder()
        .redirect(policy)
        .dns_resolver(Arc::new(PublicOnlyResolver))
        .user_agent(user_agent)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_addresses_refused() {
        for a in ["127.0.0.1", "10.1.2.3", "172.18.0.5", "192.168.1.49", "169.254.169.254",
                  "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1",
                  "::ffff:10.0.0.1", "224.0.0.1", "240.0.0.1"] {
            assert!(!is_public_ip(a.parse().unwrap()), "{a} devrait être refusée");
        }
        for a in ["1.1.1.1", "212.227.140.45", "2606:4700::1111"] {
            assert!(is_public_ip(a.parse().unwrap()), "{a} devrait être acceptée");
        }
    }

    #[test]
    fn url_literals() {
        assert!(!url_str_target_ok("http://127.0.0.1:5000/"));
        assert!(!url_str_target_ok("http://[::ffff:7f00:1]/"));
        assert!(!url_str_target_ok("http://[fd12::1]:7880/"));
        assert!(!url_str_target_ok("ftp://example.com/"));
        assert!(!url_str_target_ok("http://2130706433/")); // 127.0.0.1 en décimal
        assert!(url_str_target_ok("https://example.com/feed.xml"));
    }

    #[tokio::test]
    async fn resolver_refuses_internal_names() {
        use reqwest::dns::Resolve;
        let r = PublicOnlyResolver;
        assert!(r.resolve("localhost".parse().unwrap()).await.is_err());
        // Client complet : un nom qui résout en 127.0.0.1 ne part jamais.
        let c = public_client(3, "test").build().unwrap();
        assert!(c.get("http://localhost:1/").send().await.is_err());
    }
}
