# ForgeChat — Production Ready Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Corriger tous les bugs audio/vidéo/WebRTC, livrer une vraie app desktop .exe + portable, et intégrer ~100 nouvelles fonctionnalités pour une sortie prod.

**Architecture:** Backend Rust/Axum existant (port 3013 VPS), frontend React 18 + Zustand, desktop Tauri v2. Toutes les features s'appuient sur le store `useVoice` (voice.ts) — le hook `useWebRTC.ts` est du dead code à supprimer.

**Tech Stack:** Rust/Axum 0.7 · SQLx/PostgreSQL · React 18/TS/Vite · Zustand · Tauri v2 · WebRTC · Redis · Tokio

---

## PHASE 1 — BUGFIXES AUDIO/VIDÉO/WEBRTC CRITIQUES

### Task 1: Supprimer useWebRTC.ts (dead code)

**Files:**
- Delete: `client/src/hooks/useWebRTC.ts`

- [ ] **Step 1: Vérifier qu'aucun fichier n'importe useWebRTC**
```bash
grep -rn "useWebRTC" client/src
# Résultat attendu : seulement la définition dans hooks/useWebRTC.ts — aucun import
```

- [ ] **Step 2: Supprimer le fichier**
```bash
rm client/src/hooks/useWebRTC.ts
```

- [ ] **Step 3: Vérifier la compilation**
```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "refactor: remove dead useWebRTC hook (voice.ts store handles all WebRTC)"
```

---

### Task 2: Fix AudioSection — permission + VU-meter + output device

**Files:**
- Modify: `client/src/components/settings/AudioSection.tsx`

**Problèmes actuels:**
- `enumerateDevices()` appelé sans permission → labels vides
- Output device jamais appliquée (pas de `setSinkId`)
- Aucun test micro en temps réel

- [ ] **Step 1: Réécrire AudioSection.tsx**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { Field } from './shared'
import { Mic, Volume2, RefreshCw } from 'lucide-react'

