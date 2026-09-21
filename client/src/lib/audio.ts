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

export type NoiseEngine = 'off' | 'browser' | 'gate' | 'speex' | 'rnnoise' | 'gtcrn'

export const NOISE_ENGINES: { id: NoiseEngine; label: string; hint: string }[] = [
  { id: 'off', label: 'Désactivée', hint: 'Micro brut, aucun traitement' },
  { id: 'browser', label: 'Navigateur', hint: 'Annulation d\'écho + réduction de bruit natives (CPU négligeable)' },
  { id: 'gate', label: 'Porte de bruit', hint: 'Coupe les silences, très léger' },
  { id: 'speex', label: 'Speex', hint: 'Réduction spectrale classique, ~2 % CPU' },
  { id: 'rnnoise', label: 'RNNoise (recommandé)', hint: 'Réseau de neurones, supprime clavier et ventilateur, ~5 % CPU' },
  { id: 'gtcrn', label: 'GTCRN (maximum)', hint: 'Modèle le plus agressif, voix hors champ et bruits complexes, ~12 % CPU' },
]

const STORAGE_KEY = 'fc_noise_engine'
const LEGACY_KEY = 'fc_noise_suppression'

export function getNoiseEngine(): NoiseEngine {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw && NOISE_ENGINES.some(e => e.id === raw)) return raw as NoiseEngine
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
}

/**
 * Construit la piste micro traitée. Lève si le moteur demandé est indisponible —
 * l'appelant doit alors retomber sur 'browser' ET le signaler à l'utilisateur
 * (un repli silencieux sur le micro brut est précisément l'ancien bug).
 */
export async function createProcessedAudioTrack(input: MediaStreamTrack, engine: NoiseEngine): Promise<ProcessedAudio> {
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

  // Coupe le souffle des basses (bureau, table qui vibre) avant tout modèle
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 85
  highpass.Q.value = 0.5
  connect(highpass)

  let destroyable: { destroy?: () => void } | null = null

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

  // Limiteur doux — l'ancien réglage (seuil -55 dB, ratio 12, makeup 1.4, en
  // cascade avec l'AGC du navigateur) écrasait toute la dynamique et faisait
  // « pomper » la voix. Ici on ne rattrape que les crêtes.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -12
  limiter.knee.value = 6
  limiter.ratio.value = 4
  limiter.attack.value = 0.003
  limiter.release.value = 0.12
  connect(limiter)

  const dest = ctx.createMediaStreamDestination()
  tail.connect(dest)

  const track = dest.stream.getAudioTracks()[0]
  if (!track) throw new Error('chaîne audio sans piste de sortie')

  return {
    track,
    engine,
    dispose: () => {
      try { destroyable?.destroy?.() } catch { /* worklet déjà détruit */ }
      nodes.forEach(n => { try { n.disconnect() } catch { /* déjà déconnecté */ } })
      try { dest.disconnect() } catch { /* déjà déconnecté */ }
      dest.stream.getTracks().forEach(t => t.stop())
    },
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
