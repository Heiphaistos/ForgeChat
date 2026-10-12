//! Réglages « Système » de l'application de bureau : démarrage avec l'ordinateur,
//! bouton fermer, accélération matérielle, téléchargements (boîte « Enregistrer
//! sous »), icône d'application personnalisée, détection d'un logiciel de stream
//! et de GhostHandDesk (support à distance).
//!
//! Tout tient dans un petit fichier JSON du dossier de configuration de l'appli,
//! lu AVANT la création de la WebView (l'accélération matérielle se règle par
//! variable d'environnement, impossible à changer ensuite).
//!
//! Sécurité des écritures : le front ne donne jamais de chemin. `save_file`
//! écrit soit à l'endroit choisi dans la boîte native, soit dans le dossier par
//! défaut lui-même choisi dans une boîte native (`pick_download_dir`), sous un
//! nom de fichier nettoyé. `reveal_saved` n'ouvre que des fichiers écrits ainsi.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{image::Image, ipc::InvokeBody, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const FICHIER: &str = "systeme.json";
const ICONE: &str = "icone-perso.png";
/// Argument passé par le lancement automatique (`--autostart`) : « démarrer réduit ».
pub const ARG_AUTOSTART: &str = "--autostart";
const ICONE_MAX_OCTETS: usize = 1024 * 1024;
const ICONE_MAX_COTE: u32 = 512;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Fermer (X) : réduire dans la zone de notification au lieu de quitter.
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub hardware_acceleration: bool,
    /// Toujours demander où enregistrer (sinon : dossier par défaut).
    pub ask_save: bool,
    pub download_dir: Option<String>,
    /// Icône choisie (`preset:12`, `custom`) ; None = icône d'origine.
    pub icon: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_minimized: false,
            hardware_acceleration: true,
            ask_save: true,
            download_dir: None,
            icon: None,
        }
    }
}

/// Dossier de configuration de l'appli (le même que Tauri : `<config>/<identifiant>`),
/// calculé sans `AppHandle` puisqu'il sert avant la création de l'application.
fn dossier() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.map(|b| b.join("org.heiphaistos.forgechat"))
}

fn etat() -> &'static Mutex<Config> {
    static ETAT: OnceLock<Mutex<Config>> = OnceLock::new();
    ETAT.get_or_init(|| {
        let cfg = dossier()
            .and_then(|d| std::fs::read_to_string(d.join(FICHIER)).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Mutex::new(cfg)
    })
}

pub fn config() -> Config {
    etat().lock().map(|c| c.clone()).unwrap_or_default()
}

fn modifier(f: impl FnOnce(&mut Config)) -> Result<Config, String> {
    let mut cfg = etat().lock().map_err(|_| "réglages verrouillés".to_string())?;
    f(&mut cfg);
    let dir = dossier().ok_or("dossier de configuration introuvable")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(FICHIER), json).map_err(|e| e.to_string())?;
    Ok(cfg.clone())
}

#[derive(Serialize)]
pub struct Etat {
    #[serde(flatten)]
    config: Config,
    autostart: bool,
    /// `windows`, `linux`, `macos` : le front masque ce qui n'existe pas sur l'OS.
    platform: &'static str,
}

#[tauri::command]
pub async fn system_get(app: AppHandle) -> Etat {
    use tauri_plugin_autostart::ManagerExt;
    Etat {
        config: config(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        platform: std::env::consts::OS,
    }
}

/// Réglages modifiables depuis le front (jamais le dossier ni l'icône, qui ont leurs commandes).
#[derive(Deserialize)]
pub struct Patch {
    close_to_tray: Option<bool>,
    start_minimized: Option<bool>,
    hardware_acceleration: Option<bool>,
    ask_save: Option<bool>,
}

#[tauri::command]
pub async fn system_set(patch: Patch) -> Result<Config, String> {
    modifier(|c| {
        if let Some(v) = patch.close_to_tray { c.close_to_tray = v }
        if let Some(v) = patch.start_minimized { c.start_minimized = v }
        if let Some(v) = patch.hardware_acceleration { c.hardware_acceleration = v }
        if let Some(v) = patch.ask_save { c.ask_save = v }
    })
}

#[tauri::command]
pub async fn system_set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    al.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

// ── Téléchargements ─────────────────────────────────────────────────────────

fn saved() -> &'static Mutex<HashSet<PathBuf>> {
    static SAVED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SAVED.get_or_init(Default::default)
}

