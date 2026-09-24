//! Remontée des échecs de lancement vers `POST /api/diagnostics/report`.
//!
//! Une page blanche signifie parfois que le JavaScript ne tourne pas : le client
//! web ne peut alors rien signaler. Le côté Rust prend le relais au lancement
//! SUIVANT, en tâche de fond (jamais bloquant, échec silencieux).
//! - Linux : journal du lancement précédent (`forgechat.log`) si ce lancement
//!   n'a jamais affiché l'interface, ou si le journal contient des erreurs.
//! - Windows : panique Rust écrite dans un fichier, envoyée au lancement suivant.
use std::path::Path;
use std::time::Duration;

const ENDPOINT: &str = "https://forgechat.heiphaistos.org/api/diagnostics/report";
/// Fin de journal envoyée (le serveur tronque de toute façon à 200 000 caractères).
const MAX_LOG: u64 = 200 * 1024;

#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
/// Lit au plus les `MAX_LOG` derniers octets d'un fichier.
fn lire_fin(path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(MAX_LOG))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    // Une coupe au milieu d'un caractère UTF-8 devient « � », sans erreur.
    Some(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
/// Envoi en tâche de fond, 10 s maximum, erreurs ignorées.
fn envoyer(platform: &'static str, kind: &'static str, message: String, log: String) {
    let body = serde_json::json!({
        "platform": platform,
        "app_version": env!("CARGO_PKG_VERSION"),
        "kind": kind,
        "message": message,
        "log": log,
    })
    .to_string();
    tauri::async_runtime::spawn(async move {
        // ring ET aws-lc-rs sont compilés sous Linux : sans fournisseur choisi,
        // rustls panique à la première connexion (cf. native_voice).
        #[cfg(target_os = "linux")]
        let _ = rustls::crypto::ring::default_provider().install_default();
        let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("ForgeChat-Desktop/", env!("CARGO_PKG_VERSION")))
            .build()
        else {
            return;
        };
        let _ = client
            .post(ENDPOINT)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await;
    });
}

#[cfg(target_os = "linux")]
fn distribution() -> String {
    std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("PRETTY_NAME="))
                .map(|v| v.trim_matches('"').to_string())
        })
        .unwrap_or_else(|| "distribution inconnue".into())
}

#[cfg(target_os = "linux")]
fn paquet() -> String {
    if std::env::var_os("APPIMAGE").is_some() {
        return "AppImage".into();
    }
    let exe = std::env::current_exe().unwrap_or_default();
    if !exe.starts_with("/usr") {
        return format!("autre ({})", exe.display());
    }
    if Path::new("/var/lib/dpkg/status").exists() {
        "deb".into()
    } else if Path::new("/usr/bin/rpm").exists() {
        "rpm".into()
    } else {
        "paquet système".into()
    }
}

/// À appeler AVANT `compat::journal_si_pas_de_terminal` (qui réécrit le journal)
/// et avant `compat::preparer` (qui repose le marqueur de lancement).
#[cfg(target_os = "linux")]
pub fn signaler_lancement_precedent() {
    let Some(dir) = crate::compat::dossier_donnees() else { return };
    let journal = dir.join("forgechat.log");
    let echec = crate::compat::lancement_precedent_echoue();
    let Some(texte) = lire_fin(&journal) else { return };
    // Conservé à côté, et jamais renvoyé deux fois (un lancement depuis un
    // terminal ne réécrit pas le journal).
    let _ = std::fs::rename(&journal, dir.join("forgechat-precedent.log"));
    let erreurs = ["Processus d'affichage WebKit arrêté", "Chargement échoué", "EGL", "panicked"]
        .iter()
        .any(|m| texte.contains(m))
        || texte.lines().any(|l| l.contains("CONSOLE") && l.contains("ERROR"));
    if !echec && !erreurs {
        return;
    }
    let (kind, quoi) = if echec {
        ("startup_failure", "Lancement précédent sans premier rendu")
    } else {
        ("desktop_log", "Erreurs dans le journal du lancement précédent")
    };
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "?".into());
    let message = format!("{quoi} — {} ; session {session} ; paquet {}", distribution(), paquet());
    envoyer("linux", kind, message, texte);
}

#[cfg(windows)]
fn fichier_panique() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|d| std::path::PathBuf::from(d).join("org.heiphaistos.forgechat").join("panique.log"))
}

/// Envoie la panique du lancement précédent, puis écrit les suivantes dans un
/// fichier (sans console, une panique Windows ne laisse aucune trace).
#[cfg(windows)]
pub fn surveiller_paniques() {
    let Some(fichier) = fichier_panique() else { return };
    if let Some(texte) = lire_fin(&fichier) {
        let _ = std::fs::remove_file(&fichier);
        let premiere = texte.lines().next().unwrap_or("").chars().take(300).collect::<String>();
        envoyer("windows", "desktop_log", format!("Plantage de l'application : {premiere}"), texte);
    }
    let defaut = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(parent) = fichier.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let trace = std::backtrace::Backtrace::force_capture();
        let _ = std::fs::write(
            &fichier,
            format!("{info}\nversion {}\n{trace}", env!("CARGO_PKG_VERSION")),
        );
        defaut(info);
    }));
}

/// Journal de l'app de bureau, pour « Signaler un problème ». Linux seulement
/// (le journal du lancement courant, sinon celui du précédent) ; `None` ailleurs.
#[tauri::command]
pub fn read_desktop_log() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let dir = crate::compat::dossier_donnees()?;
        lire_fin(&dir.join("forgechat.log")).or_else(|| lire_fin(&dir.join("forgechat-precedent.log")))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}