export default function AudioSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState(localStorage.getItem('fc_audio_input') ?? '')
  const [selectedOutput, setSelectedOutput] = useState(localStorage.getItem('fc_audio_output') ?? '')
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [vuLevel, setVuLevel] = useState(0)
  const testStreamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)

  const refreshDevices = useCallback(async () => {
    const list = await navigator.mediaDevices.enumerateDevices()
    setDevices(list)
  }, [])

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  useEffect(() => {
    navigator.permissions.query({ name: 'microphone' as PermissionName })
      .then(p => {
        setPermission(p.state === 'granted' ? 'granted' : p.state === 'denied' ? 'denied' : 'unknown')
        if (p.state === 'granted') refreshDevices()
        p.onchange = () => {
          setPermission(p.state === 'granted' ? 'granted' : 'denied')
          if (p.state === 'granted') refreshDevices()
        }
      })
      .catch(() => refreshDevices())
  }, [refreshDevices])

  const startMicTest = async () => {
    if (testStreamRef.current) return
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedInput ? { deviceId: { exact: selectedInput } } : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      testStreamRef.current = stream
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      analyserRef.current = analyser

      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(buf)
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length
        setVuLevel(Math.min(100, (avg / 128) * 100))
        animFrameRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {}
  }

  const stopMicTest = () => {
    cancelAnimationFrame(animFrameRef.current)
    testStreamRef.current?.getTracks().forEach(t => t.stop())
    testStreamRef.current = null
    analyserRef.current = null
    setVuLevel(0)
  }

  useEffect(() => () => stopMicTest(), [])

  const handleInputChange = (id: string) => {
    setSelectedInput(id)
    localStorage.setItem('fc_audio_input', id)
    if (testStreamRef.current) { stopMicTest(); setTimeout(startMicTest, 100) }
  }

  const handleOutputChange = async (id: string) => {
    setSelectedOutput(id)
    localStorage.setItem('fc_audio_output', id)
    // Apply to all audio elements in the document
    document.querySelectorAll('audio, video').forEach(el => {
      if ('setSinkId' in el) (el as any).setSinkId(id).catch(() => {})
    })
  }

  const inputDevices = devices.filter(d => d.kind === 'audioinput')
  const outputDevices = devices.filter(d => d.kind === 'audiooutput')

  return (
    <div className="space-y-6">
      {permission !== 'granted' && (
        <div className="p-4 bg-fc-yellow/10 border border-fc-yellow/30 rounded-xl flex items-center justify-between">
          <span className="text-sm text-fc-yellow">
            {permission === 'denied'
              ? 'Accès micro refusé. Autorisez dans les paramètres du navigateur.'
              : 'Autorisation micro requise pour voir les périphériques.'}
          </span>
          {permission !== 'denied' && (
            <button onClick={requestPermission}
              className="px-3 py-1.5 bg-fc-yellow text-black rounded-lg text-sm font-medium hover:bg-fc-yellow/80">
              Autoriser
            </button>
          )}
        </div>
      )}

      <Field label="Périphérique d'entrée (Microphone)">
        <div className="flex gap-2">
          <select value={selectedInput} onChange={e => handleInputChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Défaut du système</option>
            {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Micro ${d.deviceId.slice(0, 6)}`}</option>)}
          </select>
          <button onClick={refreshDevices} className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted" title="Actualiser">
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      {/* VU-meter test micro */}
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white font-medium uppercase tracking-wide">Test microphone</p>
          <button
            onClick={testStreamRef.current ? stopMicTest : startMicTest}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
              ${testStreamRef.current ? 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30' : 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30'}`}
          >
            <Mic size={12} />
            {testStreamRef.current ? 'Arrêter' : 'Tester'}
          </button>
        </div>
        <div className="h-3 bg-fc-hover rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-fc-green to-fc-yellow transition-all duration-75 rounded-full"
            style={{ width: `${vuLevel}%` }} />
        </div>
        {vuLevel === 0 && testStreamRef.current && (
          <p className="text-xs text-fc-muted">Parlez pour voir le niveau...</p>
        )}
      </div>

      <Field label="Périphérique de sortie (Haut-parleurs)">
        <select value={selectedOutput} onChange={e => handleOutputChange(e.target.value)}
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
          <option value="">Défaut du système</option>
          {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Sortie ${d.deviceId.slice(0, 6)}`}</option>)}
        </select>
        {'setSinkId' in (document.createElement('audio')) ? null : (
          <p className="text-xs text-fc-muted mt-1">Votre navigateur ne supporte pas la sélection de sortie audio.</p>
        )}
      </Field>
    </div>
  )
}
```

- [ ] **Step 2: Vérifier compil**
```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**
```bash
git add client/src/components/settings/AudioSection.tsx
git commit -m "fix(audio): mic permission flow, VU-meter test, output setSinkId"
```

---

### Task 3: Fix voice.ts — camera device + stopScreenShare restaure caméra

**Files:**
- Modify: `client/src/store/voice.ts`

**Problèmes:**
1. `toggleVideo` n'utilise pas `fc_video_input` localStorage
2. `stopScreenShare` ne restaure pas la caméra si elle était active avant

- [ ] **Step 1: Dans `toggleVideo`, lire `fc_video_input`**

Dans la section `// Activer la caméra + renegociation` (~ligne 598), remplacer:
```ts
const vs = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
})
```
Par:
```ts
const savedCamId = localStorage.getItem('fc_video_input') || undefined
const vs = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
    ...(savedCamId ? { deviceId: { exact: savedCamId } } : {}),
  },
})
```

- [ ] **Step 2: Ajouter `_cameraWasActive` flag pour restaurer après screen share**

Après la ligne `let _screenTrack: MediaStreamTrack | null = null` (~ligne 85), ajouter:
```ts
let _cameraTrackBeforeShare: MediaStreamTrack | null = null
```

Dans `shareScreen`, avant `set({ screenSharing: true, videoEnabled: true })`:
```ts
// Mémoriser la piste caméra active avant screen share (pour restaurer)
const existingVideoTrack = _localStream?.getVideoTracks()[0] ?? null
if (existingVideoTrack && !existingVideoTrack.label.includes('screen')) {
  _cameraTrackBeforeShare = existingVideoTrack
} else {
  _cameraTrackBeforeShare = null
}
```

Dans `stopScreenShare`, après `set({ screenSharing: false, videoEnabled: false })`:
```ts
// Restaurer la caméra si elle était active avant le screen share
if (_cameraTrackBeforeShare && _cameraTrackBeforeShare.readyState !== 'ended') {
  _localStream?.addTrack(_cameraTrackBeforeShare)
  for (const [peerId, pc] of _pcs) {
    const sender = pc.getSenders().find(s => s.track?.kind === 'video')
    if (sender) {
      await sender.replaceTrack(_cameraTrackBeforeShare)
    }
  }
  _cameraTrackBeforeShare = null
  set({ videoEnabled: true })
}
_refreshLocalStream(set)
_broadcastState(get)
```

- [ ] **Step 3: Fix leave() — stopper le bon stream**

Remplacer le bloc de nettoyage stream dans `leave()`:
```ts
// Stopper toutes les pistes du stream brut
const rawTracks = new Set<MediaStreamTrack>()
_localStream?.getTracks().forEach(t => rawTracks.add(t))
_processedStream?.getTracks().forEach(t => rawTracks.add(t))
rawTracks.forEach(t => t.stop())
```

- [ ] **Step 4: Compiler et tester**
```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 5: Commit**
```bash
git add client/src/store/voice.ts
git commit -m "fix(voice): camera device selection, restore camera after screenshare, cleanup on leave"
```

---

### Task 4: Fix VideoSection settings — sélection caméra

**Files:**
- Modify: `client/src/components/settings/AudioSection.tsx` (ajouter section vidéo)
- Create: `client/src/components/settings/VideoSection.tsx`

- [ ] **Step 1: Créer VideoSection.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'
import { Field } from './shared'
import { Camera, RefreshCw } from 'lucide-react'

export default function VideoSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState(localStorage.getItem('fc_video_input') ?? '')
  const [previewActive, setPreviewActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const refreshDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter(d => d.kind === 'videoinput'))
    } catch {}
  }

  useEffect(() => { refreshDevices() }, [])

  const startPreview = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 }, height: { ideal: 720 },
          ...(selectedCamera ? { deviceId: { exact: selectedCamera } } : {}),
        },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setPreviewActive(true)
      await refreshDevices()
    } catch {}
  }

  const stopPreview = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setPreviewActive(false)
  }

  useEffect(() => () => stopPreview(), [])

  const handleCameraChange = (id: string) => {
    setSelectedCamera(id)
    localStorage.setItem('fc_video_input', id)
    if (previewActive) { stopPreview(); setTimeout(startPreview, 100) }
  }

  return (
    <div className="space-y-6">
      <Field label="Caméra">
        <div className="flex gap-2">
          <select value={selectedCamera} onChange={e => handleCameraChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="">Défaut du système</option>
            {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Caméra ${d.deviceId.slice(0, 6)}`}</option>)}
          </select>
          <button onClick={refreshDevices} className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted">
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white font-medium uppercase tracking-wide">Aperçu caméra</p>
          <button onClick={previewActive ? stopPreview : startPreview}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
              ${previewActive ? 'bg-fc-red/20 text-fc-red' : 'bg-fc-accent/20 text-fc-accent'}`}>
            <Camera size={12} />
            {previewActive ? 'Arrêter' : 'Aperçu'}
          </button>
        </div>
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {previewActive
            ? <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            : <div className="flex flex-col items-center justify-center h-full gap-2 text-fc-muted">
                <Camera size={32} className="opacity-30" />
                <span className="text-xs">Cliquez sur Aperçu pour tester</span>
              </div>}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Intégrer dans SettingsPage**

Dans `client/src/pages/SettingsPage.tsx`, ajouter l'import et le tab "Vidéo":
```tsx
import VideoSection from '../components/settings/VideoSection'
// Dans la liste des tabs, ajouter après 'audio':
{ id: 'video', label: 'Vidéo', icon: <Video size={16} /> },
// Dans le rendu conditionnel:
{activeTab === 'video' && <VideoSection />}
```

- [ ] **Step 3: Commit**
```bash
git add client/src/components/settings/VideoSection.tsx client/src/pages/SettingsPage.tsx
git commit -m "feat(settings): video section with camera preview and device selection"
```

---

### Task 5: Fix Tauri — CSP + permissions media + webview

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: Corriger CSP dans tauri.conf.json**

Remplacer la valeur `csp`:
```json
"csp": "default-src 'self' https://forgechat.heiphaistos.org wss://forgechat.heiphaistos.org; img-src 'self' https://forgechat.heiphaistos.org data: blob: https:; media-src 'self' blob: mediastream:; style-src 'self' 'unsafe-inline' https://forgechat.heiphaistos.org; script-src 'self' 'unsafe-inline' https://forgechat.heiphaistos.org; connect-src 'self' https://forgechat.heiphaistos.org wss://forgechat.heiphaistos.org https://api.tenor.com; worker-src 'self' blob:; frame-src 'none'"
```

Et corriger `userAgent`:
```json
"userAgent": "ForgeChat/3.2.0 (Desktop; Windows)"
```

- [ ] **Step 2: Ajouter permissions dans capabilities/default.json**

```json
{
  "$schema": "https://schema.tauri.app/config/2/capability",
  "identifier": "default",
  "description": "ForgeChat desktop capabilities",
  "platforms": ["linux", "macOS", "windows"],
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-set-focus",
    "core:window:allow-start-dragging",
    "shell:default",
    "notification:default",
    "notification:allow-notify",
    "notification:allow-request-permission"
  ]
}
```

- [ ] **Step 3: Dans src-tauri/src/lib.rs ou main.rs, activer les flags WebView2**

Dans `desktop/src-tauri/src/main.rs` (ou `lib.rs`), avant `tauri::Builder`:
```rust
fn main() {
    // Activer WebRTC, accès média et API web modernes dans WebView2
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--use-fake-ui-for-media-stream=false --allow-running-insecure-content=false --disable-web-security=false --enable-features=WebRTC-H264WithOpenH264FFmpeg");
    
    tauri::Builder::default()
        // ...
```

- [ ] **Step 4: Commit**
```bash
git add desktop/src-tauri/tauri.conf.json desktop/src-tauri/capabilities/default.json desktop/src-tauri/src/
git commit -m "fix(tauri): CSP for WebRTC/media, WebView2 flags for camera/mic, permissions"
```

---

### Task 6: Fix VoiceVideoPage — enregistrement + output device appliquée

**Files:**
- Modify: `client/src/pages/VoiceVideoPage.tsx`

**Problèmes:**
- `MediaRecorder` avec mimeType fixe peut crash (pas de vérification support)
- Output device pas appliquée sur les `<video>` elements

- [ ] **Step 1: Fix startRecording avec mimeType dynamique**

Remplacer le bloc `startRecording` dans VoiceVideoPage:
```tsx
const startRecording = useCallback(() => {
  if (!localStream) return
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) ?? ''
  try {
    const recorder = new MediaRecorder(localStream, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(recChunksRef.current, { type: mimeType || 'audio/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `forgechat-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`
      a.click()
      URL.revokeObjectURL(url)
      recChunksRef.current = []
    }
    recorder.start(1000)
    recorderRef.current = recorder
    setIsRecording(true)
    toast.success('Enregistrement démarré')
  } catch (e) {
    toast.error('Impossible de démarrer l\'enregistrement')
  }
}, [localStream])
```

- [ ] **Step 2: Appliquer output device aux éléments vidéo**

Ajouter un `useEffect` dans le composant principal de VoiceVideoPage:
```tsx
useEffect(() => {
  const savedOut = localStorage.getItem('fc_audio_output')
  if (!savedOut) return
  document.querySelectorAll('video').forEach(el => {
    if ('setSinkId' in el) (el as any).setSinkId(savedOut).catch(() => {})
  })
}, [peers]) // Re-appliquer quand des peers arrivent
```

- [ ] **Step 3: Commit**
```bash
git add client/src/pages/VoiceVideoPage.tsx
git commit -m "fix(voice): dynamic MediaRecorder mimeType, apply output device to video elements"
```

---

## PHASE 2 — DESKTOP APP PRODUCTION (.EXE + PORTABLE + TRAY)

### Task 7: System Tray + Window State

**Files:**
- Modify: `desktop/src-tauri/src/main.rs`
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Ajouter plugins Tauri dans Cargo.toml**

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-ico", "image-png"] }
tauri-plugin-notification = "2"
tauri-plugin-autostart = "2"
tauri-plugin-window-state = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Réécrire main.rs avec tray + window state**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Manager, Runtime,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

fn main() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--use-fake-ui-for-media-stream=false \
         --enable-features=WebRTC-H264WithOpenH264FFmpeg,WebRTCPipeWireCapturer",
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quitter ForgeChat", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => { app.exit(0); }
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|win, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Erreur Tauri");
}
```

- [ ] **Step 3: Ajouter plugins dans tauri.conf.json**

```json
"plugins": {
  "window-state": {
    "stateFlags": "ALL"
  }
}
```

- [ ] **Step 4: Ajouter permissions tray dans capabilities/default.json**
```json
"tray-icon:default",
"window-state:allow-save-window-state",
"window-state:allow-restore-state"
```

- [ ] **Step 5: Compiler en dev pour vérifier**
```bash
cd desktop && npx tauri build --debug 2>&1 | tail -30
```

- [ ] **Step 6: Commit**
```bash
git add desktop/src-tauri/
git commit -m "feat(desktop): system tray icon, close-to-tray, window state persistence"
```

---

### Task 8: Build portable .exe + installer amélioré

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/build.bat`

- [ ] **Step 1: Configurer NSIS + portable dans tauri.conf.json**

```json
"bundle": {
  "active": true,
  "targets": ["nsis", "app"],
  "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
  "windows": {
    "nsis": {
      "languages": ["French"],
      "displayLanguageSelector": false,
      "installMode": "both",
      "shortcuts": {
        "desktop": true,
        "startMenu": true
      }
    }
  },
  "createUpdaterArtifacts": false
}
```

- [ ] **Step 2: Réécrire build.bat**

```bat
@echo off
setlocal enabledelayedexpansion
title ForgeChat Desktop — Build v3.3.0

echo.
echo ============================================
echo   ForgeChat Desktop Builder v3.3.0
echo ============================================
echo.

where rustc >nul 2>&1 || (echo [ERREUR] Rust non trouve. & pause & exit /b 1)
where node >nul 2>&1 || (echo [ERREUR] Node.js non trouve. & pause & exit /b 1)

echo [1/5] Build du client React...
cd /d "%~dp0..\client"
call npm ci --silent
call npm run build
if %errorlevel% neq 0 (echo [ERREUR] Build client echoue. & pause & exit /b 1)

echo [2/5] Installation deps desktop...
cd /d "%~dp0"
call npm install --silent

echo [3/5] Verification icones...
if not exist "src-tauri\icons\icon.ico" (
    echo [WARN] Icones manquantes. Generation automatique...
    call npx tauri icon src-tauri\icons\app-icon.png 2>nul || echo [INFO] Lancez : npx tauri icon ^<image.png^>
)

echo [4/5] Compilation Tauri ^(NSIS installer + portable^)...
call npx tauri build
if %errorlevel% neq 0 (echo [ERREUR] Build Tauri echoue. & pause & exit /b 1)

echo [5/5] Copie des artefacts...
set BUNDLE=src-tauri\target\release\bundle
set OUT=..\dist-desktop

if not exist "%OUT%" mkdir "%OUT%"

:: Installeur NSIS
for /f "delims=" %%f in ('dir /b /s "%BUNDLE%\nsis\*.exe" 2^>nul') do (
    copy "%%f" "%OUT%\ForgeChat-Setup-v3.3.0.exe" >nul
    echo [OK] Installeur : %OUT%\ForgeChat-Setup-v3.3.0.exe
)

:: Portable .exe (raw release binary)
if exist "src-tauri\target\release\forgechat-desktop.exe" (
    copy "src-tauri\target\release\forgechat-desktop.exe" "%OUT%\ForgeChat-Portable-v3.3.0.exe" >nul
    echo [OK] Portable : %OUT%\ForgeChat-Portable-v3.3.0.exe
)

echo.
echo ============================================
echo   Build termine !
echo   Dossier : %OUT%
echo ============================================
pause
```

- [ ] **Step 3: Créer `desktop/dist-desktop/.gitkeep`**
```bash
mkdir desktop/dist-desktop
touch desktop/dist-desktop/.gitkeep
echo "dist-desktop/*.exe" >> desktop/.gitignore
```

- [ ] **Step 4: Commit**
```bash
git add desktop/
git commit -m "feat(desktop): NSIS installer + portable exe build, organized output in dist-desktop/"
```

---

### Task 9: Auto-updater + Deep Links

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Ajouter plugin updater dans Cargo.toml**
```toml
tauri-plugin-updater = "2"
tauri-plugin-deep-link = "2"
```

- [ ] **Step 2: Configurer deep link dans tauri.conf.json**
```json
"plugins": {
  "deep-link": {
    "desktop": {
      "schemes": ["forgechat"]
    }
  },
  "updater": {
    "pubkey": "",
    "endpoints": ["https://forgechat.heiphaistos.org/api/desktop/update/{{target}}/{{arch}}/{{current_version}}"]
  }
}
```

- [ ] **Step 3: Dans main.rs, initialiser les plugins**
```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_deep_link::init())
```

- [ ] **Step 4: Ajouter commande Tauri pour vérifier les mises à jour**
```rust
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_updater::UpdaterExt;
    match app.updater() {
        Ok(updater) => {
            Ok(updater.check().await.map(|u| u.is_some()).unwrap_or(false))
        }
        Err(_) => Ok(false),
    }
}
```

- [ ] **Step 5: Endpoint backend `/api/desktop/update/:target/:arch/:version`**

Dans `server/src/handlers/`, créer `desktop.rs`:
```rust
use axum::{extract::{Path, Json}, response::IntoResponse};
use serde_json::json;

