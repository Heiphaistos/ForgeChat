import { useEffect } from 'react'

/** `enabled=false` : n'écoute pas (modale rendue conditionnellement dans un composant toujours monté). */
export function useEscapeKey(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, enabled])
}

// Variante pour les panneaux latéraux avec champs de saisie : si un input/
// textarea a le focus, Échap le rend d'abord (blur) — le panneau ne se ferme
// qu'au Échap suivant. Évite de fermer le panneau en annulant une édition.
export function useEscapePanel(onClose: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        el.blur()
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}
