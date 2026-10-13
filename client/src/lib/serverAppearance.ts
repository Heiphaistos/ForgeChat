// Apparence d'un serveur choisie par son propriétaire (colonne servers.look, migration 135),
// vue par tous les membres : bannière, accents, fonds, nom, icône, accueil, non-lus, rôles.
// Le serveur valide tout (server/src/models/server_look.rs) ; ici on revérifie (cache ancien)
// et on traduit des identifiants et des nombres en styles. Aucun texte venu d'un utilisateur
// n'arrive dans du CSS : couleurs « #rrggbb » tirées d'entiers, valeurs écrites ici. Les images
// ne passent jamais par url() : elles sont affichées par <img> (mediaUrl, voir LookBackdrop).
// Testé par scripts/serverAppearance.test.mjs ; le mobile applique les mêmes règles
// (mobile/src/features/servers/serverLook.ts).
import { NAME_EFFECTS, NAME_FONTS, hex } from './nameStyle.ts'

export const BANNER_HEIGHTS = ['auto', 'full', 'compact'] as const
export const BANNER_OVERLAYS = ['none', 'bottom', 'top', 'full', 'vignette', 'accent'] as const
export const BG_KINDS = ['none', 'color', 'gradient', 'pattern', 'image'] as const
export const BG_PATTERNS = ['dots', 'grid', 'diagonal', 'checker', 'cross', 'waves', 'zigzag', 'stripes'] as const
export const ICON_SHAPES = ['circle', 'squircle', 'square', 'hexagon'] as const
export const ICON_RINGS = ['none', 'solid', 'glow'] as const
export const WELCOME_STYLES = ['classic', 'centered', 'card', 'minimal'] as const
export const ROLE_DISPLAYS = ['name', 'dot', 'badge'] as const
export const BLUR_MAX = 24
/** Images de fond : seulement nos propres envois (POST /servers/:id/look/image). */
const IMAGE_RE = /^\/uploads\/server-banners\/[A-Za-z0-9_-]{1,64}\.(png|jpg|gif|webp)$/

export type BannerHeight = (typeof BANNER_HEIGHTS)[number]
export type BannerOverlay = (typeof BANNER_OVERLAYS)[number]
export type BgKind = (typeof BG_KINDS)[number]
export type BgPattern = (typeof BG_PATTERNS)[number]
export type IconShape = (typeof ICON_SHAPES)[number]
export type IconRing = (typeof ICON_RINGS)[number]
export type WelcomeStyle = (typeof WELCOME_STYLES)[number]
export type RoleDisplay = (typeof ROLE_DISPLAYS)[number]

export interface BannerLook {
  focus_x: number
  focus_y: number
  height: BannerHeight
  overlay: BannerOverlay
  overlay_strength: number
}

export interface LookBackground {
  kind: Exclude<BgKind, 'none'>
  color?: number
  color2?: number
  angle: number
  pattern?: BgPattern
  image?: string
  opacity: number
  blur: number
}

export interface NameLook {
  colors: number[]
  angle: number
  font?: string
  effect?: string
}

export interface ServerAppearance {
  banner?: BannerLook
  accent?: number
  accent2?: number
  sidebar_bg?: LookBackground
  message_bg?: LookBackground
  name?: NameLook
  icon_shape?: IconShape
  icon_ring?: IconRing
  icon_ring_color?: number
  welcome?: WelcomeStyle
  unread_color?: number
  role_display?: RoleDisplay
  enforce?: boolean
}

export const DEFAULT_BANNER: BannerLook = { focus_x: 50, focus_y: 50, height: 'auto', overlay: 'bottom', overlay_strength: 60 }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
export const isColor = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffff
const clamp = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def
function pick<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined
}

export const validImageRef = (s: unknown): s is string => typeof s === 'string' && IMAGE_RE.test(s)

function cleanBackground(raw: unknown): LookBackground | undefined {
  if (!isObj(raw)) return undefined
  const kind = pick(BG_KINDS, raw.kind)
  if (!kind || kind === 'none') return undefined
  const bg: LookBackground = {
    kind,
    angle: clamp(raw.angle, 0, 360, 135),
    opacity: clamp(raw.opacity, 0, 100, 100),
    blur: kind === 'image' ? clamp(raw.blur, 0, BLUR_MAX, 0) : 0,
  }
  if (kind === 'image') {
    if (!validImageRef(raw.image)) return undefined
    bg.image = raw.image
    return bg
  }
  if (!isColor(raw.color)) return undefined
  bg.color = raw.color
  if (kind === 'gradient') {
    if (!isColor(raw.color2)) return undefined
    bg.color2 = raw.color2
  }
  if (kind === 'pattern') {
    const p = pick(BG_PATTERNS, raw.pattern)
    if (!p) return undefined
    bg.pattern = p
    if (isColor(raw.color2)) bg.color2 = raw.color2
  }
  return bg
}

