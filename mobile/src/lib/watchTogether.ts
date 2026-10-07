// « Regarder ensemble » (protocole : server/src/handlers/watch.rs). L'application n'embarque pas
// de WebView (react-native-webview absent) : pas de lecteur intégré, on ouvre la vidéo dans
// YouTube ou le navigateur, à la position où en est le salon.

const ID_RE = /^[A-Za-z0-9_-]{11}$/

export interface WatchInfo {
  channelId: string
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
  if (typeof e.position !== 'number' || !Number.isFinite(e.position)) return null
  return {
    channelId: e.channel_id,
    videoId: e.video_id,
    playing: e.playing === true,
    position: Math.max(0, e.position),
    receivedAt: now,
    by: typeof e.by === 'string' ? e.by : '',
    queue: Array.isArray(e.queue) ? e.queue.length : 0,
  }
}

export function watchPosition(w: WatchInfo, now: number): number {
  return w.playing ? w.position + (now - w.receivedAt) / 1000 : w.position
}

/** Lien YouTube au bon horodatage (`&t=`). */
export function watchLink(w: WatchInfo, now: number): string {
  const t = Math.floor(watchPosition(w, now))
  return `https://www.youtube.com/watch?v=${w.videoId}${t > 0 ? `&t=${t}s` : ''}`
}
