use std::time::Duration;
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, MouseButton, TrayIconEvent},
};

const TRAY_FRAME_COUNT: usize = 8;
const TRAY_FRAME_INTERVAL_MS: u64 = 225;

/// Charge les 8 frames pré-rendues (mêmes PNG que le favicon web animé, cf.
/// client/src/faviconAnimator.ts) et fait défiler l'icône du tray en continu --
/// même identité visuelle "toujours en mouvement" que le reste de la marque.
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
            if let Some(tray) = app_handle.tray_by_id("main-tray") {
                let _ = tray.set_icon(Some(frames[i].clone()));
            }
            i = (i + 1) % TRAY_FRAME_COUNT;
            std::thread::sleep(Duration::from_millis(TRAY_FRAME_INTERVAL_MS));
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebRTC dans WebView2 : accorde micro/caméra/écran sans prompt de permission
    // (--use-fake-ui-for-media-stream auto-accepte le prompt ; les périphériques restent réels)
    let mut browser_args = String::from(
        "--use-fake-ui-for-media-stream \
         --enable-features=WebRTC-H264WithOpenH264FFmpeg",
    );
    // Harnais de test (VM sans micro/caméra) : périphériques média factices
    if std::env::var("FORGECHAT_FAKE_MEDIA").as_deref() == Ok("1") {
        browser_args.push_str(" --use-fake-device-for-media-stream");
    }
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &browser_args);

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
