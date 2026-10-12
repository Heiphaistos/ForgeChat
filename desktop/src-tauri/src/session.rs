//! Session de l'application bureau (audit M10) : le jeton de rafraîchissement vit dans le
//! trousseau de l'OS (Gestionnaire d'identifiants Windows, Trousseau macOS, Secret Service
//! Linux) et ne passe jamais par le JavaScript. Le jeton d'accès reste en mémoire seulement.
//!
//! Une entrée de trousseau par compte : `refresh:active` pour le compte connecté,
//! `refresh:<id>` pour chaque compte mis de côté (lib/accounts.ts).
//!
//! Trousseau injoignable : sous Linux (pas de Secret Service), repli sur un fichier chiffré
//! lié à la machine, protection moindre (session_file.rs) ; ailleurs, la session tient en
//! mémoire pour ce lancement. Jamais de fichier en clair.

use std::sync::Mutex;
use std::time::Duration;

use tauri::async_runtime::{spawn_blocking, Mutex as AsyncMutex};

use crate::session_file;

const SERVICE: &str = "org.heiphaistos.forgechat";
const ACTIVE: &str = "refresh:active";
const REFRESH_URL: &str = "https://forgechat.heiphaistos.org/api/auth/refresh";
/// Les jetons du serveur font moins de 100 caractères ; le Gestionnaire d'identifiants
/// Windows plafonne de toute façon à 2 560 octets.
const MAX_TOKEN_LEN: usize = 2048;

struct Mem {
    access: Option<String>,
    refresh: Option<String>,
}

static MEM: Mutex<Mem> = Mutex::new(Mem { access: None, refresh: None });
/// Un seul rafraîchissement à la fois : la rotation consomme le jeton côté serveur.
static REFRESH_LOCK: AsyncMutex<()> = AsyncMutex::const_new(());

fn mem() -> std::sync::MutexGuard<'static, Mem> {
    MEM.lock().unwrap_or_else(|e| e.into_inner())
}

fn valid_token(t: &str) -> bool {
    !t.is_empty() && t.len() <= MAX_TOKEN_LEN && t.bytes().all(|b| b.is_ascii_graphic())
}

/// Nom d'entrée d'un compte mis de côté ; l'id vient du JS, il est donc filtré.
fn account_key(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("INVALID_ACCOUNT".into());
    }
    Ok(format!("refresh:{id}"))
}

// Les magasins de secrets sont synchrones (D-Bus sous Linux) : hors des threads de tokio.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    spawn_blocking(f).await.map_err(|e| e.to_string())
}

fn entry(user: &str) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, user)
}

async fn kr_get(user: String) -> Option<String> {
    blocking(move || match entry(&user).and_then(|e| e.get_password()) {
        Ok(t) => Some(t),
        // Absent du trousseau ou trousseau injoignable : peut-être rangé dans le repli Linux.
        Err(_) => session_file::machine().and_then(|f| f.get(&user)),
    })
    .await
    .ok()
    .flatten()
    .filter(|t| valid_token(t))
}

async fn kr_set(user: String, secret: String) -> Result<(), String> {
    blocking(move || match entry(&user).and_then(|e| e.set_password(&secret)) {
        Ok(()) => {
            // Le trousseau répond de nouveau : plus de copie de repli.
            if let Some(f) = session_file::machine() {
                let _ = f.del(&user);
            }
            Ok(())
        }
        Err(e) => match session_file::machine() {
            Some(f) => f.set(&user, &secret),
            None => Err(e.to_string()),
        },
    })
    .await?
}

