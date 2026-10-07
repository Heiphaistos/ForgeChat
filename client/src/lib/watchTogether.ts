// « Regarder ensemble » : fonctions pures (analyse d'URL, état reçu, dérive).
// Protocole WebSocket décrit dans server/src/handlers/watch.rs.

const ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * Identifiant d'une adresse youtube.com/watch?v=, youtu.be/ ou youtube.com/shorts/.
 * Même règle que `parse_video_id` côté serveur (qui reste l'autorité).
 */
export function parseYouTubeId(input: string): string | null {
  let s = input.trim()
  s = s.replace(/^https?:\/\//, '')
  const end = s.search(/[/?#]/)
  const host = (end < 0 ? s : s.slice(0, end)).toLowerCase()
  const rest = (end < 0 ? '' : s.slice(end)).split('#')[0]
  const q = rest.indexOf('?')
  const path = q < 0 ? rest : rest.slice(0, q)
  const query = q < 0 ? '' : rest.slice(q + 1)
  let id: string | undefined
  if (host === 'youtu.be') {
    id = path.startsWith('/') ? path.slice(1).replace(/\/+$/, '') : undefined
  } else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (path.replace(/\/+$/, '') === '/watch') {
      id = query.split('&').find(kv => kv.startsWith('v='))?.slice(2)
    } else if (path.startsWith('/shorts/')) {
      id = path.slice(8).replace(/\/+$/, '')
    }
  }
  return id && ID_RE.test(id) ? id : null
}

export interface WatchState {
  channelId: string
  item: number
  videoId: string
  playing: boolean
  /** Position (s) à `receivedAt` (heure locale de réception : pas d'écart d'horloge avec le serveur). */
  position: number
  receivedAt: number
  queue: string[]
  by: string
}

/** Valide un WATCH_STATE reçu ; `null` s'il est malformé. */
export function parseWatchState(d: unknown, now: number): WatchState | null {
  const r = d as Record<string, unknown> | null
  if (!r || typeof r.channel_id !== 'string' || typeof r.video_id !== 'string' || !ID_RE.test(r.video_id)) return null
  if (typeof r.item !== 'number' || typeof r.playing !== 'boolean' || typeof r.position !== 'number' || !Number.isFinite(r.position)) return null
  return {
    channelId: r.channel_id,
    item: r.item,
    videoId: r.video_id,
    playing: r.playing,
    position: Math.max(0, r.position),
    receivedAt: now,
    queue: Array.isArray(r.queue) ? r.queue.filter((v): v is string => typeof v === 'string' && ID_RE.test(v)) : [],
    by: typeof r.by === 'string' ? r.by : '',
  }
}

/** Position où tout le monde devrait être maintenant. */
export function expectedPosition(s: WatchState, now: number): number {
  return s.playing ? s.position + (now - s.receivedAt) / 1000 : s.position
}

/** Écart au-delà duquel on recale le lecteur local (s). */
export const DRIFT_S = 2

/** `threshold` plus fin quand un participant vient d'agir (pause + petit déplacement). */
export function needsResync(actual: number, expected: number, threshold = DRIFT_S): boolean {
  return Math.abs(actual - expected) > threshold
}

/** Lien YouTube au bon horodatage (ouvrir hors de ForgeChat). */
export function youtubeLink(videoId: string, seconds = 0): string {
  const t = Math.floor(seconds)
  return `https://www.youtube.com/watch?v=${videoId}${t > 0 ? `&t=${t}s` : ''}`
}
