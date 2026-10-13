// Chaîne audio d'entrée : suppression de bruit + mesure de niveau.
//
// Tout passe par UN SEUL AudioContext partagé (48 kHz) : Chrome plafonne à 6
// AudioContext par document, et l'ancien code en créait jusqu'à 2 + N + 3 (un
// par pair pour les indicateurs « parle »), ce qui faisait échouer `new
// AudioContext()` en silence dès ~3 pairs.
//
// Les modules AudioWorklet sont mis en cache PAR CONTEXTE : le cache global
// précédent gardait une Promise liée à un contexte fermé, donc après un premier
// leave() le `new AudioWorkletNode(...)` levait InvalidStateError et la chaîne
// retombait silencieusement sur le micro brut (suppression de bruit morte dès
// le 2e salon de la session).
import {
  loadRnnoise, RnnoiseWorkletNode,
  loadSpeex, SpeexWorkletNode,
  loadGtcrn, GtcrnWorkletNode,
  NoiseGateWorkletNode,
} from '@sapphi-red/web-noise-suppressor'
import { avPrefs } from './avPrefs'

export type NoiseEngine = 'off' | 'browser' | 'gate' | 'speex' | 'rnnoise' | 'gtcrn'

// Libellés et descriptions : clés settings.audio.engine.<id> du dictionnaire i18n.
export const NOISE_ENGINES: NoiseEngine[] = ['off', 'browser', 'gate', 'speex', 'rnnoise', 'gtcrn']

const STORAGE_KEY = 'fc_noise_engine'
const LEGACY_KEY = 'fc_noise_suppression'

export function getNoiseEngine(): NoiseEngine {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw && NOISE_ENGINES.some(e => e === raw)) return raw as NoiseEngine
  // Migration de l'ancien toggle booléen
  if (localStorage.getItem(LEGACY_KEY) === 'false') return 'browser'
  return 'rnnoise'
}

export function setNoiseEngine(engine: NoiseEngine) {
  localStorage.setItem(STORAGE_KEY, engine)
  localStorage.setItem(LEGACY_KEY, engine === 'off' || engine === 'browser' ? 'false' : 'true')
}

// ── Contexte partagé ─────────────────────────────────────────────────────────
let _ctx: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext({ sampleRate: 48000 })
    _modules = new Map()
  }
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {})
  return _ctx
}

let _modules = new Map<string, Promise<void>>()

async function ensureModule(ctx: AudioContext, url: string): Promise<void> {
  let p = _modules.get(url)
  if (!p) {
    p = ctx.audioWorklet.addModule(url)
    _modules.set(url, p)
  }
  try {
    await p
  } catch (e) {
    _modules.delete(url)
    throw e
  }
}

// Les binaires wasm sont mis en cache, mais chaque worklet peut détacher le
// buffer qu'on lui passe : on garde l'original et on en remet une copie à chaque
// construction.
const _wasm = new Map<string, ArrayBuffer>()

async function getWasm(key: string, load: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
  let buf = _wasm.get(key)
  if (!buf || buf.byteLength === 0) {
    buf = await load()
    _wasm.set(key, buf)
  }
  return buf.slice(0)
}

export interface ProcessedAudio {
  track: MediaStreamTrack
  engine: NoiseEngine
  dispose: () => void
  /** Gain du micro (Réglages > Volume d'entrée), réglable à chaud. */
  gainNode: GainNode
  /** Point de mesure : signal après gain et limiteur, avant le seuil de sensibilité. */
  tap: AudioNode
  /** Seuil de sensibilité manuel (null : sensibilité automatique). */
  gate: AudioWorkletNode | null
}

/** Qui utilise la chaîne : salon vocal, appel privé/de groupe ou test du micro des Réglages. */
export type ChainOwner = 'voice' | 'call' | 'test'

export interface ChainOptions {
  /** 1 = 100 %. */
  gain: number
  /** Seuil manuel en dBFS et maintien après la voix ; null = pas de seuil. */
  gate: { threshold: number; holdMs: number } | null
  owner: ChainOwner
}

/** Maintien du seuil manuel après la dernière syllabe. */
export const GATE_HOLD_MS = 300

/** Options de chaîne tirées des Réglages (volume d'entrée, sensibilité). */
export function chainOptionsFromPrefs(owner: ChainOwner): ChainOptions {
  const p = avPrefs()
  return {
    gain: p.inputVolume / 100,
    gate: p.vadMode === 'manual' ? { threshold: p.vadThreshold, holdMs: GATE_HOLD_MS } : null,
    owner,
  }
}

/**
 * Faut-il une chaîne WebAudio pour le micro ? Moteur applicatif, volume d'entrée
 * différent de 100 % ou seuil manuel. Sinon la piste brute part telle quelle (le
 * moteur « Navigateur » ne coûte alors rien).
 */
export function micNeedsChain(engine: NoiseEngine): boolean {
  const p = avPrefs()
  return (engine !== 'off' && engine !== 'browser') || p.inputVolume !== 100 || p.vadMode === 'manual'
}

