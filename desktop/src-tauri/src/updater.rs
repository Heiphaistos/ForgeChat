//! Mise à jour automatique de ForgeChat Desktop — les DEUX canaux.
//!
//! ## Pourquoi pas `tauri-plugin-updater`
//!
//! Le plugin officiel ne couvre pas ce que Momo demande :
//!
//! - il ne connaît sous Windows que `WindowsUpdaterType::Nsis` et `::Msi` : il
//!   lance un installeur puis quitte. **Une copie portable n'a pas
//!   d'installeur — elle EST le fichier.** Il n'existe aucun chemin « remplacer
//!   l'exécutable sur place » (constat déjà fait et documenté sur Nitrite) ;
//! - côté Linux il sait mettre à jour un AppImage mais pas un `.deb` ;
//! - il impose `createUpdaterArtifacts: true`, donc une clé minisign présente
//!   à CHAQUE build : l'oublier fait échouer `tauri build`.
//!
//! Ce module fait donc le travail à la main, sur le modèle de
//! `updater_portable.rs` de Nitrite, mais pour les quatre cibles à la fois.
//!
//! ## Ce qui protège l'utilisateur
//!
//! **Rien n'est installé sans une empreinte SIGNÉE.** Chaque release porte
//! `SHA256SUMS.txt` et sa signature Ed25519 `SHA256SUMS.txt.sig`, faite hors
//! ligne par `scripts/release-sign.mjs` : la clé privée n'est ni sur GitHub ni
//! sur le VPS. La clé publique est codée en dur ci-dessous ([`CLE_PUBLIQUE`]).
//!
//! Le client télécharge ces deux fichiers depuis [`BASE_TELECHARGEMENT`],
//! vérifie la signature, puis compare le SHA-256 du binaire téléchargé à la
//! ligne SIGNÉE qui porte son nom. L'empreinte du manifeste n'est qu'un
//! indice : un serveur compromis peut la changer, pas la signature. Le nom du
//! fichier doit porter la version annoncée, ce qui empêche de resservir une
//! ancienne release signée sous un numéro plus récent.
//!
//! L'URL de l'artefact doit commencer par [`BASE_TELECHARGEMENT`] ; la variable
//! `FORGECHAT_UPDATE_ENDPOINT` n'existe qu'en build de debug (audit M9).
//!
//! ## Aucune version codée en dur
//!
//! La version courante est `CARGO_PKG_VERSION` (donc `Cargo.toml`, aligné sur
//! `tauri.conf.json`). La version disponible vient du serveur. Aucun littéral
//! de version n'apparaît dans ce fichier.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

/// Manifeste interrogé. Surchargeable par `FORGECHAT_UPDATE_ENDPOINT` en debug
/// seulement, pour tester contre un serveur local.
const ENDPOINT: &str = "https://forgechat.heiphaistos.org/api/desktop/latest";

/// Seul dossier d'où un artefact ou ses empreintes peuvent être téléchargés.
const BASE_TELECHARGEMENT: &str = "https://forgechat.heiphaistos.org/desktop/";

/// Clé publique Ed25519 de signature des releases (`deploy/release-signing-public.pem`).
/// Empreinte SHA-256 : e43061229a0116ef3f024c6b72fa26bb9e74c01834782e9f3229cf154ae7c2b6
const CLE_PUBLIQUE: [u8; 32] = [
    0x5e, 0x48, 0xbc, 0xa5, 0xdb, 0xe6, 0x27, 0x88, 0x3a, 0x0a, 0xc0, 0x1f, 0xfc, 0xf4, 0xc1, 0x9d,
    0x99, 0x57, 0x1b, 0x74, 0xfb, 0xb7, 0xb0, 0x4e, 0x5d, 0x40, 0xe3, 0x60, 0xb2, 0xf8, 0x4e, 0xc8,
];

/// SHA256SUMS.txt et sa signature font quelques centaines d'octets.
const TAILLE_MAX_SOMMES: u64 = 64 * 1024;


/// L'installeur NSIS pèse ~12 Mo, l'AppImage ~90 Mo. Au-delà de 300 Mo ce n'est
/// pas un artefact ForgeChat : on s'arrête avant de remplir le disque.
const TAILLE_MAX: u64 = 300 * 1024 * 1024;

