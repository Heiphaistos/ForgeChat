// Audio pour la transcription sur l'appareil : mono 16 kHz (format de Whisper) et
// découpage de la parole en morceaux pour les sous-titres en direct.
export const RATE = 16000

/** Rééchantillonnage linéaire (suffisant pour la voix ; Whisper attend 16 kHz). */
export function resample(input: Float32Array, from: number, to = RATE): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio
    const j = Math.floor(x)
    const f = x - j
    out[i] = input[j] * (1 - f) + (input[j + 1] ?? input[j]) * f
  }
  return out
}

export const rms = (s: Float32Array) => {
  let sum = 0
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i]
  return Math.sqrt(sum / (s.length || 1))
}

export interface ChunkerOptions {
  rate?: number
  /** Seuil d'énergie au-dessus duquel une trame compte comme parole. */
  threshold?: number
  /** Silence qui clôt une phrase (s). */
  silence?: number
  /** Longueur maximale d'un morceau (s) : coupé même sans pause. */
  maxLen?: number
  /** Parole minimale pour émettre (s) : évite de transcrire un raclement de gorge. */
  minSpeech?: number
}

/**
 * Accumule le son reçu (trames mono déjà à `rate`) et rend un morceau à transcrire
 * à chaque fin de phrase (pause) ou tous les `maxLen` secondes. Le silence seul
 * n'est jamais émis : rien à transcrire, aucun calcul inutile.
 */
export class SpeechChunker {
  private buf: Float32Array[] = []
  private len = 0
  private speech = 0
  private quiet = 0
  private o: Required<ChunkerOptions>

  constructor(o: ChunkerOptions = {}) {
    this.o = { rate: RATE, threshold: 0.012, silence: 0.6, maxLen: 8, minSpeech: 0.4, ...o }
  }

  push(frame: Float32Array): Float32Array | null {
    const { rate, threshold, silence, maxLen, minSpeech } = this.o
    const sec = frame.length / rate
    const loud = rms(frame) >= threshold
    if (!loud && this.speech === 0) return null // silence avant toute parole : ignoré
    this.buf.push(frame)
    this.len += frame.length
    if (loud) { this.speech += sec; this.quiet = 0 } else this.quiet += sec
    const done = this.quiet >= silence || this.len / rate >= maxLen
    if (!done) return null
    const out = this.speech >= minSpeech ? concat(this.buf, this.len) : null
    this.buf = []; this.len = 0; this.speech = 0; this.quiet = 0
    return out
  }
}

export function concat(parts: Float32Array[], len = parts.reduce((n, p) => n + p.length, 0)) {
  const out = new Float32Array(len)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Fichier audio (déjà déchiffré) → mono 16 kHz. Le décodage reste dans le navigateur. */
export async function decodeToPcm(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
    const mono = ch.length === 1 ? ch[0] : ch[0].map((_, i) => ch.reduce((s, c) => s + c[i], 0) / ch.length)
    return resample(mono, buf.sampleRate)
  } finally {
    void ctx.close()
  }
}

/**
 * Découpe un vocal en morceaux d'au plus `maxLen` s, coupés dans la pause la plus calme
 * (énergie moyenne sur 0,3 s). Whisper transcrit chaque morceau seul : sur un long passage
 * il se met à boucler, et les fenêtres de 30 s avec chevauchement perdaient des phrases.
 */
export function splitOnPauses(pcm: Float32Array, maxLen = 20, rate = RATE): Float32Array[] {
  const max = maxLen * rate, min = 5 * rate, step = Math.round(rate * 0.03), win = Math.round(rate * 0.3)
  const out: Float32Array[] = []
  let start = 0
  while (pcm.length - start > max) {
    let cut = start + max, quiet = Infinity
    for (let i = start + min; i + win <= start + max; i += step) {
      const e = rms(pcm.subarray(i, i + win))
      if (e < quiet) { quiet = e; cut = i + (win >> 1) }
    }
    out.push(pcm.subarray(start, cut))
    start = cut
  }
  out.push(pcm.subarray(start))
  return out
}

/**
 * Retire les rafales de répétitions de Whisper (« ça bégaye et répète en boucle ») : un groupe
 * de 1 à 12 mots répété au moins 3 fois d'affilée n'est gardé qu'une fois, et une rafale de
 * ponctuation (« ............ ») est ramenée à trois signes.
 */
export function collapseRepeats(text: string): string {
  const w = text.replace(/([^\p{L}\p{N}\s])\1{3,}/gu, '$1$1$1').split(/\s+/).filter(Boolean)
  const key = w.map(s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  const same = (a: number, b: number, n: number) => { for (let k = 0; k < n; k++) if (key[a + k] !== key[b + k]) return false; return true }
  const out: string[] = []
  for (let i = 0; i < w.length;) {
    let run = 0, size = 0
    for (let n = 1; n <= 12 && i + 3 * n <= w.length; n++) {
      let k = 1
      while (i + (k + 1) * n <= w.length && same(i, i + k * n, n)) k++
      if (k >= 3) { run = k; size = n; break }
    }
    if (run) { out.push(...w.slice(i, i + size)); i += run * size } else out.push(w[i++])
  }
  return out.join(' ')
}

/** Whisper a bouclé sur ce morceau : rafale d'un même signe, ou groupe de mots répété en rafale. */
export const looped = (text: string) => /(\S)\1{5,}/u.test(text) || collapseRepeats(text) !== text.split(/\s+/).filter(Boolean).join(' ')