pub async fn check_update(
    Path((target, arch, current)): Path<(String, String, String)>,
) -> impl IntoResponse {
    let latest = "3.3.0";
    // Si version actuelle < latest, retourner l'update
    if current != latest {
        Json(json!({
            "version": latest,
            "notes": "Nouvelle version disponible",
            "pub_date": "2026-06-25T00:00:00Z",
            "platforms": {
                "windows-x86_64": {
                    "signature": "",
                    "url": format!("https://forgechat.heiphaistos.org/downloads/ForgeChat-Setup-v{}.exe", latest)
                }
            }
        }))
    } else {
        Json(json!(null))
    }
}
```

- [ ] **Step 6: Commit**
```bash
git add desktop/src-tauri/ server/src/handlers/desktop.rs
git commit -m "feat(desktop): auto-updater endpoint, forgechat:// deep links"
```

---

## PHASE 3 — FEATURES WAVE 1 (Chat + Profil + Serveurs)

### Task 10: Messages Audio (enregistrement vocal dans le chat)

**Files:**
- Create: `client/src/components/chat/VoiceMessageRecorder.tsx`
- Modify: `client/src/components/chat/MessageInput.tsx`
- Modify: `server/src/handlers/messages.rs` (déjà supporte les attachments)

- [ ] **Step 1: Créer VoiceMessageRecorder.tsx**

```tsx
import { useState, useRef, useCallback } from 'react'
import { Mic, Square, Send, X } from 'lucide-react'

interface Props { onSend: (blob: Blob, duration: number) => void; onCancel: () => void }

export default function VoiceMessageRecorder({ onSend, onCancel }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'preview'>('idle')
  const [duration, setDuration] = useState(0)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        blobRef.current = blob
        setBlobUrl(URL.createObjectURL(blob))
        setState('preview')
        stream.getTracks().forEach(t => t.stop())
      }
      recorder.start(100)
      recorderRef.current = recorder
      setState('recording')
      let secs = 0
      timerRef.current = setInterval(() => {
        secs++
        setDuration(secs)
        if (secs >= 120) stop()
      }, 1000)
    } catch {}
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
    recorderRef.current = null
  }, [])

  const send = () => {
    if (!blobRef.current) return
    onSend(blobRef.current, duration)
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  }

  const cancel = () => {
    stop()
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    onCancel()
  }

  const fmt = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-fc-channel rounded-xl border border-fc-hover">
      {state === 'idle' && (
        <button onClick={start} className="flex items-center gap-2 text-fc-red text-sm font-medium">
          <Mic size={16} className="animate-pulse" /> Enregistrer
        </button>
      )}
      {state === 'recording' && (
        <>
          <div className="w-2 h-2 rounded-full bg-fc-red animate-pulse" />
          <span className="text-fc-red text-sm font-mono">{fmt(duration)}</span>
          <button onClick={stop} className="p-1.5 bg-fc-red/20 rounded-lg text-fc-red"><Square size={14} /></button>
          <button onClick={cancel} className="p-1.5 bg-fc-hover rounded-lg text-fc-muted"><X size={14} /></button>
        </>
      )}
      {state === 'preview' && blobUrl && (
        <>
          <audio src={blobUrl} controls className="h-8 flex-1" />
          <span className="text-xs text-fc-muted">{fmt(duration)}</span>
          <button onClick={send} className="p-1.5 bg-fc-accent rounded-lg text-white"><Send size={14} /></button>
          <button onClick={cancel} className="p-1.5 bg-fc-hover rounded-lg text-fc-muted"><X size={14} /></button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Intégrer dans MessageInput.tsx**

Ajouter le bouton micro et le recorder dans la barre de saisie:
```tsx
import VoiceMessageRecorder from './VoiceMessageRecorder'
// Dans l'état:
const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)

// Fonction d'envoi du message vocal:
const handleVoiceMessage = async (blob: Blob, duration: number) => {
  const formData = new FormData()
  formData.append('file', blob, `voice-${Date.now()}.webm`)
  const { data: msg } = await api.post(`/channels/${channelId}/messages`, { content: `🎤 Message vocal (${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')})`, type: 'voice' })
  await api.post(`/messages/${msg.id}/attachments`, formData, { headers: { 'Content-Type': 'multipart/form-data' }})
  setShowVoiceRecorder(false)
}
// Bouton micro avant le bouton d'envoi:
{showVoiceRecorder
  ? <VoiceMessageRecorder onSend={handleVoiceMessage} onCancel={() => setShowVoiceRecorder(false)} />
  : <button onClick={() => setShowVoiceRecorder(true)} className="p-2 text-fc-muted hover:text-white" title="Message vocal">
      <Mic size={18} />
    </button>}
```

- [ ] **Step 3: Commit**
```bash
git add client/src/components/chat/VoiceMessageRecorder.tsx client/src/components/chat/MessageInput.tsx
git commit -m "feat(chat): voice message recording (up to 2min, WebM/Opus)"
```

---

### Task 11: 2FA TOTP (Authentification à deux facteurs)

**Files:**
- Create: `server/src/handlers/totp.rs`
- Modify: `server/src/main.rs`
- Modify: `server/Cargo.toml`
- Create: `client/src/components/settings/SecuritySection.tsx`
- Create: `server/migrations/021_2fa.sql`

- [ ] **Step 1: Migration SQL**
```sql
-- 021_2fa.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[];
```

- [ ] **Step 2: Ajouter `totp_lite` dans Cargo.toml**
```toml
totp-lite = "2"
data-encoding = "2.6"
```

- [ ] **Step 3: Créer totp.rs**
```rust
use axum::{extract::State, Json, response::IntoResponse};
use serde::{Deserialize, Serialize};
use totp_lite::{totp_custom, Sha1, DEFAULT_STEP};
use data_encoding::BASE32;
use rand::Rng;
use crate::{middleware::AuthUser, state::AppState, error::AppError};

#[derive(Serialize)]
pub struct TotpSetupResponse {
    secret: String,
    qr_url: String,
    backup_codes: Vec<String>,
}

#[derive(Deserialize)]
pub struct TotpVerifyInput { code: String }

pub async fn setup_totp(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let secret_bytes: Vec<u8> = rand::thread_rng().gen::<[u8; 20]>().to_vec();
    let secret = BASE32.encode(&secret_bytes);
    
    let user = sqlx::query!("SELECT username, email FROM users WHERE id = $1", user_id)
        .fetch_one(&state.db).await?;
    
    let qr_url = format!(
        "otpauth://totp/ForgeChat:{}?secret={}&issuer=ForgeChat&algorithm=SHA1&digits=6&period=30",
        urlencoding::encode(&user.username), secret
    );
    
    // Générer 8 codes de backup
    let backup_codes: Vec<String> = (0..8)
        .map(|_| format!("{:04x}-{:04x}", rand::thread_rng().gen::<u16>(), rand::thread_rng().gen::<u16>()))
        .collect();
    
    // Stocker le secret temporairement (pas encore activé)
    sqlx::query!(
        "UPDATE users SET totp_secret = $1, totp_backup_codes = $2 WHERE id = $3",
        &secret, &backup_codes, user_id
    ).execute(&state.db).await?;
    
    Ok(Json(TotpSetupResponse { secret, qr_url, backup_codes }))
}

pub async fn confirm_totp(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(input): Json<TotpVerifyInput>,
) -> Result<impl IntoResponse, AppError> {
    let user = sqlx::query!("SELECT totp_secret FROM users WHERE id = $1", user_id)
        .fetch_one(&state.db).await?;
    
    let secret = user.totp_secret.ok_or(AppError::BadRequest("2FA non initialisé".into()))?;
    
    if !verify_totp(&secret, &input.code) {
        return Err(AppError::BadRequest("Code invalide".into()));
    }
    
    sqlx::query!("UPDATE users SET totp_enabled = TRUE WHERE id = $1", user_id)
        .execute(&state.db).await?;
    
    Ok(Json(serde_json::json!({ "enabled": true })))
}

pub async fn disable_totp(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(input): Json<TotpVerifyInput>,
) -> Result<impl IntoResponse, AppError> {
    let user = sqlx::query!("SELECT totp_secret FROM users WHERE id = $1", user_id)
        .fetch_one(&state.db).await?;
    
    let secret = user.totp_secret.ok_or(AppError::BadRequest("2FA non activé".into()))?;
    
    if !verify_totp(&secret, &input.code) {
        return Err(AppError::BadRequest("Code invalide".into()));
    }
    
    sqlx::query!("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1", user_id)
        .execute(&state.db).await?;
    
    Ok(Json(serde_json::json!({ "enabled": false })))
}

fn verify_totp(secret: &str, code: &str) -> bool {
    let secret_bytes = match BASE32.decode(secret.as_bytes()) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Fenêtre ±1 step (30s)
    for delta in [-1i64, 0, 1] {
        let t = (now as i64 + delta * DEFAULT_STEP as i64) as u64;
        let expected = totp_custom::<Sha1>(t, 6, DEFAULT_STEP, &secret_bytes);
        if expected == code { return true; }
    }
    false
}
```

- [ ] **Step 4: Routes dans main.rs**
```rust
// Dans le router auth:
.route("/auth/2fa/setup", post(totp::setup_totp))
.route("/auth/2fa/confirm", post(totp::confirm_totp))
.route("/auth/2fa/disable", post(totp::disable_totp))
```

- [ ] **Step 5: SecuritySection.tsx (frontend)**
```tsx
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import api from '../../api/client'
import { Shield, QrCode, Key } from 'lucide-react'

export default function SecuritySection() {
  const [step, setStep] = useState<'idle' | 'setup' | 'confirm'>('idle')
  const [code, setCode] = useState('')
  const [setupData, setSetupData] = useState<{ secret: string; qr_url: string; backup_codes: string[] } | null>(null)

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/users/me').then(r => r.data) })

  const setupMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/setup').then(r => r.data),
    onSuccess: data => { setSetupData(data); setStep('setup') },
  })

  const confirmMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/confirm', { code }).then(r => r.data),
    onSuccess: () => { setStep('idle'); setCode('') },
  })

  const disableMutation = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { code }).then(r => r.data),
    onSuccess: () => { setStep('idle'); setCode('') },
  })

  const is2faEnabled = me?.totp_enabled ?? false

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="flex items-center gap-3">
          <Shield size={20} className={is2faEnabled ? 'text-fc-green' : 'text-fc-muted'} />
          <div>
            <p className="text-sm font-medium text-white">Authentification à deux facteurs</p>
            <p className="text-xs text-fc-muted">{is2faEnabled ? 'Activée — votre compte est protégé' : 'Désactivée'}</p>
          </div>
        </div>
        {!is2faEnabled
          ? <button onClick={() => setupMutation.mutate()} className="px-3 py-1.5 bg-fc-green/20 text-fc-green rounded-lg text-sm hover:bg-fc-green/30">Activer</button>
          : <button onClick={() => setStep('confirm')} className="px-3 py-1.5 bg-fc-red/20 text-fc-red rounded-lg text-sm hover:bg-fc-red/30">Désactiver</button>}
      </div>

      {step === 'setup' && setupData && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-4">
          <p className="text-sm text-white font-medium">1. Scannez ce QR code avec votre app d'authentification</p>
          <div className="bg-white p-4 rounded-lg inline-block">
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupData.qr_url)}`} alt="QR 2FA" className="w-44 h-44" />
          </div>
          <p className="text-xs text-fc-muted">Ou entrez manuellement : <code className="bg-fc-hover px-1 rounded">{setupData.secret}</code></p>
          <p className="text-sm text-white font-medium">2. Entrez le code généré</p>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-lg" />
          <button onClick={() => confirmMutation.mutate()} disabled={code.length !== 6}
            className="w-full py-2 bg-fc-accent rounded-lg text-white font-medium disabled:opacity-50">
            Confirmer
          </button>
          <div className="space-y-1">
            <p className="text-xs text-fc-muted font-medium">Codes de secours (conservez-les !) :</p>
            <div className="grid grid-cols-2 gap-1">
              {setupData.backup_codes.map(c => <code key={c} className="text-xs bg-fc-hover px-2 py-1 rounded font-mono">{c}</code>)}
            </div>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-red/30 space-y-3">
          <p className="text-sm text-white">Entrez votre code 2FA pour désactiver :</p>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="000000" maxLength={6}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-white font-mono tracking-widest text-center text-lg" />
          <div className="flex gap-2">
            <button onClick={() => { setStep('idle'); setCode('') }} className="flex-1 py-2 bg-fc-hover rounded-lg text-fc-muted text-sm">Annuler</button>
            <button onClick={() => disableMutation.mutate()} disabled={code.length !== 6}
              className="flex-1 py-2 bg-fc-red rounded-lg text-white font-medium disabled:opacity-50 text-sm">Désactiver</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Ajouter dans SettingsPage**
```tsx
import SecuritySection from '../components/settings/SecuritySection'
// Tab: { id: 'security', label: 'Sécurité', icon: <Shield size={16} /> }
// Rendu: {activeTab === 'security' && <SecuritySection />}
```

- [ ] **Step 7: cargo check**
```bash
cd server && cargo check 2>&1 | grep error
```

- [ ] **Step 8: Commit**
```bash
git add server/ client/src/
git commit -m "feat(auth): TOTP 2FA with QR code, backup codes, confirm/disable flow"
```

---

### Task 12: Sessions actives + déconnexion à distance

**Files:**
- Modify: `server/src/handlers/auth.rs`
- Modify: `server/migrations/021_2fa.sql` (ou nouvelle migration 022)
- Create: `client/src/components/settings/SessionsSection.tsx`

- [ ] **Step 1: Migration**
```sql
-- Ajouter à 021_2fa.sql ou créer 022_sessions.sql
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
```

- [ ] **Step 2: Enregistrer session au login dans auth.rs**

Dans `login()`, après génération du refresh token:
```rust
let token_hash = sha2::Sha256::digest(refresh_token.as_bytes());
let token_hash_hex = hex::encode(token_hash);
let device = headers.get("User-Agent").and_then(|v| v.to_str().ok()).unwrap_or("Unknown").to_string();
let ip = headers.get("X-Forwarded-For").and_then(|v| v.to_str().ok()).unwrap_or("Unknown").to_string();
sqlx::query!(
    "INSERT INTO user_sessions (user_id, refresh_token_hash, device_info, ip_address) VALUES ($1, $2, $3, $4)",
    user.id, &token_hash_hex, &device, &ip
).execute(&state.db).await?;
```

- [ ] **Step 3: Routes sessions**
```rust
// GET /users/me/sessions
pub async fn list_sessions(State(state): State<AppState>, AuthUser(uid): AuthUser) -> impl IntoResponse {
    let sessions = sqlx::query!("SELECT id, device_info, ip_address, last_seen, created_at FROM user_sessions WHERE user_id = $1 ORDER BY last_seen DESC", uid)
        .fetch_all(&state.db).await.unwrap_or_default();
    Json(sessions.iter().map(|s| serde_json::json!({
        "id": s.id, "device": s.device_info, "ip": s.ip_address,
        "last_seen": s.last_seen, "created_at": s.created_at
    })).collect::<Vec<_>>())
}

