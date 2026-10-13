//! Garde de la vue web principale : elle ne quitte jamais l'appli, les liens
//! externes partent dans le navigateur du système (http(s) seulement), et
//! (Windows) le micro et la caméra ne sont accordés qu'à l'appli elle-même.

use tauri::Url;

/// Origine de l'appli : `tauri://localhost` (Linux, macOS), `http://tauri.localhost`
/// (Windows), et le serveur Vite en développement.
pub fn origine_appli(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => url.port().is_none(),
        ("http", Some("localhost")) => cfg!(debug_assertions) && url.port() == Some(5173),
        _ => false,
    }
}

/// Navigation autorisée dans la fenêtre principale : l'appli, et les lecteurs YouTube
/// intégrés (WebKitGTK soumet aussi la navigation des iframes à ce filtre). Tout le reste
/// (lien sans target, `location = …` venu d'un contenu) est refusé : aucun site tiers ne
/// s'affiche dans le cadre de l'appli.
pub fn navigation_interne(url: &Url) -> bool {
    if origine_appli(url) || url.as_str() == "about:blank" {
        return true;
    }
    url.scheme() == "https"
        && match url.host_str() {
            Some("www.youtube-nocookie.com") => true,
            Some("www.youtube.com") => url.path().starts_with("/embed/"),
            _ => false,
        }
}

/// Filtre posé sur la fenêtre principale : un lien `mailto:` (pages légales) part dans
/// la messagerie du système, toute autre sortie de l'appli est refusée.
pub fn filtrer_navigation(url: &Url) -> bool {
    if navigation_interne(url) {
        return true;
    }
    if url.scheme() == "mailto" {
        ouvrir_externe(url);
    }
    false
}

/// Lien `target=_blank` / `window.open` vers un site : ouvert dans le navigateur du
/// système, jamais dans l'appli. http(s) et mailto: seulement (pas file:, ms-*, javascript:…).
pub fn ouvrir_externe(url: &Url) {
    let ok = match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "mailto" => true,
        _ => false,
    };
    if !ok {
        return;
    }
    // Déprécié au profit de tauri-plugin-opener (même comportement), déjà embarqué ici.
    #[allow(deprecated)]
    if let Err(e) = tauri_plugin_shell::open::open(None, url.as_str(), None) {
        eprintln!("[ForgeChat] Ouverture du lien dans le navigateur impossible : {e}");
    }
}

/// Windows : remplace `--use-fake-ui-for-media-stream`, qui accordait micro et caméra à
/// N'IMPORTE QUELLE origine chargée dans la vue (iframe tierce, page externe). Ici seule
/// l'origine de l'appli les obtient (sans invite, comme avant) ; toute autre origine se
/// voit tout refuser.
#[cfg(windows)]
pub fn permissions_appli_seulement(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DENY,
    };
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};

    let Some(fenetre) = app.get_webview_window("main") else {
        return;
    };
    let pose = fenetre.with_webview(|vue| unsafe {
        let Ok(coeur) = vue.controller().CoreWebView2() else {
            eprintln!("[ForgeChat] CoreWebView2 indisponible : permissions média non filtrées");
            return;
        };
        let mut jeton = 0i64;
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut genre = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut genre)?;
            let mut uri = windows_core::PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let appli = Url::parse(&uri).is_ok_and(|u| origine_appli(&u));
            if !appli {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            } else if genre == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                || genre == COREWEBVIEW2_PERMISSION_KIND_CAMERA
            {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            // Autres demandes de l'appli : comportement par défaut de WebView2.
            Ok(())
        }));
        if let Err(e) = coeur.add_PermissionRequested(&handler, &mut jeton) {
            eprintln!("[ForgeChat] Gestionnaire de permissions WebView2 non posé : {e}");
        }
    });
    if let Err(e) = pose {
        eprintln!("[ForgeChat] Gestionnaire de permissions WebView2 non posé : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn la_fenetre_ne_quitte_pas_l_appli() {
        for ok in [
            "tauri://localhost/servers/x",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "about:blank",
            "https://www.youtube-nocookie.com/embed/abc?enablejsapi=1",
            "https://www.youtube.com/embed/abc",
        ] {
            assert!(navigation_interne(&u(ok)), "{ok}");
        }
        for ko in [
            "https://evil.example/login",
            "http://tauri.localhost.evil.example/",
            "http://tauri.localhost:8080/",
            "https://forgechat.heiphaistos.org/",
            "https://www.youtube.com/watch?v=abc",
            "file:///C:/Windows/System32/calc.exe",
            "data:text/html,<script>alert(1)</script>",
            "javascript:alert(1)",
            "tauri://evil/",
        ] {
            assert!(!navigation_interne(&u(ko)), "{ko}");
        }
    }

    #[test]
    fn origine_de_l_appli_seulement() {
        assert!(origine_appli(&u("http://tauri.localhost/")));
        assert!(!origine_appli(&u(
            "https://www.youtube-nocookie.com/embed/x"
        )));
        assert!(!origine_appli(&u("https://evil.example/")));
        assert!(!origine_appli(&u("http://tauri.localhost@evil.example/")));
    }
}
