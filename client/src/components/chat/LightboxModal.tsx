import { useEffect, useState, useCallback } from 'react'
import { X, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

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
        <button onClick={() => setZoom(z => Math.min(z + 0.25, 4))} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><ZoomIn size={18} /></button>
        <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><ZoomOut size={18} /></button>
        <button onClick={download} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><Download size={18} /></button>
        <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"><X size={18} /></button>
      </div>

      {images.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
          {index + 1} / {images.length}
        </div>
      )}

      {images.length > 1 && (
        <>
          <button onClick={prev} className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-10"><ChevronLeft size={24} /></button>
          <button onClick={next} className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition z-10"><ChevronRight size={24} /></button>
        </>
      )}

      <div
        className="overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={e => { setDragging(true); setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y }) }}
        onMouseMove={e => { if (dragging) setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
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