/** Apparence nettoyée (liste blanche, bornes) ; null = apparence par défaut. */
export function cleanAppearance(raw: unknown): ServerAppearance | null {
  if (!isObj(raw)) return null
  const out: ServerAppearance = {}
  if (isObj(raw.banner)) {
    const b = raw.banner
    out.banner = {
      focus_x: clamp(b.focus_x, 0, 100, 50),
      focus_y: clamp(b.focus_y, 0, 100, 50),
      height: pick(BANNER_HEIGHTS, b.height) ?? 'auto',
      overlay: pick(BANNER_OVERLAYS, b.overlay) ?? 'bottom',
      overlay_strength: clamp(b.overlay_strength, 0, 100, 60),
    }
  }
  if (isColor(raw.accent)) {
    out.accent = raw.accent
    if (isColor(raw.accent2)) out.accent2 = raw.accent2
  }
  const sb = cleanBackground(raw.sidebar_bg)
  if (sb) out.sidebar_bg = sb
  const mb = cleanBackground(raw.message_bg)
  if (mb) out.message_bg = mb
  if (isObj(raw.name)) {
    const n = raw.name
    const colors = Array.isArray(n.colors) ? n.colors.filter(isColor).slice(0, 3) : []
    const font = pick(NAME_FONTS, n.font) || undefined
    const effect = pick(NAME_EFFECTS, n.effect) || undefined
    if (colors.length || font || effect) out.name = { colors, angle: clamp(n.angle, 0, 360, 90), font, effect }
  }
  const shape = pick(ICON_SHAPES, raw.icon_shape)
  if (shape && shape !== 'circle') out.icon_shape = shape
  const ring = pick(ICON_RINGS, raw.icon_ring)
  if (ring && ring !== 'none') {
    out.icon_ring = ring
    if (isColor(raw.icon_ring_color)) out.icon_ring_color = raw.icon_ring_color
  }
  const welcome = pick(WELCOME_STYLES, raw.welcome)
  if (welcome && welcome !== 'classic') out.welcome = welcome
  if (isColor(raw.unread_color)) out.unread_color = raw.unread_color
  const role = pick(ROLE_DISPLAYS, raw.role_display)
  if (role && role !== 'name') out.role_display = role
  if (raw.enforce === true) out.enforce = true
  const { enforce: _e, ...rest } = out
  return Object.keys(rest).length ? out : null
}

/** Apparence appliquée chez ce membre : ignorée s'il l'a refusée et que le serveur ne l'impose pas. */
export function effectiveAppearance(look: ServerAppearance | null, optedOut: boolean): ServerAppearance | null {
  if (!look) return null
  return optedOut && !look.enforce ? null : look
}

// ─── Traduction en styles (valeurs écrites ici + couleurs tirées d'entiers) ─────────

