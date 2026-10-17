// Lecteur YouTube SANS script tiers : iframe youtube-nocookie pilotée en postMessage
// (protocole de l'API IFrame, `enablejsapi=1`). Aucun script YouTube n'est chargé dans la page,
// donc `script-src` n'a pas besoin de youtube.com. Messages acceptés : seulement ceux de NOTRE
// iframe (`source`) ET de l'origine youtube-nocookie.

export const YT_ORIGIN = 'https://www.youtube-nocookie.com'
export const ENDED = 0, PLAYING = 1, BUFFERING = 3

export function embedUrl(videoId: string, o: { origin: string; start?: number; autoplay?: boolean }): string {
  const q = new URLSearchParams({
    enablejsapi: '1', controls: '0', disablekb: '1', rel: '0', playsinline: '1',
    origin: o.origin, start: String(Math.max(0, Math.floor(o.start ?? 0))), autoplay: o.autoplay ? '1' : '0',
  })
  return `${YT_ORIGIN}/embed/${encodeURIComponent(videoId)}?${q}`
}

export const ytCommand = (func: string, args: unknown[] = []) => JSON.stringify({ event: 'command', func, args })

export type YtMessage =
  | { type: 'ready' }
  | { type: 'state'; state: number }
  | { type: 'error' }
  | { type: 'info'; time?: number; duration?: number; state?: number; title?: string }

/** Message reçu de l'iframe (chaîne JSON) ; null si ce n'est pas un message de lecteur. */
export function parseYtMessage(data: unknown): YtMessage | null {
  if (typeof data !== 'string') return null
  let m: { event?: unknown; info?: unknown } | null
  try { m = JSON.parse(data) } catch { return null }
  if (!m || typeof m !== 'object') return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  if (m.event === 'onReady') return { type: 'ready' }
  if (m.event === 'onError') return { type: 'error' }
  if (m.event === 'onStateChange') { const s = num(m.info); return s === undefined ? null : { type: 'state', state: s } }
  if (m.event === 'infoDelivery' || m.event === 'initialDelivery') {
    const i = (m.info && typeof m.info === 'object' ? m.info : {}) as Record<string, unknown>
    const vd = i.videoData as { title?: unknown } | undefined
    return { type: 'info', time: num(i.currentTime), duration: num(i.duration), state: num(i.playerState), title: typeof vd?.title === 'string' ? vd.title : undefined }
  }
  return null
}

/** Le message vient-il bien de notre iframe, et de youtube-nocookie ? */
export const fromOurFrame = (e: { origin: string; source: unknown }, win: unknown) =>
  !!win && e.source === win && e.origin === YT_ORIGIN

export interface YtEmbed {
  play(): void
  pause(): void
  seekTo(s: number): void
  load(videoId: string, start: number): void
  cue(videoId: string, start: number): void
  setVolume(v: number): void
  time(): number
  duration(): number
  state(): number
  title(): string | null
  destroy(): void
}

interface Opts {
  videoId: string; start: number; autoplay: boolean
  onReady(): void; onState(state: number): void; onError(): void
}

/** Crée l'iframe dans `host`. Les commandes ne sont valables qu'après `onReady`. */
export function createYtEmbed(host: HTMLElement, o: Opts): YtEmbed {
  const iframe = document.createElement('iframe')
  iframe.src = embedUrl(o.videoId, { origin: window.location.origin, start: o.start, autoplay: o.autoplay })
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture'
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  iframe.title = 'YouTube'
  host.appendChild(iframe)
  let ready = false
  let snap = { time: 0, duration: 0, state: -1, title: null as string | null, at: Date.now() }
  const post = (func: string, args: unknown[] = []) => iframe.contentWindow?.postMessage(ytCommand(func, args), YT_ORIGIN)
  const markReady = () => { if (!ready) { ready = true; o.onReady() } }
  const onMessage = (e: MessageEvent) => {
    if (!fromOurFrame(e, iframe.contentWindow)) return
    const m = parseYtMessage(e.data)
    if (!m) return
    if (m.type === 'ready') markReady()
    else if (m.type === 'error') o.onError()
    else if (m.type === 'state') { snap = { ...snap, state: m.state, at: Date.now() }; o.onState(m.state) }
    else {
      markReady()
      const prev = snap.state
      snap = { time: m.time ?? snap.time, duration: m.duration ?? snap.duration, state: m.state ?? snap.state, title: m.title || snap.title, at: Date.now() }
      if (snap.state !== prev) o.onState(snap.state)
    }
  }
  window.addEventListener('message', onMessage)
  // Abonnement aux événements : à renvoyer tant que le lecteur ne répond pas.
  const listen = () => iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN)
  iframe.addEventListener('load', listen)
  const retry = setInterval(() => { if (ready) clearInterval(retry); else listen() }, 500)
  return {
    play: () => post('playVideo'),
    pause: () => post('pauseVideo'),
    seekTo: s => post('seekTo', [s, true]),
    load: (id, start) => post('loadVideoById', [id, start]),
    cue: (id, start) => post('cueVideoById', [id, start]),
    setVolume: v => post('setVolume', [v]),
    time: () => snap.time + (snap.state === PLAYING ? (Date.now() - snap.at) / 1000 : 0),
    duration: () => snap.duration,
    state: () => snap.state,
    title: () => snap.title,
    destroy: () => { clearInterval(retry); window.removeEventListener('message', onMessage); iframe.remove() },
  }
}
