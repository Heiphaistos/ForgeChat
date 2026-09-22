//! Vidéo du vocal natif Linux.
//!
//! - Conversions YUV/RGB (images reçues et caméra).
//! - Serveur MJPEG local : la vue web affiche chaque flux avec un simple
//!   `<img src="http://127.0.0.1:PORT/v/CLE?k=SECRET">`. WebKitGTK n'a pas
//!   WebRTC, mais il lit le MJPEG nativement dans une balise image.
//! - Captures caméra (V4L2) et écran (capture native de libwebrtc,
//!   portail PipeWire sous Wayland), publiées vers le SFU.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use livekit::webrtc::desktop_capturer::{
    CaptureError, DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions, DesktopFrame,
};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::prelude::{I420Buffer, VideoBuffer, VideoFrame, VideoResolution, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;

/// Largeur maximale des images servies à la vue web : au-delà, l'encodage JPEG
/// coûte plus qu'il n'apporte sur une tuile ou une fenêtre détachée.
pub const MAX_PREVIEW_WIDTH: u32 = 1920;
const JPEG_QUALITY: u8 = 75;

// ── Conversions ──────────────────────────────────────────────────────────────

fn clamp(v: i32) -> u8 {
    v.clamp(0, 255) as u8
}

/// I420 (BT.601, plage limitée) vers RGB24.
pub fn i420_to_rgb(
    y: &[u8], sy: usize, u: &[u8], su: usize, v: &[u8], sv: usize, w: usize, h: usize,
) -> Vec<u8> {
    i420_to_rgb_step(y, sy, u, su, v, sv, w, h, 1)
}

/// Idem en ne gardant qu'un pixel sur `step` dans chaque direction : réduction
/// d'échelle gratuite pour les aperçus (sortie `w/step` x `h/step`).
#[allow(clippy::too_many_arguments)]
fn i420_to_rgb_step(
    y: &[u8], sy: usize, u: &[u8], su: usize, v: &[u8], sv: usize, w: usize, h: usize, step: usize,
) -> Vec<u8> {
    let (ow, oh) = (w / step, h / step);
    let mut out = vec![0u8; ow * oh * 3];
    for orow in 0..oh {
        for ocol in 0..ow {
            let (row, col) = (orow * step, ocol * step);
            let yy = y[row * sy + col] as i32 - 16;
            let uu = u[(row / 2) * su + col / 2] as i32 - 128;
            let vv = v[(row / 2) * sv + col / 2] as i32 - 128;
            let c = 298 * yy;
            let i = (orow * ow + ocol) * 3;
            out[i] = clamp((c + 409 * vv + 128) >> 8);
            out[i + 1] = clamp((c - 100 * uu - 208 * vv + 128) >> 8);
            out[i + 2] = clamp((c + 516 * uu + 128) >> 8);
        }
    }
    out
}

/// RGB24 vers un tampon I420 prêt à publier.
pub fn rgb_to_i420(rgb: &[u8], w: u32, h: u32) -> I420Buffer {
    let mut buf = I420Buffer::new(w, h);
    let (sy, su, sv) = buf.strides();
    let (y, u, v) = buf.data_mut();
    let (w, h) = (w as usize, h as usize);
    for row in 0..h {
        for col in 0..w {
            let i = (row * w + col) * 3;
            let (r, g, b) = (rgb[i] as i32, rgb[i + 1] as i32, rgb[i + 2] as i32);
            y[row * sy as usize + col] = clamp(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16);
            if row % 2 == 0 && col % 2 == 0 {
                let o = (row / 2) * su as usize + col / 2;
                u[o] = clamp(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128);
                v[(row / 2) * sv as usize + col / 2] = clamp(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128);
            }
        }
    }
    buf
}

/// YUYV (YUY2, format brut des webcams) vers I420.
pub fn yuyv_to_i420(src: &[u8], w: u32, h: u32) -> I420Buffer {
    let mut buf = I420Buffer::new(w, h);
    let (sy, su, sv) = buf.strides();
    let (y, u, v) = buf.data_mut();
    let (w, h) = (w as usize, h as usize);
    for row in 0..h {
        for col in 0..w {
            let i = (row * w + col) * 2;
            y[row * sy as usize + col] = src[i];
            if row % 2 == 0 && col % 2 == 0 {
                u[(row / 2) * su as usize + col / 2] = src[i + 1];
                v[(row / 2) * sv as usize + col / 2] = src[i + 3];
            }
        }
    }
    buf
}

pub fn encode_jpeg(rgb: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity((w * h / 4) as usize);
    jpeg_encoder::Encoder::new(&mut out, JPEG_QUALITY)
        .encode(rgb, w as u16, h as u16, jpeg_encoder::ColorType::Rgb)
        .ok()?;
    Some(out)
}

/// Image I420 -> JPEG, réduite par pas entier sous `max_width`.
pub fn i420_to_jpeg_max(buf: &I420Buffer, max_width: u32) -> Option<Vec<u8>> {
    let (w, h) = (buf.width(), buf.height());
    if w < 2 || h < 2 {
        return None;
    }
    let step = w.div_ceil(max_width).max(1) as usize;
    let (sy, su, sv) = buf.strides();
    let (y, u, v) = buf.data();
    let rgb = i420_to_rgb_step(y, sy as usize, u, su as usize, v, sv as usize, w as usize, h as usize, step);
    encode_jpeg(&rgb, w / step as u32, h / step as u32)
}

/// Image reçue du SFU, pour une tuile ou une fenêtre détachée.
pub fn i420_to_jpeg(buf: &I420Buffer) -> Option<Vec<u8>> {
    i420_to_jpeg_max(buf, MAX_PREVIEW_WIDTH)
}

// ── Serveur MJPEG local ──────────────────────────────────────────────────────

#[derive(Default)]
struct Frames {
    latest: Mutex<HashMap<String, (u64, Arc<Vec<u8>>)>>,
    changed: Condvar,
}

pub struct VideoServer {
    port: u16,
    secret: String,
    frames: Arc<Frames>,
}

fn random_secret() -> String {
    let mut bytes = [0u8; 16];
    // Module Linux uniquement : /dev/urandom est toujours là.
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut bytes);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl VideoServer {
    pub fn start() -> std::io::Result<Arc<Self>> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let server = Arc::new(Self {
            port: listener.local_addr()?.port(),
            secret: random_secret(),
            frames: Arc::new(Frames::default()),
        });
        let s = server.clone();
        thread::Builder::new().name("fc-mjpeg".into()).spawn(move || {
            for stream in listener.incoming().flatten() {
                let s = s.clone();
                let _ = thread::Builder::new().name("fc-mjpeg-client".into()).spawn(move || s.serve(stream));
            }
        })?;
        Ok(server)
    }

    pub fn url(&self, key: &str) -> String {
        format!("http://127.0.0.1:{}/v/{}?k={}", self.port, key, self.secret)
    }

    pub fn publish(&self, key: &str, jpeg: Vec<u8>) {
        let mut map = self.frames.latest.lock().unwrap();
        let seq = map.get(key).map(|(s, _)| s + 1).unwrap_or(1);
        map.insert(key.to_string(), (seq, Arc::new(jpeg)));
        self.frames.changed.notify_all();
    }

    pub fn remove(&self, key: &str) {
        self.frames.latest.lock().unwrap().remove(key);
        self.frames.changed.notify_all();
    }

    fn serve(&self, mut stream: TcpStream) {
        let mut req = [0u8; 2048];
        let n = stream.read(&mut req).unwrap_or(0);
        let line = String::from_utf8_lossy(&req[..n]);
        let path = line.split_whitespace().nth(1).unwrap_or("");
        let (page, rest) = match (path.strip_prefix("/v/"), path.strip_prefix("/p/")) {
            (Some(r), _) => (false, r),
            (_, Some(r)) => (true, r),
            _ => return self.reply(stream, "404 Not Found"),
        };
        let (key, query) = rest.split_once('?').unwrap_or((rest, ""));
        // Refuse toute autre application locale qui tenterait de lire les flux.
        if query != format!("k={}", self.secret) {
            return self.reply(stream, "403 Forbidden");
        }
        if page {
            // Page d'une fenêtre détachée : le flux en plein cadre, double-clic plein écran.
            let body = format!(
                "<!doctype html><meta charset=utf-8><title>ForgeChat</title>\
                 <body style=\"margin:0;background:#000;height:100vh;display:flex\">\
                 <img src=\"/v/{key}?k={s}\" style=\"width:100%;height:100%;object-fit:contain\" \
                 ondblclick=\"document.fullscreenElement?document.exitFullscreen():this.requestFullscreen()\">",
                s = self.secret
            );
            let _ = stream.write_all(format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body
            ).as_bytes());
            return;
        }
        let head = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=fcframe\r\n\
                    Cache-Control: no-store\r\nConnection: close\r\n\r\n";
        if stream.write_all(head.as_bytes()).is_err() {
            return;
        }
        let mut last_seq = 0u64;
        loop {
            let frame = {
                let mut map = self.frames.latest.lock().unwrap();
                loop {
                    match map.get(key) {
                        None => return, // flux terminé : l'<img> passe en erreur, l'UI retombe sur l'avatar
                        Some((seq, data)) if *seq != last_seq => break Some((*seq, data.clone())),
                        Some(_) => {
                            let (m, timeout) = self.frames.changed.wait_timeout(map, Duration::from_secs(10)).unwrap();
                            map = m;
                            if timeout.timed_out() && !map.contains_key(key) {
                                return;
                            }
                        }
                    }
                }
            };
            let Some((seq, data)) = frame else { return };
            last_seq = seq;
            let part = format!("--fcframe\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", data.len());
            if stream.write_all(part.as_bytes()).is_err()
                || stream.write_all(&data).is_err()
                || stream.write_all(b"\r\n").is_err()
            {
                return;
            }
        }
    }

    fn reply(&self, mut stream: TcpStream, status: &str) {
        let _ = stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes());
    }
}

