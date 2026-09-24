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
