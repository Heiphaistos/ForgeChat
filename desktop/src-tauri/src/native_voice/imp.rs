//! Implémentation Linux du vocal natif (voir `mod.rs`).

use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

use futures::StreamExt;
use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use livekit::webrtc::prelude::{IceServer, RtcConfiguration, RtcVideoSource};
use livekit::webrtc::video_stream::native::NativeVideoStream;
use livekit::PlatformAudio;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::video::{self, Capture, VideoServer};

struct Session {
    room: Arc<Room>,
    /// Garde le module audio natif actif (micro + lecture des voix).
    _audio: PlatformAudio,
    mic: Option<LocalTrackPublication>,
    camera: Option<(LocalTrackPublication, Capture)>,
    screen: Option<(LocalTrackPublication, Capture)>,
    video: Arc<VideoServer>,
    events: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
struct AudioPrefs {
    deafened: bool,
    muted_peers: HashSet<String>,
}

fn session() -> &'static Mutex<Option<Session>> {
    static S: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

fn prefs() -> &'static std::sync::Mutex<AudioPrefs> {
    static P: OnceLock<std::sync::Mutex<AudioPrefs>> = OnceLock::new();
    P.get_or_init(Default::default)
}

#[derive(Serialize, Clone)]
struct TrackEvent {
    identity: String,
    /// `camera`, `screen`, `microphone` ou `screen_audio`.
    source: &'static str,
    active: bool,
    url: Option<String>,
}

#[derive(Serialize, Clone)]
struct StateEvent {
    status: &'static str,
    quality: Option<&'static str>,
    reason: Option<String>,
}

fn source_name(s: TrackSource) -> &'static str {
    match s {
        TrackSource::Camera => "camera",
        TrackSource::Screenshare => "screen",
        TrackSource::ScreenshareAudio => "screen_audio",
        _ => "microphone",
    }
}

fn state(app: &AppHandle, status: &'static str, quality: Option<&'static str>, reason: Option<String>) {
    let _ = app.emit("nv:state", StateEvent { status, quality, reason });
}

/// `ice_servers` de `/api/voice/ice-config` : `urls` est une chaîne ou une liste.
fn ice_servers(ice: &[Value]) -> Vec<IceServer> {
    ice.iter()
        .filter_map(|s| {
            let urls = match &s["urls"] {
                Value::String(u) => vec![u.clone()],
                Value::Array(a) => a.iter().filter_map(|u| u.as_str().map(String::from)).collect(),
                _ => return None,
            };
            Some(IceServer {
                urls,
                username: s["username"].as_str().unwrap_or_default().into(),
                password: s["credential"].as_str().unwrap_or_default().into(),
            })
        })
        .collect()
}

/// Applique sourdine globale et coupures individuelles à une piste audio reçue.
fn apply_audio(identity: &str, publication: &RemoteTrackPublication) {
    let p = prefs().lock().unwrap();
    publication.set_enabled(!p.deafened && !p.muted_peers.contains(identity));
}

fn apply_audio_all(room: &Room) {
    for (id, participant) in room.remote_participants() {
        for (_, publication) in participant.track_publications() {
            if publication.kind() == TrackKind::Audio {
                apply_audio(id.as_str(), &publication);
            }
        }
    }
}

/// Une image reçue sur deux threads : le décodage WebRTC d'un côté, la
/// conversion JPEG ici, sans jamais bloquer le runtime asynchrone.
fn pump_video(server: Arc<VideoServer>, key: String, track: RemoteVideoTrack) {
    let _ = std::thread::Builder::new().name("fc-video-rx".into()).spawn(move || {
        let mut stream = NativeVideoStream::new(track.rtc_track());
        let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
        // Compteurs journalisés toutes les 10 s : seul moyen de diagnostiquer une
        // vidéo saccadée chez un utilisateur Linux.
        let (mut received, mut published, mut since) = (0u32, 0u32, std::time::Instant::now());
        while let Some(frame) = futures::executor::block_on(stream.next()) {
            received += 1;
            if since.elapsed() >= std::time::Duration::from_secs(10) {
                eprintln!("[ForgeChat] vidéo {key} : {received} images reçues, {published} affichées en 10 s ({}x{})", frame.buffer.width(), frame.buffer.height());
                (received, published, since) = (0, 0, std::time::Instant::now());
            }
            // 30 images/s au plus : la vue web n'en affiche pas davantage.
            if last.elapsed() < std::time::Duration::from_millis(33) {
                continue;
            }
            last = std::time::Instant::now();
            if let Some(jpeg) = video::i420_to_jpeg(frame.buffer.to_i420()) {
                server.publish(&key, jpeg);
                published += 1;
            }
        }
        server.remove(&key);
    });
}

