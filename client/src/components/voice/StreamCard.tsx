import { useCallback, useEffect, useState } from 'react'
import { Monitor, MonitorOff, RefreshCw } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { getScreenAudioTrack, getScreenSendStats } from '../../store/voiceSfu'
import { useT, type Key } from '../../i18n'
import {
  SCREEN_HEIGHTS, SCREEN_FPS, SCREEN_AUDIO_KEY, sourceFromLabel, screenAudioWanted, streamSummary,
} from '../../lib/voiceDock'
import DockPopover from './DockPopover'

const SURFACE_KEYS: Record<string, Key> = { monitor: 'dock.stream.screen', window: 'dock.stream.window', browser: 'dock.stream.tab' }

interface Sent { height?: number; frameRate?: number; displaySurface?: string }

/**
 * Ce qui part vraiment : statistiques de l'encodeur (résolution et images/s diffusées), sinon
 * réglages de la capture. Relu chaque seconde : suit les réglages à chaud et les changements
 * de source (nouvelle piste).
 */
function useSentInfo(track: MediaStreamTrack | undefined) {
  const [info, setInfo] = useState<Sent>({})
  useEffect(() => {
    if (!track) { setInfo({}); return }
    let alive = true
    const read = async () => {
      const capture: Sent = track.getSettings()
      const sent = await getScreenSendStats()
      if (alive) setInfo({ ...capture, ...(sent ?? {}) })
    }
    void read()
    const iv = setInterval(() => void read(), 1000)
    return () => { alive = false; clearInterval(iv) }
  }, [track])
  return info
}

/** Carte « Écran — 1440p 30 FPS » du stream en cours ; clic = réglages du stream. */
export default function StreamCard() {
  const t = useT()
  const screenStream = useVoice(s => s.localScreenStream)
  const stopScreenShare = useVoice(s => s.stopScreenShare)
  const track = screenStream?.getVideoTracks()[0]
  const info = useSentInfo(track)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  const fromLabel = track ? sourceFromLabel(track.label) : null
  const source = fromLabel && 'name' in fromLabel ? fromLabel.name
    : fromLabel ? t('dock.stream.screenN', { n: fromLabel.screen })
    : t(SURFACE_KEYS[info.displaySurface ?? ''] ?? 'dock.stream.generic')
  const summary = streamSummary(info)

  return (
    <div className="relative px-2 pt-2">
      {open && <DockPopover onClose={close} label={t('dock.stream.settings')}><StreamSettings onDone={close} /></DockPopover>}
      <div className="flex items-center gap-2 rounded-lg bg-fc-bg/60 border border-white/5 pl-2 pr-1 py-1.5">
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setOpen(v => !v)}
          aria-haspopup="dialog" aria-expanded={open}
          title={t('dock.stream.settings')}
          className="flex items-center gap-2 flex-1 min-w-0 text-left rounded hover:bg-fc-hover/60 transition px-1 py-0.5"
        >
          <Monitor size={14} className="text-fc-green flex-shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-white truncate">{source}</span>
            {summary && <span className="block text-[11px] text-fc-muted tabular-nums truncate">{summary}</span>}
          </span>
        </button>
        <button
          onClick={() => void stopScreenShare()}
          title={t('dock.stream.stop')} aria-label={t('dock.stream.stop')}
          className="p-1.5 rounded text-fc-muted hover:text-red-400 hover:bg-red-500/20 transition flex-shrink-0 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center"
        >
          <MonitorOff size={14} />
        </button>
      </div>
    </div>
  )
}

/** Qualité, FPS et son changés à chaud ; mêmes clés que Réglages > Vidéo. */
function StreamSettings({ onDone }: { onDone: () => void }) {
  const t = useT()
  const applyQualityPrefs = useVoice(s => s.applyQualityPrefs)
  const shareScreen = useVoice(s => s.shareScreen)
  const stopScreenShare = useVoice(s => s.stopScreenShare)
  const [height, setHeight] = useState(() => localStorage.getItem('fc_screen_height') ?? '1080')
  const [fps, setFps] = useState(() => localStorage.getItem('fc_screen_fps') ?? '30')
  const [audio, setAudio] = useState(screenAudioWanted)
  const audioTrack = getScreenAudioTrack()

  const save = (key: string, value: string, setter: (v: string) => void) => {
    localStorage.setItem(key, value)
    setter(value)
    void applyQualityPrefs()
  }
  const toggleAudio = (on: boolean) => {
    localStorage.setItem(SCREEN_AUDIO_KEY, String(on))
    setAudio(on)
    if (audioTrack) audioTrack.enabled = on
  }
  const chip = (active: boolean) =>
    `flex-1 px-2 py-1.5 rounded text-xs font-semibold transition ${active ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`

  return (
    <div className="w-64 bg-fc-channel border border-fc-hover rounded-xl p-3 shadow-2xl space-y-3">
      <p className="text-sm font-semibold text-white">{t('dock.stream.settings')}</p>
      <fieldset>
        <legend className="text-[10px] uppercase font-semibold tracking-wide text-fc-muted mb-1">{t('dock.stream.quality')}</legend>
        <div className="flex gap-1">
          {SCREEN_HEIGHTS.map(h => (
            <button key={h} aria-pressed={height === h} onClick={() => save('fc_screen_height', h, setHeight)} className={chip(height === h)}>
              {h === 'source' ? t('dock.stream.source') : `${h}p`}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[10px] uppercase font-semibold tracking-wide text-fc-muted mb-1">{t('dock.stream.fps')}</legend>
        <div className="flex gap-1">
          {SCREEN_FPS.map(f => (
            <button key={f} aria-pressed={fps === f} onClick={() => save('fc_screen_fps', f, setFps)} className={chip(fps === f)}>{f}</button>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
        <input type="checkbox" checked={audio} onChange={e => toggleAudio(e.target.checked)} className="accent-fc-accent" />
        {t('dock.stream.audio')}
      </label>
      {audio && !audioTrack && <p className="text-[11px] text-fc-muted">{t('dock.stream.audioNone')}</p>}
      <div className="flex gap-2">
        {/* Relancer le sélecteur : le partage en cours n'est remplacé que si un autre est choisi. */}
        <button onClick={() => { onDone(); void shareScreen() }} className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-fc-hover hover:bg-fc-hover/70 text-xs text-white transition">
          <RefreshCw size={12} aria-hidden /> {t('dock.stream.changeSource')}
        </button>
        <button onClick={() => { onDone(); void stopScreenShare() }} className="flex-1 px-2 py-1.5 rounded bg-fc-red/80 hover:bg-fc-red text-xs text-white transition">
          {t('dock.stream.stop')}
        </button>
      </div>
    </div>
  )
}
