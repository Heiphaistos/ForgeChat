// Disposition de la page d'appel.
//
// - Galerie : la taille des tuiles est CALCULÉE pour que toutes tiennent dans la
//   zone visible au format 16:9 (plus de chevauchement, plus de bande vide).
// - Dès qu'un écran est partagé (mode Auto), il passe en grand et les participants
//   deviennent des miniatures en bandeau, de taille réglable (S/M/L), façon Discord.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type ViewMode = 'auto' | 'grid' | 'spotlight' | 'sidebar' | 'focus' | 'filmstrip'
export type ThumbSize = 's' | 'm' | 'l'

export interface StageTile {
  key: string
  kind: 'camera' | 'screen'
  userId: string
  username: string
  isLocal: boolean
  stream: MediaStream | null
}

export interface RenderOpts { compact?: boolean; expand?: boolean }

const THUMB_WIDTH: Record<ThumbSize, number> = { s: 136, m: 192, l: 264 }
const THUMB_KEY = 'fc_thumb_size'

export function loadThumbSize(): ThumbSize {
  const v = localStorage.getItem(THUMB_KEY)
  return v === 's' || v === 'l' ? v : 'm'
}
export function saveThumbSize(v: ThumbSize) {
  try { localStorage.setItem(THUMB_KEY, v) } catch { /* mode privé */ }
}

/**
 * Plus grande taille de tuile 16:9 telle que `n` tuiles tiennent dans W×H.
 * Essaie chaque nombre de colonnes et garde le meilleur.
 */
export function fitTiles(W: number, H: number, n: number, gap = 8, ratio = 16 / 9): { w: number; h: number } {
  let best = { w: 0, h: 0 }
  if (W <= 0 || H <= 0 || n <= 0) return best
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    let w = (W - gap * (cols - 1)) / cols
    let h = w / ratio
    if (h * rows + gap * (rows - 1) > H) {
      h = (H - gap * (rows - 1)) / rows
      w = h * ratio
    }
    if (w > best.w) best = { w: Math.floor(w), h: Math.floor(h) }
  }
  return best
}

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box] as const
}

function Gallery({ tiles, render, compact }: { tiles: StageTile[]; render: (t: StageTile, o: RenderOpts) => ReactNode; compact?: boolean }) {
  const [ref, box] = useBox<HTMLDivElement>()
  const { w, h } = fitTiles(box.w, box.h, tiles.length)
  return (
    <div ref={ref} className="w-full h-full min-h-0 flex flex-wrap content-center justify-center gap-2 overflow-hidden">
      {w > 0 && tiles.map(t => (
        <div key={t.key} style={{ width: w, height: h }} className="flex-shrink-0">{render(t, { compact, expand: true })}</div>
      ))}
    </div>
  )
}

/** Bandeau de miniatures cliquables (mettre en avant). */
function Strip({ tiles, size, onPick, render, vertical = false }: {
  tiles: StageTile[]; size: ThumbSize; onPick: (key: string) => void
  render: (t: StageTile, o: RenderOpts) => ReactNode; vertical?: boolean
}) {
  const width = THUMB_WIDTH[size]
  return (
    <div className={`flex gap-2 ${vertical ? 'flex-col overflow-y-auto' : 'overflow-x-auto justify-center'} overscroll-contain pb-1 flex-shrink-0`}>
      {tiles.map(t => (
        <div key={t.key} role="button" tabIndex={0}
          aria-label={`Mettre en avant ${t.username}${t.kind === 'screen' ? ' (écran partagé)' : ''}`}
          style={{ width, height: Math.round((width * 9) / 16) }}
          className="flex-shrink-0 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-fc-accent"
          onClick={() => onPick(t.key)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(t.key) } }}>
          {render(t, { compact: size !== 'l' })}
        </div>
      ))}
    </div>
  )
}

function ThumbSizePicker({ size, onChange }: { size: ThumbSize; onChange: (s: ThumbSize) => void }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-fc-muted" role="group" aria-label="Taille des miniatures">
      <span className="mr-1">Miniatures</span>
      {(['s', 'm', 'l'] as const).map(s => (
        <button key={s} onClick={() => onChange(s)} aria-pressed={size === s}
          className={`w-6 h-6 rounded ${size === s ? 'bg-fc-accent text-white' : 'bg-fc-channel hover:text-white'}`}>
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export default function CallStage({ tiles, mode, featuredKey, onFeature, render, activeSpeakerId }: {
  tiles: StageTile[]
  mode: ViewMode
  featuredKey: string | null
  onFeature: (key: string) => void
  render: (t: StageTile, o: RenderOpts) => ReactNode
  activeSpeakerId: string | null
}) {
  const [thumb, setThumb] = useState<ThumbSize>(loadThumbSize)
  const changeThumb = (s: ThumbSize) => { setThumb(s); saveThumbSize(s) }
  if (tiles.length === 0) return null

  const screens = tiles.filter(t => t.kind === 'screen')
  const byKey = (k: string | null) => (k ? tiles.find(t => t.key === k) : undefined)
  const speakerTile = tiles.find(t => t.kind === 'camera' && !t.isLocal && t.userId === activeSpeakerId)

  // Tuile mise en avant : choix explicite, sinon un écran partagé, sinon l'orateur.
  const featured =
    byKey(featuredKey)
    ?? (mode === 'focus' ? screens[0] ?? speakerTile : screens[0])
    ?? speakerTile
    ?? tiles.find(t => !t.isLocal)
    ?? tiles[0]

  const effective: ViewMode = mode === 'auto' ? (screens.length > 0 ? 'spotlight' : 'grid') : mode

  if (effective === 'grid') {
    return <div className="h-full p-3"><Gallery tiles={tiles} render={render} /></div>
  }

  if (effective === 'filmstrip') {
    return (
      <div className="h-full p-3 flex flex-col gap-2 justify-center">
        <ThumbSizePicker size={thumb} onChange={changeThumb} />
        <Strip tiles={tiles} size={thumb} onPick={onFeature} render={render} />
      </div>
    )
  }

  const others = tiles.filter(t => t.key !== featured.key)

  if (effective === 'sidebar') {
    return (
      <div className="flex h-full min-h-0">
        <div className="flex-1 min-w-0 p-3">{render(featured, { expand: true })}</div>
        <div className="flex flex-col gap-2 p-2 border-l border-fc-hover bg-fc-sidebar/50 min-h-0">
          <ThumbSizePicker size={thumb} onChange={changeThumb} />
          <Strip tiles={others} size={thumb} onPick={onFeature} render={render} vertical />
        </div>
      </div>
    )
  }

  // spotlight et focus : grand au centre, miniatures dessous
  return (
    <div className="flex flex-col h-full min-h-0 p-3 gap-2">
      <div className="flex-1 min-h-0">{render(featured, { expand: true })}</div>
      {others.length > 0 && (
        <>
          <div className="flex justify-end"><ThumbSizePicker size={thumb} onChange={changeThumb} /></div>
          <Strip tiles={others} size={thumb} onPick={onFeature} render={render} />
        </>
      )}
    </div>
  )
}
