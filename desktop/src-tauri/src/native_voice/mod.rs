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

/// Seul serveur média accepté (audit D2) : le même hôte que l'API, déjà le seul
/// autorisé par la CSP de tauri.conf.json (`LIVEKIT_URL` du serveur).
const HOTE_MEDIA: &str = "forgechat.heiphaistos.org";
const ICE_MAX_SERVEURS: usize = 8;
const ICE_MAX_URLS: usize = 8;
const ICE_MAX_CHAMP: usize = 512;

/// `wss://forgechat.heiphaistos.org[:443]/…`, sans identifiants dans l'URL.
fn valider_url_media(url: &str) -> Result<(), String> {
    let u: tauri::Url = url
        .parse()
        .map_err(|_| "URL du serveur média invalide".to_string())?;
    let ok = u.scheme() == "wss"
        && u.host_str() == Some(HOTE_MEDIA)
        && u.port().is_none()
        && u.username().is_empty()
        && u.password().is_none();
    if ok {
        Ok(())
    } else {
        Err(format!(
            "serveur média refusé : seul wss://{HOTE_MEDIA} est accepté"
        ))
    }
}

/// Serveurs ICE (`/api/voice/ice-config`) : nombre borné, `stun(s):`/`turn(s):` seulement,
/// champs de taille bornée. L'hôte TURN n'est pas imposé (coturn peut être ailleurs).
fn valider_ice(ice: &[Value]) -> Result<(), String> {
    if ice.len() > ICE_MAX_SERVEURS {
        return Err("trop de serveurs ICE".into());
    }
    let court = |v: &Value| v.is_null() || v.as_str().is_some_and(|s| s.len() <= ICE_MAX_CHAMP);
    let url_ok = |v: &Value| {
        v.as_str().is_some_and(|s| {
            s.len() <= ICE_MAX_CHAMP
                && ["stun:", "stuns:", "turn:", "turns:"]
                    .iter()
                    .any(|p| s.starts_with(p))
        })
    };
    for s in ice {
        let urls_ok = match &s["urls"] {
            Value::Array(a) => a.len() <= ICE_MAX_URLS && a.iter().all(url_ok),
            u => url_ok(u),
        };
        if !urls_ok || !court(&s["username"]) || !court(&s["credential"]) {
            return Err("serveur ICE invalide".into());
        }
    }
    Ok(())
}

/// `e2ee` : clé de média de bout en bout (`{ key, index }`) quand la salle l'exige.
#[tauri::command]
pub async fn nv_connect(
    app: tauri::AppHandle,
    url: String,
    token: String,
    ice: Vec<Value>,
    mic: bool,
    mic_open: bool,
    e2ee: Option<Value>,
) -> Result<(), String> {
    valider_url_media(&url)?;
    valider_ice(&ice)?;
    #[cfg(target_os = "linux")]
    {
        let e2ee = e2ee
            .filter(|v| !v.is_null())
            .map(serde_json::from_value::<imp::MediaKey>)
            .transpose()
            .map_err(|e| e.to_string())?;
        imp::connect(app, url, token, ice, mic, mic_open, e2ee).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, url, token, ice, mic, mic_open, e2ee);
        Err(ABSENT.into())
    }
}

/// Nouvelle époque de la conversation pendant l'appel : nouvelle clé de média.
#[tauri::command]
pub async fn nv_set_key(key: String, index: i32) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_key(imp::MediaKey { key, index }).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (key, index);
        Err(ABSENT.into())
    }
}

#[tauri::command]
pub async fn nv_disconnect() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        imp::disconnect().await;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err(ABSENT.into())
    }
}

#[tauri::command]
pub async fn nv_set_mic(open: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_mic(open).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = open;
        Err(ABSENT.into())
    }
}

#[tauri::command]
pub async fn nv_set_deafen(deafened: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_deafen(deafened).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = deafened;
        Err(ABSENT.into())
    }
}

