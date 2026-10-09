// Apparence des serveurs : style des en-têtes de catégorie (barre des salons) et réglages propres
// à un serveur (thème différent de celui de ForgeChat, style de catégorie). Synchronisé avec le
// compte dans /user/theme-studio, comme les thèmes perso : web, bureau et téléphone partagent tout.
import { isHex } from './themeCore'

/** auto = suit le thème (contour si le thème trace des bordures fines, sinon texte simple). */
export const CATEGORY_SHAPES = ['auto', 'plain', 'outline', 'pill', 'card', 'bar', 'underline'] as const
export type CategoryShape = (typeof CATEGORY_SHAPES)[number]

export interface CategoryStyle {
  shape: CategoryShape
  /** Couleur du style (contour, fond, barre) ; null = accent du thème. */
  color: string | null
  uppercase: boolean
}

export const DEFAULT_CATEGORY: CategoryStyle = { shape: 'auto', color: null, uppercase: true }

/** Teintes proposées (plus une couleur libre). */
export const CATEGORY_SWATCHES = ['#5865f2', '#f97316', '#ef4444', '#eab308', '#22c55e', '#06b6d4', '#a855f7', '#ec4899', '#94a3b8'] as const

export function sanitizeCategory(raw: unknown): CategoryStyle {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    shape: CATEGORY_SHAPES.includes(v.shape as CategoryShape) ? (v.shape as CategoryShape) : DEFAULT_CATEGORY.shape,
    color: isHex(v.color) ? v.color.toLowerCase() : null,
    uppercase: typeof v.uppercase === 'boolean' ? v.uppercase : DEFAULT_CATEGORY.uppercase,
  }
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

/** Pose le style de catégorie sur <html> (lu par index.css : .fc-cat). */
export function applyCategoryToDom(c: CategoryStyle) {
  const root = document.documentElement
  root.setAttribute('data-fc-cat', c.shape)
  root.toggleAttribute('data-fc-cat-upper', c.uppercase)
  if (c.color) {
    const n = parseInt(c.color.slice(1), 16)
    root.style.setProperty('--fc-cat-rgb', `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`)
  } else root.style.removeProperty('--fc-cat-rgb')
}