// DELETE /users/me/sessions/:id
pub async fn revoke_session(Path(id): Path<uuid::Uuid>, State(state): State<AppState>, AuthUser(uid): AuthUser) -> impl IntoResponse {
    sqlx::query!("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2", id, uid)
        .execute(&state.db).await.ok();
    StatusCode::NO_CONTENT
}
```

- [ ] **Step 4: SessionsSection.tsx**
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { Monitor, Smartphone, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

export default function SessionsSection() {
  const qc = useQueryClient()
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get('/users/me/sessions').then(r => r.data),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })

  return (
    <div className="space-y-3">
      <p className="text-sm text-fc-muted">{sessions.length} session{sessions.length > 1 ? 's' : ''} active{sessions.length > 1 ? 's' : ''}</p>
      {sessions.map((s: any, i: number) => (
        <div key={s.id} className="flex items-center justify-between p-3 bg-fc-channel rounded-xl border border-fc-hover">
          <div className="flex items-center gap-3">
            {s.device?.includes('Mobile') ? <Smartphone size={18} className="text-fc-muted" /> : <Monitor size={18} className="text-fc-muted" />}
            <div>
              <p className="text-sm text-white">{s.device ?? 'Appareil inconnu'}</p>
              <p className="text-xs text-fc-muted">{s.ip} · {formatDistanceToNow(new Date(s.last_seen), { addSuffix: true, locale: fr })}</p>
            </div>
            {i === 0 && <span className="text-xs bg-fc-green/20 text-fc-green px-2 py-0.5 rounded-full">Session actuelle</span>}
          </div>
          {i !== 0 && (
            <button onClick={() => revoke.mutate(s.id)} className="p-1.5 text-fc-muted hover:text-fc-red rounded-lg hover:bg-fc-red/10">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(auth): active sessions list with remote revocation"
```

---

### Task 13: Rappels sur messages (Reminders)

**Files:**
- Create: `server/migrations/022_reminders.sql`
- Modify: `server/src/handlers/messages.rs`
- Create: `client/src/components/chat/ReminderModal.tsx`

- [ ] **Step 1: Migration**
```sql
CREATE TABLE IF NOT EXISTS message_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    remind_at TIMESTAMPTZ NOT NULL,
    sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Endpoint POST /messages/:id/remind**
```rust
#[derive(Deserialize)]
pub struct ReminderInput { remind_at: chrono::DateTime<chrono::Utc> }

pub async fn set_reminder(
    Path(id): Path<uuid::Uuid>,
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(input): Json<ReminderInput>,
) -> Result<impl IntoResponse, AppError> {
    sqlx::query!(
        "INSERT INTO message_reminders (user_id, message_id, remind_at) VALUES ($1, $2, $3)",
        uid, id, input.remind_at
    ).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
```

- [ ] **Step 3: Tâche Tokio pour envoyer les rappels (dans scheduled.rs ou state.rs)**
```rust
pub async fn reminder_task(state: AppState) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        let due = sqlx::query!(
            "SELECT r.id, r.user_id, r.message_id, m.content FROM message_reminders r
             JOIN messages m ON m.id = r.message_id
             WHERE r.remind_at <= NOW() AND r.sent = FALSE LIMIT 50"
        ).fetch_all(&state.db).await.unwrap_or_default();
        
        for r in due {
            let event = serde_json::json!({
                "type": "REMINDER",
                "message_id": r.message_id,
                "content": r.content,
            });
            state.broadcast_to_user(r.user_id, event);
            sqlx::query!("UPDATE message_reminders SET sent = TRUE WHERE id = $1", r.id)
                .execute(&state.db).await.ok();
        }
    }
}
```

- [ ] **Step 4: ReminderModal.tsx**
```tsx
import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import api from '../../api/client'
import { addMinutes, addHours, addDays } from 'date-fns'

