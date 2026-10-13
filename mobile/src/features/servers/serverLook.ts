// Apparence d'un serveur (servers.look, migration 135), version mobile : mêmes règles que le
// web (client/src/lib/serverAppearance.ts) et le serveur (server/src/models/server_look.rs).
// On n'applique ici que la bannière (cadrage, hauteur, voile), l'accent, la forme de l'icône,
// la couleur des non-lus et les fonds (liste des salons, messages). Les couleurs viennent
// d'entiers 0xRRGGBB ; les images seulement de nos propres envois (/uploads/server-banners/).

export const BANNER_HEIGHTS = ['auto', 'full', 'compact'] as const
export const BANNER_OVERLAYS = ['none', 'bottom', 'top', 'full', 'vignette', 'accent'] as const
export const BG_KINDS = ['none', 'color', 'gradient', 'pattern', 'image'] as const
export const ICON_SHAPES = ['circle', 'squircle', 'square', 'hexagon'] as const
export const BLUR_MAX = 24
const IMAGE_RE = /^\/uploads\/server-banners\/[A-Za-z0-9_-]{1,64}\.(png|jpg|gif|webp)$/

export type BannerHeight = (typeof BANNER_HEIGHTS)[number]
export type BannerOverlay = (typeof BANNER_OVERLAYS)[number]
export type IconShape = (typeof ICON_SHAPES)[number]

export interface BannerLook {
  focus_x: number
  focus_y: number
  height: BannerHeight
  overlay: BannerOverlay
  overlay_strength: number
}

export interface LookBackground {
  kind: 'color' | 'gradient' | 'pattern' | 'image'
  color?: number
  color2?: number
  image?: string
  opacity: number
  blur: number
}

export interface ServerLook {
  banner?: BannerLook
  accent?: number
  accent2?: number
  sidebar_bg?: LookBackground
  message_bg?: LookBackground
  icon_shape?: IconShape
  unread_color?: number
  enforce?: boolean
}

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
  const bg: LookBackground = { kind, opacity: clamp(raw.opacity, 0, 100, 100), blur: kind === 'image' ? clamp(raw.blur, 0, BLUR_MAX, 0) : 0 }
  if (kind === 'image') {
    if (!validImageRef(raw.image)) return undefined
    bg.image = raw.image
    return bg
  }
  if (!isColor(raw.color)) return undefined
  bg.color = raw.color
  if (kind === 'gradient' && !isColor(raw.color2)) return undefined
  if (isColor(raw.color2)) bg.color2 = raw.color2
  return bg
}

/** Apparence nettoyée (liste blanche, bornes) ; null = apparence par défaut. */
export function cleanLook(raw: unknown): ServerLook | null {
  if (!isObj(raw)) return null
  const out: ServerLook = {}
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
  const shape = pick(ICON_SHAPES, raw.icon_shape)
  if (shape && shape !== 'circle') out.icon_shape = shape
  if (isColor(raw.unread_color)) out.unread_color = raw.unread_color
  if (raw.enforce === true) out.enforce = true
  const { enforce: _e, ...rest } = out
  return Object.keys(rest).length ? out : null
}

export const hex = (c: number) => '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0')

/** Bornes de hauteur de la bannière (dp) selon le mode choisi. */
export function bannerBounds(b: BannerLook | undefined): { min: number; max: number } {
  switch (b?.height) {
    case 'compact': return { min: 48, max: 110 }
    case 'full': return { min: 80, max: 360 }
    default: return { min: 64, max: 220 }
  }
}

/** Voile de la bannière : couleur et opacité (pas de dégradé natif sans module dédié). */
export function bannerOverlay(b: BannerLook | undefined, accent?: number): { color: string; opacity: number; at: 'bottom' | 'top' | 'full' } | null {
  const s = b ?? { overlay: 'bottom' as BannerOverlay, overlay_strength: 60 }
  const a = s.overlay_strength / 100
  switch (s.overlay) {
    case 'none': return null
    case 'top': return { color: '#000000', opacity: 0.6 * a, at: 'top' }
    case 'full': case 'vignette': return { color: '#000000', opacity: 0.45 * a, at: 'full' }
    case 'accent': return { color: hex(accent ?? 0x5865f2), opacity: 0.6 * a, at: 'bottom' }
    default: return { color: '#000000', opacity: 0.6 * a, at: 'bottom' }
  }
}

/** Rayon de l'icône (dp) selon la forme ; l'hexagone, impossible sans découpage, devient un carré arrondi. */
export function iconRadius(shape: IconShape | undefined, size: number): number {
  switch (shape) {
    case 'squircle': case 'hexagon': return size * 0.3
    case 'square': return size * 0.12
    default: return size / 2
  }
}