/// `%XX` → octets (le nom passe par un en-tête HTTP, donc en `encodeURIComponent`).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Nom de fichier sûr : dernier composant seulement, sans caractère interdit sous
/// Windows ni nom réservé, 150 caractères au plus.
fn nom_sur(nom: &str) -> String {
    let base = nom.rsplit(['/', '\\']).next().unwrap_or("");
    let propre: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .take(150)
        .collect();
    let propre = propre.trim().trim_matches('.').trim().to_string();
    let souche = propre.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserve = ["CON", "PRN", "AUX", "NUL"].contains(&souche.as_str())
        || ((souche.starts_with("COM") || souche.starts_with("LPT")) && souche.len() == 4);
    if propre.is_empty() || reserve { format!("fichier-{propre}") } else { propre }
}

/// `nom.ext` existe déjà → `nom (1).ext`, `nom (2).ext`…
fn chemin_libre(dir: &Path, nom: &str) -> PathBuf {
    let p = dir.join(nom);
    if !p.exists() {
        return p;
    }
    let (souche, ext) = match nom.rfind('.') {
        Some(i) if i > 0 => (&nom[..i], &nom[i..]),
        _ => (nom, ""),
    };
    (1..10_000)
        .map(|n| dir.join(format!("{souche} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(p)
}

/// Extensions qui s'exécutent ou s'interprètent à l'ouverture (Windows, macOS, Linux).
const EXTENSIONS_EXECUTABLES: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msix", "msp", "appx", "appxbundle", "ps1", "psm1",
    "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "cpl", "lnk", "url", "reg", "inf", "scf", "jar",
    "dll", "sys", "iso", "img", "vhd", "vhdx", "chm", "xll", "app", "command", "pkg", "dmg", "sh",
    "run", "appimage", "deb", "rpm", "desktop", "py", "pl", "bash", "zsh", "fish", "flatpak", "flatpakref",
    "snap",
];

fn extension_executable(nom: &str) -> bool {
    // Paquet pacman (Arch, Omarchy) : double extension `.pkg.tar.zst`, `.pkg.tar.xz`…
    nom.to_ascii_lowercase().contains(".pkg.tar.")
        || nom
            .rsplit_once('.')
            .map(|(_, ext)| EXTENSIONS_EXECUTABLES.contains(&ext.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
}

/// « Téléchargé d'Internet » : sous Windows le flux `Zone.Identifier` (ZoneId=3), que SmartScreen
/// et Office lisent avant d'ouvrir le fichier ; sous macOS l'attribut `com.apple.quarantine`
/// (Gatekeeper). Un fichier reçu d'un autre membre n'est jamais traité comme local. Sans effet
/// (et sans erreur) sur un système de fichiers qui ne les connaît pas.
fn marquer_provenance(chemin: &Path) {
    #[cfg(windows)]
    {
        let mut flux = chemin.as_os_str().to_os_string();
        flux.push(":Zone.Identifier");
        let _ = std::fs::write(PathBuf::from(flux), "[ZoneTransfer]\r\nZoneId=3\r\n");
    }
    #[cfg(target_os = "macos")]
    {
        let horodatage = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = std::process::Command::new("/usr/bin/xattr")
            .arg("-w")
            .arg("com.apple.quarantine")
            .arg(format!("0081;{horodatage:x};ForgeChat;"))
            .arg(chemin)
            .status();
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = chemin;
}

/// Enregistre les octets reçus (corps brut de l'invocation, nom dans `x-file-name`).
/// Renvoie le chemin écrit, ou None si l'utilisateur a annulé la boîte.
#[tauri::command]
pub async fn save_file(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(octets) = request.body() else {
        return Err("corps binaire attendu".into());
    };
    let nom = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let nom = nom_sur(&nom);
    let octets = octets.clone();
    let cfg = config();
    let dir_defaut = cfg.download_dir.map(PathBuf::from).filter(|d| d.is_dir());
    let fenetre = app.get_webview_window("main");

    let chemin = tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, String> {
        let chemin = match dir_defaut {
            // Un exécutable n'est jamais déposé sans que l'utilisateur choisisse où.
            Some(dir) if !cfg.ask_save && !extension_executable(&nom) => chemin_libre(&dir, &nom),
            dir => {
                let mut boite = app.dialog().file().set_file_name(&nom);
                if let Some(d) = dir {
                    boite = boite.set_directory(d);
                }
                if let Some(w) = &fenetre {
                    boite = boite.set_parent(w);
                }
                match boite.blocking_save_file() {
                    Some(p) => p.into_path().map_err(|e| e.to_string())?,
                    None => return Ok(None),
                }
            }
        };
        std::fs::write(&chemin, &octets).map_err(|e| format!("{}: {e}", chemin.display()))?;
        marquer_provenance(&chemin);
        Ok(Some(chemin))
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(chemin.map(|p| {
        if let Ok(mut s) = saved().lock() {
            s.insert(p.clone());
        }
        p.display().to_string()
    }))
}

/// Ouvre le dossier d'un fichier enregistré par `save_file` (et seulement ceux-là).
#[tauri::command]
pub async fn reveal_saved(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !saved().lock().map(|s| s.contains(&p)).unwrap_or(false) {
        return Err("fichier inconnu".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", p.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg("-R").arg(&p).spawn().map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(p.parent().unwrap_or(Path::new("/")))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Choisit le dossier par défaut dans une boîte native. None = annulé.
#[tauri::command]
pub async fn pick_download_dir(app: AppHandle) -> Result<Option<String>, String> {
    let fenetre = app.get_webview_window("main");
    let app2 = app.clone();
    let choix = tauri::async_runtime::spawn_blocking(move || {
        let mut boite = app2.dialog().file();
        if let Some(w) = &fenetre {
            boite = boite.set_parent(w);
        }
        boite.blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(dir) = choix else { return Ok(None) };
    let dir = dir.into_path().map_err(|e| e.to_string())?.display().to_string();
    modifier(|c| c.download_dir = Some(dir.clone()))?;
    Ok(Some(dir))
}

#[tauri::command]
pub async fn clear_download_dir() -> Result<(), String> {
    modifier(|c| c.download_dir = None).map(|_| ())
}

// ── Icône d'application ─────────────────────────────────────────────────────

/// Icône personnalisée en cours (lue par l'animation de la zone de notification).
fn icone() -> &'static Mutex<Option<Image<'static>>> {
    static ICONE_ACTIVE: OnceLock<Mutex<Option<Image<'static>>>> = OnceLock::new();
    ICONE_ACTIVE.get_or_init(Default::default)
}

pub fn icone_perso_active() -> bool {
    icone().lock().map(|i| i.is_some()).unwrap_or(false)
}

/// PNG carré, 16 à 512 px, 1 Mo au plus.
fn decoder_icone(octets: &[u8]) -> Result<Image<'static>, String> {
    if octets.len() > ICONE_MAX_OCTETS || !octets.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("PNG de 1 Mo au plus attendu".into());
    }
    let img = Image::from_bytes(octets).map_err(|e| e.to_string())?.to_owned();
    let (w, h) = (img.width(), img.height());
    if w != h || !(16..=ICONE_MAX_COTE).contains(&w) {
        return Err(format!("icône carrée de 16 à {ICONE_MAX_COTE} px attendue ({w}x{h})"));
    }
    Ok(img)
}

/// Pose l'icône (ou l'icône d'origine si None) sur la fenêtre, la barre des tâches
/// et la zone de notification. À appeler sur le thread principal.
fn appliquer_icone(app: &AppHandle, img: Option<Image<'static>>) {
    if let Ok(mut i) = icone().lock() {
        *i = img.clone();
    }
    let img = img.or_else(|| app.default_window_icon().map(|i| i.clone().to_owned()));
    let Some(img) = img else { return };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_icon(img.clone());
    }
    // Icône d'origine sous Windows/macOS : l'animation reprend d'elle-même.
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_icon(Some(img));
    }
}

/// Au démarrage : réapplique l'icône enregistrée.
pub fn restaurer_icone(app: &AppHandle) {
    if config().icon.is_none() {
        return;
    }
    let img = dossier()
        .and_then(|d| std::fs::read(d.join(ICONE)).ok())
        .and_then(|o| decoder_icone(&o).ok());
    if img.is_some() {
        appliquer_icone(app, img);
    }
}

/// Corps brut = PNG de l'icône (vide = icône d'origine) ; `x-icon-id` = choix affiché.
#[tauri::command]
pub async fn set_app_icon(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(octets) = request.body() else {
        return Err("corps binaire attendu".into());
    };
    let id = request
        .headers()
        .get("x-icon-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty() && v.len() <= 32 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == ':'))
        .map(str::to_string);
    let dir = dossier().ok_or("dossier de configuration introuvable")?;
    let img = if octets.is_empty() || id.is_none() {
        let _ = std::fs::remove_file(dir.join(ICONE));
        modifier(|c| c.icon = None)?;
        None
    } else {
        let img = decoder_icone(octets)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(ICONE), octets).map_err(|e| e.to_string())?;
        modifier(|c| c.icon = id)?;
        Some(img)
    };
    let handle = app.clone();
    app.run_on_main_thread(move || appliquer_icone(&handle, img)).map_err(|e| e.to_string())
}

// ── Logiciel de stream ──────────────────────────────────────────────────────

/// Exécutables de logiciels de diffusion (nom sans extension, en minuscules).
const STREAMING_EXES: &[&str] = &[
    "obs64", "obs32", "obs", "obs-studio", "streamlabs obs", "streamlabs desktop", "streamlabs",
    "xsplit.core", "xsplitbroadcaster", "xsplit", "twitchstudio", "prismlivestudio", "vmix64", "vmix",
];

fn est_logiciel_de_stream(nom: &str) -> bool {
    let nom = nom.to_lowercase();
    let souche = nom.strip_suffix(".exe").unwrap_or(&nom);
    STREAMING_EXES.contains(&souche)
}

/// Un logiciel de stream (OBS, Streamlabs, XSplit…) est-il lancé ? Pour le mode streamer.
#[tauri::command]
pub async fn streaming_software_running() -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
    tauri::async_runtime::spawn_blocking(|| {
        let kind = ProcessRefreshKind::nothing();
        let mut sys = System::new_with_specifics(RefreshKind::nothing().with_processes(kind));
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        sys.processes().values().any(|p| est_logiciel_de_stream(&p.name().to_string_lossy()))
    })
    .await
    .unwrap_or(false)
}

/// GhostHandDesk installé (support à distance) : son lien `ghosthanddesk://`, inscrit par
/// l'appli à chaque lancement (HKCU), pointe vers un exécutable présent. Sans lui,
/// l'ouverture du lien échoue sans rien montrer : le front propose alors le téléchargement.
/// Hors Windows, GhostHandDesk n'existe pas.
#[tauri::command]
pub async fn ghd_installed() -> bool {
    #[cfg(windows)]
    {
        lire_hkcu_defaut(r"Software\Classes\ghosthanddesk\shell\open\command")
            .and_then(|c| exe_de_commande(&c))
            .is_some_and(|exe| Path::new(&exe).is_file())
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Valeur par défaut (REG_SZ) d'une clé de HKEY_CURRENT_USER.
#[cfg(windows)]
fn lire_hkcu_defaut(sous_cle: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let cle: Vec<u16> = sous_cle.encode_utf16().chain(Some(0)).collect();
    let mut buf = [0u16; 2048];
    let mut taille = (buf.len() * 2) as u32;
    // SAFETY : clé terminée par NUL ; tampon et taille (en octets) cohérents ; nom NULL = valeur par défaut.
    let statut = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            cle.as_ptr(),
            std::ptr::null(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut taille,
        )
    };
    if statut != 0 {
        return None;
    }
    let n = (taille as usize / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buf[..n]))
}

/// Exécutable d'une commande `shell\open\command` : `"C:\…\ghd.exe" "%1"` → `C:\…\ghd.exe`.
#[cfg_attr(not(windows), allow(dead_code))]
fn exe_de_commande(commande: &str) -> Option<String> {
    let commande = commande.trim();
    let exe = match commande.strip_prefix('"') {
        Some(reste) => reste.split('"').next()?,
        None => commande.split_whitespace().next()?,
    };
    (!exe.is_empty()).then(|| exe.to_string())
}

#[cfg(test)]
mod tests {

    #[test]
    fn executables_reconnus() {
        for n in ["setup.EXE", "facture.pdf.lnk", "a.ps1", "x.AppImage", "photo.scr", "maj-1.0-1-x86_64.pkg.tar.zst", "a.PKG.TAR.XZ", "x.flatpakref"] {
            assert!(super::extension_executable(n), "{n}");
        }
        for n in ["photo.png", "doc.pdf", "notes.txt", "sans-extension", "archive.zip", "sauvegarde.tar.zst"] {
            assert!(!super::extension_executable(n), "{n}");
        }
    }

    use super::*;

    #[test]
    fn exe_du_lien_ghosthanddesk() {
        assert_eq!(
            exe_de_commande(r#""C:\Users\a b\GhostHandDesk.exe" "%1""#).as_deref(),
            Some(r"C:\Users\a b\GhostHandDesk.exe")
        );
        assert_eq!(exe_de_commande(r"C:\ghd.exe %1").as_deref(), Some(r"C:\ghd.exe"));
        assert_eq!(exe_de_commande(r#""" "%1""#), None);
        assert_eq!(exe_de_commande("  "), None);
    }

    #[test]
    fn decode_les_noms() {
        assert_eq!(percent_decode("caf%C3%A9%20%281%29.txt"), "café (1).txt");
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("é%"), "é%");
    }

    #[test]
    fn nettoie_les_noms() {
        assert_eq!(nom_sur("../../Windows/system32/x.dll"), "x.dll");
        assert_eq!(nom_sur(r"..\..\a:b?.txt"), "a_b_.txt");
        assert_eq!(nom_sur("CON.txt"), "fichier-CON.txt");
        assert_eq!(nom_sur(".."), "fichier-");
        assert_eq!(nom_sur("rapport.pdf"), "rapport.pdf");
    }

    #[test]
    fn trouve_un_nom_libre() {
        let dir = std::env::temp_dir().join(format!("fc-systeme-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        assert_eq!(chemin_libre(&dir, "a.txt"), dir.join("a (1).txt"));
        assert_eq!(chemin_libre(&dir, "b.txt"), dir.join("b.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconnait_les_logiciels_de_stream() {
        assert!(est_logiciel_de_stream("obs64.exe"));
        assert!(est_logiciel_de_stream("Streamlabs OBS.exe"));
        assert!(est_logiciel_de_stream("obs"));
        assert!(!est_logiciel_de_stream("chrome.exe"));
    }

    #[test]
    fn refuse_les_icones_invalides() {
        assert!(decoder_icone(b"pas un png").is_err());
        let png = include_bytes!("../icons/32x32.png");
        assert!(decoder_icone(png).is_ok());
    }
}
