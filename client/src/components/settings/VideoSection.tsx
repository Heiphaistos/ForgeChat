import { useState, useEffect, useRef, useCallback } from 'react'
import { Field } from './shared'
import { Camera, RefreshCw, ShieldCheck, ShieldX, Monitor } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'
import { useClipsSetting } from '../../lib/clipBuffer'
import { useT, intlLocale } from '../../i18n'
import toast from 'react-hot-toast'
import { backgroundImage, clearBackgroundImage, saveBackgroundImage } from '../../utils/backgroundBlur'

export default function VideoSection() {
  const t = useT()
  const rec = t('settings.video.recommended')
  const mbps = (n: number) => `${n.toLocaleString(intlLocale())} Mb/s`
  const fps = (n: number) => t('settings.video.fps', { n })
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
  const clipsEnabled = useClipsSetting(s => s.enabled)
  const setClipsEnabled = useClipsSetting(s => s.setEnabled)
  const [screenHint, setScreenHint] = useState(() => localStorage.getItem('fc_screen_hint') ?? 'motion')
  const [camBlur, setCamBlur] = useState(() => localStorage.getItem('fc_cam_blur') ?? 'false')
  const [bgImage, setBgImage] = useState(backgroundImage)

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
      stream.getTracks().forEach(tr => tr.stop())
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
    streamRef.current?.getTracks().forEach(tr => tr.stop())
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
    void useCallStore.getState().setVideoInput()
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
              {permission === 'denied' ? t('settings.video.denied') : t('settings.video.required')}
            </p>
            <p className="text-xs text-fc-muted mt-0.5">
              {permission === 'denied'
                ? t('settings.video.deniedHelp')
                : t('settings.video.requiredHelp')}
            </p>
          </div>
          {permission !== 'denied' && (
            <button onClick={requestPermission} className="btn-primary text-xs px-3 py-1.5 flex-shrink-0">
              {t('settings.audio.allow')}
            </button>
          )}
        </div>
      )}

      <Field label={t('settings.video.camera')}>
        <div className="flex gap-2">
          <select
            value={selectedCamera}
            onChange={e => handleCameraChange(e.target.value)}
            className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">{t('settings.audio.systemDefault')}</option>
            {devices.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('settings.video.camN', { id: d.deviceId.slice(0, 6) })}
              </option>
            ))}
          </select>
          <button
            onClick={refreshDevices}
            className="p-2 bg-fc-hover rounded-lg hover:bg-fc-channel text-fc-muted"
            title={t('settings.video.refresh')}
            aria-label={t('settings.video.refresh')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </Field>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-white font-medium uppercase tracking-wide">{t('settings.video.preview')}</p>
          <button
            onClick={previewActive ? stopPreview : startPreview}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
              ${previewActive
                ? 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30'
                : 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30'
              }`}
          >
            <Camera size={12} />
            {previewActive ? t('settings.audio.stop') : t('settings.video.previewBtn')}
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
              <span className="text-xs">{t('settings.video.previewHint')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Qualité d'émission — aucune de ces valeurs n'était réglable, et aucun
          plafond de débit n'était appliqué aux senders (mesh N-à-N sans limite). */}
      <Field label={t('settings.video.camQuality')}>
        <div className="grid grid-cols-2 gap-2">
          <select value={camHeight} onChange={e => savePref('fc_cam_height', e.target.value, setCamHeight)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="360">{`360p (${t('settings.video.saver')})`}</option>
            <option value="480">480p</option>
            <option value="720">{`720p (${rec})`}</option>
            <option value="1080">1080p</option>
          </select>
          <select value={camBitrate} onChange={e => savePref('fc_cam_bitrate', e.target.value, setCamBitrate)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="500000">{mbps(0.5)}</option>
            <option value="1200000">{`${mbps(1.2)} (${rec})`}</option>
            <option value="2500000">{mbps(2.5)}</option>
            <option value="4000000">4 Mb/s</option>
            <option value="6000000">6 Mb/s</option>
          </select>
        </div>
        <p className="text-xs text-fc-muted mt-1">
          {t('settings.video.camQualityHint')}
        </p>
      </Field>

      <Field label={t('settings.video.background')}>
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={camBlur === 'true'} onChange={e => savePref('fc_cam_blur', String(e.target.checked), setCamBlur)} className="accent-fc-accent" />
          {t('settings.video.blur')}
        </label>
        <p className="text-xs text-fc-muted mt-1">{t('settings.video.blurHint')}</p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {bgImage && <img src={bgImage} alt="" className="h-10 w-16 object-cover rounded border border-fc-hover" />}
          <label className="text-xs px-2 py-1 rounded bg-fc-hover hover:bg-fc-accent/30 text-white cursor-pointer">
            {t('voiceLot.bg.pick')}
            <input type="file" accept="image/*" className="hidden" onChange={e => {
              const f = e.target.files?.[0]
              if (f) void saveBackgroundImage(f).then(setBgImage).catch(() => toast.error(t('voiceLot.bg.error')))
            }} />
          </label>
          {bgImage && (
            <button onClick={() => { clearBackgroundImage(); setBgImage(null) }}
              className="text-xs px-2 py-1 rounded bg-fc-hover hover:bg-fc-red text-white">{t('voiceLot.bg.remove')}</button>
          )}
        </div>
        <p className="text-xs text-fc-muted mt-1">{t('voiceLot.bg.hint')}</p>
      </Field>

      <Field label={t('settings.video.screenQuality')}>
        <div className="grid grid-cols-2 gap-2">
          <select value={screenHeight} onChange={e => savePref('fc_screen_height', e.target.value, setScreenHeight)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="720">720p</option>
            <option value="1080">{`1080p (${rec})`}</option>
            <option value="1440">1440p</option>
            <option value="2160">2160p (4K)</option>
            <option value="source">{t('dock.stream.source')}</option>
          </select>
          <select value={screenFps} onChange={e => savePref('fc_screen_fps', e.target.value, setScreenFps)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="15">{fps(15)}</option>
            <option value="30">{fps(30)}</option>
            <option value="60">{`${fps(60)} (${t('settings.video.game')})`}</option>
          </select>
          <select value={screenBitrate} onChange={e => savePref('fc_screen_bitrate', e.target.value, setScreenBitrate)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="1500000">{mbps(1.5)}</option>
            <option value="4000000">{`${mbps(4)} (${rec})`}</option>
            <option value="8000000">8 Mb/s</option>
            <option value="12000000">12 Mb/s (4K)</option>
            <option value="20000000">{`${mbps(20)} (4K, ${fps(60)})`}</option>
          </select>
          <select value={screenHint} onChange={e => savePref('fc_screen_hint', e.target.value, setScreenHint)}
            className="bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white">
            <option value="motion">{t('settings.video.motion')}</option>
            <option value="detail">{t('settings.video.detail')}</option>
          </select>
        </div>
        <p className="text-xs text-fc-muted mt-1 flex items-center gap-1">
          <Monitor size={12} /> {t('settings.video.audioHint')}
        </p>
      </Field>
      <Field label={t('settings.video.others')}>
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={autoWatchStreams} onChange={e => setAutoWatchStreams(e.target.checked)} className="accent-fc-accent" />
          {t('settings.video.autoWatch')}
        </label>
        <p className="text-xs text-fc-muted mt-1">{t('settings.video.autoWatchHint')}</p>
      </Field>
      <Field label={t('settings.video.clips')}>
        <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
          <input type="checkbox" checked={clipsEnabled} onChange={e => setClipsEnabled(e.target.checked)} className="accent-fc-accent" />
          {t('settings.video.clipsKeep')}
        </label>
        <p className="text-xs text-fc-muted mt-1">{t('settings.video.clipsHint')}</p>
      </Field>
    </div>
  )
}
