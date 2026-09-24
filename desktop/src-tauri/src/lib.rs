#[cfg(not(target_os = "linux"))]
use std::time::Duration;

/// Voir `FORGECHAT_SELFTEST=popout` dans `setup`.
const POPOUT_SELFTEST_JS: &str = r#"
window.addEventListener('load', () => {
  if (window.opener) return;
  setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${(n++ * 7) % 360},80%,50%)`; g.fillRect(0, 0, 320, 180); }, 40);
    const stream = c.captureStream(25);
    const w = window.open('', 'fc-selftest', 'popup,width=400,height=260');
    if (!w) { document.title = 'SELFTEST BLOQUE'; return; }
    w.document.title = 'SELFTEST ATTENTE';
    const v = w.document.createElement('video'); v.muted = true; v.autoplay = true;
    w.document.body.appendChild(v); v.srcObject = stream; v.play().catch(() => {});
    setTimeout(() => { w.document.title = 'SELFTEST ' + v.videoWidth + 'x' + v.videoHeight + ' paused=' + v.paused; }, 3000);
  }, 2000);
});
"#;

/// Mise à jour automatique (version installée ET version portable).
pub mod updater;
mod compat;

/// Vocal natif de l'application Linux (WebKitGTK sans WebRTC).
pub mod native_voice;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, MouseButton, TrayIconEvent},
};

#[cfg(not(target_os = "linux"))]
const TRAY_FRAME_COUNT: usize = 8;
#[cfg(not(target_os = "linux"))]
const TRAY_FRAME_INTERVAL_MS: u64 = 225;

/// Frames embarquées dans le binaire : le portable est un fichier unique, des
/// ressources posées à côté de l'exe n'y existent pas (icône figée avant).
#[cfg(not(target_os = "linux"))]
const TRAY_FRAMES: [&[u8]; TRAY_FRAME_COUNT] = [
    include_bytes!("../icons/tray-frames/f0.png"),
    include_bytes!("../icons/tray-frames/f1.png"),
    include_bytes!("../icons/tray-frames/f2.png"),
    include_bytes!("../icons/tray-frames/f3.png"),
    include_bytes!("../icons/tray-frames/f4.png"),
    include_bytes!("../icons/tray-frames/f5.png"),
    include_bytes!("../icons/tray-frames/f6.png"),
    include_bytes!("../icons/tray-frames/f7.png"),
];


/// L'exe portable ne passe par aucun installeur : si le WebView2 Runtime n'est
/// pas déjà présent sur la machine, Tauri ne peut pas peupler la fenêtre
/// (fenêtre native visible mais grise, sans le moindre message d'erreur).
/// On détecte ce cas AVANT de lancer Tauri pour afficher un message clair au
/// lieu de laisser une fenêtre grise énigmatique.
#[cfg(windows)]
mod webview2_check {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Lit `pv` (la version du runtime) sous la clé EdgeUpdate donnée.
    ///
    /// EdgeUpdate laisse la clé en place après une désinstallation, avec
    /// `pv = "0.0.0.0"` : une simple présence de la valeur donnait donc un
    /// faux négatif (« runtime présent » sur une machine où il ne l'est plus,
    /// puis fenêtre grise). On rejette explicitement cette version fantôme.
    fn read_pv(hkey: HKEY, subkey: &str) -> Option<String> {
        let subkey_w = to_wide(subkey);
        let value_w = to_wide("pv");
        let mut buf = [0u16; 64];
        let mut buf_size = (buf.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                hkey,
                subkey_w.as_ptr(),
                value_w.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buf.as_mut_ptr().cast(),
                &mut buf_size,
            )
        };
        if status != 0 || buf_size <= 2 {
            return None;
        }
        // buf_size est en octets et inclut le NUL final.
        let len = (buf_size as usize / 2).saturating_sub(1);
        let pv = String::from_utf16_lossy(&buf[..len]);
        let pv = pv.trim_end_matches('\0').trim().to_string();
        if pv.is_empty() || pv.split('.').all(|part| part == "0") {
            return None;
        }
        Some(pv)
    }

    const CLIENT_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    pub fn runtime_missing() -> bool {
        let machine_key = format!(
            "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT_GUID}"
        );
        let user_key = format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT_GUID}");
        read_pv(HKEY_LOCAL_MACHINE, &machine_key)
            .or_else(|| read_pv(HKEY_CURRENT_USER, &user_key))
            .is_none()
    }

    pub fn show_missing_dialog() {
        let title = to_wide("ForgeChat");
        let text = to_wide(
            "WebView2 Runtime introuvable sur cette machine.\n\n\
             ForgeChat a besoin du \u{ab}Microsoft Edge WebView2 Runtime\u{bb} pour s'afficher \
             (déjà installé sur la plupart des Windows 10/11 à jour, mais pas ici).\n\n\
             Installe-le depuis :\n\
             https://developer.microsoft.com/microsoft-edge/webview2/\n\n\
             puis relance ForgeChat.",
        );
        unsafe {
            MessageBoxW(
                0 as HWND,
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }
}

/// Charge les 8 frames pré-rendues (mêmes PNG que le favicon web animé, cf.
/// client/src/faviconAnimator.ts) et fait défiler l'icône du tray en continu --
/// même identité visuelle "toujours en mouvement" que le reste de la marque.
///
/// Windows/macOS uniquement (voir le `#[cfg]` sur le point d'appel). Une
/// première tentative de fix envoyait `set_icon()` sur le thread principal via
/// `run_on_main_thread` (le thread de fond ne fait que dormir et calculer
/// l'index), sur la théorie que GTK interdit tout appel touchant un widget
/// hors de son thread principal. Ça n'a PAS suffi : reproduit en lançant le
/// binaire réel (AppImage ET .deb installé) sur Ubuntu 22.04, la fenêtre est
/// noire dès les premières secondes et stderr crache en continu `Gtk-CRITICAL:
/// gtk_widget_get_scale_factor: assertion 'GTK_IS_WIDGET (widget)' failed`
/// exactement toutes les TRAY_FRAME_INTERVAL_MS -- donc même bien posté sur le
/// thread principal, remplacer l'icône du tray ~4x/s corrompt la boucle GTK
/// partagée avec la fenêtre WebKitGTK. Cause exacte non élucidée (probable bug
/// interne à tray-icon/muda ou à l'AppIndicator de secours GtkStatusIcon), mais
/// le signal est trop net pour continuer à risquer un rendu cassé pour un
/// détail cosmétique : désactivé sur Linux plutôt que retenté une 3e fois.
#[cfg(not(target_os = "linux"))]
fn animate_tray_icon(app: &tauri::AppHandle) -> tauri::Result<()> {
    let mut frames = Vec::with_capacity(TRAY_FRAME_COUNT);
    for bytes in TRAY_FRAMES {
        frames.push(tauri::image::Image::from_bytes(bytes)?.to_owned());
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut i = 0usize;
        loop {
            let frame = frames[i].clone();
            let handle = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                if let Some(tray) = handle.tray_by_id("main-tray") {
                    let _ = tray.set_icon(Some(frame));
                }
            });
            i = (i + 1) % TRAY_FRAME_COUNT;
            std::thread::sleep(Duration::from_millis(TRAY_FRAME_INTERVAL_MS));
        }
    });

    Ok(())
}

