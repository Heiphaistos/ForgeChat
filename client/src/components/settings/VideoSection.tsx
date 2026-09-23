import { useState, useEffect, useRef, useCallback } from 'react'
import { Field } from './shared'
import { Camera, RefreshCw, ShieldCheck, ShieldX, Monitor } from 'lucide-react'
import { useVoice } from '../../store/voice'

export default function VideoSection() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState(localStorage.getItem('fc_video_input') ?? '')
  const [previewActive, setPreviewActive] = useState(false)
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const setVideoInput = useVoice(s => s.setVideoInput)
  const applyQualityPrefs = useVoice(s => s.applyQualityPrefs)
  const [camHeight, setCamHeight] = useState(() => localStorage.getItem('fc_cam_height') ?? '720')
  const [camBitrate, setCamBitrate] = useState(() => localStorage.getItem('fc_cam_bitrate') ?? '1200000')
  const [screenHeight, setScreenHeight] = useState(() => localStorage.getItem('fc_screen_height') ?? '1080')
  const [screenFps, setScreenFps] = useState(() => localStorage.getItem('fc_screen_fps') ?? '30')
  const [screenBitrate, setScreenBitrate] = useState(() => localStorage.getItem('fc_screen_bitrate') ?? '4000000')
  const autoWatchStreams = useVoice(s => s.autoWatchStreams)
  const setAutoWatchStreams = useVoice(s => s.setAutoWatchStreams)
  const [screenHint, setScreenHint] = useState(() => localStorage.getItem('fc_screen_hint') ?? 'motion')

  const savePref = (key: string, value: string, setter: (v: string) => void) => {
    localStorage.setItem(key, value)
    setter(value)
    void applyQualityPrefs()
  }

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter(d => d.kind === 'videoinput'))
    } catch {}
  }, [])

  useEffect(() => {
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
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

  const requestPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(t => t.stop())
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  const startPreview = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(selectedCamera ? { deviceId: { exact: selectedCamera } } : {}),
        },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      // L'élément <video> n'existe pas encore au premier clic : il n'est monté
      // qu'une fois previewActive à true. Assigner srcObject avant, c'était
      // assigner à null — caméra allumée, cadre noir.
      setPreviewActive(true)
      setPermission('granted')
      await refreshDevices()
    } catch {
      setPermission('denied')
    }
  }

  const stopPreview = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setPreviewActive(false)
  }

  // Attache le flux dès que le <video> est monté (et à chaque changement de flux)
  useEffect(() => {
    if (previewActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [previewActive])

  useEffect(() => () => stopPreview(), [])

  const handleCameraChange = (id: string) => {
    setSelectedCamera(id)
    // Applique la caméra à l'appel en cours (replaceTrack) et pas seulement au suivant
    void setVideoInput(id)
    if (previewActive) {
      stopPreview()
      setTimeout(startPreview, 100)
    }
  }

  return (
    <div className="space-y-6">
      {/* Bloc permission caméra */}
      {permission !== 'granted' && (
        <div className={`p-4 rounded-xl border flex items-center gap-3
          ${permission === 'denied'
            ? 'bg-fc-red/10 border-fc-red/30'
            : 'bg-fc-accent/10 border-fc-accent/30'}`}
        >
          {permission === 'denied'
            ? <ShieldX size={20} className="text-fc-red flex-shrink-0" />
            : <ShieldCheck size={20} className="text-fc-accent flex-shrink-0" />}
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              {permission === 'denied' ? 'Accès caméra refusé' : 'Accès caméra requis'}
            </p>
            <p className="text-xs text-fc-muted mt-0.5">
              {permission === 'denied'
                ? 'Autorisez la caméra dans les paramètres de votre navigateur.'
                : 'Cliquez pour autoriser ForgeChat à accéder à votre caméra.'}
            </p>
          </div>
          {permission !== 'denied' && (
            <button onClick={requestPermission} className="btn-primary text-xs px-3 py-1.5 flex-shrink-0">
              Autoriser
            </button>
          )}
        </div>
      )}

      <Field label="Caméra">
        <div className="flex gap-2">
          <select
            value={selectedCamera}
            onChange={e => handleCameraChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Défaut du système</option>
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Caméra ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
          <button
            onClick={refreshDevices}
            className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted"
            title="Actualiser la liste"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white font-medium uppercase tracking-wide">Aperçu caméra</p>
          <button
            onClick={previewActive ? stopPreview : startPreview}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
              ${previewActive
                ? 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30'
                : 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30'
              }`}
          >
            <Camera size={12} />
            {previewActive ? 'Arrêter' : 'Aperçu'}
          </button>
        </div>
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {previewActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-fc-muted">
              <Camera size={32} className="opacity-30" />
              <span className="text-xs">Cliquez sur Aperçu pour tester votre caméra</span>
            </div>
          )}
        </div>
      </div>

      {/* Qualité d'émission — aucune de ces valeurs n'était réglable, et aucun
          plafond de débit n'était appliqué aux senders (mesh N-à-N sans limite). */}
      <Field label="Qualité de la caméra">
        <div className="grid grid-cols-2 gap-2">
          <select value={camHeight} onChange={e => savePref('fc_cam_height', e.target.value, setCamHeight)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="360">360p (économe)</option>
            <option value="480">480p</option>
            <option value="720">720p (recommandé)</option>
            <option value="1080">1080p</option>
          </select>
          <select value={camBitrate} onChange={e => savePref('fc_cam_bitrate', e.target.value, setCamBitrate)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="500000">0,5 Mb/s</option>
            <option value="1200000">1,2 Mb/s (recommandé)</option>
            <option value="2500000">2,5 Mb/s</option>
            <option value="4000000">4 Mb/s</option>
          </select>
        </div>
        <p className="text-xs text-fc-muted mt-1">
          Chaque participant reçoit son propre flux : au-delà de 5-6 caméras, baissez la résolution et le débit.
        </p>
      </Field>

      <Field label="Qualité du partage d'écran">
        <div className="grid grid-cols-2 gap-2">
          <select value={screenHeight} onChange={e => savePref('fc_screen_height', e.target.value, setScreenHeight)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="720">720p</option>
            <option value="1080">1080p (recommandé)</option>
            <option value="1440">1440p</option>
          </select>
          <select value={screenFps} onChange={e => savePref('fc_screen_fps', e.target.value, setScreenFps)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="15">15 images/s</option>
            <option value="30">30 images/s</option>
            <option value="60">60 images/s (jeu)</option>
          </select>
          <select value={screenBitrate} onChange={e => savePref('fc_screen_bitrate', e.target.value, setScreenBitrate)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="1500000">1,5 Mb/s</option>
            <option value="4000000">4 Mb/s (recommandé)</option>
            <option value="8000000">8 Mb/s</option>
          </select>
          <select value={screenHint} onChange={e => savePref('fc_screen_hint', e.target.value, setScreenHint)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="motion">Fluidité (jeu, vidéo)</option>
            <option value="detail">Netteté (texte, code)</option>
          </select>
        </div>
        <p className="text-xs text-fc-muted mt-1 flex items-center gap-1">
          <Monitor size={12} /> Le son du partage n'est transmis que pour un onglet ou l'écran entier — une fenêtre seule ne peut pas partager son audio.
        </p>
      </Field>
      <Field label="Streams des autres">
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={autoWatchStreams} onChange={e => setAutoWatchStreams(e.target.checked)} className="accent-fc-accent" />
          Regarder automatiquement les streams
        </label>
        <p className="text-xs text-fc-muted mt-1">Désactivé, un stream n'est téléchargé qu'après un clic sur « Regarder » : utile sur une connexion lente ou avec plusieurs streams à la fois.</p>
      </Field>
    </div>
  )
}