/// Évènement de progression émis vers le front pendant le téléchargement.
const EVT_PROGRES: &str = "update://progress";

// ─────────────────────────── Manifeste ───────────────────────────

#[derive(Debug, Deserialize)]
struct Artefact {
    url: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
struct Manifeste {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    pub_date: String,
    #[serde(default)]
    platforms: std::collections::HashMap<String, Artefact>,
}

/// Ce que le front reçoit, et qu'il renvoie tel quel à `update_install`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: String,
    pub pub_date: String,
    /// Cible retenue : `windows-x86_64`, `windows-portable`, `linux-x86_64`,
    /// `linux-portable`. Affiché dans l'UI pour que l'utilisateur sache quel
    /// chemin va être pris.
    pub target: String,
    /// Vrai quand la mise à jour remplace l'exécutable sur place (pas
    /// d'installeur, pas d'UAC).
    pub portable: bool,
    url: String,
    sha256: String,
}

#[derive(Clone, Serialize)]
struct Progres {
    downloaded: u64,
    total: u64,
}

// ─────────────────────── Détection du mode ───────────────────────

fn exe_courant() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("exécutable introuvable : {e}"))
}

/// Vrai quand cette copie a été posée par un installeur.
///
/// - Windows : témoin `uninstall.exe`, écrit à côté de l'exécutable par le
///   script NSIS généré par Tauri (`WriteUninstaller "$INSTDIR\uninstall.exe"`)
///   et par lui seul. Une copie portable ne l'a jamais.
/// - Linux : un AppImage annonce son propre chemin dans `$APPIMAGE` — c'est un
///   fichier unique déplaçable, donc portable. Sinon, un binaire installé par
///   le `.deb` vit sous `/usr` ou `/opt` ; ailleurs, c'est une copie posée à la
///   main, traitée comme portable.
fn est_installee() -> bool {
    let Ok(exe) = exe_courant() else {
        return false;
    };

    #[cfg(windows)]
    {
        return exe
            .parent()
            .map(|p| p.join("uninstall.exe").is_file())
            .unwrap_or(false);
    }

    #[cfg(not(windows))]
    {
        if std::env::var_os("APPIMAGE").is_some() {
            return false;
        }
        return exe.starts_with("/usr") || exe.starts_with("/opt");
    }
}

/// Copie installée par le gestionnaire de paquets RPM (Fedora, openSUSE,
/// RHEL) : il lui faut le `.rpm`, pas le `.deb`.
fn installee_par_rpm() -> bool {
    let Ok(exe) = exe_courant() else {
        return false;
    };
    std::process::Command::new("rpm")
        .arg("-qf")
        .arg(&exe)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Cible du manifeste correspondant à cette copie.
fn cible() -> &'static str {
    let installee = est_installee();
    if cfg!(windows) {
        if installee {
            "windows-x86_64"
        } else {
            "windows-portable"
        }
    } else if installee && installee_par_rpm() {
        "linux-rpm"
    } else if installee {
        "linux-x86_64"
    } else {
        "linux-portable"
    }
}

/// Le fichier que le chemin portable doit remplacer. Pour un AppImage c'est
/// `$APPIMAGE` (le `.AppImage` lui-même), pas le binaire extrait dans /tmp que
/// `current_exe()` renvoie.
fn cible_portable() -> Result<PathBuf, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(appimage));
    }
    exe_courant()
}

// ──────────────────────── Comparaison de versions ────────────────────────

/// `major.minor.patch`, sans dépendance `semver` : les versions de ForgeChat
/// n'ont ni pré-release ni métadonnée.
fn triplet(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().split('.');
    let a = it.next()?.parse().ok()?;
    let b = it.next()?.parse().ok()?;
    let c = it.next()?.parse().ok()?;
    // Un 4e segment signifie un format qu'on ne sait pas comparer : on refuse.
    if it.next().is_some() {
        return None;
    }
    Some((a, b, c))
}

/// Un manifeste illisible ne déclenche JAMAIS de mise à jour.
fn plus_recente(distante: &str, locale: &str) -> bool {
    match (triplet(distante), triplet(locale)) {
        (Some(d), Some(l)) => d > l,
        _ => false,
    }
}