/// Push-to-talk global (correctif A9).
///
/// Les listeners `keydown`/`keyup` du front ne reçoivent rien quand ForgeChat
/// n'a pas le focus — or c'est le cas d'usage principal du PTT (jeu en plein
/// écran). On enregistre donc un raccourci au niveau de l'OS et on renvoie
/// l'appui/relâchement au front sous forme d'events globaux.
///
/// Contrat côté front :
/// - `invoke('register_ptt_shortcut', { accelerator: 'Control+Shift+Space' })`
/// - `invoke('unregister_ptt_shortcut')`
/// - `listen('ptt-down' | 'ptt-up', e => ...)`, `e.payload` = l'accélérateur
///   normalisé (ex. `"alt+Space"`).
///
/// ⚠ L'accélérateur doit contenir une **vraie touche** : un modificateur seul
/// (`"Alt"`, le défaut actuel des Réglages) est refusé par l'API OS — la
/// commande renvoie alors une `Err` lisible que le front doit afficher.
#[cfg(desktop)]
#[tauri::command]
fn register_ptt_shortcut(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    // Un seul PTT à la fois : repartir d'une table vide évite d'accumuler des
    // raccourcis orphelins à chaque changement de touche dans les Réglages.
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.register(accelerator.as_str()).map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn unregister_ptt_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

#[cfg(desktop)]
fn global_shortcut_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::ShortcutState;

    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            let name = match event.state() {
                ShortcutState::Pressed => "ptt-down",
                ShortcutState::Released => "ptt-up",
            };
            let _ = app.emit(name, shortcut.to_string());
        })
        .build()
}