const _chains = new Map<ProcessedAudio, ChainOwner>()

/** Volume d'entrée appliqué tout de suite à toutes les chaînes en cours (appel, test). */
export function setLiveInputGain(pct: number) {
  _chains.forEach((_o, c) => {
    const ctx = c.gainNode.context
    c.gainNode.gain.setTargetAtTime(Math.max(0, pct) / 100, ctx.currentTime, 0.02)
  })
}

/** Seuil manuel appliqué tout de suite aux chaînes qui en ont un. */
export function setLiveGate(threshold: number) {
  _chains.forEach((_o, c) => c.gate?.port.postMessage({ threshold, holdMs: GATE_HOLD_MS }))
}

/** Une chaîne de ce propriétaire est-elle en cours (et a-t-elle un seuil si demandé) ? */
export function hasLiveChain(owner: ChainOwner, withGate = false): boolean {
  for (const [c, o] of _chains) if (o === owner && (!withGate || c.gate)) return true
  return false
}

/**
 * Construit la piste micro traitée. Lève si le moteur demandé est indisponible —
 * l'appelant doit alors retomber sur 'browser' ET le signaler à l'utilisateur
 * (un repli silencieux sur le micro brut est précisément l'ancien bug).
 *
 * Chaîne : [passe-haut + moteur] → gain d'entrée → limiteur → [seuil de sensibilité].
 * Pour 'off' et 'browser' : gain, limiteur et seuil seulement.
 */
export async function createProcessedAudioTrack(
  input: MediaStreamTrack, engine: NoiseEngine, opts: ChainOptions = chainOptionsFromPrefs('voice'),
): Promise<ProcessedAudio> {
  const ctx = getAudioContext()
  await ctx.resume().catch(() => {})

  const source = ctx.createMediaStreamSource(new MediaStream([input]))
  const nodes: AudioNode[] = [source]
  let tail: AudioNode = source

  const connect = (node: AudioNode) => {
    tail.connect(node)
    nodes.push(node)
    tail = node
  }

  let destroyable: { destroy?: () => void } | null = null

  if (engine !== 'off' && engine !== 'browser') {
    // Coupe le souffle des basses (bureau, table qui vibre) avant tout modèle
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 85
    highpass.Q.value = 0.5
    connect(highpass)
  }

  if (engine === 'gate') {
    await ensureModule(ctx, '/noise/noise-gate-processor.js')
    connect(new NoiseGateWorkletNode(ctx, { openThreshold: -45, closeThreshold: -55, holdMs: 120, maxChannels: 1 }))
  } else if (engine === 'speex') {
    await ensureModule(ctx, '/noise/speex-processor.js')
    const wasmBinary = await getWasm('speex', () => loadSpeex({ url: '/noise/speex.wasm' }))
    const node = new SpeexWorkletNode(ctx, { wasmBinary, maxChannels: 1 })
    destroyable = node
    connect(node)
  } else if (engine === 'rnnoise') {
    await ensureModule(ctx, '/noise/rnnoise-processor.js')
    const wasmBinary = await getWasm('rnnoise', () => loadRnnoise({ url: '/noise/rnnoise.wasm', simdUrl: '/noise/rnnoise_simd.wasm' }))
    const node = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 })
    destroyable = node
    connect(node)
  } else if (engine === 'gtcrn') {
    await ensureModule(ctx, '/noise/gtcrn-processor.js')
    const wasmBinary = await getWasm('gtcrn', () => loadGtcrn({ url: '/noise/gtcrn.wasm' }))
    const node = new GtcrnWorkletNode(ctx, { wasmBinary, maxChannels: 1 })
    destroyable = node
    connect(node)
  }

  // Volume d'entrée : réglable à chaud (setLiveInputGain), sans reconstruire la chaîne.
  const gainNode = ctx.createGain()
  gainNode.gain.value = Math.max(0, opts.gain)
  connect(gainNode)

  // Limiteur doux — l'ancien réglage (seuil -55 dB, ratio 12, makeup 1.4, en
  // cascade avec l'AGC du navigateur) écrasait toute la dynamique et faisait
  // « pomper » la voix. Ici on ne rattrape que les crêtes (et la saturation
  // d'un volume d'entrée poussé au-delà de 100 %).
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -12
  limiter.knee.value = 6
  limiter.ratio.value = 4
  limiter.attack.value = 0.003
  limiter.release.value = 0.12
  connect(limiter)
  const tap: AudioNode = limiter

  // Seuil de sensibilité manuel : dans le fil audio (un minuteur de page serait
  // ralenti à 1 Hz dans un onglet en arrière-plan et hacherait la voix).
  let gate: AudioWorkletNode | null = null
  if (opts.gate) {
    try {
      await ensureModule(ctx, '/audio/vad-gate-processor.js')
      gate = new AudioWorkletNode(ctx, 'fc-vad-gate', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { threshold: opts.gate.threshold, holdMs: opts.gate.holdMs },
      })
      connect(gate)
    } catch (e) {
      console.warn('[audio] seuil de sensibilité indisponible', e)
      gate = null
    }
  }

  const dest = ctx.createMediaStreamDestination()
  tail.connect(dest)

  const track = dest.stream.getAudioTracks()[0]
  if (!track) throw new Error('chaîne audio sans piste de sortie')

  const chain: ProcessedAudio = {
    track,
    engine,
    gainNode,
    tap,
    gate,
    dispose: () => {
      _chains.delete(chain)
      try { destroyable?.destroy?.() } catch { /* worklet déjà détruit */ }
      nodes.forEach(n => { try { n.disconnect() } catch { /* déjà déconnecté */ } })
      try { dest.disconnect() } catch { /* déjà déconnecté */ }
      dest.stream.getTracks().forEach(t => t.stop())
    },
  }
  _chains.set(chain, opts.owner)
  return chain
}

