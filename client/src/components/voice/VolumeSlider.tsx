import { useState, useRef, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'

interface Props {
  userId: string
  username: string
  initialVolume?: number
  onVolumeChange: (volume: number) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement>
}

export default function VolumeSlider({ username, initialVolume = 100, onVolumeChange, onClose }: Props) {
  const [volume, setVolume] = useState(initialVolume)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler as EventListener)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler as EventListener)
    }
  }, [onClose])

  const handleChange = (v: number) => {
    setVolume(v)
    onVolumeChange(v)
  }

  const reset = () => handleChange(100)

  const pct = Math.round(volume)

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-fc-channel border border-white/10 rounded-xl shadow-2xl p-3 w-48"
      style={{ left: '100%', top: 0, marginLeft: '8px' }}
    >
      {/* Titre */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-white truncate max-w-[100px]">{username}</span>
        <button
          onClick={reset}
          title="Réinitialiser à 100%"
          className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* Label volume */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-fc-muted">Volume</span>
        <span className="text-xs font-mono text-fc-text">{pct}%</span>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={200}
        step={1}
        value={volume}
        onChange={e => handleChange(Number(e.target.value))}
        className="w-full accent-fc-accent h-1.5 rounded cursor-pointer"
      />

      {/* Marqueurs */}
      <div className="flex justify-between text-[10px] text-fc-muted mt-1">
        <span>0%</span>
        <span>100%</span>
        <span>200%</span>
      </div>
    </div>
  )
}
