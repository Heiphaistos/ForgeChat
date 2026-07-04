import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Share2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  images: string[]
  initialIndex: number
  onClose: () => void
}

export default function LightboxModal({ images, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const panStart = useRef<{ x: number; y: number } | null>(null)
  const pinchStartDist = useRef<number | null>(null)
  const pinchStartZoom = useRef(1)
  const lastTapTime = useRef(0)

  const prev = useCallback(() => { setIndex(i => (i - 1 + images.length) % images.length); setZoom(1); setPos({ x: 0, y: 0 }) }, [images.length])
  const next = useCallback(() => { setIndex(i => (i + 1) % images.length); setZoom(1); setPos({ x: 0, y: 0 }) }, [images.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === '+') setZoom(z => Math.min(z + 0.25, 4))
      if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.5))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, prev, next])

  const download = () => {
    const a = document.createElement('a')
    a.href = images[index]
    a.download = images[index].split('/').pop() ?? 'image'
    a.click()
  }

  // Web Share API (mobile) avec fallback copie du lien
  const share = async () => {
    const url = new URL(images[index], window.location.origin).href
    if (navigator.share) {
      try { await navigator.share({ url }) } catch { /* partage annulé */ }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        toast.success('Lien de l\'image copié')
      } catch {
        toast.error('Impossible de copier le lien')
      }
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => e.deltaY < 0 ? Math.min(z + 0.25, 4) : Math.max(z - 0.25, 0.5))
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button onClick={() => setZoom(z => Math.min(z + 0.25, 4))} aria-label="Zoom avant" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><ZoomIn size={18} aria-hidden /></button>
        <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} aria-label="Zoom arrière" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><ZoomOut size={18} aria-hidden /></button>
        <button onClick={share} aria-label="Partager l'image" title="Partager" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><Share2 size={18} aria-hidden /></button>
        <button onClick={download} aria-label="Télécharger l'image" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><Download size={18} aria-hidden /></button>
        <button onClick={onClose} aria-label="Fermer" className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><X size={18} aria-hidden /></button>
      </div>

      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
          {index + 1} / {images.length}
        </div>
      )}

      {images.length > 1 && (
        <>
          <button onClick={prev} aria-label="Image précédente" className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-10"><ChevronLeft size={24} /></button>
          <button onClick={next} aria-label="Image suivante" className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-10"><ChevronRight size={24} /></button>
        </>
      )}

      <div
        className="overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={e => { setDragging(true); setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y }) }}
        onMouseMove={e => { if (dragging) setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
        onTouchStart={e => {
          if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX
            const dy = e.touches[0].clientY - e.touches[1].clientY
            pinchStartDist.current = Math.sqrt(dx * dx + dy * dy)
            pinchStartZoom.current = zoom
            touchStartX.current = null
            touchStartY.current = null
          } else {
            touchStartX.current = e.touches[0].clientX
            touchStartY.current = e.touches[0].clientY
            panStart.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y }
            pinchStartDist.current = null
          }
        }}
        onTouchMove={e => {
          if (e.touches.length === 2 && pinchStartDist.current !== null) {
            e.preventDefault()
            const dx = e.touches[0].clientX - e.touches[1].clientX
            const dy = e.touches[0].clientY - e.touches[1].clientY
            const dist = Math.sqrt(dx * dx + dy * dy)
            const scale = dist / pinchStartDist.current
            setZoom(Math.max(0.5, Math.min(4, pinchStartZoom.current * scale)))
            return
          }
          // Pan tactile à un doigt quand l'image est zoomée
          if (e.touches.length === 1 && zoom > 1 && panStart.current) {
            e.preventDefault()
            setPos({ x: e.touches[0].clientX - panStart.current.x, y: e.touches[0].clientY - panStart.current.y })
          }
        }}
        onTouchEnd={e => {
          if (pinchStartDist.current !== null) { pinchStartDist.current = null; return }
          if (touchStartX.current === null || touchStartY.current === null) return
          const dx = e.changedTouches[0].clientX - touchStartX.current
          const dy = e.changedTouches[0].clientY - touchStartY.current
          touchStartX.current = null
          touchStartY.current = null
          panStart.current = null
          // Image zoomée : le geste était un pan, rien d'autre à interpréter
          if (zoom > 1) return
          // Swipe vertical vers le bas → fermer (geste standard)
          if (dy > 90 && Math.abs(dx) < Math.abs(dy)) { onClose(); return }
          if (Math.abs(dx) > 50 && images.length > 1) { dx < 0 ? next() : prev(); return }
          // Double-tap immobile → toggle zoom 1x ↔ 2x
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
            const now = Date.now()
            if (now - lastTapTime.current < 300) {
              lastTapTime.current = 0
              setZoom(z => z > 1 ? 1 : 2)
              setPos({ x: 0, y: 0 })
            } else {
              lastTapTime.current = now
            }
          }
        }}
      >
        <img
          src={images[index]}
          alt=""
          className="max-w-[90vw] max-h-[85vh] object-contain select-none"
          style={{ transform: `scale(${zoom}) translate(${pos.x / zoom}px, ${pos.y / zoom}px)`, transition: dragging ? 'none' : 'transform 0.15s ease' }}
          draggable={false}
        />
      </div>
    </div>
  )
}