// ──────────────────────────── Réseau ────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("ForgeChat-Desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn endpoint() -> String {
    #[cfg(debug_assertions)]
    if let Ok(e) = std::env::var("FORGECHAT_UPDATE_ENDPOINT") {
        return e;
    }
    ENDPOINT.into()
}

// ──────────────────────────── Signature ────────────────────────────

/// Nom du fichier visé par `url`, à condition qu'il soit servi depuis
/// [`BASE_TELECHARGEMENT`], sans sous-dossier, et qu'il porte `version`.
fn nom_artefact<'a>(url: &'a str, version: &str) -> Result<&'a str, String> {
    let nom = url
        .strip_prefix(BASE_TELECHARGEMENT)
        .ok_or_else(|| format!("artefact hors de {BASE_TELECHARGEMENT} : mise à jour refusée"))?;
    let valide = !nom.is_empty()
        && nom.len() <= 120
        && !nom.starts_with('.')
        && nom
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    if !valide {
        return Err("nom d'artefact refusé".into());
    }
    if !(nom.contains(&format!("v{version}-")) || nom.contains(&format!("v{version}."))) {
        return Err(format!(
            "l'artefact {nom} ne porte pas la version {version} : mise à jour refusée"
        ));
    }
    Ok(nom)
}

/// ── La garde qui compte ──────────────────────────────────────────
/// Vérifie la signature Ed25519 de `sommes` (SHA256SUMS.txt) par `cle`, puis
/// rend l'empreinte que la ligne SIGNÉE attribue à `nom`.
fn empreinte_signee(
    sommes: &[u8],
    signature_b64: &str,
    nom: &str,
    cle: &[u8; 32],
) -> Result<String, String> {
    use base64::Engine as _;
    use ed25519_dalek::{Signature, VerifyingKey};

    let refus = || {
        "signature de la mise à jour invalide : ce fichier n'a pas été publié par ForgeChat. \
         Mise à jour annulée."
            .to_string()
    };
    let octets = base64::engine::general_purpose::STANDARD
        .decode(signature_b64.trim())
        .map_err(|_| refus())?;
    let signature = Signature::from_slice(&octets).map_err(|_| refus())?;
    VerifyingKey::from_bytes(cle)
        .and_then(|k| k.verify_strict(sommes, &signature))
        .map_err(|_| refus())?;

    let texte = std::str::from_utf8(sommes).map_err(|_| refus())?;
    texte
        .lines()
        .filter_map(|l| l.split_once(' '))
        .find(|(_, n)| n.trim_start_matches([' ', '*']) == nom)
        .map(|(h, _)| h.to_ascii_lowercase())
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| format!("{nom} absent de la liste signée : mise à jour refusée"))
}

/// Télécharge SHA256SUMS.txt et sa signature pour `version`, et rend
/// l'empreinte signée de `nom`.
async fn empreinte_publiee(version: &str, nom: &str) -> Result<String, String> {
    let sommes_url = format!("{BASE_TELECHARGEMENT}desktop-v{version}.SHA256SUMS.txt");
    let sommes = telecharger(&sommes_url, TAILLE_MAX_SOMMES, |_, _| {}).await?;
    let signature = telecharger(&format!("{sommes_url}.sig"), TAILLE_MAX_SOMMES, |_, _| {}).await?;
    let signature = String::from_utf8(signature).map_err(|_| "signature illisible".to_string())?;
    empreinte_signee(&sommes, &signature, nom, &CLE_PUBLIQUE)
}

// ──────────────────────────── Commandes ────────────────────────────