// ── Captures locales ─────────────────────────────────────────────────────────

/// Thread de capture ; s'arrête quand la valeur est libérée.
pub struct Capture {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

type SourceSlot = Arc<Mutex<Option<NativeVideoSource>>>;

fn push(slot: &SourceSlot, frame: &VideoFrame<I420Buffer>) {
    if let Some(src) = slot.lock().unwrap().as_ref() {
        src.capture_frame(frame);
    }
}

fn frame_of(buffer: I420Buffer) -> VideoFrame<I420Buffer> {
    VideoFrame::new(VideoRotation::VideoRotation0, buffer)
}

/// Démarre la capture puis crée la source à la résolution réelle du périphérique.
fn start<F>(name: &str, screencast: bool, body: F) -> Result<(Capture, NativeVideoSource), String>
where
    F: FnOnce(Arc<AtomicBool>, SourceSlot, mpsc::Sender<Result<(u32, u32), String>>) + Send + 'static,
{
    let stop = Arc::new(AtomicBool::new(false));
    let slot: SourceSlot = Arc::new(Mutex::new(None));
    let (tx, rx) = mpsc::channel();
    let (s, sl) = (stop.clone(), slot.clone());
    let handle = thread::Builder::new()
        .name(name.into())
        .spawn(move || body(s, sl, tx))
        .map_err(|e| e.to_string())?;
    let mut capture = Capture { stop, handle: Some(handle) };
    match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(Ok((w, h))) => {
            let source = NativeVideoSource::new(VideoResolution { width: w, height: h }, screencast);
            *slot.lock().unwrap() = Some(source.clone());
            Ok((capture, source))
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            capture.stop.store(true, Ordering::Relaxed);
            capture.handle.take();
            Err("capture : aucune image reçue".into())
        }
    }
}

