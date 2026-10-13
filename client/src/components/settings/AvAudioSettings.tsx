// Réglages > Voix : volume et sensibilité d'entrée, vérification du micro, traitement de la
// voix, sortie (volume général, mono, atténuation des streams) et sons. Les valeurs vivent
// dans lib/avPrefs ; chaque changement est appliqué tout de suite à l'appel en cours.
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Volume2, Play, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import { Toggle } from './shared'
import { useT } from '../../i18n'
import { useAvPrefs, micConstraintsFor, type AvPrefs } from '../../lib/avPrefs'
import {
  createProcessedAudioTrack, chainOptionsFromPrefs, hasLiveChain, setLiveGate, setLiveInputGain,
  type ProcessedAudio,
} from '../../lib/audio'
import { isNativeVoice } from '../../lib/nativeVoice'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'
import { previewUiSound } from '../../hooks/useAudioNotifications'

const card = 'p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3'
const cardTitle = 'text-xs text-white font-medium uppercase tracking-wide'

const AUDIO_KEYS: (keyof AvPrefs)[] = [
  'inputVolume', 'outputVolume', 'vadMode', 'vadThreshold', 'pttReleaseMs',
  'echoCancellation', 'autoGain', 'sfxVolume', 'monoOutput', 'duckStreams',
]

// ── Application à chaud ────────────────────────────────────────────────────────
let _refreshTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Répercute un changement sur le micro des appels en cours, regroupé (un curseur
 * émet des dizaines de valeurs) :
 * - 'gain' : volume d'entrée, suivi à chaud ; on ne reconstruit que s'il manque une chaîne ;
 * - 'gate' : seuil manuel activé/désactivé ;
 * - 'full' : contraintes du navigateur (écho, gain automatique), tout est reconstruit.
 */
function scheduleMicRefresh(mode: 'gain' | 'gate' | 'full') {
  if (_refreshTimer) clearTimeout(_refreshTimer)
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null
    void useVoice.getState().refreshMicChain(mode === 'full' ? undefined : { onlyIfMissing: true })
    // Appel privé : son micro ne se reconstruit pas tout seul (setAudioInput ne fait rien hors appel).
    if (mode !== 'gain' || !hasLiveChain('call')) void useCallStore.getState().setAudioInput()
  }, 250)
}

// ── Petits composants ──────────────────────────────────────────────────────────
export function Slider({ label, value, min, max, step = 1, format, onChange, hint, disabled }: {
  label: string; value: number; min: number; max: number; step?: number
  format: (v: number) => string; onChange: (v: number) => void; hint?: string; disabled?: boolean
}) {
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="flex items-center justify-between text-sm text-white">
        <span>{label}</span>
        <span className="text-xs text-fc-muted tabular-nums">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-fc-accent mt-1" aria-label={label} />
      {hint && <p className="text-xs text-fc-muted">{hint}</p>}
    </div>
  )
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-white">{label}</p>
        {hint && <p className="text-xs text-fc-muted mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0 pt-0.5"><Toggle value={value} onChange={onChange} label={label} /></div>
    </div>
  )
}

