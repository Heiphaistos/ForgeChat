// « Regarder ensemble » (protocole : server/src/handlers/watch.rs), fonctions pures partagées par le
// store et le lecteur intégré (components/WatchPlayer.tsx, WebView + API IFrame YouTube).
// Mêmes règles que le web (client/src/lib/watchTogether.ts).

import { t, type Key } from '@/i18n'

const ID_RE = /^[A-Za-z0-9_-]{11}$/

/**
 * Identifiant d'une adresse youtube.com/watch?v= (ou music.youtube.com), youtu.be/ ou youtube.com/shorts/.
 * Même règle que `parse_video_id` côté serveur (qui reste l'autorité).
 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim().replace(/^https?:\/\//, '')
  const end = s.search(/[/?#]/)
  const host = (end < 0 ? s : s.slice(0, end)).toLowerCase()
  const rest = (end < 0 ? '' : s.slice(end)).split('#')[0] ?? ''
  const q = rest.indexOf('?')
  const path = q < 0 ? rest : rest.slice(0, q)
  const query = q < 0 ? '' : rest.slice(q + 1)
  let id: string | undefined
  if (host === 'youtu.be') {
    id = path.startsWith('/') ? path.slice(1).replace(/\/+$/, '') : undefined
  } else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (path.replace(/\/+$/, '') === '/watch') {
      id = query.split('&').find((kv) => kv.startsWith('v='))?.slice(2)
    } else if (path.startsWith('/shorts/')) {
      id = path.slice(8).replace(/\/+$/, '')
    }
  }
  return id && ID_RE.test(id) ? id : null
}

export interface WatchInfo {
  channelId: string
  /** Numéro de la vidéo courante (WATCH_STATE / WATCH_NEXT visant une autre vidéo sont ignorés). */
  item: number
  videoId: string
  playing: boolean
  /** Position (s) à `receivedAt`, heure locale de réception. */
  position: number
  receivedAt: number
  /** Qui a lancé ou piloté la vidéo en dernier. */
  by: string
  queue: number
}

/** Valide un WATCH_STATE reçu ; `null` s'il est malformé. */
export function parseWatch(e: Record<string, unknown>, now: number): WatchInfo | null {
  if (typeof e.channel_id !== 'string' || typeof e.video_id !== 'string' || !ID_RE.test(e.video_id)) return null
  if (typeof e.item !== 'number' || typeof e.position !== 'number' || !Number.isFinite(e.position)) return null
  return {
    channelId: e.channel_id,
    item: e.item,
    videoId: e.video_id,
    playing: e.playing === true,
    position: Math.max(0, e.position),
    receivedAt: now,
    by: typeof e.by === 'string' ? e.by : '',
    queue: Array.isArray(e.queue) ? e.queue.length : 0,
  }
}

/** Position où tout le salon devrait être maintenant. */
export function watchPosition(w: WatchInfo, now: number): number {
  return w.playing ? w.position + (now - w.receivedAt) / 1000 : w.position
}

/** Lien YouTube au bon horodatage (`&t=`). */
export function watchLink(w: WatchInfo, now: number): string {
  const t = Math.floor(watchPosition(w, now))
  return `https://www.youtube.com/watch?v=${w.videoId}${t > 0 ? `&t=${t}s` : ''}`
}

const ERRORS: Record<string, Key> = {
  rate_limited: 'store.watch.rateLimited',
  invalid_url: 'store.watch.invalidUrl',
  queue_full: 'store.watch.queueFull',
}
/** Message d'un WATCH_ERROR (`reason`). */
export const watchErrorMessage = (reason: unknown) => t((typeof reason === 'string' && ERRORS[reason]) || 'store.watch.refused')

// ─── Lecteur intégré : pont WebView ─────────────────────────────────────────

/** Écart au-delà duquel on recale le lecteur local (s) ; 0,5 s quand un participant vient d'agir. */
export const DRIFT_S = 2

export function needsResync(actual: number, expected: number, threshold = DRIFT_S): boolean {
  return Math.abs(actual - expected) > threshold
}

/** Commandes envoyées à la page du lecteur (injectJavaScript). */
export type PlayerCmd =
  | { type: 'load'; videoId: string; position: number; playing: boolean }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; position: number }
  | { type: 'mute'; muted: boolean }

/** Messages renvoyés par la page (postMessage), validés. */
export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'ended' }
  | { type: 'error'; code: number }
  | { type: 'state'; playing: boolean; ended: boolean; time: number; duration: number }

/** Dernier état rapporté par le lecteur, daté à la réception (`at`). */
export type PlayerReport = Extract<PlayerEvent, { type: 'state' }> & { at: number }

/** Script à injecter ; JSON.stringify échappe tout (et videoId est déjà validé). */
export const playerScript = (c: PlayerCmd) => `window.fcCmd(${JSON.stringify(c)});true;`

/** Page du lecteur : même ORIGINE exacte (un préfixe laissait passer `https://hôte.evil.example`). */
export function isPlayerPage(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parsePlayerEvent(raw: string): PlayerEvent | null {
  let r: unknown
  try {
    r = JSON.parse(raw)
  } catch {
    return null
  }
  if (!r || typeof r !== 'object') return null
  const m = r as Record<string, unknown>
  switch (m.type) {
    case 'ready':
    case 'ended':
      return { type: m.type }
    case 'error':
      return { type: 'error', code: num(m.code) ? m.code : -1 }
    case 'state':
      if (!num(m.state) || !num(m.currentTime) || !num(m.duration)) return null
      // États YouTube : 0 fin, 1 lecture, 3 mise en mémoire tampon (comptée comme lecture).
      return { type: 'state', playing: m.state === 1 || m.state === 3, ended: m.state === 0, time: Math.max(0, m.currentTime), duration: Math.max(0, m.duration) }
    default:
      return null
  }
}

/**
 * Commandes pour aligner le lecteur sur l'état partagé. `loadedItem` : vidéo déjà chargée ;
 * `force` : un participant vient d'agir (seuil plus fin).
 */
export function syncCommands(w: WatchInfo, loadedItem: number | null, r: PlayerReport | null, now: number, force: boolean): PlayerCmd[] {
  const expected = watchPosition(w, now)
  if (loadedItem !== w.item) return [{ type: 'load', videoId: w.videoId, position: expected, playing: w.playing }]
  if (!r || (r.ended && expected >= r.duration - 1)) return []
  const out: PlayerCmd[] = []
  if (w.playing && !r.playing) out.push({ type: 'play' })
  if (!w.playing && r.playing) out.push({ type: 'pause' })
  // Le rapport date d'au plus 1 s : on extrapole si le lecteur tournait.
  const actual = r.playing ? r.time + (now - r.at) / 1000 : r.time
  if (needsResync(actual, expected, force ? 0.5 : DRIFT_S)) out.push({ type: 'seek', position: expected })
  return out
}
