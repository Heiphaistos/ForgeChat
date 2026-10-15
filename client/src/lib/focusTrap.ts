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
  // Dernier élément focalisé par modale (null = hors modale) : le déclencheur d'une modale imbriquée
  // est dans la modale parente, pas derrière elle.
  const lastIn = new Map<HTMLElement | null, HTMLElement>()

  // Derniers éléments focalisés hors modale : repli quand le déclencheur a disparu (une modale
  // ouverte depuis un menu contextuel qui se ferme emporte son entrée, le focus tombait sur <body>).
  const recent: HTMLElement[] = []

  document.addEventListener('focusin', e => {
    const el = e.target as HTMLElement
    const modal = el.closest?.<HTMLElement>(MODAL) ?? null
    lastIn.set(modal, el)
    if (!modal) { recent.push(el); if (recent.length > 8) recent.shift() }
  })

  new MutationObserver(() => {
    for (const d of document.querySelectorAll<HTMLElement>(MODAL)) {
      if (stack.includes(d)) continue
      triggers.set(d, lastIn.get(stack[stack.length - 1] ?? null) ?? null)
      stack.push(d)
      if (!d.contains(document.activeElement)) (focusables(d)[0] ?? (d.tabIndex = -1, d)).focus({ preventScroll: true })
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      const d = stack[i]
      if (d.isConnected) continue
      stack.splice(i, 1)
      const back = triggers.get(d)
      triggers.delete(d)
      lastIn.delete(d)
      const a = document.activeElement
      if (!a || a === document.body) {
        const target = back?.isConnected ? back : [...recent].reverse().find(el => el.isConnected && el.getClientRects().length > 0)
        target?.focus({ preventScroll: true })
      }
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
