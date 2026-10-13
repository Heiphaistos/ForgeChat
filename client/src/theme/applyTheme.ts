import { COLOR_KEYS, cssGradient, isTranslucent, rgbOf, type Pattern, type ThemeSpec } from './themeCore'

/** Mise en page de l'application (web et bureau), synchronisée avec le compte. */
export interface LayoutPrefs {
  /** Côté de la liste des membres. */
  members: 'right' | 'left'
  /** Largeur de la liste des membres (px). */
  membersWidth: number
  /** Rail des serveurs : toujours visible, ou replié et révélé au survol de la barre latérale. */
  rail: 'show' | 'hover'
  /** Barre de saisie : en retrait (défaut), flottante (ombre) ou collée en bas. */
  composer: 'inset' | 'floating' | 'attached'
  /** Style des messages : à plat (défaut), cartes, ou bulles autour du texte. */
  bubbles: 'flat' | 'cards' | 'bubbles'
  /** Largeur de la discussion : toute la place, ou colonne centrée plus lisible. */
  chatWidth: 'full' | 'centered'
  /** Barres de défilement : normales, fines ou masquées (le défilement reste possible). */
  scrollbars: 'normal' | 'thin' | 'hidden'
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  members: 'right', membersWidth: 240, rail: 'show', composer: 'inset', bubbles: 'flat', chatWidth: 'full', scrollbars: 'normal',
}

const oneOf = <T extends string>(v: unknown, values: readonly T[], def: T): T => (values.includes(v as T) ? (v as T) : def)
export const MEMBERS_MIN = 200
export const MEMBERS_MAX = 360

export function sanitizeLayout(raw: unknown): LayoutPrefs {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const w = typeof v.membersWidth === 'number' && Number.isFinite(v.membersWidth) ? Math.round(v.membersWidth) : DEFAULT_LAYOUT.membersWidth
  return {
    members: v.members === 'left' ? 'left' : 'right',
    membersWidth: Math.min(MEMBERS_MAX, Math.max(MEMBERS_MIN, w)),
    rail: v.rail === 'hover' ? 'hover' : 'show',
    composer: v.composer === 'floating' || v.composer === 'attached' ? v.composer : 'inset',
    bubbles: oneOf(v.bubbles, ['flat', 'cards', 'bubbles'] as const, 'flat'),
    chatWidth: oneOf(v.chatWidth, ['full', 'centered'] as const, 'full'),
    scrollbars: oneOf(v.scrollbars, ['normal', 'thin', 'hidden'] as const, 'normal'),
  }
}

const triplet = (hex: string) => rgbOf(hex).join(' ')

/** Variables CSS du thème (lues par Tailwind : bg-fc-*, text-fc-*…). Valeurs numériques uniquement. */
export function themeVars(s: ThemeSpec): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const k of COLOR_KEYS) vars[`--fc-${k}-rgb`] = triplet(s.colors[k])
  // « text-white » des composants : blanc en sombre, couleur du texte en clair.
  vars['--fc-strong-rgb'] = s.scheme === 'dark' ? '255 255 255' : triplet(s.colors.text)
  const translucent = isTranslucent(s)
  vars['--fc-surface-a'] = String(translucent ? s.opacity : 1)
  vars['--fc-float-a'] = String(translucent ? Math.max(0.88, s.opacity) : 1)
  vars['--fc-glass-blur'] = `${s.blur}px`
  vars['--fc-radius'] = String(s.radius)
  vars['--fc-accent2-rgb'] = triplet(s.accent2 ?? s.colors.accent)
  return vars
}

/**
 * Motif du fond en CSS, construit uniquement à partir de nombres (couleur du texte, opacité bornée) :
 * jamais de chaîne venant du thème.
 */
export function patternCss(p: Pattern, rgb: string, alpha: number): string | null {
  const c = `rgb(${rgb} / ${Math.min(0.4, Math.max(0, alpha))})`
  switch (p) {
    case 'dots': return `radial-gradient(${c} 1px, transparent 1.6px) 0 0 / 16px 16px`
    case 'grid': return `linear-gradient(${c} 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / 24px 24px`
    case 'lines': return `repeating-linear-gradient(0deg, ${c} 0 1px, transparent 1px 4px)`
    case 'diagonal': return `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 14px)`
    case 'checker': return `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0) 0 0 / 32px 32px`
    case 'waves': return `radial-gradient(circle at 50% 100%, transparent 8px, ${c} 9px 10px, transparent 11px) 0 0 / 24px 12px`
    default: return null
  }
}

/** Calque de fond (dégradé et/ou image) derrière toute l'application. */
function applyBackdrop(s: ThemeSpec) {
  let el = document.getElementById('fc-backdrop')
  if (!s.gradient && !s.image) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'fc-backdrop'
    el.setAttribute('aria-hidden', 'true')
    document.body.prepend(el)
  }
  const layers: string[] = []
  if (s.image) {
    const veil = s.scheme === 'dark' ? `rgba(0, 0, 0, ${s.image.dim})` : `rgba(255, 255, 255, ${s.image.dim})`
    // URL déjà validée (https sans guillemets/parenthèses, ou data:image base64).
    layers.push(`linear-gradient(${veil}, ${veil})`, `url("${s.image.url}")`)
  }
  if (s.gradient) layers.push(cssGradient(s.gradient))
  el.style.backgroundImage = layers.join(', ')
  el.style.backgroundColor = s.colors.bg
  el.style.filter = s.image && s.image.blur > 0 ? `blur(${s.image.blur}px)` : ''
}

export function applyThemeToDom(id: string, s: ThemeSpec) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(s))) root.style.setProperty(k, v)
  root.setAttribute('data-theme', id)
  root.setAttribute('data-fc-scheme', s.scheme)
  root.style.colorScheme = s.scheme
  root.toggleAttribute('data-fc-outline', s.outline)
  root.toggleAttribute('data-fc-glass', isTranslucent(s) && s.blur > 0)
  root.toggleAttribute('data-fc-accent-grad', !!s.accent2)
  // Motif : sur le calque de fond s'il est visible (thème translucide), sinon sur la zone de discussion.
  const pattern = patternCss(s.pattern, triplet(s.colors.text), s.patternOpacity)
  if (pattern) {
    root.style.setProperty('--fc-pattern', pattern)
    root.setAttribute('data-fc-pattern', isTranslucent(s) ? 'backdrop' : 'surface')
  } else {
    root.style.removeProperty('--fc-pattern')
    root.removeAttribute('data-fc-pattern')
  }
  applyBackdrop(s)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.colors.sidebar)
}

export function applyLayoutToDom(l: LayoutPrefs) {
  const root = document.documentElement
  root.setAttribute('data-fc-members', l.members)
  root.setAttribute('data-fc-rail', l.rail)
  root.setAttribute('data-fc-composer', l.composer)
  root.setAttribute('data-fc-bubbles', l.bubbles)
  root.setAttribute('data-fc-chat-width', l.chatWidth)
  root.setAttribute('data-fc-scrollbars', l.scrollbars)
  root.style.setProperty('--fc-members-w', `${l.membersWidth}px`)
}