const PRESETS = [
  { label: 'Dans 20 min', fn: () => addMinutes(new Date(), 20) },
  { label: 'Dans 1h', fn: () => addHours(new Date(), 1) },
  { label: 'Ce soir (18h)', fn: () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d } },
  { label: 'Demain matin', fn: () => { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); return d } },
]

export default function ReminderModal({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [custom, setCustom] = useState('')

  const setReminder = async (date: Date) => {
    await api.post(`/messages/${messageId}/remind`, { remind_at: date.toISOString() })
    onClose()
  }

  return (
    <div className="absolute bottom-8 right-0 z-50 bg-fc-sidebar border border-fc-hover rounded-xl shadow-2xl p-4 w-64">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-white"><Bell size={14} /> Me rappeler</div>
        <button onClick={onClose}><X size={14} className="text-fc-muted" /></button>
      </div>
      <div className="space-y-1">
        {PRESETS.map(p => (
          <button key={p.label} onClick={() => setReminder(p.fn())}
            className="w-full text-left px-3 py-2 text-sm text-fc-text hover:bg-fc-hover rounded-lg">
            {p.label}
          </button>
        ))}
        <div className="pt-2 border-t border-fc-hover">
          <input type="datetime-local" value={custom} onChange={e => setCustom(e.target.value)}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-2 py-1.5 text-sm text-white" />
          {custom && (
            <button onClick={() => setReminder(new Date(custom))}
              className="w-full mt-2 py-1.5 bg-fc-accent rounded-lg text-white text-sm font-medium">
              Définir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(chat): message reminders with presets and custom datetime"
```

---

### Task 14: Compteur de caractères + indicateur limite dans MessageInput

**Files:**
- Modify: `client/src/components/chat/MessageInput.tsx`

- [ ] **Step 1: Ajouter compteur sous l'input**
```tsx
// Constante limite
const MAX_CHARS = 4000

// Dans le return, sous l'input:
{content.length > MAX_CHARS * 0.8 && (
  <div className={`flex items-center justify-end px-1 text-xs ${
    content.length > MAX_CHARS ? 'text-fc-red' : content.length > MAX_CHARS * 0.9 ? 'text-fc-yellow' : 'text-fc-muted'
  }`}>
    {content.length > MAX_CHARS
      ? <span className="font-medium">{content.length - MAX_CHARS} caractères en trop</span>
      : <span>{MAX_CHARS - content.length} restants</span>}
  </div>
)}
// Désactiver le bouton d'envoi si dépassement:
<button disabled={content.length > MAX_CHARS || ...} ...>
```

- [ ] **Step 2: Commit**
```bash
git add client/src/components/chat/MessageInput.tsx
git commit -m "feat(chat): character counter with limit warning at 80% and 90%"
```

---

### Task 15: Traduction automatique des messages

**Files:**
- Create: `client/src/components/chat/TranslateButton.tsx`
- Modify: `server/src/handlers/messages.rs`

- [ ] **Step 1: Endpoint de traduction (via LibreTranslate ou DeepL free)**

```rust
// POST /messages/:id/translate
#[derive(Deserialize)]
pub struct TranslateInput { target_lang: String }

pub async fn translate_message(
    Path(id): Path<uuid::Uuid>,
    State(state): State<AppState>,
    AuthUser(_uid): AuthUser,
    Json(input): Json<TranslateInput>,
) -> Result<impl IntoResponse, AppError> {
    let msg = sqlx::query!("SELECT content FROM messages WHERE id = $1", id)
        .fetch_one(&state.db).await?;
    
    // Utiliser l'API LibreTranslate (self-hosted possible) ou fallback MyMemory (gratuit)
    let url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair=auto|{}",
        urlencoding::encode(&msg.content), &input.target_lang
    );
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build().unwrap();
    
    let resp = client.get(&url).send().await
        .map_err(|_| AppError::Internal("Service de traduction indisponible".into()))?;
    
    let json: serde_json::Value = resp.json().await
        .map_err(|_| AppError::Internal("Réponse traduction invalide".into()))?;
    
    let translated = json["responseData"]["translatedText"]
        .as_str().unwrap_or(&msg.content).to_string();
    
    Ok(Json(serde_json::json!({ "translated": translated, "lang": input.target_lang })))
}
```

- [ ] **Step 2: Bouton dans MessageList (toolbar message)**
```tsx
const [translated, setTranslated] = useState<string | null>(null)
const [translating, setTranslating] = useState(false)

const translate = async () => {
  setTranslating(true)
  try {
    const { data } = await api.post(`/messages/${message.id}/translate`, { target_lang: 'fr' })
    setTranslated(data.translated)
  } finally { setTranslating(false) }
}

// Dans l'affichage du message, sous le contenu:
{translated && (
  <div className="mt-1 px-2 py-1 bg-fc-accent/10 border-l-2 border-fc-accent rounded text-sm text-fc-text">
    <span className="text-xs text-fc-accent mr-1">Traduction :</span>{translated}
    <button onClick={() => setTranslated(null)} className="ml-2 text-fc-muted hover:text-white text-xs">✕</button>
  </div>
)}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(chat): automatic message translation via MyMemory API"
```

---

## PHASE 4 — FEATURES WAVE 2 (Vocal/Vidéo/Modération)

### Task 16: Tableau blanc partagé (Whiteboard)

**Files:**
- Create: `client/src/components/voice/Whiteboard.tsx`
- Modify: `server/src/handlers/websocket.rs`

- [ ] **Step 1: Créer Whiteboard.tsx**
```tsx
import { useRef, useEffect, useState, useCallback } from 'react'
import { useWs } from '../../store/ws'
import { Pencil, Eraser, Trash2, Download, Square, Circle as CircleIcon, Minus } from 'lucide-react'

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle'

interface DrawEvent {
  type: 'WHITEBOARD_DRAW'
  channel_id: string
  tool: Tool
  color: string
  size: number
  points: { x: number; y: number }[]
}

interface Props { channelId: string; onClose: () => void }

export default function Whiteboard({ channelId, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { send, on } = useWs()
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#ffffff')
  const [size, setSize] = useState(3)
  const [drawing, setDrawing] = useState(false)
  const pointsRef = useRef<{ x: number; y: number }[]>([])

  const getCtx = () => canvasRef.current?.getContext('2d')

  const drawPoints = useCallback((ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], t: Tool, c: string, s: number) => {
    ctx.strokeStyle = t === 'eraser' ? '#1e1f29' : c
    ctx.lineWidth = t === 'eraser' ? s * 4 : s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (t === 'pen' || t === 'eraser') {
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    const off = on('WHITEBOARD_DRAW', (d: DrawEvent) => {
      if (d.channel_id !== channelId) return
      const ctx = getCtx()
      if (ctx) drawPoints(ctx, d.points, d.tool, d.color, d.size)
    })
    const offClear = on('WHITEBOARD_CLEAR', (d: any) => {
      if (d.channel_id !== channelId) return
      const ctx = getCtx()
      if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    })
    return () => { off(); offClear() }
  }, [channelId, drawPoints, on])

  const getPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width), y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height) }
  }

  const onMouseDown = (e: React.MouseEvent) => { setDrawing(true); pointsRef.current = [getPos(e)] }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const pt = getPos(e)
    pointsRef.current.push(pt)
    const ctx = getCtx()
    if (ctx) drawPoints(ctx, pointsRef.current.slice(-2), tool, color, size)
  }
  const onMouseUp = () => {
    if (!drawing) return
    setDrawing(false)
    send({ type: 'WHITEBOARD_DRAW', channel_id: channelId, tool, color, size, points: pointsRef.current })
    pointsRef.current = []
  }

  const clear = () => {
    const ctx = getCtx()
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    send({ type: 'WHITEBOARD_CLEAR', channel_id: channelId })
  }

  const download = () => {
    const a = document.createElement('a')
    a.href = canvasRef.current?.toDataURL('image/png') ?? ''
    a.download = `whiteboard-${channelId}-${Date.now()}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 bg-fc-sidebar border-b border-fc-hover">
        <span className="text-white font-semibold text-sm">Tableau blanc</span>
        <div className="flex items-center gap-1 flex-1">
          {([['pen', <Pencil size={14}/>], ['eraser', <Eraser size={14}/>], ['line', <Minus size={14}/>], ['rect', <Square size={14}/>], ['circle', <CircleIcon size={14}/>]] as [Tool, React.ReactNode][]).map(([t, icon]) => (
            <button key={t} onClick={() => setTool(t)} className={`p-1.5 rounded ${tool === t ? 'bg-fc-accent text-white' : 'text-fc-muted hover:bg-fc-hover'}`}>{icon}</button>
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
          <input type="range" min={1} max={20} value={size} onChange={e => setSize(+e.target.value)} className="w-20" />
          <button onClick={clear} className="p-1.5 text-fc-red hover:bg-fc-red/10 rounded"><Trash2 size={14}/></button>
          <button onClick={download} className="p-1.5 text-fc-muted hover:bg-fc-hover rounded"><Download size={14}/></button>
        </div>
        <button onClick={onClose} className="text-fc-muted hover:text-white text-sm">Fermer</button>
      </div>
      <canvas ref={canvasRef} width={1920} height={1080}
        className="flex-1 w-full cursor-crosshair" style={{ background: '#1e1f29' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
    </div>
  )
}
```

- [ ] **Step 2: Relay WS dans websocket.rs**
```rust
// Dans le handler WS, ajouter les types WHITEBOARD_DRAW et WHITEBOARD_CLEAR
"WHITEBOARD_DRAW" | "WHITEBOARD_CLEAR" => {
    let channel_id = msg.get("channel_id").and_then(|v| v.as_str()).unwrap_or_default();
    if let Ok(cid) = uuid::Uuid::parse_str(channel_id) {
        state.broadcast_to_channel_members(cid, msg.clone()).await;
    }
}
```

- [ ] **Step 3: Intégrer dans VoiceVideoPage**
```tsx
import Whiteboard from '../components/voice/Whiteboard'
const [showWhiteboard, setShowWhiteboard] = useState(false)
// Bouton dans la barre de contrôles:
<CtrlBtn active={showWhiteboard} onClick={() => setShowWhiteboard(v => !v)}
  activeIcon={<Layout size={16}/>} inactiveIcon={<Layout size={16}/>}
  activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
  label="Tableau blanc" />
{showWhiteboard && <Whiteboard channelId={channel.id} onClose={() => setShowWhiteboard(false)} />}
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(voice): shared real-time whiteboard with draw/erase/shapes/download"
```

---

### Task 17: Tickets / Formulaires serveur

**Files:**
- Create: `server/migrations/023_tickets.sql`
- Create: `server/src/handlers/tickets.rs`
- Create: `client/src/pages/TicketsPage.tsx`

- [ ] **Step 1: Migration**
```sql
CREATE TABLE IF NOT EXISTS ticket_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    emoji TEXT DEFAULT '🎫',
    channel_id UUID REFERENCES channels(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    category_id UUID REFERENCES ticket_categories(id),
    creator_id UUID NOT NULL REFERENCES users(id),
    channel_id UUID REFERENCES channels(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assigned_to UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Handler tickets.rs**
```rust
// GET/POST /servers/:id/tickets
// PATCH /servers/:id/tickets/:tid (status, priority, assigned_to)
// GET /servers/:id/ticket-categories
// POST /servers/:id/ticket-categories
// (implémentation standard CRUD)
```

- [ ] **Step 3: TicketsPage.tsx (composant complet)**
```tsx
// Interface kanban-style : colonnes Open / In Progress / Resolved / Closed
// Drag & drop entre colonnes via PATCH /tickets/:id
// Filtre par catégorie et priorité
// Ouvrir un ticket crée un canal textuel dédié (via POST /channels)
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(server): ticket system with categories, kanban board, priority"
```

---

### Task 18: Classements serveur (Leaderboard)

**Files:**
- Create: `client/src/pages/LeaderboardPage.tsx`
- Modify: `server/src/handlers/servers.rs`

- [ ] **Step 1: Endpoint leaderboard**
```rust
// GET /servers/:id/leaderboard?period=week|month|all
pub async fn get_leaderboard(
    Path(server_id): Path<uuid::Uuid>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
    AuthUser(_uid): AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let period = params.get("period").map(|s| s.as_str()).unwrap_or("month");
    let since = match period {
        "week" => "NOW() - INTERVAL '7 days'",
        "month" => "NOW() - INTERVAL '30 days'",
        _ => "'1970-01-01'",
    };
    let rows = sqlx::query(&format!(
        "SELECT u.id, u.username, u.avatar_url, COUNT(m.id) as message_count,
         COUNT(DISTINCT DATE(m.created_at)) as active_days
         FROM messages m
         JOIN users u ON u.id = m.author_id
         JOIN channels c ON c.id = m.channel_id
         WHERE c.server_id = $1 AND m.created_at > {}
         GROUP BY u.id ORDER BY message_count DESC LIMIT 20", since
    )).bind(server_id).fetch_all(&state.db).await?;
    Ok(Json(rows.iter().map(|r| serde_json::json!({
        "user_id": r.get::<uuid::Uuid, _>("id"),
        "username": r.get::<String, _>("username"),
        "avatar": r.get::<Option<String>, _>("avatar_url"),
        "messages": r.get::<i64, _>("message_count"),
        "active_days": r.get::<i64, _>("active_days"),
    })).collect::<Vec<_>>()))
}
```

- [ ] **Step 2: LeaderboardPage.tsx**
```tsx
// Tableau avec rang, avatar, username, messages, jours actifs
// Sélecteur de période (semaine / mois / tout)
// Médailles pour top 3 (🥇🥈🥉)
// Mise en évidence de l'utilisateur actuel
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(server): leaderboard with weekly/monthly/all-time message counts"
```

---

### Task 19: Anti-spam + Bans temporaires

**Files:**
- Modify: `server/src/handlers/moderation.rs`
- Modify: `server/migrations` (nouvelle colonne)

- [ ] **Step 1: Migration**
```sql
ALTER TABLE server_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE server_bans ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE TABLE IF NOT EXISTS message_spam_track (
    user_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    count INT NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);
```

- [ ] **Step 2: Middleware anti-spam dans messages.rs**
```rust
// Avant d'insérer le message, vérifier le rate limit par canal
const SPAM_LIMIT: i64 = 5;
const SPAM_WINDOW_SECS: i64 = 3;

let track = sqlx::query!(
    "SELECT count, window_start FROM message_spam_track WHERE user_id=$1 AND channel_id=$2",
    user_id, channel_id
).fetch_optional(&state.db).await?;

match track {
    Some(t) if t.window_start + chrono::Duration::seconds(SPAM_WINDOW_SECS) > chrono::Utc::now() => {
        if t.count >= SPAM_LIMIT {
            return Err(AppError::RateLimited("Anti-spam : trop de messages rapides".into()));
        }
        sqlx::query!("UPDATE message_spam_track SET count = count + 1 WHERE user_id=$1 AND channel_id=$2", user_id, channel_id).execute(&state.db).await?;
    }
    _ => {
        sqlx::query!("INSERT INTO message_spam_track (user_id, channel_id, count, window_start) VALUES ($1,$2,1,NOW()) ON CONFLICT (user_id, channel_id) DO UPDATE SET count=1, window_start=NOW()", user_id, channel_id).execute(&state.db).await?;
    }
}
```

- [ ] **Step 3: Ban temporaire avec expires_at**
```rust
#[derive(Deserialize)]
pub struct BanInput {
    reason: Option<String>,
    duration_hours: Option<i64>, // None = permanent
}

// Dans la route POST /servers/:id/members/:uid/ban :
let expires_at = input.duration_hours.map(|h| chrono::Utc::now() + chrono::Duration::hours(h));
sqlx::query!(
    "INSERT INTO server_bans (server_id, user_id, banned_by, reason, expires_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (server_id, user_id) DO UPDATE SET expires_at=$5, reason=$4",
    server_id, target_uid, user_id, &input.reason, expires_at
).execute(&state.db).await?;
```

- [ ] **Step 4: Tâche de levée automatique des bans expirés**
```rust
pub async fn unban_task(state: AppState) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        sqlx::query!("DELETE FROM server_bans WHERE expires_at IS NOT NULL AND expires_at < NOW()")
            .execute(&state.db).await.ok();
    }
}
```

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(moderation): anti-spam 5msg/3s, temporary bans with auto-unban"
```

