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
