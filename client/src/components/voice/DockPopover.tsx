import { useEffect, useRef } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'

/** Fenêtre posée au-dessus du panneau vocal ; se ferme au clic extérieur ou sur Échap. */
export default function DockPopover({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEscapeKey(onClose)
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return (
    <div ref={ref} role="dialog" aria-label={label} className="absolute bottom-full left-2 mb-2 z-50">
      {children}
    </div>
  )
}