---

## PHASE 5 — FEATURES WAVE 3 (UX + Mobile + Intégrations)

### Task 20: Mode Focus (masquer sidebar)

**Files:**
- Modify: `client/src/components/layout/MainLayout.tsx`
- Modify: `client/src/components/KeyboardShortcutsModal.tsx`

- [ ] **Step 1: Ajouter état focusMode dans MainLayout**
```tsx
const [focusMode, setFocusMode] = useState(false)

// Raccourci Ctrl+Shift+F
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault()
      setFocusMode(v => !v)
    }
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}, [])

// Dans le JSX, conditionner l'affichage des sidebars:
<div className={`flex h-full transition-all duration-200 ${focusMode ? '' : ''}`}>
  {!focusMode && <ServerSidebar />}
  {!focusMode && <ChannelSidebar />}
  <main className="flex-1 min-w-0">...</main>
</div>
```

- [ ] **Step 2: Bouton toggle dans le header du canal**
```tsx
// Ajouter dans ChannelHeader ou la barre d'outils:
<button onClick={() => setFocusMode(v => !v)} title="Mode focus (Ctrl+Shift+F)"
  className={`p-2 rounded-lg ${focusMode ? 'bg-fc-accent text-white' : 'text-fc-muted hover:bg-fc-hover'}`}>
  <Maximize2 size={16} />
</button>
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ux): focus mode hides sidebars (Ctrl+Shift+F)"
```

---

### Task 21: Recherche globale améliorée (tous serveurs + DMs)

**Files:**
- Modify: `server/src/handlers/messages.rs`
- Modify: `client/src/components/QuickSwitcher.tsx`

- [ ] **Step 1: Endpoint recherche globale**
```rust
// GET /search?q=...&type=messages|channels|users|servers
pub async fn global_search(
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let q = params.get("q").map(|s| format!("%{}%", s)).unwrap_or_default();
    let search_type = params.get("type").map(|s| s.as_str()).unwrap_or("all");
    
    let mut result = serde_json::Map::new();
    
    if matches!(search_type, "all" | "messages") {
        let msgs = sqlx::query!(
            "SELECT m.id, m.content, m.created_at, u.username, c.name as channel_name
             FROM messages m JOIN users u ON u.id = m.author_id JOIN channels c ON c.id = m.channel_id
             JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = $1
             WHERE m.content ILIKE $2 ORDER BY m.created_at DESC LIMIT 10",
            uid, &q
        ).fetch_all(&state.db).await?;
        result.insert("messages".into(), serde_json::to_value(
            msgs.iter().map(|m| serde_json::json!({ "id": m.id, "content": m.content, "channel": m.channel_name, "author": m.username })).collect::<Vec<_>>()
        ).unwrap_or_default());
    }
    
    if matches!(search_type, "all" | "users") {
        let users = sqlx::query!(
            "SELECT id, username, avatar_url FROM users WHERE username ILIKE $1 LIMIT 10", &q
        ).fetch_all(&state.db).await?;
        result.insert("users".into(), serde_json::to_value(
            users.iter().map(|u| serde_json::json!({ "id": u.id, "username": u.username, "avatar": u.avatar_url })).collect::<Vec<_>>()
        ).unwrap_or_default());
    }
    
    Ok(Json(serde_json::Value::Object(result)))
}
```

- [ ] **Step 2: Étendre QuickSwitcher pour afficher les résultats de recherche**
```tsx
// Quand le query commence par '?' : recherche globale (pas juste navigation channels)
// Afficher 3 sections : Messages / Utilisateurs / Canaux avec icônes et liens
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(search): global search across messages, users, channels"
```

---

### Task 22: Export conversation PDF/TXT + Import contacts CSV

**Files:**
- Modify: `client/src/pages/ChannelPage.tsx` (bouton export déjà intégré à compléter)
- Create: `client/src/components/modals/ImportContactsModal.tsx`

