//! Implémentation Linux du vocal natif (voir `mod.rs`).

use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

use futures::StreamExt;
use livekit::e2ee::key_provider::{KeyProvider, KeyProviderOptions};
use livekit::e2ee::{E2eeOptions, EncryptionType};
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
    audio: PlatformAudio,
    mic: Option<LocalTrackPublication>,
    camera: Option<(LocalTrackPublication, Capture)>,
    screen: Option<(LocalTrackPublication, Capture)>,
    video: Arc<VideoServer>,
    events: tauri::async_runtime::JoinHandle<()>,
    app: AppHandle,
}

/// Clé de média de bout en bout (docs/CHIFFREMENT-E2E.md §5), calculée par le
/// front : chaîne base64url donnée telle quelle à LiveKit (dérivation PBKDF2 du
/// SDK, identique au web et au mobile) et index dans l'anneau (époque modulo 16).
#[derive(serde::Deserialize, Clone)]
pub struct MediaKey {
    pub key: String,
    pub index: i32,
}

/// Comme le fournisseur de clé du web : clé partagée, jamais de ratchet automatique.
fn key_options() -> KeyProviderOptions {
    KeyProviderOptions {
        ratchet_window_size: 0,
        ..Default::default()
    }
}

/// Le SDK crée les chiffreurs d'émission à l'index 0 : on leur donne l'index de
/// la clé courante (après chaque publication et à chaque nouvelle époque).
fn sync_key_index(room: &Room) {
    let manager = room.e2ee_manager();
    let Some(provider) = manager.key_provider() else {
        return;
    };
    let me = room.local_participant().identity();
    for ((identity, _), cryptor) in manager.frame_cryptors() {
        if identity == me {
            cryptor.set_key_index(provider.get_latest_key_index());
        }
    }
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

/// Traitement du micro choisi dans Réglages > Voix (annulation d'écho,
/// réduction de bruit, gain automatique). Gardé d'un appel à l'autre : ce sont
/// des préférences, pas un état de session.
#[derive(Clone, Copy)]
struct Processing {
    aec: bool,
    ns: bool,
    agc: bool,
}

fn processing() -> &'static std::sync::Mutex<Processing> {
    static P: OnceLock<std::sync::Mutex<Processing>> = OnceLock::new();
    P.get_or_init(|| {
        std::sync::Mutex::new(Processing {
            aec: true,
            ns: true,
            agc: true,
        })
    })
}