/// Webcam V4L2 : MJPEG (décodé par zune-jpeg) ou YUYV. `preview` reçoit
/// l'aperçu local en JPEG pour la tuile « Vous ».
pub fn start_camera(preview: Arc<VideoServer>, preview_key: String) -> Result<(Capture, NativeVideoSource), String> {
    use nokhwa::pixel_format::RgbFormat;
    use nokhwa::utils::{CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType, Resolution};

    start("fc-camera", false, move |stop, slot, ready| {
        let wanted = CameraFormat::new(Resolution::new(1280, 720), FrameFormat::MJPEG, 30);
        let fmt = RequestedFormat::new::<RgbFormat>(RequestedFormatType::Closest(wanted));
        let mut cam = match nokhwa::Camera::new(CameraIndex::Index(0), fmt).and_then(|mut c| c.open_stream().map(|_| c)) {
            Ok(c) => c,
            Err(e) => { let _ = ready.send(Err(format!("caméra indisponible : {e}"))); return; }
        };
        let res = cam.resolution();
        let (w, h) = (res.width() & !1, res.height() & !1);
        let _ = ready.send(Ok((w, h)));
        let mut last_preview = Instant::now() - Duration::from_secs(1);
        while !stop.load(Ordering::Relaxed) {
            let Ok(frame) = cam.frame() else { thread::sleep(Duration::from_millis(20)); continue };
            let raw = frame.buffer();
            let show = last_preview.elapsed() >= Duration::from_millis(66);
            match frame.source_frame_format() {
                FrameFormat::MJPEG => {
                    let mut dec = zune_jpeg::JpegDecoder::new(std::io::Cursor::new(raw));
                    let Ok(rgb) = dec.decode() else { continue };
                    push(&slot, &frame_of(rgb_to_i420(&rgb, w, h)));
                    if show { preview.publish(&preview_key, raw.to_vec()); last_preview = Instant::now(); }
                }
                FrameFormat::YUYV => {
                    let frame = frame_of(yuyv_to_i420(raw, w, h));
                    if show {
                        if let Some(j) = i420_to_jpeg_max(&frame.buffer, 640) { preview.publish(&preview_key, j); }
                        last_preview = Instant::now();
                    }
                    push(&slot, &frame);
                }
                _ => {}
            }
        }
        let _ = cam.stop_stream();
        preview.remove(&preview_key);
    })
}