/// WebKitGTK (Linux) refuse par défaut **toute** demande de permission média :
/// sans handler `permission-request`, le signal retombe sur le comportement par
/// défaut de WebKitWebView (deny) et `getUserMedia`/`getDisplayMedia` rejettent
/// immédiatement avec `NotAllowedError`. Côté front ce rejet est indiscernable
/// d'une annulation du sélecteur, donc « Partager l'écran » ne faisait
/// strictement rien, sans erreur ni toast (défaut S3).
///
/// On autorise ici les seules demandes `WebKitUserMediaPermissionRequest`
/// (micro, caméra, capture d'écran) ; tout le reste (géolocalisation,
/// notifications, pointer lock, accès aux données de sites tiers) retombe sur
/// le comportement par défaut, c'est-à-dire refusé. Le contenu chargé est notre
/// propre front, pas du web arbitraire — la CSP de tauri.conf.json le verrouille.
///
/// Pour la capture d'écran, autoriser la permission ne court-circuite pas le
/// choix de l'utilisateur : WebKitGTK délègue ensuite au portail
/// xdg-desktop-portal (ScreenCast), qui affiche son propre sélecteur de source.
///
/// `enable-media-stream` / `enable-webrtc` doivent en plus être activés
/// explicitement : wry ne touche pas à ces réglages WebKitSettings et leur
/// défaut n'est pas garanti d'une version de WebKitGTK à l'autre.
#[cfg(target_os = "linux")]
fn enable_linux_media_capture(app: &tauri::AppHandle) {
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[ForgeChat] Fenêtre 'main' introuvable : capture média Linux non câblée");
        return;
    };

    if let Err(e) = window.with_webview(|platform| {
        let webview = platform.inner();

        if let Some(settings) = WebViewExt::settings(&webview) {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            settings.set_enable_webrtc(true);
        } else {
            eprintln!("[ForgeChat] WebKitSettings indisponibles : WebRTC peut rester désactivé");
        }

        webview.connect_permission_request(|_, request| {
            match request.downcast_ref::<UserMediaPermissionRequest>() {
                Some(media) => {
                    media.allow();
                    true
                }
                None => false,
            }
        });
    }) {
        eprintln!("[ForgeChat] Câblage de la permission média WebKitGTK échoué : {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Purge le service worker que les versions <= 3.24.0 enregistraient sous
/// http://tauri.localhost. Sous WebView2, les fetch() émis par un service
/// worker ne sont pas routés vers le protocole Tauri : dès le 2e lancement,
/// /assets/* échouait et la fenêtre restait vide. Le front n'enregistre plus
/// de SW dans l'application bureau, mais un profil existant en garde un, et
/// le bundle React ne démarre jamais assez loin pour le désinscrire lui-même.
/// À faire AVANT la création du webview (le profil n'est pas encore ouvert).
#[cfg(windows)]
fn purger_service_worker_webview2() {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return };
    let dir = std::path::PathBuf::from(local)
        .join("org.heiphaistos.forgechat")
        .join("EBWebView")
        .join("Default")
        .join("Service Worker");
    if dir.is_dir() {
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => eprintln!("[ForgeChat] Service worker WebView2 hérité purgé"),
            Err(e) => eprintln!("[ForgeChat] Purge du service worker impossible : {e}"),
        }
    }
}