/** Bouton en deux temps : un premier clic arme, le second confirme (3 s pour confirmer). */
export function ResetButton({ onReset }: { onReset: () => void }) {
  const t = useT()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(id)
  }, [armed])
  return (
    <button
      onClick={() => { if (armed) { setArmed(false); onReset() } else setArmed(true) }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
        ${armed ? 'bg-fc-red text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
    >
      <RotateCcw size={12} /> {armed ? t('av.resetConfirm') : t('av.reset')}
    </button>
  )
}

// ── Vérification du micro + sensibilité ─────────────────────────────────────────
interface Running {
  raw: MediaStream
  chain: ProcessedAudio
  analyser: AnalyserNode
  raf: number
}

/** Barre de niveau mesurée APRÈS le volume d'entrée et la suppression de bruit, avec le seuil manuel. */
export function MicCheck({ deviceId }: { deviceId: string }) {
  const t = useT()
  const vadMode = useAvPrefs(s => s.vadMode)
  const threshold = useAvPrefs(s => s.vadThreshold)
  const setPref = useAvPrefs(s => s.set)
  const engine = useVoice(s => s.noiseEngine)
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState(false)
  const [db, setDb] = useState(-100)
  const [loopback, setLoopback] = useState(false)
  const run = useRef<Running | null>(null)
  const audioEl = useRef<HTMLAudioElement | null>(null)

  const stop = () => {
    const r = run.current
    run.current = null
    if (r) {
      cancelAnimationFrame(r.raf)
      r.chain.dispose()
      r.raw.getTracks().forEach(tr => tr.stop())
    }
    if (audioEl.current) { audioEl.current.pause(); audioEl.current.srcObject = null; audioEl.current = null }
    setRunning(false)
    setDb(-100)
  }

  const start = async () => {
    stop()
    setFailed(false)
    try {
      const raw = await navigator.mediaDevices.getUserMedia({ audio: micConstraintsFor(engine) })
      const track = raw.getAudioTracks()[0]
      if (!track) throw new Error('aucune piste micro')
      const opts = chainOptionsFromPrefs('test')
      const chain = await createProcessedAudioTrack(track, engine, opts)
        .catch(() => createProcessedAudioTrack(track, 'browser', opts))
      const analyser = chain.tap.context.createAnalyser()
      analyser.fftSize = 1024
      chain.tap.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let lastPaint = 0
      const r: Running = { raw, chain, analyser, raf: 0 }
      const tick = (now: number) => {
        if (run.current !== r) return
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += (buf[i] ?? 0) ** 2
        const level = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6))
        if (now - lastPaint > 50) { lastPaint = now; setDb(level) }
        r.raf = requestAnimationFrame(tick)
      }
      run.current = r
      r.raf = requestAnimationFrame(tick)
      setRunning(true)
    } catch {
      setFailed(true)
      stop()
    }
  }

  // Micro, moteur ou présence du seuil changés : la chaîne de test est refaite.
  useEffect(() => {
    if (run.current) void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, engine, vadMode])

  // Retour sur la sortie choisie : le signal tel que les autres l'entendent (seuil compris).
  useEffect(() => {
    const r = run.current
    if (!running || !loopback || !r) return
    const el = new Audio()
    el.srcObject = new MediaStream([r.chain.track])
    const sink = localStorage.getItem('fc_audio_output')
    const sinkable = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
    if (sink && sinkable.setSinkId) sinkable.setSinkId(sink).catch(() => {})
    void el.play().catch(() => {})
    audioEl.current = el
    return () => { el.pause(); el.srcObject = null; if (audioEl.current === el) audioEl.current = null }
  }, [running, loopback])

  useEffect(() => () => stop(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const manual = vadMode === 'manual'
  const pct = (v: number) => `${Math.min(100, Math.max(0, v + 100))}%`
  const open = db >= threshold

  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <p className={cardTitle}>{t('av.check.title')}</p>
        <button
          onClick={running ? stop : () => void start()}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition
            ${running ? 'bg-fc-red/20 text-fc-red hover:bg-fc-red/30' : 'bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30'}`}
        >
          {running ? <Square size={12} /> : <Mic size={12} />}
          {running ? t('av.check.stop') : t('av.check.start')}
        </button>
      </div>
      <div className="relative h-3 bg-fc-hover rounded-full overflow-hidden" aria-hidden="true">
        <div className={`h-full rounded-full transition-[width] duration-75 ${manual && !open ? 'bg-fc-muted' : 'bg-gradient-to-r from-fc-green to-fc-yellow'}`}
          style={{ width: running ? pct(db) : '0%' }} />
        {manual && <div className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: pct(threshold) }} />}
      </div>
      {failed && <p className="text-xs text-fc-red">{t('av.check.failed')}</p>}
      {running && (
        <p className="text-xs text-fc-muted">
          {manual ? (open ? t('av.check.open') : t('av.check.closed')) : t('av.check.speak')}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
        <input type="checkbox" checked={loopback} onChange={e => setLoopback(e.target.checked)} className="accent-fc-accent" />
        {t('av.check.loopback')}
      </label>
      {loopback && <p className="text-xs text-fc-yellow">{t('av.check.loopbackHint')}</p>}

      <div className="pt-2 border-t border-fc-hover space-y-2">
        <p className="text-sm font-medium text-white">{t('av.sens.title')}</p>
        <ToggleRow label={t('av.sens.auto')} hint={manual ? undefined : t('av.sens.autoHint')} value={!manual}
          onChange={auto => { setPref('vadMode', auto ? 'auto' : 'manual'); scheduleMicRefresh('gate') }} />
        {manual && (
          <Slider label={t('av.sens.threshold')} value={threshold} min={-100} max={0}
            format={v => t('av.db', { n: v })} hint={t('av.sens.manualHint')}
            onChange={v => { setPref('vadThreshold', v); setLiveGate(v) }} />
        )}
      </div>
    </div>
  )
}

// ── Entrée ─────────────────────────────────────────────────────────────────────
export function InputVolume() {
  const t = useT()
  const value = useAvPrefs(s => s.inputVolume)
  const setPref = useAvPrefs(s => s.set)
  return (
    <Slider label={t('av.input.volume')} value={value} min={0} max={200}
      format={v => t('av.pct', { n: v })} hint={t('av.input.volumeHint')}
      onChange={v => { setPref('inputVolume', v); setLiveInputGain(v); scheduleMicRefresh('gain') }} />
  )
}

/** Délai de relâchement du push-to-talk (affiché quand le mode est actif). */
export function PttRelease() {
  const t = useT()
  const value = useAvPrefs(s => s.pttReleaseMs)
  const setPref = useAvPrefs(s => s.set)
  return (
    <Slider label={t('av.ptt.release')} value={value} min={0} max={1000} step={10}
      format={v => t('av.ms', { n: v })} hint={t('av.ptt.releaseHint')}
      onChange={v => setPref('pttReleaseMs', v)} />
  )
}

// ── Traitement de la voix ──────────────────────────────────────────────────────
export function VoiceProcessing() {
  const t = useT()
  const echo = useAvPrefs(s => s.echoCancellation)
  const agc = useAvPrefs(s => s.autoGain)
  const setPref = useAvPrefs(s => s.set)
  return (
    <div className={card}>
      <p className={cardTitle}>{t('av.proc.title')}</p>
      <ToggleRow label={t('av.proc.echo')} hint={t('av.proc.echoHint')} value={echo}
        onChange={v => { setPref('echoCancellation', v); scheduleMicRefresh('full') }} />
      <div>
        <p className="text-sm text-white">{t('av.proc.agc')}</p>
        <p className="text-xs text-fc-muted mt-0.5">{t('av.proc.agcHint')}</p>
        <select
          value={agc === null ? 'default' : String(agc)}
          onChange={e => { setPref('autoGain', e.target.value === 'default' ? null : e.target.value === 'true'); scheduleMicRefresh('full') }}
          className="mt-1.5 bg-fc-sidebar border border-fc-hover rounded-lg px-3 py-1.5 text-sm text-white"
          aria-label={t('av.proc.agc')}
        >
          <option value="default">{t('av.proc.agcDefault')}</option>
          <option value="true">{t('av.on')}</option>
          <option value="false">{t('av.off')}</option>
        </select>
      </div>
      {isNativeVoice() && <p className="text-xs text-fc-muted">{t('av.proc.native')}</p>}
    </div>
  )
}

// ── Sortie ─────────────────────────────────────────────────────────────────────
/** Court carillon joué sur la sortie choisie, au volume général. */
function playTestSound(volumePct: number) {
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const gain = ctx.createGain()
  gain.connect(dest)
  ;[523.25, 659.25, 783.99].forEach((f, i) => {
    const at = ctx.currentTime + i * 0.15
    const osc = ctx.createOscillator()
    osc.frequency.value = f
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.4)
    osc.connect(g).connect(gain)
    osc.start(at)
    osc.stop(at + 0.45)
  })
  // Au-delà de 100 %, le gain WebAudio prend le relais (l'élément plafonne à 1).
  gain.gain.value = Math.max(1, volumePct / 100)
  const el = new Audio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  el.srcObject = dest.stream
  el.volume = Math.min(1, volumePct / 100)
  const sink = localStorage.getItem('fc_audio_output')
  if (sink && el.setSinkId) el.setSinkId(sink).catch(() => {})
  void el.play().catch(() => {})
  setTimeout(() => { el.pause(); el.srcObject = null; void ctx.close() }, 1200)
}

export function OutputSettings() {
  const t = useT()
  const volume = useAvPrefs(s => s.outputVolume)
  const mono = useAvPrefs(s => s.monoOutput)
  const duck = useAvPrefs(s => s.duckStreams)
  const setPref = useAvPrefs(s => s.set)
  const perUser = useVoice(s => Object.keys(s.userVolumes).length)
  const [armed, setArmed] = useState(false)

  const resetPerUser = () => {
    try { localStorage.removeItem('fc_user_volumes') } catch { /* rien à effacer */ }
    useVoice.setState({ userVolumes: {} })
    setArmed(false)
  }

  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <p className={cardTitle}>{t('av.output.title')}</p>
        <button onClick={() => playTestSound(volume)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-fc-accent/20 text-fc-accent hover:bg-fc-accent/30">
          <Volume2 size={12} /> {t('av.output.test')}
        </button>
      </div>
      <Slider label={t('av.output.volume')} value={volume} min={0} max={200}
        format={v => t('av.pct', { n: v })} hint={t('av.output.volumeHint')}
        onChange={v => setPref('outputVolume', v)} />
      <ToggleRow label={t('av.output.mono')} hint={t('av.output.monoHint')} value={mono}
        onChange={v => setPref('monoOutput', v)} />
      <Slider label={t('av.output.duck')} value={duck} min={0} max={90} step={5}
        format={v => t('av.pct', { n: v })} hint={t('av.output.duckHint')}
        onChange={v => setPref('duckStreams', v)} />
      <div className="pt-2 border-t border-fc-hover">
        <p className="text-sm text-white">{t('av.output.perUser')}</p>
        <p className="text-xs text-fc-muted mt-0.5">{t('av.output.perUserHint', { n: perUser })}</p>
        {perUser > 0 && (
          <button
            onClick={() => (armed ? resetPerUser() : setArmed(true))}
            onBlur={() => setArmed(false)}
            className={`mt-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${armed ? 'bg-fc-red text-white' : 'bg-fc-hover text-white hover:opacity-80'}`}
          >
            {armed ? t('av.resetConfirm') : t('av.output.perUserReset')}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sons ───────────────────────────────────────────────────────────────────────
const SOUNDBOARD_KEY = 'forgechat_soundboard_volume'

export function SoundSettings() {
  const t = useT()
  const sfx = useAvPrefs(s => s.sfxVolume)
  const setPref = useAvPrefs(s => s.set)
  const [board, setBoard] = useState(() => {
    const n = parseInt(localStorage.getItem(SOUNDBOARD_KEY) ?? '80', 10)
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 80
  })
  return (
    <div className={card}>
      <p className={cardTitle}>{t('av.sfx.title')}</p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Slider label={t('av.sfx.ui')} value={sfx} min={0} max={100} step={5}
            format={v => t('av.pct', { n: v })} hint={t('av.sfx.uiHint')}
            onChange={v => setPref('sfxVolume', v)} />
        </div>
        <button onClick={previewUiSound} title={t('av.sfx.preview')} aria-label={t('av.sfx.preview')}
          className="mb-5 p-2 rounded-lg bg-fc-hover text-fc-muted hover:text-white">
          <Play size={14} />
        </button>
      </div>
      <Slider label={t('av.sfx.soundboard')} value={board} min={0} max={100} step={5}
        format={v => t('av.pct', { n: v })}
        onChange={v => { setBoard(v); try { localStorage.setItem(SOUNDBOARD_KEY, String(v)) } catch { /* stockage bloqué */ } }} />
    </div>
  )
}

/** Remet tous les réglages audio de cette page par défaut (micro et sortie choisis gardés). */
export function AudioResetButton() {
  const t = useT()
  return (
    <ResetButton onReset={() => {
      useAvPrefs.getState().reset(AUDIO_KEYS)
      setLiveInputGain(100)
      scheduleMicRefresh('full')
      toast.success(t('av.resetDone'))
    }} />
  )
}
