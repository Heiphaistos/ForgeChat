//! GhostHandDesk (support à distance, Windows) : détection de l'appli et lancement
//! par un lien `ghosthanddesk://` construit et confirmé côté Rust (audit D1).

use std::path::Path;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

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

/// Identifiant GhostHandDesk : 9 chiffres, sans zéro en tête.
fn id_ghd_valide(id: &str) -> bool {
    id.len() == 9 && id.bytes().all(|b| b.is_ascii_digit()) && !id.starts_with('0')
}

/// Identifiant GhostHandDesk de cet ordinateur, lu dans `device_id.txt` : dossier `data` à côté
/// de l'exécutable (version portable, celui du lien inscrit) sinon `%APPDATA%\GhostHandDesk`.
/// `None` tant que GhostHandDesk n'a jamais été lancé ici.
#[tauri::command]
pub async fn ghd_device_id() -> Option<String> {
    #[cfg(windows)]
    {
        let portable = lire_hkcu_defaut(r"Software\Classes\ghosthanddesk\shell\open\command")
            .and_then(|c| exe_de_commande(&c))
            .and_then(|exe| Path::new(&exe).parent().map(|d| d.join("data").join("device_id.txt")));
        let itinerant = std::env::var_os("APPDATA").map(|d| Path::new(&d).join("GhostHandDesk").join("device_id.txt"));
        [portable, itinerant]
            .into_iter()
            .flatten()
            .filter_map(|f| std::fs::read_to_string(f).ok())
            .map(|s| s.trim().to_string())
            .find(|id| id_ghd_valide(id))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Lien `ghosthanddesk://` construit ici à partir de champs validés (audit D1) :
/// `share` (code à armer, durée en secondes) ou `connect` (identifiant + code).
/// Rend le lien et la question posée à l'utilisateur.
fn lien_ghd(
    action: &str,
    code: &str,
    id: Option<&str>,
    ttl: Option<u32>,
) -> Result<(String, String), String> {
    // Code de support : 12 caractères base32 Crockford (sans I, L, O, U).
    let code_ok = code.len() == 12
        && code
            .bytes()
            .all(|b| b.is_ascii_digit() || (b.is_ascii_uppercase() && !b"ILOU".contains(&b)));
    if !code_ok {
        return Err("code de support invalide".into());
    }
    let groupes = |s: &str, n: usize| -> String {
        s.as_bytes()
            .chunks(n)
            .map(|c| String::from_utf8_lossy(c).into_owned())
            .collect::<Vec<_>>()
            .join(" ")
    };
    match (action, id) {
        ("share", None) => {
            let ttl = ttl.unwrap_or(600);
            if !(60..=3600).contains(&ttl) {
                return Err("durée de validité invalide".into());
            }
            Ok((
                format!("ghosthanddesk://share?code={code}&ttl={ttl}"),
                format!(
                    "GhostHandDesk va s'ouvrir et autoriser la prise en main de cet ordinateur avec le code {}.\n\nContinuer ?",
                    groupes(code, 4)
                ),
            ))
        }
        ("connect", Some(id)) if ttl.is_none() => {
            let id: String = id.chars().filter(|c| !matches!(c, ' ' | '-')).collect();
            if !id_ghd_valide(&id) {
                return Err("identifiant GhostHandDesk invalide".into());
            }
            Ok((
                format!("ghosthanddesk://connect?id={id}&code={code}"),
                format!(
                    "GhostHandDesk va se connecter à l'ordinateur {}.\n\nContinuer ?",
                    groupes(&id, 3)
                ),
            ))
        }
        _ => Err("action GhostHandDesk invalide".into()),
    }
}

/// Lance GhostHandDesk (audit D1) : le front ne passe jamais d'URL, seulement des champs
/// validés ici, et l'utilisateur confirme dans une boîte native qu'aucun script de la vue
/// web ne peut valider à sa place. `Ok(false)` = annulé par l'utilisateur.
#[tauri::command]
pub async fn ghd_launch(
    app: AppHandle,
    action: String,
    code: String,
    id: Option<String>,
    ttl: Option<u32>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    let (lien, question) = lien_ghd(&action, &code, id.as_deref(), ttl)?;
    if !ghd_installed().await {
        return Err("GhostHandDesk n'est pas installé".into());
    }
    let fenetre = app.get_webview_window("main");
    let app2 = app.clone();
    let accepte = tauri::async_runtime::spawn_blocking(move || {
        let mut boite = app2
            .dialog()
            .message(question)
            .title("Support à distance")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Ouvrir GhostHandDesk".into(),
                "Annuler".into(),
            ));
        if let Some(w) = &fenetre {
            boite = boite.parent(w);
        }
        boite.blocking_show()
    })
    .await
    .map_err(|e| e.to_string())?;
    if !accepte {
        return Ok(false);
    }
    // Déprécié au profit de tauri-plugin-opener (même comportement), déjà embarqué ici.
    // Sans portée : le lien vient d'être construit ci-dessus, pas du front.
    #[allow(deprecated)]
    tauri_plugin_shell::open::open(None, &lien, None)
        .map_err(|e| format!("ouverture de GhostHandDesk impossible : {e}"))?;
    Ok(true)
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
    use super::*;

    #[test]
    fn exe_du_lien_ghosthanddesk() {
        assert_eq!(
            exe_de_commande(r#""C:\Users\a b\GhostHandDesk.exe" "%1""#).as_deref(),
            Some(r"C:\Users\a b\GhostHandDesk.exe")
        );
        assert_eq!(
            exe_de_commande(r"C:\ghd.exe %1").as_deref(),
            Some(r"C:\ghd.exe")
        );
        assert_eq!(exe_de_commande(r#""" "%1""#), None);
        assert_eq!(exe_de_commande("  "), None);
    }

    #[test]
    fn liens_ghosthanddesk_valides_seulement() {
        let (lien, _) = lien_ghd("share", "7K2MQ9XR4TVB", None, Some(600)).unwrap();
        assert_eq!(lien, "ghosthanddesk://share?code=7K2MQ9XR4TVB&ttl=600");
        let (lien, q) = lien_ghd("connect", "7K2MQ9XR4TVB", Some("482 915 036"), None).unwrap();
        assert_eq!(
            lien,
            "ghosthanddesk://connect?id=482915036&code=7K2MQ9XR4TVB"
        );
        assert!(q.contains("482 915 036"));
        for (a, c, i, t) in [
            ("share", "7K2MQ9XR4TVB", Some("482915036"), None),
            ("share", "7K2MQ9XR4TVB", None, Some(999_999)),
            ("share", "7k2mq9xr4tvb", None, None),
            ("share", "7K2MQ9XR4TVI", None, None),
            ("share", "7K2MQ9XR4TV&x=1", None, None),
            ("connect", "7K2MQ9XR4TVB", None, None),
            ("connect", "7K2MQ9XR4TVB", Some("082915036"), None),
            ("connect", "7K2MQ9XR4TVB", Some("482915036&cmd=x"), None),
            ("connect", "7K2MQ9XR4TVB", Some("482915036"), Some(600)),
            ("exec", "7K2MQ9XR4TVB", None, None),
        ] {
            assert!(lien_ghd(a, c, i, t).is_err(), "{a} {c} {i:?} {t:?}");
        }
    }
}
