// Piège de focus global des modales (WCAG 2.4.3) : tout `[aria-modal="true"]` retient Tab/Maj+Tab,
// reçoit le focus à l'ouverture et le rend à l'élément déclencheur à la fermeture. Échap reste
// géré par chaque modale (useEscapeKey). Une seule installation (main.tsx) couvre toutes les modales.

/** Élément à focaliser sur Tab/Maj+Tab dans une modale, ou null si le navigateur peut décider seul. */
export function trapTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | 'container' | null {
  if (items.length === 0) return 'container'
  const i = active === null ? -1 : items.indexOf(active)
  if (i === -1) return shift ? items[items.length - 1] : items[0]
  if (shift && i === 0) return items[items.length - 1]
  if (!shift && i === items.length - 1) return items[0]
  return null
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
const MODAL = '[aria-modal="true"]'

const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0)

export function installFocusTrap(): void {
  const stack: HTMLElement[] = []
  const triggers = new Map<HTMLElement, HTMLElement | null>()
  let lastOutside: HTMLElement | null = null

  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement
    if (!el.closest?.(MODAL)) lastOutside = el
  })

  new MutationObserver(() => {
    for (const d of document.querySelectorAll<HTMLElement>(MODAL)) {
      if (stack.includes(d)) continue
      stack.push(d)
      triggers.set(d, lastOutside)
      if (!d.contains(document.activeElement)) (focusables(d)[0] ?? (d.tabIndex = -1, d)).focus({ preventScroll: true })
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      const d = stack[i]
      if (d.isConnected) continue
      stack.splice(i, 1)
      const back = triggers.get(d)
      triggers.delete(d)
      const a = document.activeElement
      if (back?.isConnected && (!a || a === document.body)) back.focus({ preventScroll: true })
    }
  }).observe(document.body, { childList: true, subtree: true })

  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return
    const top = stack[stack.length - 1]
    if (!top?.isConnected) return
    const target = trapTarget(focusables(top), document.activeElement as HTMLElement | null, e.shiftKey)
    if (target === null) return
    e.preventDefault()
    ;(target === 'container' ? top : target).focus()
  }, true)
}
