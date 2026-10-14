// Recadrage carré d'un avatar avant envoi (audit C18) : glisser (souris, doigt, stylet),
// flèches du clavier, zoom par curseur ; sortie PNG/JPEG/WebP de 512 px au plus.
// Images animées (GIF, APNG, WebP animé) et images illisibles : envoyées telles quelles,
// le canvas n'en garderait que la première image.
// ponytail: avatar seulement ; la bannière s'affiche en entier à ses propres proportions
// (ui/ProfileBanner.tsx), un recadrage imposé irait contre ce choix.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { isAnimatedImage, squareCrop } from '../../lib/imageCrop'

const OUT_MAX = 512
const MAX_ZOOM = 4

interface Props {
  file: File
  onCancel: () => void
  /** Fichier recadré, ou le fichier d'origine quand le recadrage ne s'applique pas. */
  onDone: (file: File) => void
}

export default function ImageCropDialog({ file, onCancel, onDone }: Props) {
  const t = useT()
  const [url, setUrl] = useState<string | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })
  // Focus sur la zone dès l'affichage (autoFocus ne s'applique pas à un div).
  useEffect(() => { if (url) areaRef.current?.focus() }, [url])

  // Image animée : pas de recadrage. Sinon URL locale de l'aperçu, libérée à la fermeture.
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    file.slice(0, 65536).arrayBuffer()
      .then(buf => isAnimatedImage(new Uint8Array(buf)))
      .catch((err: unknown) => { console.warn('[ImageCropDialog] en-tête illisible, envoi sans recadrage', err); return true })
      .then(skip => {
        if (!alive) return
        if (skip) { done.current(file); return }
        objectUrl = URL.createObjectURL(file)
        setUrl(objectUrl)
      })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [file])

  // Échap = annuler, en capture : ne ferme pas aussi la fenêtre de paramètres dessous.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const w = img?.naturalWidth ?? 1
  const h = img?.naturalHeight ?? 1
  const crop = squareCrop(w, h, zoom, center.x, center.y)
  // Déplace le carré (pixels de l'image) et mémorise le centre ramené dans l'image.
  const move = (dx: number, dy: number) => setCenter(c => {
    const k = squareCrop(w, h, zoom, c.x + dx, c.y + dy)
    return { x: k.x + k.side / 2, y: k.y + k.side / 2 }
  })

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const scale = crop.side / e.currentTarget.getBoundingClientRect().width
    move((d.x - e.clientX) * scale, (d.y - e.clientY) * scale)
    drag.current = { id: d.id, x: e.clientX, y: e.clientY }
  }
  const endDrag = () => { drag.current = null }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = crop.side * 0.05
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const m = moves[e.key]
    if (m) { e.preventDefault(); move(m[0], m[1]) }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(z => Math.min(MAX_ZOOM, z + 0.1)) }
    else if (e.key === '-') { e.preventDefault(); setZoom(z => Math.max(1, z - 0.1)) }
  }

  const apply = () => {
    if (!img) return
    const out = Math.max(1, Math.min(OUT_MAX, Math.round(crop.side)))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) { console.warn('[ImageCropDialog] canvas 2D indisponible, envoi sans recadrage'); onDone(file); return }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, out, out)
    const type = file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png'
    setBusy(true)
    canvas.toBlob(blob => {
      setBusy(false)
      if (!blob) { console.warn('[ImageCropDialog] encodage refusé, envoi sans recadrage'); onDone(file); return }
      const name = `${file.name.replace(/\.[^.]*$/, '') || 'avatar'}.${type.slice(6)}`
      onDone(new File([blob], name, { type }))
    }, type, 0.92)
  }

  if (!url) return null
  // Portail : un ancêtre transformé (panneau animé) bornerait sinon le `fixed` à sa boîte.
  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="fc-crop-title"
        className="relative bg-fc-sidebar border border-white/10 shadow-2xl p-5 w-full h-full sm:h-auto sm:max-w-sm sm:rounded-xl flex flex-col justify-center gap-4 overflow-y-auto">
        <h3 id="fc-crop-title" className="text-white font-semibold">{t('crop.titleAvatar')}</h3>
        <div
          ref={areaRef}
          tabIndex={0}
          role="group"
          aria-label={t('crop.area')}
          aria-describedby="fc-crop-hint"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="relative w-full max-w-[320px] mx-auto aspect-square overflow-hidden rounded-lg bg-black cursor-move select-none outline-none focus-visible:ring-2 focus-visible:ring-fc-accent"
          style={{ touchAction: 'none' }}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={e => { const el = e.currentTarget; setCenter({ x: el.naturalWidth / 2, y: el.naturalHeight / 2 }); setImg(el) }}
            onError={() => { console.warn('[ImageCropDialog] image illisible par le navigateur, envoi sans recadrage'); onDone(file) }}
            className="absolute pointer-events-none"
            style={img
              ? { maxWidth: 'none', width: `${(w / crop.side) * 100}%`, left: `${(-crop.x / crop.side) * 100}%`, top: `${(-crop.y / crop.side) * 100}%` }
              : { opacity: 0 }}
          />
          {/* Aperçu de la découpe ronde des avatars */}
          <div aria-hidden className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
        </div>
        <p id="fc-crop-hint" className="text-xs text-fc-muted text-center">{t('crop.hint')}</p>
        <label className="flex items-center gap-3 text-xs font-semibold text-fc-muted uppercase tracking-wide">
          {t('crop.zoom')}
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))} className="flex-1 accent-fc-accent" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-fc-muted hover:text-white transition">{t('crop.cancel')}</button>
          <button type="button" onClick={apply} disabled={!img || busy}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {t('crop.apply')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