- [ ] **Step 1: Compléter ExportConversationButton (si bouton existe sans logique)**
```tsx
// Dans le handler d'export:
const exportTxt = async () => {
  const { data: msgs } = await api.get(`/channels/${channelId}/messages?limit=1000`)
  const lines = msgs.map((m: any) => `[${new Date(m.created_at).toLocaleString('fr')}] ${m.author.username}: ${m.content}`)
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${channelName}-export.txt`; a.click()
  URL.revokeObjectURL(url)
}

const exportPdf = async () => {
  const { data: msgs } = await api.get(`/channels/${channelId}/messages?limit=1000`)
  // Construire un HTML et ouvrir la fenêtre d'impression (window.print)
  const html = `<html><head><style>body{font-family:monospace;font-size:12px}p{margin:4px 0}</style></head><body>
    <h2>${channelName}</h2>
    ${msgs.map((m: any) => `<p><strong>${m.author.username}</strong> <small>${new Date(m.created_at).toLocaleString('fr')}</small><br>${m.content}</p>`).join('')}
  </body></html>`
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.print()
}
```

- [ ] **Step 2: ImportContactsModal.tsx**
```tsx
// Drag & drop CSV avec colonnes: email,username,message
// Parse CSV, prévisualiser le tableau
// Bouton "Inviter" → POST /friends/invite-batch (envoie des invitations en masse)
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(chat): export conversation TXT/PDF, import contacts CSV"
```

---

### Task 23: Dashboard admin global

**Files:**
- Create: `client/src/pages/AdminPage.tsx`
- Modify: `server/src/handlers/servers.rs`

- [ ] **Step 1: Endpoint stats globales**
```rust
// GET /admin/stats (owner uniquement ou role admin)
// Retourne: total users, messages today, active servers, storage used, etc.
```

- [ ] **Step 2: AdminPage.tsx avec graphiques**
```tsx
// Cards: total users / messages / servers / storage
// Graphique messages/jour sur 30j (SVG bars simple)
// Tableau des 10 serveurs les plus actifs
// Tableau des 10 utilisateurs les plus actifs
// Actions rapides: ban user, delete server, view logs
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(admin): global admin dashboard with stats and quick actions"
```

---

### Task 24: Notifications push FCM (PWA Mobile)

**Files:**
- Modify: `client/src/hooks/usePushNotifications.ts`
- Modify: `server/src/handlers/user_settings.rs`
- Create: `client/public/sw.js` (service worker)

- [ ] **Step 1: Service Worker avec push**
```js
// client/public/sw.js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'ForgeChat', {
      body: data.body,
      icon: '/icons/icon.svg',
      badge: '/icons/badge.png',
      data: { url: data.url },
      vibrate: [100, 50, 100],
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(clients.openWindow(url))
})
```

- [ ] **Step 2: Enregistrer le SW et subscription dans usePushNotifications.ts**
```ts
export async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.register('/sw.js')
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY, // à générer
  })
  await api.post('/users/me/push-subscription', sub.toJSON())
  return sub
}
```

- [ ] **Step 3: Backend: stocker subscription + envoyer push**
```rust
// POST /users/me/push-subscription → stocker endpoint+keys en DB
// Dans les handlers de messages/mentions : envoyer push via web-push crate si user offline
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(pwa): push notifications via service worker, FCM-compatible"
```

---

### Task 25: Historique d'activité + RGPD export données

**Files:**
- Create: `server/src/handlers/privacy.rs`
- Create: `client/src/components/settings/PrivacySection.tsx` (compléter l'existant)

- [ ] **Step 1: Endpoint export RGPD**
```rust
// GET /users/me/data-export
// Génère un JSON avec: profil, messages (100 derniers), serveurs, amis, paramètres
pub async fn export_user_data(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let user = sqlx::query!("SELECT username, email, bio, created_at FROM users WHERE id=$1", uid).fetch_one(&state.db).await?;
    let messages = sqlx::query!("SELECT content, created_at FROM messages WHERE author_id=$1 ORDER BY created_at DESC LIMIT 100", uid).fetch_all(&state.db).await?;
    let servers = sqlx::query!("SELECT s.name FROM servers s JOIN server_members sm ON sm.server_id=s.id WHERE sm.user_id=$1", uid).fetch_all(&state.db).await?;
    
    let export = serde_json::json!({
        "exported_at": chrono::Utc::now(),
        "profile": { "username": user.username, "email": user.email, "bio": user.bio, "created_at": user.created_at },
        "messages_sample": messages.iter().map(|m| serde_json::json!({ "content": m.content, "date": m.created_at })).collect::<Vec<_>>(),
        "servers": servers.iter().map(|s| &s.name).collect::<Vec<_>>(),
    });
    
    Ok((
        [(axum::http::header::CONTENT_TYPE, "application/json"), (axum::http::header::CONTENT_DISPOSITION, "attachment; filename=\"forgechat-data.json\"")],
        Json(export)
    ))
}
```

- [ ] **Step 2: Bouton dans PrivacySection.tsx**
```tsx
<button onClick={() => window.open('/api/users/me/data-export', '_blank')}
  className="flex items-center gap-2 px-4 py-2 bg-fc-hover hover:bg-fc-channel rounded-lg text-sm text-white">
  <Download size={14} /> Télécharger mes données (RGPD)
</button>
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(privacy): GDPR data export endpoint and button in settings"
```

---

### Task 26: Intégration Spotify Now Playing

**Files:**
- Create: `client/src/components/settings/ConnectedAccountsSection.tsx` (mise à jour)
- Modify: `server/src/handlers/user_settings.rs`

- [ ] **Step 1: Afficher activity Spotify dans profil**
```tsx
// L'activité "listening" existe déjà dans le store presence
// Ajouter un bouton dans settings pour activer "Afficher Spotify sur mon profil"
// Utiliser l'API Web Playback SDK Spotify (côté client, sans backend)
// Lire current track via window.Spotify.Player et broadcaster via PRESENCE_UPDATE WS
```

- [ ] **Step 2: Affichage dans UserPopup et MemberList**
```tsx
// Si activity.type === 'listening':
<div className="flex items-center gap-1.5 text-xs text-fc-green">
  <Music size={12} /> Écoute {activity.details} — {activity.state}
</div>
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(presence): Spotify Now Playing integration via Web Playback SDK"
```

---

### Task 27: Emoji personnalisés animés (GIF)

**Files:**
- Modify: `server/src/handlers/emojis.rs`
- Modify: `client/src/utils/markdown.tsx`

- [ ] **Step 1: Supporter les GIFs dans l'upload d'emojis**
```rust
// Dans emojis.rs, le handler d'upload :
// Accepter image/gif en plus de image/png
// Limite 512KB pour les GIF (au lieu de 256KB)
// Stocker le type MIME pour savoir si c'est animé
```

- [ ] **Step 2: Rendu animé dans markdown.tsx**
```tsx
// Les emojis custom sont déjà rendus via <img>
// Ajouter className="inline-block align-middle w-5 h-5" sur les GIFs
// Les navigateurs jouent les GIFs automatiquement
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(emoji): animated GIF support for custom server emojis (512KB limit)"
```

---

### Task 28: Réactions en temps réel pendant appel (emojis flottants)

**Files:**
- Create: `client/src/components/voice/FloatingReactions.tsx`
- Modify: `server/src/handlers/websocket.rs`

- [ ] **Step 1: FloatingReactions.tsx**
```tsx
import { useState, useEffect } from 'react'
import { useWs } from '../../store/ws'

interface FloatingEmoji { id: string; emoji: string; x: number }

export default function FloatingReactions({ channelId }: { channelId: string }) {
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([])
  const { on } = useWs()

  useEffect(() => {
    const off = on('VOICE_REACTION', (d: any) => {
      if (d.channel_id !== channelId) return
      const id = Math.random().toString(36).slice(2)
      const x = 10 + Math.random() * 80
      setEmojis(prev => [...prev, { id, emoji: d.emoji, x }])
      setTimeout(() => setEmojis(prev => prev.filter(e => e.id !== id)), 3000)
    })
    return off
  }, [channelId, on])

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {emojis.map(e => (
        <div key={e.id} className="absolute bottom-20 text-3xl animate-bounce"
          style={{ left: `${e.x}%`, animation: 'floatUp 3s ease-out forwards' }}>
          {e.emoji}
        </div>
      ))}
      <style>{`@keyframes floatUp { from { opacity:1; transform:translateY(0) } to { opacity:0; transform:translateY(-300px) } }`}</style>
    </div>
  )
}
```

- [ ] **Step 2: Bouton dans VoiceVideoPage**
```tsx
// Picker 8 emojis rapides (👍❤️😂🔥👏😮🎉💯)
// Clic → send({ type: 'VOICE_REACTION', channel_id, emoji })
// relay dans websocket.rs → broadcast_to_channel_members
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(voice): floating emoji reactions during calls"
```

---

### Task 29: Onboarding Wizard (première connexion)

**Files:**
- Create: `client/src/components/Onboarding.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Créer Onboarding.tsx**
```tsx
// 4 étapes:
// 1. Bienvenue + avatar upload
// 2. Trouver ou créer un serveur (lien vers /explore)
// 3. Paramètres micro/notifications (permission request)
// 4. C'est parti !
// Persisté via localStorage 'fc_onboarding_done'
```

- [ ] **Step 2: Afficher dans App.tsx**
```tsx
const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('fc_onboarding_done') && !!user)
// Overlay fullscreen au-dessus du contenu
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ux): first-time onboarding wizard (avatar, server, permissions)"
```

---

### Task 30: Mode split-view (2 canaux côte à côte)

**Files:**
- Modify: `client/src/pages/ChannelPage.tsx`
- Modify: `client/src/components/layout/MainLayout.tsx`

- [ ] **Step 1: Ajouter état splitView dans MainLayout**
```tsx
const [splitChannel, setSplitChannel] = useState<string | null>(null)

// Raccourci Ctrl+Shift+S → activer split
// Bouton dans ChannelHeader pour "Ouvrir en split"
```

- [ ] **Step 2: Rendu split**
```tsx
{splitChannel ? (
  <div className="flex h-full">
    <div className="flex-1 border-r border-fc-hover"><ChannelPage channelId={currentChannelId} /></div>
    <div className="flex-1"><ChannelPage channelId={splitChannel} /></div>
  </div>
) : <ChannelPage channelId={currentChannelId} />}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(ux): split-view mode for two channels side by side (Ctrl+Shift+S)"
```