/// Annulation d'écho, réduction de bruit et gain automatique du micro natif.
#[tauri::command]
pub async fn nv_set_audio_processing(aec: bool, ns: bool, agc: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_audio_processing(aec, ns, agc).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (aec, ns, agc);
        Err(ABSENT.into())
    }
}

#[tauri::command]
pub async fn nv_set_peer_audio(identity: String, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_peer_audio(identity, enabled).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (identity, enabled);
        Err(ABSENT.into())
    }
}

/// Fenêtre détachée pour un flux vidéo local (`ws://127.0.0.1:PORT/w/…`).
/// La vue web Linux ne peut pas partager de flux entre fenêtres : chaque
/// fenêtre relit simplement le flux du serveur local.
#[tauri::command]
pub async fn nv_popout(app: tauri::AppHandle, url: String, title: String) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    // Seul le serveur vidéo local est accepté : jamais une URL arbitraire.
    let page = url
        .strip_prefix("ws://127.0.0.1:")
        .filter(|rest| rest.contains("/w/"))
        .map(|rest| format!("http://127.0.0.1:{}", rest.replacen("/w/", "/p/", 1)))
        .ok_or("URL de flux invalide")?;
    let page: tauri::Url = page.parse().map_err(|e| format!("{e}"))?;
    // `ws://127.0.0.1:80@hote/w/…` se lirait « utilisateur 127.0.0.1, hôte `hote` » :
    // l'hôte et le port sont donc revérifiés après analyse.
    if page.host_str() != Some("127.0.0.1") || page.port().is_none() || !page.username().is_empty()
    {
        return Err("URL de flux invalide".into());
    }
    let port = page.port();
    let label = format!("popout-{}", N.fetch_add(1, Ordering::Relaxed));
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(page))
        .title(title)
        .inner_size(1024.0, 600.0)
        // Audit D9 : comme la fenêtre principale, la fenêtre détachée ne quitte jamais
        // le serveur vidéo local ; aucune fenêtre supplémentaire.
        .on_navigation(move |u| {
            u.scheme() == "http" && u.host_str() == Some("127.0.0.1") && u.port() == port
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Renvoie l'URL de l'aperçu local quand la caméra démarre.
#[tauri::command]
pub async fn nv_set_camera(on: bool) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_camera(on).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = on;
        Err(ABSENT.into())
    }
}

/// Renvoie l'URL de l'aperçu local quand le partage démarre.
#[tauri::command]
pub async fn nv_set_screen(on: bool) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        imp::set_screen(on).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = on;
        Err(ABSENT.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serveur_media_de_l_appli_seulement() {
        assert!(valider_url_media("wss://forgechat.heiphaistos.org/livekit").is_ok());
        assert!(valider_url_media("wss://forgechat.heiphaistos.org:443/livekit").is_ok());
        for ko in [
            "ws://forgechat.heiphaistos.org/livekit",
            "wss://forgechat.heiphaistos.org.evil.example/livekit",
            "wss://evil.example/livekit",
            "wss://forgechat.heiphaistos.org@evil.example/",
            "wss://a:b@forgechat.heiphaistos.org/",
            "wss://forgechat.heiphaistos.org:7880/",
            "pas une url",
        ] {
            assert!(valider_url_media(ko).is_err(), "{ko}");
        }
    }

    #[test]
    fn serveurs_ice_bornes() {
        let ok = [
            json!({ "urls": ["stun:stun.example:3478"] }),
            json!({ "urls": "turns:turn.example:5349", "username": "u", "credential": "c" }),
            json!({ "urls": [] }),
        ];
        assert!(valider_ice(&ok).is_ok());
        assert!(valider_ice(&vec![json!({ "urls": "stun:a" }); 9]).is_err());
        for ko in [
            json!({ "urls": "http://evil.example" }),
            json!({ "urls": 3 }),
            json!({ "urls": vec!["stun:a"; 9] }),
            json!({ "urls": "stun:a", "username": "x".repeat(600) }),
            json!({ "urls": "stun:a", "credential": 1 }),
        ] {
            assert!(valider_ice(std::slice::from_ref(&ko)).is_err(), "{ko}");
        }
    }
}
