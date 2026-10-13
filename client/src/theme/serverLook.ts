// Apparence des serveurs : style des en-têtes de catégorie (barre des salons) et réglages propres
// à un serveur (thème différent de celui de ForgeChat, style de catégorie). Synchronisé avec le
// compte dans /user/theme-studio, comme les thèmes perso : web, bureau et téléphone partagent tout.
// Même format que mobile/src/features/appearance/categoryLook.ts.
import { isHex, rgbOf } from './themeCore.ts'

/**
 * Formes des en-têtes de catégorie. auto = suit le thème (contour si le thème trace des bordures
 * fines, sinon texte simple). Chaque forme est une règle statique de index.css (.fc-cat) : aucune
 * valeur saisie n'entre dans le CSS, seulement ces identifiants, des couleurs #rrggbb et des nombres bornés.
 */
export const CATEGORY_SHAPES = [
  'auto', 'plain', 'outline', 'pill', 'card', 'bar', 'underline',
  'gradient', 'boxed', 'bracket', 'neon', 'smallcaps', 'divider', 'ribbon', 'banner', 'tag', 'chip',
  'outlined', 'shadow', 'dot', 'terminal', 'chiseled', 'glass', 'glow', 'double', 'dashed', 'stripes',
  'tab', 'fade', 'overline', 'highlight', 'arrow', 'slant', 'stamp',
] as const
export type CategoryShape = (typeof CATEGORY_SHAPES)[number]

/** Polices du titre (piles de polices système fixes, dans index.css). */
export const CATEGORY_FONTS = ['theme', 'sans', 'serif', 'mono', 'rounded', 'condensed', 'display', 'hand'] as const
export type CategoryFont = (typeof CATEGORY_FONTS)[number]
export const CATEGORY_WEIGHTS = ['regular', 'semibold', 'bold', 'black'] as const
export type CategoryWeight = (typeof CATEGORY_WEIGHTS)[number]
export const CATEGORY_ALIGNS = ['left', 'center', 'right'] as const
export type CategoryAlign = (typeof CATEGORY_ALIGNS)[number]
/** Flèche de repli : chevron (défaut), triangle plein, plus/moins, flèche, ou aucune. */
export const CATEGORY_ARROWS = ['chevron', 'caret', 'plus', 'arrow', 'none'] as const
export type CategoryArrow = (typeof CATEGORY_ARROWS)[number]

/** Icône devant le titre : symboles et emojis de cette liste uniquement. */
export const CATEGORY_ICONS = {
  none: '', hash: '#', dot: '•', star: '★', sparkle: '✦', diamond: '◆', heart: '♥', arrow: '➤', square: '■', triangle: '▲',
  fire: '🔥', bolt: '⚡', leaf: '🌿', moon: '🌙', sun: '☀️', music: '🎵', game: '🎮', crown: '👑', pin: '📌',
  folder: '📁', chat: '💬', rocket: '🚀', gem: '💎', book: '📚', art: '🎨', shield: '🛡️', tools: '🛠️', megaphone: '📣',
} as const
export type CategoryIcon = keyof typeof CATEGORY_ICONS
export const CATEGORY_ICON_IDS = Object.keys(CATEGORY_ICONS) as CategoryIcon[]

export const CATEGORY_SIZE_MIN = 9
export const CATEGORY_SIZE_MAX = 18
/** Espacement des lettres en centièmes d'em (0 à 0,3 em). */
export const CATEGORY_SPACING_MAX = 30

export interface CategoryStyle {
  shape: CategoryShape
  /** Couleur du style (contour, fond, barre) ; null = accent du thème. */
  color: string | null
  /** Seconde couleur (texte en dégradé, bandeaux) ; null = couleur des liens du thème. */
  color2: string | null
  uppercase: boolean
  font: CategoryFont
  weight: CategoryWeight
  /** Taille du titre (px). */
  size: number
  /** Espacement des lettres (centièmes d'em). */
  spacing: number
  align: CategoryAlign
  icon: CategoryIcon
  arrow: CategoryArrow
}

export const DEFAULT_CATEGORY: CategoryStyle = {
  shape: 'auto', color: null, color2: null, uppercase: true, font: 'theme', weight: 'semibold', size: 12, spacing: 3,
  align: 'left', icon: 'none', arrow: 'chevron',
}

/** Teintes proposées (plus une couleur libre). */
export const CATEGORY_SWATCHES = ['#5865f2', '#f97316', '#ef4444', '#eab308', '#22c55e', '#06b6d4', '#a855f7', '#ec4899', '#94a3b8'] as const

const oneOf = <T extends string>(v: unknown, values: readonly T[], def: T): T => (values.includes(v as T) ? (v as T) : def)
const intIn = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

