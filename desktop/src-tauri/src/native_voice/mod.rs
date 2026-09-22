//! Vocal natif de l'application Linux.
//!
//! La WebKitGTK des distributions est compilée sans WebRTC
//! (`typeof RTCPeerConnection === 'undefined'`, mesuré sur 2.50.4) : la vue web
//! ne peut pas passer d'appel. Ici, le processus Rust se connecte lui-même au
//! SFU avec le SDK LiveKit, qui embarque son propre WebRTC :
//!
//! - son : module audio natif (PulseAudio/ALSA) avec annulation d'écho,
//!   gain automatique et suppression de bruit, comme un navigateur ;
//! - vidéo reçue : images servies en MJPEG sur 127.0.0.1 (voir `video.rs`) ;
//! - caméra et partage d'écran publiés depuis des captures natives.
//!
//! Le front (`client/src/lib/nativeVoice.ts`) pilote par les commandes `nv_*`
//! et suit les événements `nv:track`, `nv:speakers`, `nv:state`.
//! Sur Windows, ces commandes répondent une erreur : WebView2 a WebRTC.

#[cfg(target_os = "linux")]
mod imp;
#[cfg(target_os = "linux")]
pub mod video;

use serde_json::Value;

#[cfg(not(target_os = "linux"))]
const ABSENT: &str = "vocal natif réservé à l'application Linux";

#[tauri::command]
pub async fn nv_connect(app: tauri::AppHandle, url: String, token: String, ice: Vec<Value>, mic: bool, mic_open: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { imp::connect(app, url, token, ice, mic, mic_open).await }
    #[cfg(not(target_os = "linux"))]
    { let _ = (app, url, token, ice, mic, mic_open); Err(ABSENT.into()) }
}

#[tauri::command]
pub async fn nv_disconnect() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { imp::disconnect().await; Ok(()) }
    #[cfg(not(target_os = "linux"))]
    { Err(ABSENT.into()) }
}

#[tauri::command]
pub async fn nv_set_mic(open: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { imp::set_mic(open).await }
    #[cfg(not(target_os = "linux"))]
    { let _ = open; Err(ABSENT.into()) }
}

#[tauri::command]
pub async fn nv_set_deafen(deafened: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { imp::set_deafen(deafened).await }
    #[cfg(not(target_os = "linux"))]
    { let _ = deafened; Err(ABSENT.into()) }
}

#[tauri::command]
pub async fn nv_set_peer_audio(identity: String, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { imp::set_peer_audio(identity, enabled).await }
    #[cfg(not(target_os = "linux"))]
    { let _ = (identity, enabled); Err(ABSENT.into()) }
}

/// Fenêtre détachée pour un flux vidéo local (`http://127.0.0.1:PORT/v/…`).
/// La vue web Linux ne peut pas partager de flux entre fenêtres : chaque
/// fenêtre relit simplement le flux MJPEG du serveur local.
#[tauri::command]
pub async fn nv_popout(app: tauri::AppHandle, url: String, title: String) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    // Seul le serveur vidéo local est accepté : jamais une URL arbitraire.
    let page = url
        .strip_prefix("http://127.0.0.1:")
        .filter(|rest| rest.contains("/v/"))
        .map(|rest| format!("http://127.0.0.1:{}", rest.replacen("/v/", "/p/", 1)))
        .ok_or("URL de flux invalide")?;
    let label = format!("popout-{}", N.fetch_add(1, Ordering::Relaxed));
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(page.parse().map_err(|e| format!("{e}"))?))
        .title(title)
        .inner_size(1024.0, 600.0)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Renvoie l'URL de l'aperçu local quand la caméra démarre.
#[tauri::command]
pub async fn nv_set_camera(on: bool) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    { imp::set_camera(on).await }
    #[cfg(not(target_os = "linux"))]
    { let _ = on; Err(ABSENT.into()) }
}

/// Renvoie l'URL de l'aperçu local quand le partage démarre.
#[tauri::command]
pub async fn nv_set_screen(on: bool) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    { imp::set_screen(on).await }
    #[cfg(not(target_os = "linux"))]
    { let _ = on; Err(ABSENT.into()) }
}