/// Interroge le manifeste. `Ok(None)` = rien de neuf, et c'est le cas normal.
#[tauri::command]
pub async fn update_check() -> Result<Option<UpdateInfo>, String> {
    let actuelle = env!("CARGO_PKG_VERSION");

    let reponse = client()?
        .get(endpoint())
        .send()
        .await
        .map_err(|e| format!("canal de mise à jour injoignable : {e}"))?;

    // 204 = aucune release publiée. Rien à signaler.
    if reponse.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    let texte = reponse
        .error_for_status()
        .map_err(|e| format!("canal de mise à jour en erreur : {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let manifeste: Manifeste =
        serde_json::from_str(&texte).map_err(|e| format!("manifeste illisible : {e}"))?;

    let info = choisir_artefact(&manifeste, cible(), actuelle)?;
    *derniere_proposee()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = info.clone();
    Ok(info)
}

/// Dernière mise à jour proposée par `update_check`, gardée côté Rust (audit D3) :
/// `update_install` n'installe que celle-ci, jamais la cible, le mode portable ou
/// l'URL renvoyés par le front.
fn derniere_proposee() -> &'static std::sync::Mutex<Option<UpdateInfo>> {
    static DERNIERE: std::sync::Mutex<Option<UpdateInfo>> = std::sync::Mutex::new(None);
    &DERNIERE
}


/// Décide, hors réseau, si le manifeste justifie une mise à jour pour `target`.
/// Séparé d'`update_check` uniquement pour être testable sans serveur.
fn choisir_artefact(
    manifeste: &Manifeste,
    target: &str,
    actuelle: &str,
) -> Result<Option<UpdateInfo>, String> {
    if !plus_recente(&manifeste.version, actuelle) {
        return Ok(None);
    }

    let artefact = manifeste
        .platforms
        .get(target)
        .ok_or_else(|| format!("aucun artefact publié pour {target}"))?;

    if artefact.sha256.trim().is_empty() {
        return Err(format!(
            "l'artefact {target} est publié sans empreinte SHA-256 : mise à jour refusée"
        ));
    }
    nom_artefact(&artefact.url, &manifeste.version)?;

    Ok(Some(UpdateInfo {
        version: manifeste.version.clone(),
        current_version: actuelle.to_string(),
        notes: manifeste.notes.clone(),
        pub_date: manifeste.pub_date.clone(),
        portable: target.ends_with("-portable"),
        target: target.to_string(),
        url: artefact.url.clone(),
        sha256: artefact.sha256.clone(),
    }))
}

/// Échoue AVANT le téléchargement si le dossier n'accepte pas l'écriture —
/// Program Files sans élévation, clé USB en lecture seule, montage `ro`.
/// Un échec silencieux laisserait l'utilisateur croire qu'il est à jour.
fn verifier_dossier_inscriptible(fichier: &Path) -> Result<(), String> {
    let dossier = fichier
        .parent()
        .ok_or_else(|| "dossier de l'application introuvable".to_string())?;

    let temoin = dossier.join(".forgechat-maj-test");
    match std::fs::write(&temoin, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&temoin);
            Ok(())
        }
        Err(e) => Err(format!(
            "Mise à jour impossible : le dossier « {} » n'accepte pas l'écriture ({e}).\n\n\
             Déplacez ForgeChat dans un dossier où vous avez les droits d'écriture \
             (par exemple vos Documents), ou relancez-le en tant qu'administrateur, \
             puis réessayez.",
            dossier.display()
        )),
    }
}

/// Télécharge `url` en mémoire (au plus `taille_max` octets), en signalant
/// l'avancement à `progres`. Ne vérifie rien : les gardes sont
/// `empreinte_signee` et `verifier_empreinte`.
async fn telecharger(
    url: &str,
    taille_max: u64,
    mut progres: impl FnMut(u64, u64),
) -> Result<Vec<u8>, String> {
    let mut reponse = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("téléchargement impossible : {e}"))?
        .error_for_status()
        .map_err(|e| format!("téléchargement refusé : {e}"))?;

    let total = reponse.content_length().unwrap_or(0);
    if total > taille_max {
        return Err(format!("artefact annoncé à {total} octets : refusé"));
    }

    let mut octets: Vec<u8> = Vec::with_capacity(total as usize);
    while let Some(morceau) = reponse
        .chunk()
        .await
        .map_err(|e| format!("téléchargement interrompu : {e}"))?
    {
        octets.extend_from_slice(&morceau);
        if octets.len() as u64 > taille_max {
            return Err("artefact trop gros : refusé".into());
        }
        progres(octets.len() as u64, total);
    }

    Ok(octets)
}

