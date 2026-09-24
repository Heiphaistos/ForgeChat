//! Mode compatibilité Linux.
//!
//! Sur certaines machines (NVIDIA propriétaire sous Wayland, GPU hybrides,
//! pilotes anciens), WebKitGTK n'affiche qu'une fenêtre BLANCHE : le même
//! paquet s'affiche pourtant normalement dans Fedora 42 et Ubuntu 22.04 en
//! rendu logiciel. Ce mode force ce qui marche partout : X11 (XWayland),
//! rendu OpenGL logiciel, synchronisation explicite NVIDIA désactivée.
//!
//! Il s'active :
//! - avec `--safe-mode` ou `FORGECHAT_SAFE_MODE=1` (raccourci « ForgeChat
//!   (mode compatibilité) » installé par le .deb et le .rpm) ;
//! - tout seul, si le lancement précédent n'a jamais affiché l'interface (le
//!   client appelle `app_ready` après son premier rendu) ; le choix est alors
//!   retenu pour les lancements suivants ;
//! - depuis l'icône de la zone de notification, visible même fenêtre blanche.
use std::path::PathBuf;

const EN_COURS: &str = "lancement-en-cours";
const ACTIF: &str = "mode-compatibilite";

fn dossier() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .map(|d| d.join("forgechat"))
}

pub fn actif() -> bool {
    dossier().is_some_and(|d| d.join(ACTIF).exists())
}

/// Active ou retire le mode pour les prochains lancements.
pub fn definir(on: bool) {
    let Some(d) = dossier() else { return };
    let _ = std::fs::create_dir_all(&d);
    if on {
        let _ = std::fs::write(d.join(ACTIF), "manuel");
    } else {
        let _ = std::fs::remove_file(d.join(ACTIF));
    }
    let _ = std::fs::remove_file(d.join(EN_COURS));
}

/// À appeler avant toute initialisation GTK. Renvoie vrai si le mode est actif.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn preparer() -> bool {
    let force = std::env::args().any(|a| a == "--safe-mode")
        || std::env::var_os("FORGECHAT_SAFE_MODE").is_some_and(|v| v != "0");
    let mut on = force;
    if let Some(d) = dossier() {
        let _ = std::fs::create_dir_all(&d);
        if d.join(ACTIF).exists() {
            on = true;
        } else if d.join(EN_COURS).exists() {
            // Le lancement précédent n'a jamais signalé son premier rendu.
            on = true;
            let _ = std::fs::write(d.join(ACTIF), "auto");
        }
        let _ = std::fs::write(d.join(EN_COURS), "");
    }
    if on {
        for (k, v) in [
            ("GDK_BACKEND", "x11"),
            ("LIBGL_ALWAYS_SOFTWARE", "1"),
            ("__NV_DISABLE_EXPLICIT_SYNC", "1"),
        ] {
            if std::env::var_os(k).is_none() {
                std::env::set_var(k, v);
            }
        }
        eprintln!("[ForgeChat] Mode compatibilité actif (X11 + rendu logiciel).");
    }
    on
}

/// Le client a affiché son premier écran : ce lancement a réussi.
#[tauri::command]
pub fn app_ready() {
    if let Some(d) = dossier() {
        let _ = std::fs::remove_file(d.join(EN_COURS));
    }
}

/// Au changement de version, vide les caches de WebKitGTK (cache HTTP, stockage
/// des service workers). Une page d'accueil périmée servie depuis ces caches
/// réclame des fichiers qui n'existent plus dans la nouvelle version : page
/// blanche. Même cause que la fenêtre vide corrigée sous Windows en 3.25.0.
/// La session et les réglages (`localstorage`, `storage`) sont conservés.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn purger_caches_si_nouvelle_version() {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return };
    let donnees = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"))
        .join("org.heiphaistos.forgechat");
    let caches = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".cache"))
        .join("org.heiphaistos.forgechat");
    let version = env!("CARGO_PKG_VERSION");
    let temoin = donnees.join("version-caches");
    if std::fs::read_to_string(&temoin).ok().as_deref() == Some(version) {
        return;
    }
    for d in [
        donnees.join("CacheStorage"),
        donnees.join("WebKitCache"),
        donnees.join("serviceworkers"),
        donnees.join("storage").join("serviceworkers"),
        caches.clone(),
    ] {
        if d.exists() {
            match std::fs::remove_dir_all(&d) {
                Ok(()) => eprintln!("[ForgeChat] Cache WebKit purgé : {}", d.display()),
                Err(e) => eprintln!("[ForgeChat] Purge impossible ({}) : {e}", d.display()),
            }
        }
    }
    let _ = std::fs::create_dir_all(&donnees);
    let _ = std::fs::write(&temoin, version);
}

/// Lancée depuis le menu des applications, l'app n'a pas de terminal : ses
/// erreurs et celles de WebKit (processus enfants, qui héritent du descripteur)
/// partent dans `~/.local/share/org.heiphaistos.forgechat/forgechat.log`,
/// réécrit à chaque lancement. Depuis un terminal, rien ne change.
#[cfg(target_os = "linux")]
pub fn journal_si_pas_de_terminal() {
    use std::os::fd::AsRawFd;
    // SAFETY: isatty lit seulement l'état du descripteur 2.
    if unsafe { libc::isatty(2) } == 1 {
        return;
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return };
    let dir = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"))
        .join("org.heiphaistos.forgechat");
    let _ = std::fs::create_dir_all(&dir);
    let Ok(f) = std::fs::File::create(dir.join("forgechat.log")) else { return };
    // SAFETY: dup2 remplace stdout/stderr par un fichier ouvert, possédé par `f`
    // jusqu'ici ; les descripteurs 1 et 2 restent valides après sa fermeture.
    unsafe {
        libc::dup2(f.as_raw_fd(), 1);
        libc::dup2(f.as_raw_fd(), 2);
    }
    eprintln!("[ForgeChat] {} — journal de démarrage", env!("CARGO_PKG_VERSION"));
}
