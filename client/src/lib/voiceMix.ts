// Mixage de lecture d'une voix reçue : calcul pur, testé (scripts/voiceMix.test.mjs).
// Le graphe WebAudio lui-même vit dans lib/voicePlayback.ts.

/** Volume par personne mémorisé (en %) : 0 à 200, 100 par défaut ou si la valeur est invalide. */
export function clampVolumePct(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 100
  return Math.min(200, Math.max(0, Math.round(n)))
}

export interface MixPlan {
  /** Faut-il passer par WebAudio (sinon <audio> joue la piste telle quelle). */
  graph: boolean
  /** Downmix en mono centré : une piste stéréo mal formée (canal vide) s'entend des deux côtés. */
  mono: boolean
  /** PannerNode HRTF : uniquement pour la voix spatiale. */
  panner: boolean
  /** Gain du GainNode (0..2) ou volume de l'élément <audio> (0..1). */
  gain: number
}

/**
 * `kind` voice : micro d'un participant, toujours mixé en mono (graphe systématique).
 * `kind` screen : son d'un partage d'écran, stéréo conservée ; graphe seulement si > 100 % ou spatial.
 * `azimuth` null = voix spatiale désactivée.
 */
export function mixPlan(kind: 'voice' | 'screen', volume: number, azimuth: number | null): MixPlan {
  const gain = Math.min(Math.max(Number.isFinite(volume) ? volume : 1, 0), 2)
  const panner = azimuth !== null
  const mono = kind === 'voice'
  return { graph: mono || panner || gain > 1, mono, panner, gain }
}