export const rgbTriplet = (c: number) => `${(c >> 16) & 255} ${(c >> 8) & 255} ${c & 255}`
const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${Math.min(1, Math.max(0, a)).toFixed(2)})`

export type Css = Record<string, string | number | undefined>

/** Variables CSS d'accent pour un sous-arbre (lu par tailwind : bg-fc-accent, text-fc-accent…). */
export function accentVars(look: ServerAppearance | null): Css | undefined {
  if (!look || look.accent == null) return undefined
  return { '--fc-accent-rgb': rgbTriplet(look.accent) }
}

/** Dégradé d'accent (accent → second accent), ou la couleur unie. */
export function accentFill(look: ServerAppearance | null): string | undefined {
  if (!look || look.accent == null) return undefined
  return look.accent2 != null ? `linear-gradient(135deg, ${hex(look.accent)}, ${hex(look.accent2)})` : hex(look.accent)
}

/** Motifs : gradients écrits ici, seule la couleur (entier) varie. */
export function patternCss(pattern: BgPattern, color: number, color2?: number): Css {
  const c = rgba(color, 0.9)
  const base = color2 != null ? hex(color2) : 'transparent'
  switch (pattern) {
    case 'dots': return { backgroundColor: base, backgroundImage: `radial-gradient(${c} 1.5px, transparent 1.6px)`, backgroundSize: '18px 18px' }
    case 'grid': return { backgroundColor: base, backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, backgroundSize: '24px 24px' }
    case 'diagonal': return { backgroundColor: base, backgroundImage: `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 14px)` }
    case 'stripes': return { backgroundColor: base, backgroundImage: `repeating-linear-gradient(90deg, ${c} 0 6px, transparent 6px 18px)` }
    case 'checker': return { backgroundColor: base, backgroundImage: `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0)`, backgroundSize: '24px 24px' }
    case 'cross': return { backgroundColor: base, backgroundImage: `radial-gradient(circle, transparent 20%, ${base} 21%, ${base} 79%, transparent 80%), linear-gradient(${c} 2px, transparent 2px), linear-gradient(90deg, ${c} 2px, transparent 2px)`, backgroundSize: '22px 22px' }
    case 'waves': return { backgroundColor: base, backgroundImage: `radial-gradient(circle at 50% 100%, transparent 9px, ${c} 10px, ${c} 11px, transparent 12px)`, backgroundSize: '24px 12px' }
    case 'zigzag': return { backgroundColor: base, backgroundImage: `linear-gradient(135deg, ${c} 25%, transparent 25%), linear-gradient(225deg, ${c} 25%, transparent 25%)`, backgroundSize: '20px 20px', backgroundPosition: '0 0, 10px 0' }
  }
}

/** Calque de fond hors image (couleur, dégradé, motif) ; l'image passe par <img> (LookBackdrop). */
export function backgroundCss(bg: LookBackground): Css {
  const opacity = bg.opacity / 100
  if (bg.kind === 'color' && bg.color != null) return { backgroundColor: hex(bg.color), opacity }
  if (bg.kind === 'gradient' && bg.color != null && bg.color2 != null)
    return { backgroundImage: `linear-gradient(${bg.angle}deg, ${hex(bg.color)}, ${hex(bg.color2)})`, opacity }
  if (bg.kind === 'pattern' && bg.pattern && bg.color != null) return { ...patternCss(bg.pattern, bg.color, bg.color2), opacity }
  return { opacity }
}

/** Voile posé sur la bannière (lisibilité du nom du serveur). */
export function bannerOverlayCss(b: BannerLook | undefined, accent?: number): Css | undefined {
  const s = b ?? DEFAULT_BANNER
  const a = s.overlay_strength / 100
  switch (s.overlay) {
    case 'none': return undefined
    case 'top': return { backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,${(0.85 * a).toFixed(2)}), transparent 65%)` }
    case 'full': return { backgroundColor: `rgba(0,0,0,${(0.6 * a).toFixed(2)})` }
    case 'vignette': return { backgroundImage: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${(0.9 * a).toFixed(2)}) 100%)` }
    case 'accent': return { backgroundImage: `linear-gradient(to top, ${rgba(accent ?? 0x5865f2, 0.9 * a)}, transparent 75%)` }
    default: return { backgroundImage: `linear-gradient(to top, rgba(0,0,0,${(0.85 * a).toFixed(2)}), transparent 65%)` }
  }
}

/** Bornes de hauteur de la bannière du serveur (px) selon le mode choisi. */
export function bannerBounds(b: BannerLook | undefined): { min: number; max: number } {
  switch (b?.height) {
    case 'compact': return { min: 40, max: 96 }
    case 'full': return { min: 64, max: 360 }
    default: return { min: 56, max: 200 }
  }
}

/** Point d'ancrage de l'image entière dans son cadre (object-position, en %). */
export const bannerFocus = (b: BannerLook | undefined) => `${b?.focus_x ?? 50}% ${b?.focus_y ?? 50}%`

const HEXAGON = 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)'

/** Forme de l'icône du serveur : classe d'arrondi, plus un découpage pour l'hexagone. */
export function iconShape(shape: IconShape | undefined): { className: string; style?: Css } {
  switch (shape) {
    case 'squircle': return { className: 'rounded-[30%]' }
    case 'square': return { className: 'rounded-md' }
    case 'hexagon': return { className: 'rounded-none', style: { clipPath: HEXAGON } }
    default: return { className: 'rounded-full' }
  }
}

/** Anneau ou lueur autour de l'icône : filtre posé sur un conteneur (suit aussi l'hexagone). */
export function iconRingCss(look: ServerAppearance | null): Css | undefined {
  if (!look?.icon_ring || look.icon_ring === 'none') return undefined
  const c = hex(look.icon_ring_color ?? look.accent ?? 0x5865f2)
  return look.icon_ring === 'glow'
    ? { filter: `drop-shadow(0 0 4px ${c}) drop-shadow(0 0 8px ${c})` }
    : { filter: `drop-shadow(0 0 0.5px ${c}) drop-shadow(0 0 0.5px ${c}) drop-shadow(0 0 0.5px ${c}) drop-shadow(0 0 0.5px ${c})` }
}

// ─── Refus par membre (appareil) ─────────────────────────────────────────────────────

const OPT_KEY = 'fc.serverLookOff'
export const OPT_EVENT = 'fc-server-look-off'

/** Copie en mémoire : le réglage tient la session même si le stockage est bloqué. */
let memory: string[] | null = null

function readOptOuts(): string[] {
  if (memory) return memory
  try {
    const v = JSON.parse(localStorage.getItem(OPT_KEY) ?? '[]')
    memory = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []
  } catch {
    memory = []
  }
  return memory
}

/** Le membre a choisi de ne pas voir l'apparence de ce serveur (si elle n'est pas imposée). */
export function isOptedOut(serverId: string | undefined): boolean {
  return !!serverId && readOptOuts().includes(serverId)
}

export function setOptedOut(serverId: string, off: boolean) {
  const list = readOptOuts().filter(id => id !== serverId)
  if (off) list.push(serverId)
  memory = list
  try { localStorage.setItem(OPT_KEY, JSON.stringify(list)) } catch { /* stockage bloqué : réglage gardé pour la session */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPT_EVENT))
}