fn apply_processing(audio: &PlatformAudio, p: Processing) {
    let _ = audio.set_echo_cancellation(p.aec, true);
    let _ = audio.set_noise_suppression(p.ns, true);
    let _ = audio.set_auto_gain_control(p.agc, true);
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

fn state(
    app: &AppHandle,
    status: &'static str,
    quality: Option<&'static str>,
    reason: Option<String>,
) {
    let _ = app.emit(
        "nv:state",
        StateEvent {
            status,
            quality,
            reason,
        },
    );
}

/// `ice_servers` de `/api/voice/ice-config` : `urls` est une chaîne ou une liste.
fn ice_servers(ice: &[Value]) -> Vec<IceServer> {
    ice.iter()
        .filter_map(|s| {
            let urls = match &s["urls"] {
                Value::String(u) => vec![u.clone()],
                Value::Array(a) => a
                    .iter()
                    .filter_map(|u| u.as_str().map(String::from))
                    .collect(),
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
    let p = prefs().lock().unwrap_or_else(|e| e.into_inner());
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

async fn run_events(
    app: AppHandle,
    room: Arc<Room>,
    server: Arc<VideoServer>,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>,
) {
    while let Some(ev) = rx.recv().await {
        match ev {
            RoomEvent::TrackSubscribed {
                track,
                publication,
                participant,
            } => {
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
                let _ = app.emit(
                    "nv:track",
                    TrackEvent {
                        identity,
                        source,
                        active: true,
                        url,
                    },
                );
            }
            RoomEvent::TrackUnsubscribed {
                publication,
                participant,
                ..
            } => {
                let identity = participant.identity().to_string();
                let source = source_name(publication.source());
                server.remove(&format!("{}-{}", identity, source));
                let _ = app.emit(
                    "nv:track",
                    TrackEvent {
                        identity,
                        source,
                        active: false,
                        url: None,
                    },
                );
            }
            RoomEvent::ActiveSpeakersChanged { speakers } => {
                let ids: Vec<String> = speakers.iter().map(|p| p.identity().to_string()).collect();
                let _ = app.emit("nv:speakers", ids);
            }
            RoomEvent::ConnectionQualityChanged {
                quality,
                participant,
            } => {
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

pub async fn connect(
    app: AppHandle,
    url: String,
    token: String,
    ice: Vec<Value>,
    mic: bool,
    mic_open: bool,
    e2ee: Option<MediaKey>,
) -> Result<(), String> {
    // Mesuré : sans fournisseur installé, rustls panique dans le thread tokio et
    // la commande ne répond jamais (le front restait sur « Connexion… »).
    let _ = rustls::crypto::ring::default_provider().install_default();
    disconnect().await;

    let audio = PlatformAudio::new().map_err(|e| format!("audio du système indisponible : {e}"))?;
    // Même traitement qu'un navigateur (tout actif par défaut) : sans annulation
    // d'écho, un casque non utilisé renvoie la voix des autres dans le micro.
    let p = *processing().lock().unwrap_or_else(|e| e.into_inner());
    apply_processing(&audio, p);

    let video = VideoServer::start().map_err(|e| format!("serveur vidéo local : {e}"))?;
    let mut rtc = RtcConfiguration::default();
    rtc.ice_servers = ice_servers(&ice);
    let mut options = RoomOptions::default();
    options.auto_subscribe = true;
    options.adaptive_stream = false;
    options.dynacast = true;
    options.rtc_config = rtc;
    // Salle chiffrée de bout en bout : trames (et paquets de données) chiffrés
    // avec la clé de média du salon ou de l'appel.
    if let Some(k) = &e2ee {
        let provider = KeyProvider::with_shared_key(key_options(), k.key.clone().into_bytes());
        provider.set_shared_key(k.key.clone().into_bytes(), k.index);
        options.encryption = Some(E2eeOptions {
            encryption_type: EncryptionType::Gcm,
            key_provider: provider,
        });
    }
    state(&app, "connecting", None, None);
    let (room, rx) = Room::connect(&url, &token, options).await.map_err(|e| {
        state(&app, "failed", None, Some(e.to_string()));
        format!("connexion au serveur audio/vidéo impossible : {e}")
    })?;
    let room = Arc::new(room);

    // Micro refusé (jeton sans droit de parole, périphérique absent) : on reste
    // dans le salon pour écouter, au lieu d'échouer toute la connexion.
    let mic_pub = if mic {
        let track = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
        match room
            .local_participant()
            .publish_track(
                LocalTrack::Audio(track),
                TrackPublishOptions {
                    source: TrackSource::Microphone,
                    ..Default::default()
                },
            )
            .await
        {
            Ok(publication) => {
                if !mic_open {
                    publication.mute();
                }
                Some(publication)
            }
            Err(e) => {
                eprintln!("[ForgeChat] micro non publié : {e}");
                None
            }
        }
    } else {
        None
    };

    sync_key_index(&room);

    // Pistes déjà publiées avant notre arrivée : l'abonnement automatique les
    // livre en `TrackSubscribed`, traité par la boucle d'événements.
    let events =
        tauri::async_runtime::spawn(run_events(app.clone(), room.clone(), video.clone(), rx));
    state(&app, "connected", None, None);
    *session().lock().await = Some(Session {
        room,
        audio,
        mic: mic_pub,
        camera: None,
        screen: None,
        video,
        events,
        app,
    });
    Ok(())
}

pub async fn disconnect() {
    let Some(s) = session().lock().await.take() else {
        return;
    };
    // Les captures s'arrêtent en premier (threads joints à la libération).
    drop(s.camera);
    drop(s.screen);
    // Boucle d'événements arrêtée AVANT la fermeture : sinon son « disconnected »
    // arrivait aux écouteurs de la session suivante (appel coupé à peine ouvert).
    s.events.abort();
    let _ = s.room.close().await;
    *prefs().lock().unwrap_or_else(|e| e.into_inner()) = AudioPrefs::default();
}

/// Nouvelle époque pendant l'appel : nouvelle clé, émise aussitôt à son index.
pub async fn set_key(key: MediaKey) -> Result<(), String> {
    let guard = session().lock().await;
    let Some(s) = guard.as_ref() else {
        return Ok(());
    };
    let Some(provider) = s.room.e2ee_manager().key_provider() else {
        return Err("appel non chiffré".into());
    };
    provider.set_shared_key(key.key.into_bytes(), key.index);
    sync_key_index(&s.room);
    Ok(())
}

pub async fn set_mic(open: bool) -> Result<(), String> {
    let guard = session().lock().await;
    let Some(s) = guard.as_ref() else {
        return Ok(());
    };
    if let Some(p) = &s.mic {
        if open {
            p.unmute()
        } else {
            p.mute()
        }
    }
    Ok(())
}

/// Réglages > Voix : appliqué tout de suite à l'appel en cours, et aux suivants.
pub async fn set_audio_processing(aec: bool, ns: bool, agc: bool) -> Result<(), String> {
    let p = Processing { aec, ns, agc };
    *processing().lock().unwrap_or_else(|e| e.into_inner()) = p;
    if let Some(s) = session().lock().await.as_ref() {
        apply_processing(&s.audio, p);
    }
    Ok(())
}

/// Port du serveur vidéo local de la session en cours (`None` hors appel).
pub async fn video_port() -> Option<u16> {
    session().lock().await.as_ref().map(|s| s.video.port())
}

pub async fn set_deafen(deafened: bool) -> Result<(), String> {
    prefs().lock().unwrap_or_else(|e| e.into_inner()).deafened = deafened;
    if let Some(s) = session().lock().await.as_ref() {
        apply_audio_all(&s.room);
    }
    Ok(())
}

pub async fn set_peer_audio(identity: String, enabled: bool) -> Result<(), String> {
    {
        let mut p = prefs().lock().unwrap_or_else(|e| e.into_inner());
        if enabled {
            p.muted_peers.remove(&identity);
        } else {
            p.muted_peers.insert(identity);
        }
    }
    if let Some(s) = session().lock().await.as_ref() {
        apply_audio_all(&s.room);
    }
    Ok(())
}

async fn publish_video(
    room: &Room,
    name: &str,
    source: livekit::webrtc::video_source::native::NativeVideoSource,
    kind: TrackSource,
) -> Result<LocalTrackPublication, String> {
    let track = LocalVideoTrack::create_video_track(name, RtcVideoSource::Native(source));
    room.local_participant()
        .publish_track(
            LocalTrack::Video(track),
            TrackPublishOptions {
                source: kind,
                simulcast: kind == TrackSource::Camera,
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())
}

fn video_slot(s: &mut Session, screen: bool) -> &mut Option<(LocalTrackPublication, Capture)> {
    if screen {
        &mut s.screen
    } else {
        &mut s.camera
    }
}

/// Caméra ou partage d'écran. La capture démarre SANS le verrou de session : le
/// sélecteur d'écran du système peut attendre l'utilisateur jusqu'à 60 s, et le
/// verrou tenu bloquait micro, push-to-talk et sortie pendant tout ce temps.
async fn set_video(on: bool, screen: bool) -> Result<Option<String>, String> {
    let (room, server, app) = {
        let mut guard = session().lock().await;
        let Some(s) = guard.as_mut() else {
            return Err("pas d'appel en cours".into());
        };
        if let Some((publication, capture)) = video_slot(s, screen).take() {
            let _ = s
                .room
                .local_participant()
                .unpublish_track(&publication.sid())
                .await;
            drop(capture);
        }
        if !on {
            return Ok(None);
        }
        (s.room.clone(), s.video.clone(), s.app.clone())
    };
    let key = if screen {
        "local-screen"
    } else {
        "local-camera"
    }
    .to_string();
    let (capture, source) = {
        let (v, k) = (server.clone(), key.clone());
        tauri::async_runtime::spawn_blocking(move || {
            if screen {
                // Partage arrêté par le système (portail fermé) : le front coupe le partage.
                video::start_screen(v, k, move || {
                    let _ = app.emit("nv:local_ended", "screen");
                })
            } else {
                video::start_camera(v, k)
            }
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let (name, kind) = if screen {
        ("screen", TrackSource::Screenshare)
    } else {
        ("camera", TrackSource::Camera)
    };
    let publication = publish_video(&room, name, source, kind).await?;
    sync_key_index(&room);
    let mut guard = session().lock().await;
    match guard.as_mut() {
        Some(s) if Arc::ptr_eq(&s.room, &room) => {
            // Une capture lancée en parallèle (double clic) est remplacée.
            if let Some((old, old_capture)) = video_slot(s, screen).replace((publication, capture))
            {
                let _ = s.room.local_participant().unpublish_track(&old.sid()).await;
                drop(old_capture);
            }
            Ok(Some(server.url(&key)))
        }
        _ => {
            // Appel quitté pendant la capture.
            let _ = room
                .local_participant()
                .unpublish_track(&publication.sid())
                .await;
            drop(capture);
            Err("pas d'appel en cours".into())
        }
    }
}

pub async fn set_camera(on: bool) -> Result<Option<String>, String> {
    set_video(on, false).await
}

pub async fn set_screen(on: bool) -> Result<Option<String>, String> {
    set_video(on, true).await
}