/// Partage d'écran natif : portail PipeWire (sélecteur du système) sous
/// Wayland, capture X11 sinon.
pub fn start_screen(preview: Arc<VideoServer>, preview_key: String) -> Result<(Capture, NativeVideoSource), String> {
    start("fc-screen", true, move |stop, slot, ready| {
        let ready = Mutex::new(Some(ready));
        let mut out = frame_of(I420Buffer::new(2, 2));
        let mut last_preview = Instant::now() - Duration::from_secs(1);
        let (pv, pk) = (preview.clone(), preview_key.clone());
        let callback = move |result: Result<DesktopFrame, CaptureError>| {
            let Ok(frame) = result else { return };
            let (w, h) = (frame.width() & !1, frame.height() & !1);
            if w <= 0 || h <= 0 { return; }
            if let Some(tx) = ready.lock().unwrap().take() { let _ = tx.send(Ok((w as u32, h as u32))); }
            if out.buffer.width() as i32 != w || out.buffer.height() as i32 != h {
                out.buffer = I420Buffer::new(w as u32, h as u32);
            }
            let (sy, su, sv) = out.buffer.strides();
            let (y, u, v) = out.buffer.data_mut();
            yuv_helper::argb_to_i420(frame.data(), frame.stride(), y, sy, u, su, v, sv, w, h);
            push(&slot, &out);
            // Aperçu local réduit, 5 images/s : juste de quoi savoir ce qu'on partage.
            if last_preview.elapsed() >= Duration::from_millis(200) {
                last_preview = Instant::now();
                if let Some(j) = i420_to_jpeg_max(&out.buffer, 640) { pv.publish(&pk, j); }
            }
        };
        let options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Generic);
        let Some(mut capturer) = DesktopCapturer::new(options) else {
            eprintln!("[ForgeChat] capture d'écran indisponible");
            return;
        };
        let source = capturer.get_source_list().first().cloned();
        capturer.start_capture(source, callback);
        while !stop.load(Ordering::Relaxed) {
            capturer.capture_frame();
            thread::sleep(Duration::from_millis(16));
        }
        preview.remove(&preview_key);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_aller_retour_rgb_i420_rgb_garde_les_couleurs() {
        for (r, g, b) in [(255u8, 0u8, 0u8), (0, 255, 0), (0, 0, 255), (128, 128, 128), (250, 200, 30)] {
            let rgb: Vec<u8> = (0..16 * 16).flat_map(|_| [r, g, b]).collect();
            let buf = rgb_to_i420(&rgb, 16, 16);
            let (sy, su, sv) = buf.strides();
            let (y, u, v) = buf.data();
            let back = i420_to_rgb(y, sy as usize, u, su as usize, v, sv as usize, 16, 16);
            for (a, b) in rgb.iter().zip(back.iter()) {
                assert!((*a as i32 - *b as i32).abs() <= 8, "{a} -> {b} pour {r},{g},{b}");
            }
        }
    }

    #[test]
    fn yuyv_gris_donne_un_i420_gris() {
        let src: Vec<u8> = (0..4 * 4).flat_map(|_| [128u8, 128u8]).collect();
        let buf = yuyv_to_i420(&src, 4, 4);
        let (y, u, v) = buf.data();
        assert!(y[..4].iter().all(|&p| p == 128));
        assert_eq!((u[0], v[0]), (128, 128));
    }

    #[test]
    fn le_serveur_refuse_un_mauvais_secret_et_sert_le_bon() {
        let s = VideoServer::start().unwrap();
        s.publish("t", vec![0xFF, 0xD8, 0xFF, 0xD9]);
        let get = |path: &str| {
            let mut c = TcpStream::connect(("127.0.0.1", s.port)).unwrap();
            c.write_all(format!("GET {path} HTTP/1.1\r\n\r\n").as_bytes()).unwrap();
            c.set_read_timeout(Some(Duration::from_millis(500))).unwrap();
            let mut buf = vec![0u8; 512];
            let n = c.read(&mut buf).unwrap_or(0);
            String::from_utf8_lossy(&buf[..n]).to_string()
        };
        assert!(get("/v/t?k=faux").starts_with("HTTP/1.1 403"));
        let ok = get(&format!("/v/t?k={}", s.secret));
        assert!(ok.contains("multipart/x-mixed-replace"), "{ok}");
    }
}