/**
 * Appels privés et de groupe : applique volume d'entrée et seuil manuel au micro
 * du flux (réduction de bruit du navigateur). Sans réglage actif, renvoie le flux
 * tel quel. Arrêter la piste rendue arrête aussi le micro et libère la chaîne.
 */
export async function processCallMicStream(stream: MediaStream): Promise<MediaStream> {
  const raw = stream.getAudioTracks()[0]
  if (!raw || !micNeedsChain('browser')) return stream
  try {
    const chain = await createProcessedAudioTrack(raw, 'browser', chainOptionsFromPrefs('call'))
    const out = chain.track
    const stop = out.stop.bind(out)
    let stopped = false
    out.stop = () => {
      if (stopped) return
      stopped = true
      stop()
      chain.dispose()
      raw.stop()
    }
    raw.addEventListener('ended', () => out.stop())
    return new MediaStream([out, ...stream.getVideoTracks()])
  } catch (e) {
    console.warn('[audio] volume d’entrée non appliqué à l’appel', e)
    return stream
  }
}

// ── Mesure de niveau (indicateur « parle ») ──────────────────────────────────
// Un analyser par flux, tous sur le contexte partagé. Une seule boucle globale
// échantillonne l'ensemble et notifie les abonnés : avant, chaque composant
// avait sa propre boucle (setInterval 80 ms + requestAnimationFrame 60 Hz par
// participant), ce qui re-rendait toute la page d'appel ~250 fois par seconde.

export const SPEAKING_THRESHOLD = 14 // sur 255, seuil unique partagé

interface Meter {
  analyser: AnalyserNode
  source: MediaStreamAudioSourceNode
  data: Uint8Array
  refs: number
}

const _meters = new Map<string, Meter>()
const _levels = new Map<string, number>()
const _subs = new Set<(levels: Map<string, number>) => void>()
let _loop: ReturnType<typeof setInterval> | null = null

function tick() {
  let changed = false
  _meters.forEach((m, key) => {
    // cast : le typage de getByteFrequencyData varie selon la version de lib.dom
    m.analyser.getByteFrequencyData(m.data as any)
    // Moitié basse du spectre : la voix y est, les sifflantes et le souffle non
    const half = m.data.length >> 1
    let sum = 0
    for (let i = 0; i < half; i++) sum += m.data[i]
    const level = Math.round(sum / half)
    if (_levels.get(key) !== level) {
      _levels.set(key, level)
      changed = true
    }
  })
  if (changed) _subs.forEach(fn => fn(_levels))
}

function ensureLoop() {
  if (_loop || _meters.size === 0) return
  _loop = setInterval(tick, 100)
}

function stopLoopIfIdle() {
  if (_loop && _meters.size === 0) {
    clearInterval(_loop)
    _loop = null
  }
}

/** Attache un analyser au flux et renvoie la fonction de détachement. */
export function attachMeter(key: string, stream: MediaStream | null): () => void {
  if (!stream || stream.getAudioTracks().length === 0) return () => {}
  const existing = _meters.get(key)
  if (existing) {
    existing.refs++
    return () => detachMeter(key)
  }
  try {
    const ctx = getAudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser) // jamais vers ctx.destination : pas de retour local
    _meters.set(key, { analyser, source, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)), refs: 1 })
    ensureLoop()
  } catch (e) {
    console.warn('[audio] analyser indisponible', e)
    return () => {}
  }
  return () => detachMeter(key)
}

function detachMeter(key: string) {
  const m = _meters.get(key)
  if (!m) return
  m.refs--
  if (m.refs > 0) return
  try { m.source.disconnect() } catch { /* déjà déconnecté */ }
  try { m.analyser.disconnect() } catch { /* déjà déconnecté */ }
  _meters.delete(key)
  _levels.delete(key)
  stopLoopIfIdle()
}

export function subscribeLevels(fn: (levels: Map<string, number>) => void): () => void {
  _subs.add(fn)
  return () => { _subs.delete(fn) }
}

export function getLevel(key: string): number {
  return _levels.get(key) ?? 0
}
