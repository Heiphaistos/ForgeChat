import { useEffect, useState } from 'react'
import ActivityFeedPanel from '../activity/ActivityFeedPanel'

interface Props {
  visible: boolean
  onClose: () => void
}

export default function RightSidebar({ visible, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!visible) return null

  return (
    <div className="absolute inset-0 z-20 md:relative md:inset-auto md:z-auto md:w-[260px] bg-fc-channel flex-shrink-0 border-l border-fc-bg flex flex-col panel-slide-right">
      <ActivityFeedPanel onClose={onClose} />
    </div>
  )
}

/**
 * Hook pour gérer l'état ouvert/fermé de la sidebar droite.
 * Expose aussi le toggle pour le header.
 */
export function useRightSidebar() {
  const [open, setOpen] = useState(false)
  const toggle = () => setOpen(v => !v)
  const close = () => setOpen(false)
  return { open, toggle, close }
}
