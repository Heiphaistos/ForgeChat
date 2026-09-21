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
//! **L'empreinte SHA-256 annoncée par le manifeste est vérifiée avant que quoi
//! que ce soit ne soit installé.** Le manifeste vient de l'API
//! (`/api/desktop/latest`, en HTTPS), le binaire vient du dossier statique : un
//! artefact corrompu, tronqué ou remplacé dans ce dossier est refusé et n'est
//! jamais exécuté.
//!
//! ponytail: l'authenticité repose sur HTTPS vers forgechat.heiphaistos.org —
//! quelqu'un qui contrôle le serveur contrôle aussi l'empreinte. Passer à une
//! signature minisign hors-ligne (clé jamais sur le VPS) si le modèle de menace
//! doit couvrir la compromission du serveur ; le champ à ajouter au manifeste
//! est `signature`, à vérifier ici juste après le SHA-256.
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

/// Manifeste interrogé par défaut. Surchargeable par `FORGECHAT_UPDATE_ENDPOINT`
/// pour tester contre un serveur local sans reconstruire.
const ENDPOINT: &str = "https://forgechat.heiphaistos.org/api/desktop/latest";

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

/// Cible du manifeste correspondant à cette copie.
fn cible() -> &'static str {
    let installee = est_installee();
    if cfg!(windows) {
        if installee {
            "windows-x86_64"
        } else {
            "windows-portable"
        }
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
    std::env::var("FORGECHAT_UPDATE_ENDPOINT").unwrap_or_else(|_| ENDPOINT.into())
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

    if !plus_recente(&manifeste.version, actuelle) {
        return Ok(None);
    }

    let target = cible();
    let artefact = manifeste
        .platforms
        .get(target)
        .ok_or_else(|| format!("aucun artefact publié pour {target}"))?;

    if artefact.sha256.trim().is_empty() {
        return Err(format!(
            "l'artefact {target} est publié sans empreinte SHA-256 : mise à jour refusée"
        ));
    }

    Ok(Some(UpdateInfo {
        version: manifeste.version,
        current_version: actuelle.to_string(),
        notes: manifeste.notes,
        pub_date: manifeste.pub_date,
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

/// Télécharge en émettant la progression, puis VÉRIFIE l'empreinte.
/// Rien n'est écrit à destination tant que l'empreinte n'est pas confirmée.
async fn telecharger_et_verifier(app: &AppHandle, info: &UpdateInfo) -> Result<Vec<u8>, String> {
    let mut reponse = client()?
        .get(&info.url)
        .send()
        .await
        .map_err(|e| format!("téléchargement impossible : {e}"))?
        .error_for_status()
        .map_err(|e| format!("téléchargement refusé : {e}"))?;

    let total = reponse.content_length().unwrap_or(0);
    if total > TAILLE_MAX {
        return Err(format!("artefact annoncé à {total} octets : refusé"));
    }

    let mut octets: Vec<u8> = Vec::with_capacity(total as usize);
    while let Some(morceau) = reponse
        .chunk()
        .await
        .map_err(|e| format!("téléchargement interrompu : {e}"))?
    {
        octets.extend_from_slice(&morceau);
        if octets.len() as u64 > TAILLE_MAX {
            return Err("artefact trop gros : refusé".into());
        }
        let _ = app.emit(
            EVT_PROGRES,
            Progres {
                downloaded: octets.len() as u64,
                total,
            },
        );
    }

    // ── La garde qui compte ──────────────────────────────────────────
    let empreinte = hex(&Sha256::digest(&octets));
    if !empreinte.eq_ignore_ascii_case(info.sha256.trim()) {
        return Err(format!(
            "empreinte SHA-256 incorrecte : ce fichier n'est pas celui qui a été publié \
             (attendu {}, obtenu {empreinte}). Mise à jour annulée.",
            info.sha256.trim()
        ));
    }

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
#[tauri::command]
pub async fn update_install(app: AppHandle, info: UpdateInfo) -> Result<bool, String> {
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
                     Installez-le à la main : sudo apt install \"{}\"",
                    chemin.display(),
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
mod tests {
    use super::*;

    #[test]
    fn compare_les_versions() {
        assert!(plus_recente("3.24.0", "3.23.0"));
        assert!(plus_recente("3.23.1", "3.23.0"));
        assert!(plus_recente("4.0.0", "3.99.99"));
        assert!(!plus_recente("3.23.0", "3.23.0"));
        assert!(!plus_recente("3.22.0", "3.23.0"));
        // Comparaison numérique, pas lexicographique : 3.9.0 < 3.23.0.
        assert!(!plus_recente("3.9.0", "3.23.0"));
    }

    #[test]
    fn un_manifeste_illisible_ne_met_rien_a_jour() {
        assert!(!plus_recente("pas-une-version", "3.23.0"));
        assert!(!plus_recente("", "3.23.0"));
        assert!(!plus_recente("3.24", "3.23.0"));
        assert!(!plus_recente("3.24.0.1", "3.23.0"));
    }

    #[test]
    fn hex_rend_bien_le_sha256_connu() {
        // SHA-256 de la chaîne vide — valeur de référence publique.
        assert_eq!(
            hex(&Sha256::digest(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn la_cible_est_une_des_quatre_publiees() {
        assert!(matches!(
            cible(),
            "windows-x86_64" | "windows-portable" | "linux-x86_64" | "linux-portable"
        ));
    }

    #[test]
    fn un_dossier_inexistant_donne_un_message_clair_pas_un_succes() {
        let inexistant = Path::new("/dossier/qui/nexiste/pas/forgechat.exe");
        let r = verifier_dossier_inscriptible(inexistant);
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("n'accepte pas l'écriture"));
    }
}
