// Réglages > Vidéo : affichage de ma caméra, décor du fond virtuel, réglages d'image et
// encodage. Les valeurs vivent dans lib/avPrefs ; décor et image sont réappliqués tout de
// suite à la caméra allumée (salon vocal et appel privé).
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import { useAvPrefs, VIDEO_CODECS, type AvPrefs, type VideoCodecPref } from '../../lib/avPrefs'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'
import { Slider, ToggleRow, ResetButton } from './AvAudioSettings'

const card = 'p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3'
const cardTitle = 'text-xs text-white font-medium uppercase tracking-wide'

const VIDEO_KEYS: (keyof AvPrefs)[] = [
  'camMirror', 'camBlurStrength', 'camBgMode', 'camBgColor', 'camBrightness', 'camContrast',
  'camSaturation', 'camAlwaysPreview', 'videoCodec', 'camSimulcast',
]

let _reapplyTimer: ReturnType<typeof setTimeout> | null = null

/** Rouvre la caméra en cours avec le nouveau décor / les nouveaux réglages d'image (regroupé). */
export function reapplyCamera() {
  if (_reapplyTimer) clearTimeout(_reapplyTimer)
  _reapplyTimer = setTimeout(() => {
    _reapplyTimer = null
    const id = localStorage.getItem('fc_video_input') ?? ''
    if (useVoice.getState().videoEnabled) void useVoice.getState().setVideoInput(id)
    // Hors appel ou caméra coupée : ne fait rien.
    void useCallStore.getState().setVideoInput()
  }, 500)
}

function codecSupported(c: VideoCodecPref): boolean {
  try {
    const caps = RTCRtpSender.getCapabilities?.('video')
    if (!caps) return true
    return caps.codecs.some(x => x.mimeType.toLowerCase() === `video/${c}`)
  } catch {
    return true
  }
}

const CODEC_LABEL: Record<VideoCodecPref, string> = { vp8: 'VP8', vp9: 'VP9', h264: 'H.264', av1: 'AV1' }

/** Miroir et aperçu avant diffusion. */
export function CameraDisplaySettings() {
  const t = useT()
  const mirror = useAvPrefs(s => s.camMirror)
  const always = useAvPrefs(s => s.camAlwaysPreview)
  const setPref = useAvPrefs(s => s.set)
  return (
    <div className={card}>
      <ToggleRow label={t('av.video.mirror')} hint={t('av.video.mirrorHint')} value={mirror} onChange={v => setPref('camMirror', v)} />
      <ToggleRow label={t('av.video.alwaysPreview')} hint={t('av.video.alwaysPreviewHint')} value={always} onChange={v => setPref('camAlwaysPreview', v)} />
    </div>
  )
}

/** Décor du fond virtuel (sous la case « Fond virtuel » ; actif seulement si elle est cochée). */
export function BackgroundOptions({ enabled, hasImage }: { enabled: boolean; hasImage: boolean }) {
  const t = useT()
  const mode = useAvPrefs(s => s.camBgMode)
  const strength = useAvPrefs(s => s.camBlurStrength)
  const color = useAvPrefs(s => s.camBgColor)
  const setPref = useAvPrefs(s => s.set)
  const effective = mode === 'auto' ? (hasImage ? 'image' : 'blur') : mode
  const change = <K extends keyof AvPrefs>(k: K, v: AvPrefs[K]) => { setPref(k, v); if (enabled) reapplyCamera() }
  return (
    <div className={`space-y-2 mt-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`} aria-disabled={!enabled}>
      <label className="flex items-center gap-2 text-sm text-white">
        <span className="w-28 flex-shrink-0">{t('av.video.bgMode')}</span>
        <select value={mode} onChange={e => change('camBgMode', e.target.value as AvPrefs['camBgMode'])}
          className="flex-1 bg-fc-channel border border-fc-hover rounded-lg px-3 py-1.5 text-sm text-white">
          <option value="auto">{t('av.video.bgAuto')}</option>
          <option value="blur">{t('av.video.bgBlur')}</option>
          <option value="image">{t('av.video.bgImage')}</option>
          <option value="color">{t('av.video.bgColor')}</option>
        </select>
      </label>
      {effective === 'blur' && (
        <Slider label={t('av.video.blurStrength')} value={strength} min={2} max={40}
          format={v => `${v} px`} onChange={v => change('camBlurStrength', v)} />
      )}
      {effective === 'color' && (
        <label className="flex items-center gap-2 text-sm text-white">
          <span className="w-28 flex-shrink-0">{t('av.video.color')}</span>
          <input type="color" value={color} onChange={e => change('camBgColor', e.target.value)}
            className="h-8 w-14 rounded border border-fc-hover bg-transparent cursor-pointer" aria-label={t('av.video.color')} />
        </label>
      )}
    </div>
  )
}

/** Luminosité, contraste, saturation de l'image envoyée. */
export function ImageAdjustSettings() {
  const t = useT()
  const brightness = useAvPrefs(s => s.camBrightness)
  const contrast = useAvPrefs(s => s.camContrast)
  const saturation = useAvPrefs(s => s.camSaturation)
  const setPref = useAvPrefs(s => s.set)
  const pct = (v: number) => t('av.pct', { n: v })
  const change = (k: 'camBrightness' | 'camContrast' | 'camSaturation', v: number) => { setPref(k, v); reapplyCamera() }
  return (
    <div className={card}>
      <p className={cardTitle}>{t('av.video.image')}</p>
      <Slider label={t('av.video.brightness')} value={brightness} min={50} max={200} step={5} format={pct} onChange={v => change('camBrightness', v)} />
      <Slider label={t('av.video.contrast')} value={contrast} min={50} max={200} step={5} format={pct} onChange={v => change('camContrast', v)} />
      <Slider label={t('av.video.saturation')} value={saturation} min={0} max={200} step={5} format={pct} onChange={v => change('camSaturation', v)} />
      <p className="text-xs text-fc-muted">{t('av.video.imageHint')} {t('av.video.liveHint')}</p>
    </div>
  )
}

/** Codec préféré et simulcast (appliqués à la prochaine publication). */
export function EncodingSettings() {
  const t = useT()
  const codec = useAvPrefs(s => s.videoCodec)
  const simulcast = useAvPrefs(s => s.camSimulcast)
  const setPref = useAvPrefs(s => s.set)
  return (
    <div className={card}>
      <p className={cardTitle}>{t('av.video.encoding')}</p>
      <label className="block text-sm text-white">
        {t('av.video.codec')}
        <select value={codec} onChange={e => setPref('videoCodec', e.target.value as VideoCodecPref)}
          className="mt-1.5 w-full bg-fc-sidebar border border-fc-hover rounded-lg px-3 py-1.5 text-sm text-white">
          {VIDEO_CODECS.map(c => (
            <option key={c} value={c}>
              {codecSupported(c) ? CODEC_LABEL[c] : t('av.video.codecUnsupported', { codec: CODEC_LABEL[c] })}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-fc-muted">{t('av.video.codecHint')}</p>
      <ToggleRow label={t('av.video.simulcast')} hint={t('av.video.simulcastHint')} value={simulcast}
        onChange={v => setPref('camSimulcast', v)} />
    </div>
  )
}

export function VideoResetButton() {
  const t = useT()
  return (
    <ResetButton onReset={() => {
      useAvPrefs.getState().reset(VIDEO_KEYS)
      reapplyCamera()
      toast.success(t('av.resetDone'))
    }} />
  )
}