pub fn run() {
    #[cfg(windows)]
    purger_service_worker_webview2();

    #[cfg(windows)]
    if webview2_check::runtime_missing() {
        webview2_check::show_missing_dialog();
        return;
    }

    // Balaye l'exécutable écarté par la mise à jour portable précédente : il ne
    // pouvait pas être supprimé tant qu'il tournait, c'est maintenant possible.
    updater::balayer_ancien();

    // WebKitGTK (Linux) : sur certains pilotes GPU (Mesa/NVIDIA proprio/VM), le chemin de
    // rendu matériel DMA-BUF de WebKitGTK 2.4x laisse la fenêtre entièrement noire -- au
    // premier lancement sur les machines concernées, ou après un changement d'état GPU
    // (reprise, changement d'espace de travail). C'est le bug remonté le plus fréquemment
    // dans l'écosystème Tauri pour ce symptôme exact ; corrigé nulle part côté app jusqu'ici
    // (ForgeChat Desktop n'avait AUCUNE variable Linux, seulement du code Windows-only).
    // Forcer le renderer logiciel élimine la dépendance au pilote GPU. Ne pas écraser une
    // valeur déjà définie par l'utilisateur/l'environnement de lancement.
    #[cfg(target_os = "linux")]
    {
        compat::journal_si_pas_de_terminal();
        compat::purger_caches_si_nouvelle_version();
        compat::preparer();
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        // Fenêtre BLANCHE au démarrage alors que la page est bien construite (DOM
        // complet, vérifié par WebDriver) : le mode composition accélérée de
        // WebKitGTK ne peint rien sur certains couples pilote/compositeur (NVIDIA
        // propriétaire, Wayland, AppImage sur une distribution autre qu'Ubuntu).
        // Le rendu logiciel suffit à une messagerie ; la vidéo reste décodée à part.
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    // WebRTC dans WebView2 (Windows uniquement).
    //
    // `--use-fake-ui-for-media-stream` auto-accepte le prompt de permission
    // **getUserMedia** (micro + caméra) ; les périphériques restent réels.
    // Il ne couvre PAS `getDisplayMedia` : le partage d'écran passe par le
    // sélecteur de source de Chromium, qui n'est pas un prompt de permission
    // et s'affiche quoi qu'il arrive (correctif S12 — le commentaire précédent
    // affirmait le contraire et donnait un faux sentiment de couverture).
    //
    // `--auto-select-desktop-capture-source=<titre>` existe et supprimerait ce
    // sélecteur, mais il impose une source unique choisie par nous : on ne
    // l'ajoute PAS, ce serait une régression fonctionnelle (l'utilisateur ne
    // pourrait plus choisir quel écran ou quelle fenêtre partager). C'est un
    // drapeau de harnais de test, pas de production ; s'il devient nécessaire
    // pour les tests automatisés, il devra être conditionné à
    // FORGECHAT_FAKE_MEDIA comme --use-fake-device-for-media-stream ci-dessous.
    //
    // Linux/WebKitGTK n'a pas d'équivalent WEBVIEW2_* : la capture y est
    // autorisée par le handler `permission-request` posé dans `setup()`.
    #[cfg(windows)]
    {
        let mut browser_args = String::from(
            "--use-fake-ui-for-media-stream \
             --enable-features=WebRTC-H264WithOpenH264FFmpeg",
        );
        // Harnais de test (VM sans micro/caméra) : périphériques média factices
        if std::env::var("FORGECHAT_FAKE_MEDIA").as_deref() == Ok("1") {
            browser_args.push_str(" --use-fake-device-for-media-stream");
        }
        // Note : --remote-debugging-port ne sert a rien ici, WebView2 filtre ce
        // drapeau dans AdditionalBrowserArguments (essaye le 2026-09-22, le port
        // n'ecoute jamais). Pour lire la console d'une build de production,
        // utiliser F12 : la feature `devtools` de tauri est activee en release.
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &browser_args);
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Focaliser la fenêtre existante si une 2e instance est lancée
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init());

    // Push-to-talk global : plugin + commandes exposées au front (correctif A9).
    #[cfg(desktop)]
    let builder = builder
        .plugin(global_shortcut_plugin())
        .invoke_handler(tauri::generate_handler![
            register_ptt_shortcut,
            unregister_ptt_shortcut,
            updater::update_check,
            updater::update_install,
            updater::update_restart,
            native_voice::nv_connect,
            native_voice::nv_disconnect,
            native_voice::nv_set_mic,
            native_voice::nv_set_deafen,
            native_voice::nv_set_peer_audio,
            native_voice::nv_set_camera,
            native_voice::nv_set_screen,
            native_voice::nv_popout,
            compat::app_ready
        ]);

    builder
        .setup(|app| {
            // Fenêtre principale créée ici (et non par tauri.conf.json, `create: false`)
            // pour lui attacher un gestionnaire de nouvelles fenêtres. Sans lui, wry
            // refuse tout `window.open` sous WebView2 : impossible de détacher un
            // stream ou une caméra dans sa propre fenêtre.
            // Seules les fenêtres détachées, ouvertes vides (`about:blank`) sur la même
            // origine, sont autorisées : elles partagent alors les flux vidéo de la
            // fenêtre principale. Tout autre `window.open` reste refusé.
            let main_cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("fenêtre 'main' absente de tauri.conf.json")?;
            let mut main_builder = tauri::WebviewWindowBuilder::from_config(app, &main_cfg)?;
            // Auto-test des fenêtres détachées (harnais uniquement) : ouvre une fenêtre
            // vide, y lit un flux vidéo de la fenêtre principale, et écrit le résultat
            // dans son titre, lisible par l'outil de capture sans toucher à l'écran.
            if std::env::var("FORGECHAT_SELFTEST").as_deref() == Ok("popout") {
                main_builder = main_builder.initialization_script(POPOUT_SELFTEST_JS);
            }
            main_builder
                .on_new_window(|url, _features| {
                    if url.as_str() == "about:blank" {
                        tauri::webview::NewWindowResponse::Allow
                    } else {
                        tauri::webview::NewWindowResponse::Deny
                    }
                })
                .build()?;

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // Capture micro/caméra/écran sous WebKitGTK (correctif S3).
            #[cfg(target_os = "linux")]
            enable_linux_media_capture(app.handle());

            // ── Tray icon ────────────────────────────────────────────
            let quit = MenuItem::with_id(app, "quit", "Quitter ForgeChat", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
            // Linux : sortie de secours visible même si la fenêtre reste blanche.
            let compat_label = if compat::actif() {
                "Redémarrer en mode normal"
            } else {
                "Redémarrer en mode compatibilité (écran blanc)"
            };
            let compat_item = MenuItem::with_id(app, "compat", compat_label, cfg!(target_os = "linux"), None::<&str>)?;
            let menu = if cfg!(target_os = "linux") {
                Menu::with_items(app, &[&show, &compat_item, &quit])?
            } else {
                Menu::with_items(app, &[&show, &quit])?
            };

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("ForgeChat")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "compat" => {
                        compat::definir(!compat::actif());
                        app.restart();
                    }
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Désactivé sur Linux : corrompt la boucle de rendu GTK/WebKitGTK
            // partagée (fenêtre noire), voir la doc de animate_tray_icon().
            #[cfg(not(target_os = "linux"))]
            if let Err(e) = animate_tray_icon(app.handle()) {
                eprintln!("[ForgeChat] Animation icône tray désactivée (chargement frames échoué) : {e}");
            }

            // ── Fermer = réduire dans le tray (ne pas quitter) ───────
            let window = app.get_webview_window("main").unwrap();
            let win_hide = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = win_hide.hide();
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de ForgeChat Desktop");
}