/// ── La garde qui compte ──────────────────────────────────────────
/// Refuse tout ce dont le SHA-256 ne correspond pas à l'empreinte publiée.
/// La comparaison est insensible à la casse et tolère les espaces autour de
/// l'empreinte attendue ; elle ne tolère rien d'autre.
fn verifier_empreinte(octets: &[u8], attendu: &str) -> Result<(), String> {
    let empreinte = hex(&Sha256::digest(octets));
    if !empreinte.eq_ignore_ascii_case(attendu.trim()) {
        return Err(format!(
            "empreinte SHA-256 incorrecte : ce fichier n'est pas celui qui a été publié \
             (attendu {}, obtenu {empreinte}). Mise à jour annulée.",
            attendu.trim()
        ));
    }
    Ok(())
}

/// Vérifie la liste signée, télécharge en émettant la progression, puis
/// VÉRIFIE l'empreinte signée. Rien n'est écrit à destination avant.
///
/// `info` revient du front : rien n'y est cru sur parole. URL, version et
/// empreinte sont recontrôlées ici, et seule l'empreinte SIGNÉE fait foi.
async fn telecharger_et_verifier(app: &AppHandle, info: &UpdateInfo) -> Result<Vec<u8>, String> {
    if !plus_recente(&info.version, env!("CARGO_PKG_VERSION")) {
        return Err("version proposée non plus récente : mise à jour refusée".into());
    }
    let nom = nom_artefact(&info.url, &info.version)?;
    let attendu = empreinte_publiee(&info.version, nom).await?;

    let octets = telecharger(&info.url, TAILLE_MAX, |downloaded, total| {
        let _ = app.emit(EVT_PROGRES, Progres { downloaded, total });
    })
    .await?;

    verifier_empreinte(&octets, &attendu)?;

    Ok(octets)
}

fn hex(octets: &[u8]) -> String {
    let mut s = String::with_capacity(octets.len() * 2);
    for o in octets {
        s.push_str(&format!("{o:02x}"));
    }
    s
}

/// Télécharge, vérifie, installe. Ne redémarre pas : c'est `update_restart`,
/// appelé par le front quand l'utilisateur est prêt.
///
/// Rend `true` quand l'application doit être redémarrée par nos soins
/// (chemin portable), `false` quand l'installeur s'en charge ou qu'il reste une
/// action manuelle à l'utilisateur (paquet `.deb`).
/// `info` (renvoyé par le front) ne sert qu'à vérifier qu'il s'agit bien de la version
/// affichée : tout le reste vient de la proposition gardée par `update_check`.
#[tauri::command]
pub async fn update_install(app: AppHandle, info: UpdateInfo) -> Result<bool, String> {
    let info = derniere_proposee()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .filter(|retenue| retenue.version == info.version)
        .ok_or("mise à jour non vérifiée : relancez la recherche de mise à jour")?;
    if info.portable {
        let cible = cible_portable()?;
        // Avant de télécharger 90 Mo pour rien.
        verifier_dossier_inscriptible(&cible)?;
        let octets = telecharger_et_verifier(&app, &info).await?;
        remplacer_sur_place(&cible, &octets)?;
        Ok(true)
    } else {
        let octets = telecharger_et_verifier(&app, &info).await?;
        lancer_installeur(&octets, &info)?;
        Ok(false)
    }
}

/// Redémarre l'application. Ne rend jamais la main.
#[tauri::command]
pub fn update_restart(app: AppHandle) {
    app.restart();
}

// ─────────────────────── Chemin portable ───────────────────────