async fn kr_del(user: String) -> Result<(), String> {
    blocking(move || {
        if let Some(f) = session_file::machine() {
            f.del(&user)?;
        }
        match entry(&user).and_then(|e| e.delete_credential()) {
            // Trousseau injoignable : rien n'a pu y être rangé.
            Ok(()) | Err(keyring::Error::NoEntry | keyring::Error::NoDefaultStore) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await?
}

async fn active_refresh() -> Option<String> {
    let cached = mem().refresh.clone();
    match cached {
        Some(t) => Some(t),
        None => kr_get(ACTIVE.into()).await,
    }
}

/// Enregistre la session active ; le trousseau qui échoue n'empêche pas la session en cours.
async fn set_active(access: Option<String>, refresh: String) -> Result<(), String> {
    {
        let mut m = mem();
        m.access = access;
        m.refresh = Some(refresh.clone());
    }
    kr_set(ACTIVE.into(), refresh).await
}

fn parse_tokens(body: &[u8]) -> Option<(String, String)> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    let access = v["access_token"].as_str().filter(|t| valid_token(t))?;
    let refresh = v["refresh_token"].as_str().filter(|t| valid_token(t))?;
    Some((access.to_string(), refresh.to_string()))
}

/// POST /api/auth/refresh. Erreur = statut HTTP, 0 = réseau ou réponse illisible (transitoire).
async fn post_refresh(token: &str) -> Result<(String, String), u16> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent(concat!("ForgeChat-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| 0u16)?;
    let body = serde_json::to_vec(&serde_json::json!({ "refresh_token": token })).map_err(|_| 0u16)?;
    let res = client
        .post(REFRESH_URL)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| 0u16)?;
    let status = res.status();
    if !status.is_success() {
        return Err(status.as_u16());
    }
    let bytes = res.bytes().await.map_err(|_| 0u16)?;
    parse_tokens(&bytes).ok_or(0)
}

/// Après une connexion : jeton d'accès en mémoire, jeton de rafraîchissement au trousseau.
#[tauri::command]
pub async fn session_store(access: String, refresh: String) -> Result<(), String> {
    if !valid_token(&refresh) || !(access.is_empty() || valid_token(&access)) {
        return Err("INVALID_TOKEN".into());
    }
    // Trousseau (et repli) en échec : la connexion vaut quand même pour ce lancement.
    if let Err(e) = set_active(Some(access).filter(|a| !a.is_empty()), refresh).await {
        eprintln!("[session] trousseau indisponible, session gardée en mémoire : {e}");
    }
    Ok(())
}

/// Jeton d'accès en mémoire (survit au rechargement de la page, pas au redémarrage).
#[tauri::command]
pub async fn session_access() -> Option<String> {
    mem().access.clone()
}

/// Rafraîchit la session depuis le trousseau ; renvoie seulement le nouveau jeton d'accès.
/// Erreur = statut HTTP (401 : aucune session enregistrée), 0 = réseau.
#[tauri::command]
pub async fn session_refresh() -> Result<String, u16> {
    let before = mem().access.clone();
    let _guard = REFRESH_LOCK.lock().await;
    // Un appel concurrent vient de tourner le jeton : son résultat sert à tous.
    if let Some(a) = mem().access.clone().filter(|a| Some(a) != before.as_ref()) {
        return Ok(a);
    }
    let token = active_refresh().await.ok_or(401u16)?;
    let (access, refresh) = match post_refresh(&token).await {
        Ok(t) => t,
        // Jeton périmé, révoqué ou compte suspendu : il ne servira plus jamais.
        Err(s @ (400 | 401 | 403)) => {
            let _ = session_clear().await;
            return Err(s);
        }
        Err(s) => return Err(s),
    };
    if let Err(e) = set_active(Some(access.clone()), refresh).await {
        eprintln!("[session] trousseau indisponible, session gardée en mémoire : {e}");
    }
    Ok(access)
}

/// Déconnexion : oublie la session active (les comptes mis de côté restent).
#[tauri::command]
pub async fn session_clear() -> Result<(), String> {
    *mem() = Mem { access: None, refresh: None };
    kr_del(ACTIVE.into()).await
}

/// Met le compte actif de côté sous `id`.
#[tauri::command]
pub async fn session_stash(id: String) -> Result<(), String> {
    let key = account_key(&id)?;
    let refresh = active_refresh().await.ok_or("NO_SESSION")?;
    kr_set(key, refresh).await?;
    session_clear().await
}

/// Bascule vers le compte `id` ; le compte actif (`current`) est mis de côté.
#[tauri::command]
pub async fn session_switch(id: String, current: Option<String>) -> Result<String, String> {
    let key = account_key(&id)?;
    let current_key = current.as_deref().map(account_key).transpose()?;
    let _guard = REFRESH_LOCK.lock().await;
    let target = kr_get(key.clone()).await.ok_or("UNKNOWN_ACCOUNT")?;
    let (access, refresh) = post_refresh(&target).await.map_err(|s| format!("HTTP {s}"))?;
    if let (Some(ck), Some(r)) = (current_key, active_refresh().await) {
        kr_set(ck, r).await?;
    }
    kr_del(key).await?;
    set_active(Some(access.clone()), refresh).await?;
    Ok(access)
}

/// Oublie un compte mis de côté.
#[tauri::command]
pub async fn session_forget(id: String) -> Result<(), String> {
    kr_del(account_key(&id)?).await
}

/// Migration depuis localStorage : range au trousseau un compte mis de côté.
#[tauri::command]
pub async fn session_import_account(id: String, refresh: String) -> Result<(), String> {
    if !valid_token(&refresh) {
        return Err("INVALID_TOKEN".into());
    }
    kr_set(account_key(&id)?, refresh).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_key_filters_ids() {
        assert_eq!(account_key("3f2b-AA09").unwrap(), "refresh:3f2b-AA09");
        assert!(account_key("").is_err());
        assert!(account_key("../x").is_err());
        assert!(account_key("a b").is_err());
        assert!(account_key(&"a".repeat(65)).is_err());
    }

    #[test]
    fn parse_tokens_requires_both() {
        assert_eq!(
            parse_tokens(br#"{"access_token":"a.b.c","refresh_token":"r1"}"#),
            Some(("a.b.c".into(), "r1".into()))
        );
        assert_eq!(parse_tokens(br#"{"access_token":"a"}"#), None);
        assert_eq!(parse_tokens(br#"{"access_token":"a","refresh_token":""}"#), None);
        assert_eq!(parse_tokens(b"<html>"), None);
    }

    /// La vraie route refuse un jeton inconnu par un statut HTTP, pas une erreur réseau.
    #[test]
    #[ignore = "réseau : interroge forgechat.heiphaistos.org"]
    fn refresh_route_rejects_unknown_token() {
        let r = tauri::async_runtime::block_on(post_refresh("jeton-inconnu-selftest"));
        assert_eq!(r, Err(401));
    }

    /// Écrit, relit et efface une entrée du vrai trousseau de la machine.
    #[test]
    #[ignore = "trousseau réel : Secret Service absent sur les CI Linux"]
    fn keyring_roundtrip() {
        let rt = tauri::async_runtime::block_on(async {
            let user = "refresh:selftest".to_string();
            kr_set(user.clone(), "tok-123".into()).await?;
            let got = kr_get(user.clone()).await;
            kr_del(user.clone()).await?;
            Ok::<_, String>((got, kr_get(user).await))
        });
        assert_eq!(rt.unwrap(), (Some("tok-123".into()), None));
    }
}

const REMEMBER: &str = "login:remembered";

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Remembered {
    pub email: String,
    pub password: String,
}

fn encode_remembered(r: &Remembered) -> Option<String> {
    use base64::Engine;
    let json = serde_json::to_vec(r).ok()?;
    Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json))
}

fn decode_remembered(s: &str) -> Option<Remembered> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[tauri::command]
pub async fn login_remember(email: String, password: String) -> Result<(), String> {
    if email.is_empty()
        || email.len() > 254
        || !email.contains('@')
        || password.is_empty()
        || password.len() > 512
    {
        return Err("INVALID_LOGIN".into());
    }
    let enc = encode_remembered(&Remembered { email, password }).ok_or("INVALID_LOGIN")?;
    kr_set(REMEMBER.into(), enc).await
}

#[tauri::command]
pub async fn login_remembered() -> Option<Remembered> {
    kr_get(REMEMBER.into())
        .await
        .and_then(|s| decode_remembered(&s))
}

#[tauri::command]
pub async fn login_forget() -> Result<(), String> {
    kr_del(REMEMBER.into()).await
}

/// Où la session est gardée : `os` (trousseau du système), `file` (repli chiffré Linux) ou
/// `memory` (rien ne survivra à la fermeture) — affiché dans Paramètres > Système.
#[tauri::command]
pub async fn session_storage_status() -> String {
    blocking(|| match keyring::Entry::store_status() {
        Ok(()) => "os".to_string(),
        Err(_) if session_file::machine().is_some() => "file".to_string(),
        Err(_) => "memory".to_string(),
    })
    .await
    .unwrap_or_else(|_| "memory".into())
}

#[cfg(test)]
mod remember_tests {
    use super::*;

    #[test]
    fn remembered_round_trip_survives_any_password() {
        let r = Remembered {
            email: "a@b.c".into(),
            password: "mot de passe éàü \" { } 🔑".into(),
        };
        let enc = encode_remembered(&r).unwrap();
        assert!(valid_token(&enc), "rangé comme un jeton (ASCII imprimable)");
        let back = decode_remembered(&enc).unwrap();
        assert_eq!(
            (back.email.as_str(), back.password.as_str()),
            ("a@b.c", r.password.as_str())
        );
        assert!(decode_remembered("pas du base64 !").is_none());
    }
}
