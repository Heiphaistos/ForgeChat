use std::time::Duration;
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, MouseButton, TrayIconEvent},
};

const TRAY_FRAME_COUNT: usize = 8;
const TRAY_FRAME_INTERVAL_MS: u64 = 225;

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

    fn has_pv(hkey: HKEY, subkey: &str) -> bool {
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
        status == 0 && buf_size > 2
    }

    const CLIENT_GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    pub fn runtime_missing() -> bool {
        let machine_key = format!(
            "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT_GUID}"
        );
        let user_key = format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{CLIENT_GUID}");
        !(has_pv(HKEY_LOCAL_MACHINE, &machine_key) || has_pv(HKEY_CURRENT_USER, &user_key))
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
/// Le thread de fond ne fait QUE dormir et calculer l'index : le `set_icon()`
/// lui-même est renvoyé sur le thread principal via `run_on_main_thread`.
/// Sur Linux, le tray est backé par GTK, qui n'autorise aucun appel touchant
/// un widget hors de son thread principal -- l'appeler directement depuis ce
/// thread de fond déclenchait un flot continu de `Gtk-CRITICAL:
/// gtk_widget_get_scale_factor: assertion 'GTK_IS_WIDGET (widget)' failed`
/// toutes les 225 ms, en continu, tant que l'app tournait (reproduit et
/// confirmé en lançant le binaire réel : le log matche exactement
/// TRAY_FRAME_INTERVAL_MS). Ce spam de corruption sur la boucle GTK partagée
/// avec la fenêtre WebKitGTK est la cause la plus probable des rendus qui
/// deviennent noirs "au bout d'un moment" signalés sur la version Linux.
fn animate_tray_icon(app: &tauri::AppHandle) -> tauri::Result<()> {
    let resource_dir = app.path().resource_dir()?;
    let frames_dir = resource_dir.join("icons").join("tray-frames");

    let mut frames = Vec::with_capacity(TRAY_FRAME_COUNT);
    for i in 0..TRAY_FRAME_COUNT {
        let path = frames_dir.join(format!("f{i}.png"));
        let bytes = std::fs::read(&path).map_err(tauri::Error::Io)?;
        frames.push(tauri::image::Image::from_bytes(&bytes)?.to_owned());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    if webview2_check::runtime_missing() {
        webview2_check::show_missing_dialog();
        return;
    }

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
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // WebRTC dans WebView2 (Windows uniquement) : accorde micro/caméra/écran sans prompt
    // (--use-fake-ui-for-media-stream auto-accepte le prompt ; les périphériques restent réels)
    // Linux/WebKitGTK n'a pas d'équivalent WEBVIEW2_*, le prompt de permission natif s'affiche.
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
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &browser_args);
    }

    tauri::Builder::default()
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
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            // ── Tray icon ────────────────────────────────────────────
            let quit = MenuItem::with_id(app, "quit", "Quitter ForgeChat", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

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
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

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
