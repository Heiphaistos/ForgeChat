import { useRef } from 'react'

// Fermeture au swipe vers la droite (panneaux latéraux plein écran sur mobile).
// Seuil horizontal 70px avec tolérance verticale 60px pour ne pas capter les
// scrolls. À étaler sur l'élément racine : <div {...useSwipeRightToClose(onClose)}>
export function useSwipeRightToClose(onClose: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      start.current = { x: t.clientX, y: t.clientY }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (!start.current) return
      const dx = e.changedTouches[0].clientX - start.current.x
      const dy = Math.abs(e.changedTouches[0].clientY - start.current.y)
      start.current = null
      if (dx > 70 && dy < 60) onClose()
    },
  }
}