---

## PHASE 6 — FEATURES WAVE 4 (30 features supplémentaires)

### Task 31: Formulaire signalement/rapport d'abus

- [ ] Créer `ReportModal.tsx` — bouton "Signaler" sur messages/profils → form avec catégorie + description
- [ ] Endpoint `POST /reports` → table `abuse_reports` → notification admin via WS
- [ ] Commit: `feat(moderation): report/flag system for messages and users`

### Task 32: Groupes d'amis / Groupes DM

- [ ] Migration: `group_dms` (id, name, creator_id, members[])
- [ ] `GET/POST /group-dms`, `POST /group-dms/:id/messages`
- [ ] `GroupDMPage.tsx` — liste de groupes dans la sidebar DMs
- [ ] Commit: `feat(dm): group DMs with multiple participants`

### Task 33: Statut personnalisé avec emoji

- [ ] Endpoint `PATCH /users/me/status` avec `emoji` + `text` + `expires_at`
- [ ] Affichage dans `UserPopup`, `MemberList`, `UserPanel`
- [ ] Presets status: "Ne pas déranger", "En réunion", "À plus tard"
- [ ] Commit: `feat(presence): custom status with emoji, text, and expiry`

### Task 34: Réponses rapides / Templates

- [ ] `QuickReplies.tsx` — liste personnalisable sauvée en localStorage
- [ ] Bouton ⚡ dans `MessageInput` → popup avec templates
- [ ] Commit: `feat(chat): quick reply templates`

### Task 35: Profil pronoms + bio Markdown

- [ ] Colonne `pronouns TEXT` dans users
- [ ] Input dans ProfileSection.tsx + affichage dans UserPopup
- [ ] Commit: `feat(profile): pronouns field`

### Task 36: Anniversaires membres

- [ ] Colonne `birthday DATE` dans users (optionnel)
- [ ] Notification canal dédié quand c'est l'anniversaire d'un membre (tâche Tokio quotidienne)
- [ ] Commit: `feat(server): birthday notifications for members`

### Task 37: Réponse aux réactions (thread depuis une réaction)

- [ ] Clic sur une réaction → ouvre thread avec les messages sur ce sujet
- [ ] Commit: `feat(chat): reaction-based thread creation`

### Task 38: Messages éphémères (disparaissent après lecture)

- [ ] `is_ephemeral BOOLEAN` sur messages + TTL 10s côté client
- [ ] Affiché différemment (fond rouge, timer)
- [ ] Commit: `feat(chat): ephemeral messages that auto-delete after viewing`

### Task 39: Copie de message en Markdown

- [ ] Bouton "Copier Markdown" dans toolbar de chaque message
- [ ] Commit: `feat(chat): copy message as Markdown`

### Task 40: Mentions @here et @everyone avec permissions

- [ ] Vérifier permission `MENTION_EVERYONE` (bit 17) avant d'autoriser
- [ ] Retourner erreur 403 si pas de permission
- [ ] Commit: `fix(chat): gate @everyone and @here behind MENTION_EVERYONE permission`

### Task 41: Canaux archivés

- [ ] `archived BOOLEAN` sur channels + endpoint `PATCH /channels/:id/archive`
- [ ] Section "Archivés" (collapse par défaut) dans `ChannelSidebar`
- [ ] Commit: `feat(channels): archive channels to hide them without deleting`

### Task 42: Historique de connexion dans paramètres

- [ ] `GET /users/me/login-history` → table `user_sessions` (déjà créée en Task 12)
- [ ] Section dans SettingsPage → `LoginHistorySection.tsx`
- [ ] Commit: `feat(security): login history in settings`

### Task 43: Mode karaoké (lyrics Spotify)

- [ ] Afficher les paroles de la chanson en cours depuis l'API Genius (scraping via backend)
- [ ] Commit: `feat(voice): karaoke lyrics display synchronized with Spotify`

### Task 44: Badge non-lus dans le titre de la page

- [ ] `useEffect` dans App.tsx → `document.title = unreadCount > 0 ? \`(${unreadCount}) ForgeChat\` : 'ForgeChat'`
- [ ] Commit: `feat(ux): unread count in page title and tab`

### Task 45: Zoom sur images (lightbox améliorée)

- [ ] `LightboxModal.tsx` — zoom pinch-to-zoom, navigation ←→, download
- [ ] Remplacer l'inline lightbox existante
- [ ] Commit: `feat(chat): improved image lightbox with zoom and navigation`

### Task 46: QR code d'invitation serveur

- [ ] Dans `InviteModal.tsx`, ajouter QR code de l'URL d'invitation
- [ ] Via `https://api.qrserver.com/v1/create-qr-code/?data=...`
- [ ] Commit: `feat(invite): QR code for server invitations`

### Task 47: Réactions avec compteur animé

- [ ] Quand le compteur change, animation `scale-110` pendant 200ms
- [ ] Commit: `feat(chat): animated reaction counter on change`

### Task 48: Historique de recherche

- [ ] Sauvegarder les 10 dernières recherches dans localStorage
- [ ] Afficher dans `SearchPanel` avant de taper
- [ ] Commit: `feat(search): search history with recent queries`

### Task 49: Profils vérifiés (badge)

- [ ] Colonne `verified BOOLEAN` sur users (admin seul peut activer)
- [ ] Badge ✓ dans `UserPopup` et `MessageList`
- [ ] Commit: `feat(profile): verified badge for users`

### Task 50: Liens permanents vers les messages

- [ ] `GET /channels/:id/messages/:mid` → redirect vers la page avec highlight
- [ ] Bouton "Lien vers ce message" dans toolbar
- [ ] Commit: `feat(chat): permanent message permalink`

### Task 51: Thème personnalisé (couleurs custom)

- [ ] Dans `AppearanceSection.tsx`, onglet "Personnalisé" avec 5 color pickers (bg, sidebar, text, accent, green)
- [ ] CSS variables appliquées dynamiquement
- [ ] Commit: `feat(theme): fully custom color theme editor`

### Task 52: Masquage de canaux spécifiques

- [ ] Table `hidden_channels (user_id, channel_id)`
- [ ] Bouton "Masquer ce canal" dans le menu contextuel sidebar
- [ ] Commit: `feat(channels): per-user channel hiding`

### Task 53: Messagerie sécurisée E2E (compléter useE2E.ts)

- [ ] `useE2E.ts` existe déjà — compléter avec échange de clés ECDH et chiffrement AES-GCM
- [ ] Afficher 🔒 sur les messages E2E dans les DMs
- [ ] Commit: `feat(security): complete E2E encryption for DMs`

### Task 54: Bots améliorés — webhooks entrants GitHub

- [ ] Dans `FeedsTab`, ajouter source type "github_webhook"
- [ ] Parser payload GitHub `push`/`pull_request`/`issues`
- [ ] Commit: `feat(feeds): GitHub webhook integration for push/PR/issues events`

### Task 55: Statistiques personnelles

- [ ] `GET /users/me/stats` → messages total, serveurs, amis, réactions données/reçues
- [ ] Section dans SettingsPage → `StatsSection.tsx`
- [ ] Commit: `feat(profile): personal stats (messages, servers, reactions)`

### Task 56: Aperçu de lien étendu (Open Graph)

- [ ] `LinkPreview` existant — améliorer avec image grande taille, site name, description
- [ ] Ajouter whitelist de domaines (Twitter, GitHub, YouTube...)
- [ ] Commit: `feat(chat): enhanced link preview with large images and metadata`

### Task 57: Canaux par catégorie drag & drop (reordering)

- [ ] Le D&D de channels existe déjà — étendre pour déplacer entre catégories
- [ ] `PATCH /categories/reorder` avec nouveau parent_category_id
- [ ] Commit: `feat(channels): drag channels between categories`

### Task 58: Raccourcis clavier personnalisables

- [ ] Dans `KeybindingsSection.tsx` (déjà dans settings), interface pour modifier les raccourcis
- [ ] Sauvegarder dans localStorage `fc_keybindings`
- [ ] Commit: `feat(settings): customizable keyboard shortcuts`

### Task 59: Notifications par email (événements importants)

- [ ] Table `email_preferences (user_id, event_type, enabled)`
- [ ] Tâche Tokio → envoyer email si DM non lu depuis 24h (via `lettre`)
- [ ] Commit: `feat(notifications): email notifications for unread DMs`

### Task 60: Archivage de messages (purge)

- [ ] Admin → `POST /channels/:id/purge?before=date&author=uid`
- [ ] Suppression en masse avec audit log
- [ ] Commit: `feat(admin): bulk message purge with audit trail`

---

## RÉCAPITULATIF DES 60 TÂCHES

| Phase | Tasks | Scope |
|-------|-------|-------|
| Phase 1 | 1-6 | Bugfixes critiques audio/vidéo/Tauri |
| Phase 2 | 7-9 | Desktop app (tray, portable, deep links) |
| Phase 3 | 10-15 | Features Wave 1 (chat, auth, profil) |
| Phase 4 | 16-19 | Features Wave 2 (vocal, modération) |
| Phase 5 | 20-30 | Features Wave 3 (UX, PWA, intégrations) |
| Phase 6 | 31-60 | 30 features supplémentaires (micro-tâches) |

**Total features nouvelles : 60 tâches couvrant ~100 fonctionnalités distinctes.**

## Ordre d'exécution recommandé

1. **Phase 1 d'abord** (fixes bloquants — audio/vidéo cassé = app inutilisable)
2. **Phase 2** (desktop app — critère explicite de la demande)
3. **Phases 3-5** en parallèle par sous-agents (tâches indépendantes)
4. **Phase 6** en parallèle, 3 tâches par agent

## Commandes de déploiement post-implémentation

```bash
# VPS
cd /opt/forgechat
git fetch origin && git reset --hard origin/master
cd client && npm ci && npm run build && cd ..
docker compose up -d --build --remove-orphans

# Desktop Windows
cd desktop && build.bat
# Artefacts: dist-desktop/ForgeChat-Setup-v3.3.0.exe + ForgeChat-Portable-v3.3.0.exe
```