async fn run_events(app: AppHandle, room: Arc<Room>, server: Arc<VideoServer>, mut rx: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>) {
    while let Some(ev) = rx.recv().await {
        match ev {
            RoomEvent::TrackSubscribed { track, publication, participant } => {
                let identity = participant.identity().to_string();
                let source = source_name(publication.source());
                let url = match track {
                    RemoteTrack::Video(v) => {
                        let key = format!("{}-{}", identity, source);
                        pump_video(server.clone(), key.clone(), v);
                        Some(server.url(&key))
                    }
                    RemoteTrack::Audio(_) => {
                        apply_audio(&identity, &publication);
                        None
                    }
                };
                let _ = app.emit("nv:track", TrackEvent { identity, source, active: true, url });
            }
            RoomEvent::TrackUnsubscribed { publication, participant, .. } => {
                let identity = participant.identity().to_string();
                let source = source_name(publication.source());
                server.remove(&format!("{}-{}", identity, source));
                let _ = app.emit("nv:track", TrackEvent { identity, source, active: false, url: None });
            }
            RoomEvent::ActiveSpeakersChanged { speakers } => {
                let ids: Vec<String> = speakers.iter().map(|p| p.identity().to_string()).collect();
                let _ = app.emit("nv:speakers", ids);
            }
            RoomEvent::ConnectionQualityChanged { quality, participant } => {
                if participant.identity() == room.local_participant().identity() {
                    let q = match quality {
                        ConnectionQuality::Excellent => "excellent",
                        ConnectionQuality::Good => "good",
                        ConnectionQuality::Poor => "poor",
                        ConnectionQuality::Lost => "lost",
                    };
                    state(&app, "connected", Some(q), None);
                }
            }
            RoomEvent::Reconnecting => state(&app, "reconnecting", None, None),
            RoomEvent::Reconnected => state(&app, "connected", None, None),
            RoomEvent::Disconnected { reason } => {
                state(&app, "disconnected", None, Some(format!("{reason:?}")));
                break;
            }
            _ => {}
        }
    }
}

pub async fn connect(app: AppHandle, url: String, token: String, ice: Vec<Value>, mic: bool, mic_open: bool) -> Result<(), String> {
    // Mesuré : sans fournisseur installé, rustls panique dans le thread tokio et
    // la commande ne répond jamais (le front restait sur « Connexion… »).
    let _ = rustls::crypto::ring::default_provider().install_default();
    disconnect().await;

    let audio = PlatformAudio::new().map_err(|e| format!("audio du système indisponible : {e}"))?;
    // Même traitement qu'un navigateur : sans annulation d'écho, un casque
    // non utilisé renvoie la voix des autres dans le micro.
    let _ = audio.set_echo_cancellation(true, true);
    let _ = audio.set_noise_suppression(true, true);
    let _ = audio.set_auto_gain_control(true, true);

    let video = VideoServer::start().map_err(|e| format!("serveur vidéo local : {e}"))?;
    let mut rtc = RtcConfiguration::default();
    rtc.ice_servers = ice_servers(&ice);
    let mut options = RoomOptions::default();
    options.auto_subscribe = true;
    options.adaptive_stream = false;
    options.dynacast = true;
    options.rtc_config = rtc;
    state(&app, "connecting", None, None);
    let (room, rx) = Room::connect(&url, &token, options).await.map_err(|e| {
        state(&app, "failed", None, Some(e.to_string()));
        format!("connexion au serveur audio/vidéo impossible : {e}")
    })?;
    let room = Arc::new(room);

    let mic_pub = if mic {
        let track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
        let publication = room
            .local_participant()
            .publish_track(LocalTrack::Audio(track), TrackPublishOptions { source: TrackSource::Microphone, ..Default::default() })
            .await
            .map_err(|e| format!("micro : {e}"))?;
        if !mic_open {
            publication.mute();
        }
        Some(publication)
    } else {
        None
    };

    // Pistes déjà publiées avant notre arrivée : l'abonnement automatique les
    // livre en `TrackSubscribed`, traité par la boucle d'événements.
    let events = tauri::async_runtime::spawn(run_events(app.clone(), room.clone(), video.clone(), rx));
    state(&app, "connected", None, None);
    *session().lock().await = Some(Session { room, _audio: audio, mic: mic_pub, camera: None, screen: None, video, events });
    Ok(())
}

