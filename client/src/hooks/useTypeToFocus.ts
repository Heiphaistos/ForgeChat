import { useEffect, type RefObject } from 'react'

/**
 * Type-to-focus (desktop) : taper un caractère imprimable alors qu'aucun champ
 * n'a le focus place le curseur dans le composer — le caractère y est inséré
 * nativement par le navigateur.
 *
 * Exclusions : raccourcis à modificateurs, espace (scroll / push-to-talk),
 * '?' (modal des raccourcis), et overlays ouverts (dialog / menu).
 * Un composer de fil ouvert (textarea[data-composer="thread"]) a la priorité.
 */
export function useTypeToFocus(ref: RefObject<HTMLTextAreaElement>) {
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length !== 1 || e.key === ' ' || e.key === '?') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      const threadComposer = document.querySelector<HTMLTextAreaElement>('textarea[data-composer="thread"]')
      ;(threadComposer ?? ref.current)?.focus()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [ref])
}
