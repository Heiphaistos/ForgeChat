// Disposition de la page d'appel.
//
// - Galerie : la taille des tuiles est CALCULÉE pour que toutes tiennent dans la
//   zone visible au format 16:9 (plus de chevauchement, plus de bande vide).
// - Dès qu'un écran est partagé (mode Auto), il passe en grand et les participants
//   deviennent des miniatures en bandeau, de taille réglable (S/M/L), façon Discord.
// - Épingler une tuile (bouton punaise) la met en grand ; la désépingler revient à la grille.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { useT, t as tr } from '../../i18n'

export type ViewMode = 'auto' | 'grid' | 'spotlight' | 'sidebar' | 'focus' | 'filmstrip'
export type ThumbSize = 's' | 'm' | 'l'

export interface StageTile {
  key: string
  kind: 'camera' | 'screen'
  userId: string
  username: string
  isLocal: boolean
  stream: MediaStream | null
  /** Application Linux : flux vidéo local. */
  url?: string | null
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

/** Bouton punaise posé sur une tuile : épingler en grand, ou désépingler. */
function PinButton({ tile, pinned, onClick }: { tile: StageTile; pinned: boolean; onClick: () => void }) {
  const t = useT()
  const label = t(pinned ? 'voice.tile.unpin' : 'voice.tile.pin', { name: tile.username })
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }} aria-pressed={pinned} aria-label={label} title={label}
      className={`absolute top-2 left-2 z-10 p-1.5 rounded-full min-w-[28px] min-h-[28px] flex items-center justify-center ${pinned ? 'bg-white text-black' : 'bg-black/50 text-white/80 hover:text-white hover:bg-black/70'}`}>
      {pinned ? <PinOff size={12} aria-hidden /> : <Pin size={12} aria-hidden />}
    </button>
  )
}

function Gallery({ tiles, render, compact, onPin }: {
  tiles: StageTile[]; render: (t: StageTile, o: RenderOpts) => ReactNode; compact?: boolean; onPin: (key: string) => void
}) {
  const [ref, box] = useBox<HTMLDivElement>()
  const { w, h } = fitTiles(box.w, box.h, tiles.length)
  return (
    <div ref={ref} className="w-full h-full min-h-0 flex flex-wrap content-center justify-center gap-2 overflow-hidden">
      {w > 0 && tiles.map(t => (
        <div key={t.key} style={{ width: w, height: h }} className="flex-shrink-0 relative">
          {render(t, { compact, expand: true })}
          {tiles.length > 1 && <PinButton tile={t} pinned={false} onClick={() => onPin(t.key)} />}
        </div>
      ))}
    </div>
  )
}

/** Tuile mise en avant, avec la punaise pour revenir à la grille quand elle est épinglée. */
function Featured({ tile, pinned, onUnpin, render }: { tile: StageTile; pinned: boolean; onUnpin: () => void; render: (t: StageTile, o: RenderOpts) => ReactNode }) {
  return (
    <div className="relative w-full h-full min-h-0">
      {render(tile, { expand: true })}
      {pinned && <PinButton tile={tile} pinned onClick={onUnpin} />}
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
          aria-label={tr(t.kind === 'screen' ? 'hc.cs.pinScreen' : 'hc.cs.pin', { name: t.username })}
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
  const t = useT()
  return (
    <div className="flex items-center gap-1 text-[10px] text-fc-muted" role="group" aria-label={t('hc.cs.thumbSize')}>
      <span className="mr-1">{t('hc.cs.thumbs')}</span>
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
  /** Épingler une tuile (null : désépingler). */
  onFeature: (key: string | null) => void
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

  const pinned = byKey(featuredKey)
  const effective: ViewMode = mode === 'auto' ? (screens.length > 0 || pinned ? 'spotlight' : 'grid') : mode

  if (effective === 'grid') {
    return <div className="h-full p-3"><Gallery tiles={tiles} render={render} onPin={onFeature} /></div>
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
        <div className="flex-1 min-w-0 p-3"><Featured tile={featured} pinned={featured === pinned} onUnpin={() => onFeature(null)} render={render} /></div>
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
      <div className="flex-1 min-h-0"><Featured tile={featured} pinned={featured === pinned} onUnpin={() => onFeature(null)} render={render} /></div>
      {others.length > 0 && (
        <>
          <div className="flex justify-end"><ThumbSizePicker size={thumb} onChange={changeThumb} /></div>
          <Strip tiles={others} size={thumb} onPick={onFeature} render={render} />
        </>
      )}
    </div>
  )
}
