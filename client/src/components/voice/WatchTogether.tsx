import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, FastForward, Music2, Pause, Play, Rewind, SkipForward, Square, Tv, Volume2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useWs } from '../../store/ws'
import {
  expectedPosition, needsResync, parseWatchState, parseYouTubeId, youtubeLink, type WatchState,
} from '../../lib/watchTogether'
import { useT, t as tr, type Key } from '../../i18n'
import { BUFFERING, createYtEmbed, ENDED, PLAYING, type YtEmbed } from '../../lib/youtubeEmbed'

// « Regarder ensemble » : lecteur YouTube (iframe officielle youtube-nocookie
// pilotée en postMessage, aucun script YouTube dans la page) synchronisé par le WebSocket, voir server/src/handlers/watch.rs.
// Aucune action n'est appliquée en local d'avance : on envoie la commande et c'est
// l'état renvoyé par le serveur (à tout le salon, nous compris) qui pilote le lecteur.

// États du lecteur (ENDED, PLAYING, BUFFERING) et iframe : lib/youtubeEmbed.

const ERRORS: Record<string, Key> = {
  rate_limited: 'watch.err.rateLimited',
  invalid_url: 'watch.err.invalidUrl',
  queue_full: 'watch.err.queueFull',
}

/** État de l'activité du salon : écoute WATCH_*, et le redemande à l'ouverture de la page. */
export function useWatchTogether(channelId: string, enabled: boolean) {
  const { send, on } = useWs()
  const [state, setState] = useState<WatchState | null>(null)
  useEffect(() => {
    setState(null)
    if (!enabled) return
    const offs = [
      on('WATCH_STATE', (d: unknown) => {
        const s = parseWatchState(d, Date.now())
        if (s && s.channelId === channelId) setState(s)
      }),
      on('WATCH_STOP', (d: any) => { if (d?.channel_id === channelId) setState(null) }),
      on('WATCH_ERROR', (d: any) => {
        if (d?.channel_id === channelId) toast.error(tr(ERRORS[d.reason] ?? 'watch.err.refused'))
      }),
    ]
    send({ type: 'WATCH_SYNC', channel_id: channelId })
    return () => offs.forEach(off => off())
  }, [channelId, enabled, on, send])
  return state
}

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`
}

interface Props { channelId: string; state: WatchState | null; onClose: () => void }

export default function WatchTogether({ channelId, state, onClose }: Props) {
  const t = useT()
  const { send } = useWs()
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YtEmbed | null>(null)
  const loadedItemRef = useRef<number | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [volume, setVolume] = useState(80)
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  // Musique ensemble : lecteur réduit (toujours visible, comme l'exige YouTube), file et commandes en grand.
  const [audioOnly, setAudioOnly] = useState(() => localStorage.getItem('fc_watch_audio') === 'true')
  const toggleAudioOnly = () => setAudioOnly(v => { localStorage.setItem('fc_watch_audio', String(!v)); return !v })
  const [, setTick] = useState(0)

  // Lecteur créé quand une vidéo est partagée (l'iframe porte la 1re vidéo) ; détruit à l'arrêt ou à la fermeture.
  const active = !!state
  useEffect(() => {
    const s = stateRef.current
    if (!active || !s || !hostRef.current) return
    loadedItemRef.current = s.item
    playerRef.current = createYtEmbed(hostRef.current, {
      videoId: s.videoId, start: expectedPosition(s, Date.now()), autoplay: s.playing,
      onReady: () => setReady(true),
      onState: st => {
        const cur = stateRef.current
        // Fin de vidéo : chaque client le signale, le serveur n'avance qu'une fois (item).
        if (st === ENDED && cur) send({ type: 'WATCH_NEXT', channel_id: channelId, item: cur.item })
      },
      onError: () => setFailed(tr('watch.cannotPlay')),
    })
    return () => {
      playerRef.current?.destroy()
      playerRef.current = null
      loadedItemRef.current = null
      setReady(false)
    }
  }, [channelId, send, active])

  // Aligne le lecteur sur l'état partagé. `force` : un participant vient d'agir.
  const sync = useCallback((force: boolean) => {
    const p = playerRef.current, s = stateRef.current
    if (!ready || !p || !s) return
    const expected = expectedPosition(s, Date.now())
    if (loadedItemRef.current !== s.item) {
      loadedItemRef.current = s.item
      setFailed(null)
      if (s.playing) p.load(s.videoId, expected)
      else p.cue(s.videoId, expected)
      return
    }
    const ps = p.state()
    const ended = ps === ENDED && expected >= p.duration() - 1
    if (ended) return
    if (s.playing && ps !== PLAYING && ps !== BUFFERING) p.play()
    if (!s.playing && (ps === PLAYING || ps === BUFFERING)) p.pause()
    if (needsResync(p.time(), expected, force ? 0.5 : undefined)) p.seekTo(expected)
  }, [ready])

  useEffect(() => { sync(true) }, [state, sync])
  useEffect(() => {
    const iv = setInterval(() => { sync(false); setTick(t => t + 1) }, 1000)
    return () => clearInterval(iv)
  }, [sync])
  useEffect(() => { if (ready) playerRef.current?.setVolume(volume) }, [ready, volume])

  const player = ready ? playerRef.current : null
  const current = player && state ? player.time() : state ? expectedPosition(state, Date.now()) : 0
  const duration = player?.duration() || 0
  const title = (player && state && player.title()) || null

  const setPlayback = (playing: boolean, position: number) => {
    if (!state) return
    send({ type: 'WATCH_STATE', channel_id: channelId, item: state.item, playing, position: Math.max(0, position) })
  }
  const commitSeek = () => {
    if (seekDraft !== null && state) setPlayback(state.playing, seekDraft)
    setSeekDraft(null)
  }
  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!parseYouTubeId(url)) {
      toast.error(t('watch.invalidHelp'))
      return
    }
    send({ type: 'WATCH_ADD', channel_id: channelId, url: url.trim() })
    setUrl('')
  }

  const btn = 'p-2 rounded-lg bg-fc-hover text-fc-text hover:text-white disabled:opacity-40 min-w-[36px] min-h-[36px] flex items-center justify-center'

  return (
    <div className="absolute inset-0 z-20 bg-fc-bg flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-fc-hover">
        <Tv size={16} className="text-fc-accent flex-shrink-0" aria-hidden />
        <span className="text-sm font-semibold text-white truncate flex-1">{title ?? t('watch.title')}</span>
        {state && (
          <a href={youtubeLink(state.videoId, current)} target="_blank" rel="noopener noreferrer"
            className={btn} title={t('watch.openYt')} aria-label={t('watch.openYt')}>
            <ExternalLink size={14} aria-hidden />
          </a>
        )}
        <button onClick={toggleAudioOnly} className={btn} aria-pressed={audioOnly}
          title={t('voiceLot.music.toggle')} aria-label={t('voiceLot.music.toggle')}>
          <Music2 size={14} aria-hidden className={audioOnly ? 'text-fc-accent' : undefined} />
        </button>
        <button onClick={onClose} className={btn} title={t('watch.hideTitle')} aria-label={t('watch.hide')}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className={`${audioOnly ? 'h-28 w-48 self-center my-2 rounded-lg overflow-hidden' : 'flex-1 min-h-0'} bg-black relative`}>
        <div ref={hostRef} className="absolute inset-0 [&>iframe]:w-full [&>iframe]:h-full" />
        {(!state || failed) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-fc-muted bg-black">
            {failed ?? t('watch.empty')}
            {failed && state && (
              <a href={youtubeLink(state.videoId, current)} target="_blank" rel="noopener noreferrer" className="text-fc-accent underline">
                {t('watch.openYt')}
              </a>
            )}
          </div>
        )}
      </div>

      {state && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-fc-hover">
          <button className={btn} onClick={() => setPlayback(!state.playing, current)}
            aria-label={state.playing ? t('watch.pause') : t('watch.play')} title={state.playing ? t('watch.pause') : t('watch.play')}>
            {state.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <button className={btn} onClick={() => setPlayback(state.playing, current - 10)} aria-label={t('watch.back10')} title="-10 s">
            <Rewind size={16} aria-hidden />
          </button>
          <button className={btn} onClick={() => setPlayback(state.playing, current + 10)} aria-label={t('watch.fwd10')} title="+10 s">
            <FastForward size={16} aria-hidden />
          </button>
          <span className="text-xs text-fc-muted font-mono">{fmt(seekDraft ?? current)}</span>
          <input type="range" min={0} max={Math.max(1, Math.floor(duration))} step={1}
            value={Math.floor(seekDraft ?? current)} disabled={!duration}
            onChange={e => setSeekDraft(Number(e.target.value))}
            onPointerUp={commitSeek} onKeyUp={commitSeek}
            aria-label={t('watch.position')} className="flex-1 min-w-[120px] accent-fc-accent" />
          <span className="text-xs text-fc-muted font-mono">{fmt(duration)}</span>
          <button className={btn} onClick={() => send({ type: 'WATCH_NEXT', channel_id: channelId, item: state.item })}
            aria-label={t('watch.next')} title={state.queue.length ? t('watch.next') : t('watch.finish')}>
            <SkipForward size={16} aria-hidden />
          </button>
          <button className={btn} onClick={() => send({ type: 'WATCH_STOP', channel_id: channelId })}
            aria-label={t('watch.stopAll')} title={t('watch.stopAll')}>
            <Square size={14} aria-hidden />
          </button>
          <label className="flex items-center gap-1 text-fc-muted" title={t('watch.volumeTitle')}>
            <Volume2 size={14} aria-hidden />
            <input type="range" min={0} max={100} value={volume} onChange={e => setVolume(Number(e.target.value))}
              aria-label={t('watch.volume')} className="w-20 accent-fc-accent" />
          </label>
        </div>
      )}

      <form onSubmit={add} className="flex gap-2 px-3 py-2 border-t border-fc-hover">
        <input value={url} onChange={e => setUrl(e.target.value)} maxLength={300} inputMode="url"
          placeholder={audioOnly ? 'https://music.youtube.com/watch?v=…' : 'https://www.youtube.com/watch?v=…'} aria-label={t('watch.url')}
          className="flex-1 min-w-0 bg-fc-input text-fc-text text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-fc-accent" />
        <button type="submit" disabled={!url.trim()} className="px-3 py-2 rounded-lg bg-fc-accent text-white text-sm font-medium disabled:opacity-40">
          {state ? t('watch.queue') : t('watch.start')}
        </button>
      </form>

      {audioOnly && <div className="flex-1" />}
      {state && state.queue.length > 0 && (
        <div className="flex gap-2 px-3 pb-2 overflow-x-auto" aria-label={t('watch.queueLabel')}>
          {state.queue.map((id, i) => (
            <img key={`${i}-${id}`} src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt={t('watch.queueItem', { n: i + 1 })}
              className="h-12 rounded flex-shrink-0" loading="lazy" />
          ))}
        </div>
      )}
    </div>
  )
}