/// Windows interdit de SUPPRIMER un `.exe` en cours d'exécution, mais autorise
/// à le RENOMMER. On écarte l'ancien, on met le neuf à sa place, et l'ancien
/// est balayé au démarrage suivant.
///
/// Un seul fichier est touché : l'exécutable. Rien d'autre dans le dossier
/// n'est ouvert, listé ni supprimé.
fn remplacer_sur_place(cible: &Path, octets: &[u8]) -> Result<(), String> {
    let nouveau = cible.with_extension("nouveau");
    let ancien = cible.with_extension("ancien");

    std::fs::write(&nouveau, octets).map_err(|e| format!("écriture impossible : {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&nouveau, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("droits d'exécution non posés : {e}"))?;
    }

    if ancien.exists() {
        let _ = std::fs::remove_file(&ancien);
    }
    if let Err(e) = std::fs::rename(cible, &ancien) {
        let _ = std::fs::remove_file(&nouveau);
        return Err(format!("impossible d'écarter l'ancienne version : {e}"));
    }
    if let Err(e) = std::fs::rename(&nouveau, cible) {
        // Remettre l'ancienne en place : mieux vaut une version périmée qu'une
        // installation sans exécutable.
        let _ = std::fs::rename(&ancien, cible);
        return Err(format!(
            "impossible de mettre en place la nouvelle version : {e}"
        ));
    }
    Ok(())
}

/// Balaye la dépouille de la mise à jour précédente. Elle ne peut pas être
/// supprimée pendant qu'elle tourne, seulement écartée : c'est au lancement
/// SUIVANT qu'elle disparaît.
pub fn balayer_ancien() {
    if let Ok(cible) = cible_portable() {
        let ancien = cible.with_extension("ancien");
        if ancien.exists() {
            let _ = std::fs::remove_file(&ancien);
        }
    }
}

// ─────────────────────── Chemin installé ───────────────────────

/// Écrit l'artefact vérifié dans le dossier temporaire et le lance.
fn lancer_installeur(octets: &[u8], info: &UpdateInfo) -> Result<(), String> {
    let nom = info
        .url
        .rsplit('/')
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or("forgechat-update");
    // `file_name()` d'une URL contrôlée par nous, mais on refuse quand même
    // tout séparateur : un nom d'artefact ne sort pas du dossier temporaire.
    if nom.contains('\\') || nom.contains('/') || nom.contains("..") {
        return Err("nom d'artefact refusé".into());
    }

    let chemin = std::env::temp_dir().join(nom);
    std::fs::write(&chemin, octets)
        .map_err(|e| format!("écriture du fichier de mise à jour impossible : {e}"))?;

    #[cfg(windows)]
    {
        // Drapeaux du script NSIS généré par Tauri, relevés dans
        // `target/release/nsis/x64/installer.nsi` :
        //   /P      mode passif (barre de progression, aucune question)
        //   /UPDATE remplace l'installation existante
        //   /R      relance l'application après installation (n'est honoré
        //           qu'en mode passif ou silencieux)
        //   /ARGS   arguments passés à l'application relancée (vide ici)
        // L'installeur demande l'élévation lui-même : `Command::spawn` échoue
        // sur un exécutable qui l'exige (ERROR_ELEVATION_REQUIRED), il faut
        // passer par ShellExecuteW, comme le fait tauri-plugin-updater.
        shell_execute(&chemin, "/P /UPDATE /R /ARGS")?;
        // L'installeur ne peut pas remplacer les fichiers tant que nous
        // tournons. Il relancera l'application lui-même (/R).
        std::process::exit(0);
    }

    #[cfg(not(windows))]
    {
        // Un `.deb` ne s'installe pas sans les droits root : on ne peut pas le
        // faire à la place de l'utilisateur sans lui demander son mot de passe.
        // On lui remet le paquet vérifié, ouvert dans son installeur graphique.
        std::process::Command::new("xdg-open")
            .arg(&chemin)
            .spawn()
            .map_err(|e| {
                format!(
                    "Paquet téléchargé et vérifié dans « {} », mais son ouverture a échoué ({e}). \
                     Installez-le à la main : {} \"{}\"",
                    chemin.display(),
                    if cible() == "linux-rpm" { "sudo dnf install" } else { "sudo apt install" },
                    chemin.display()
                )
            })?;
        Ok(())
    }
}

#[cfg(windows)]
fn shell_execute(fichier: &Path, parametres: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;

    fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    let verbe = wide(std::ffi::OsStr::new("open"));
    let f = wide(fichier.as_os_str());
    let p = wide(std::ffi::OsStr::new(parametres));

    // ShellExecuteW rend une valeur <= 32 en cas d'échec (y compris un refus
    // d'élévation UAC par l'utilisateur).
    let code = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verbe.as_ptr(),
            f.as_ptr(),
            p.as_ptr(),
            std::ptr::null(),
            SW_SHOW,
        )
    };
    if code as isize <= 32 {
        return Err(format!(
            "l'installeur n'a pas pu être lancé (code {}). L'élévation a peut-être été refusée.",
            code as isize
        ));
    }
    Ok(())
}

// ──────────────────────────── Tests ────────────────────────────

#[cfg(test)]
mod tests;