/** Donnée quelconque → style valide (anciens styles à 3 champs : le reste prend les valeurs par défaut). */
export function sanitizeCategory(raw: unknown): CategoryStyle {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_CATEGORY
  return {
    shape: oneOf(v.shape, CATEGORY_SHAPES, d.shape),
    color: isHex(v.color) ? v.color.toLowerCase() : null,
    color2: isHex(v.color2) ? v.color2.toLowerCase() : null,
    uppercase: typeof v.uppercase === 'boolean' ? v.uppercase : d.uppercase,
    font: oneOf(v.font, CATEGORY_FONTS, d.font),
    weight: oneOf(v.weight, CATEGORY_WEIGHTS, d.weight),
    size: intIn(v.size, CATEGORY_SIZE_MIN, CATEGORY_SIZE_MAX, d.size),
    spacing: intIn(v.spacing, 0, CATEGORY_SPACING_MAX, d.spacing),
    align: oneOf(v.align, CATEGORY_ALIGNS, d.align),
    icon: oneOf(v.icon, CATEGORY_ICON_IDS, d.icon),
    arrow: oneOf(v.arrow, CATEGORY_ARROWS, d.arrow),
  }
}

/** Encre lisible (noir ou blanc) sur une couleur pleine : bandeaux, étiquettes. */
export function inkOn(hex: string): '#000000' | '#ffffff' {
  const [r, g, b] = rgbOf(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Contraste avec le blanc contre contraste avec le noir.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#000000'
}

/** Réglages d'un serveur pour cet utilisateur : absents = comme partout ailleurs. */
export interface ServerLook {
  /** Thème affiché dans ce serveur (préréglage ou thème perso). */
  theme?: string
  category?: CategoryStyle
}

const SERVER_ID_RE = /^[0-9a-f-]{36}$/i
const THEME_ID_RE = /^[a-z0-9-]{1,40}$/i
export const MAX_SERVER_LOOKS = 200

export function sanitizeServerLooks(raw: unknown): Record<string, ServerLook> {
  const out: Record<string, ServerLook> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_SERVER_LOOKS)) {
    if (!SERVER_ID_RE.test(id) || !v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const look: ServerLook = {}
    if (typeof o.theme === 'string' && THEME_ID_RE.test(o.theme)) look.theme = o.theme
    if (o.category) look.category = sanitizeCategory(o.category)
    if (look.theme || look.category) out[id.toLowerCase()] = look
  }
  return out
}

const triplet = (hex: string) => rgbOf(hex).join(' ')

/**
 * Variables CSS d'un style (couleurs converties en nombres, taille et espacement bornés). Posées sur
 * <html> pour la barre des salons, ou sur un aperçu (éditeur) qui les redéfinit pour lui seul.
 */
export function categoryVars(c: CategoryStyle, accent?: string, explicit = false): Record<string, string> {
  const vars: Record<string, string> = {
    '--fc-cat-size': `${Math.min(CATEGORY_SIZE_MAX, Math.max(CATEGORY_SIZE_MIN, Math.round(c.size)))}px`,
    '--fc-cat-ls': `${Math.min(CATEGORY_SPACING_MAX, Math.max(0, Math.round(c.spacing))) / 100}em`,
  }
  // Aperçu (explicit) : ne pas hériter des couleurs du style posé sur <html>.
  if (isHex(c.color)) vars['--fc-cat-rgb'] = triplet(c.color)
  else if (explicit) vars['--fc-cat-rgb'] = 'var(--fc-accent-rgb)'
  if (isHex(c.color2)) vars['--fc-cat2-rgb'] = triplet(c.color2)
  else if (explicit) vars['--fc-cat2-rgb'] = 'var(--fc-link-rgb)'
  const fill = isHex(c.color) ? c.color : isHex(accent) ? accent : null
  if (fill) vars['--fc-cat-ink'] = triplet(inkOn(fill))
  return vars
}

/** Attributs de l'en-tête (.fc-cat) lus par index.css : identifiants de listes uniquement. */
export function categoryAttrs(c: CategoryStyle) {
  return {
    'data-shape': c.shape,
    'data-font': c.font,
    'data-weight': c.weight,
    'data-align': c.align,
    'data-upper': String(c.uppercase),
  }
}

const VAR_KEYS = ['--fc-cat-rgb', '--fc-cat2-rgb', '--fc-cat-ink', '--fc-cat-size', '--fc-cat-ls']

/** Pose les variables du style affiché sur <html>. `accent` = accent du thème affiché (encre des bandeaux). */
export function applyCategoryToDom(c: CategoryStyle, accent?: string) {
  const root = document.documentElement
  const vars = categoryVars(c, accent)
  for (const k of VAR_KEYS) {
    const v = vars[k]
    if (v) root.style.setProperty(k, v)
    else root.style.removeProperty(k)
  }
}