pub async fn disconnect() {
    let Some(s) = session().lock().await.take() else { return };
    // Les captures s'arrêtent en premier (threads joints à la libération).
    drop(s.camera);
    drop(s.screen);
    let _ = s.room.close().await;
    s.events.abort();
    *prefs().lock().unwrap() = AudioPrefs::default();
}

pub async fn set_mic(open: bool) -> Result<(), String> {
    let guard = session().lock().await;
    let Some(s) = guard.as_ref() else { return Ok(()) };
    if let Some(p) = &s.mic {
        if open { p.unmute() } else { p.mute() }
    }
    Ok(())
}

pub async fn set_deafen(deafened: bool) -> Result<(), String> {
    prefs().lock().unwrap().deafened = deafened;
    if let Some(s) = session().lock().await.as_ref() {
        apply_audio_all(&s.room);
    }
    Ok(())
}

pub async fn set_peer_audio(identity: String, enabled: bool) -> Result<(), String> {
    {
        let mut p = prefs().lock().unwrap();
        if enabled { p.muted_peers.remove(&identity); } else { p.muted_peers.insert(identity); }
    }
    if let Some(s) = session().lock().await.as_ref() {
        apply_audio_all(&s.room);
    }
    Ok(())
}

async fn publish_video(room: &Room, name: &str, source: livekit::webrtc::video_source::native::NativeVideoSource, kind: TrackSource) -> Result<LocalTrackPublication, String> {
    let track = LocalVideoTrack::create_video_track(name, RtcVideoSource::Native(source));
    room.local_participant()
        .publish_track(
            LocalTrack::Video(track),
            TrackPublishOptions { source: kind, simulcast: kind == TrackSource::Camera, ..Default::default() },
        )
        .await
        .map_err(|e| e.to_string())
}

pub async fn set_camera(on: bool) -> Result<Option<String>, String> {
    let mut guard = session().lock().await;
    let Some(s) = guard.as_mut() else { return Err("pas d'appel en cours".into()) };
    if let Some((publication, capture)) = s.camera.take() {
        let _ = s.room.local_participant().unpublish_track(&publication.sid()).await;
        drop(capture);
    }
    if !on {
        return Ok(None);
    }
    let key = "local-camera".to_string();
    let (capture, source) = {
        let v = s.video.clone();
        let k = key.clone();
        tauri::async_runtime::spawn_blocking(move || video::start_camera(v, k)).await.map_err(|e| e.to_string())??
    };
    let publication = publish_video(&s.room, "camera", source, TrackSource::Camera).await?;
    s.camera = Some((publication, capture));
    Ok(Some(s.video.url(&key)))
}

pub async fn set_screen(on: bool) -> Result<Option<String>, String> {
    let mut guard = session().lock().await;
    let Some(s) = guard.as_mut() else { return Err("pas d'appel en cours".into()) };
    if let Some((publication, capture)) = s.screen.take() {
        let _ = s.room.local_participant().unpublish_track(&publication.sid()).await;
        drop(capture);
    }
    if !on {
        return Ok(None);
    }
    let key = "local-screen".to_string();
    let (capture, source) = {
        let v = s.video.clone();
        let k = key.clone();
        tauri::async_runtime::spawn_blocking(move || video::start_screen(v, k)).await.map_err(|e| e.to_string())??
    };
    let publication = publish_video(&s.room, "screen", source, TrackSource::Screenshare).await?;
    s.screen = Some((publication, capture));
    Ok(Some(s.video.url(&key)))
}
