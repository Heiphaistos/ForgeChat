/**
 * Style du pseudo (gratuit) : fonctions pures, mêmes règles que le web.
 * Le serveur (models/profile_style.rs) ne renvoie que des couleurs 0xRRGGBB et des identifiants
 * en liste blanche ; tout le rendu est décidé ici. Testé dans __tests__/name-style.test.ts.
 */

export const NAME_EFFECTS = [
  '', 'shimmer', 'glow', 'outline', 'neon', 'rainbow', 'wave', 'glitch', 'shadow3d',
  'fire', 'frost', 'pulse', 'holo', 'chrome', 'retro', 'float', 'sparkle',
  'glow2', 'flicker', 'huecycle', 'electric', 'bounce', 'typewriter', 'breathe', 'gold',
  'aurora', 'matrix', 'draw', 'longshadow', 'vaporwave', 'gradshift', 'jelly', 'shake',
  'blurin', 'scanline', 'emboss', 'letterpress', 'comic', 'stencil', 'smoke', 'stars',
  'candy', 'pixel', 'galaxy', 'lava', 'toxic', 'ghost', 'heartbeat',
] as const
export const NAME_FONTS = [
  '', 'serif', 'mono', 'rounded', 'heavy', 'cursive', 'slab', 'condensed', 'wide', 'elegant',
  'typewriter', 'gothic', 'comic', 'impact', 'smallcaps', 'light', 'handwritten', 'futuristic',
  'retro', 'stencil', 'code', 'italic',
  'arial', 'times', 'courier', 'cambria', 'calibri', 'display', 'inter', 'interthin',
  'jetbrains', 'georgia', 'palatino', 'garamond', 'baskerville', 'bodoni', 'optima', 'futura',
  'century', 'verdana', 'tahoma', 'trebuchet', 'gill', 'helvetica', 'avenir', 'copperplate',
  'papyrus', 'marker', 'chalk', 'brush', 'calligraphy', 'console', 'arialblack', 'franklin',
  'bookman', 'segoe', 'hoefler', 'candara', 'cascadia', 'lucida', 'caps', 'spaced', 'tight',
  'serifcaps', 'monocaps', 'lower',
] as const
/** Type de dégradé ('' = linéaire). Sur mobile, le dégradé suit le nom lettre par lettre. */
export const NAME_GRADIENTS = ['', 'radial', 'conic', 'flow'] as const
/** Style du contour ('' = trait simple). */
export const OUTLINE_STYLES = ['', 'double', 'glow'] as const
/** Fonds d'une marque de clan (étiquette perso ou tag de serveur). */
export const TAG_BADGES = ['', 'solid', 'soft', 'outline', 'gradient', 'glass', 'pill', 'neon', 'plain'] as const
/** Icônes d'une marque : identifiants traduits en glyphes par components/ClanTag.tsx. */
export const TAG_ICONS = [
  '', 'star', 'crown', 'shield', 'flame', 'bolt', 'heart', 'skull', 'leaf', 'diamond',
  'moon', 'sword', 'gem', 'paw', 'music', 'gamepad',
] as const
/** Couleurs d'un pseudo : 1 = unie, 2 à NAME_COLORS_MAX = dégradé (comme le serveur). */
export const NAME_COLORS_MAX = 5
/** Épaisseur maximale du contour du pseudo (px), comme le serveur. */
export const OUTLINE_WIDTH_MAX = 6
/** Intensité et vitesse de l'effet : 1 à LEVEL_MAX, LEVEL_DEFAULT = normal. */
export const LEVEL_MAX = 10
export const LEVEL_DEFAULT = 5
export type NameEffect = (typeof NAME_EFFECTS)[number]
export type NameFont = (typeof NAME_FONTS)[number]
export type NameGradient = (typeof NAME_GRADIENTS)[number]
export type OutlineStyle = (typeof OUTLINE_STYLES)[number]
export type TagBadge = (typeof TAG_BADGES)[number]
export type TagIcon = (typeof TAG_ICONS)[number]

/** Style d'une marque de clan : `color` seulement pour l'étiquette perso. */
export interface TagStyle {
  color?: number
  color2?: number
  font?: NameFont
  badge?: TagBadge
  icon?: TagIcon
}

/** Tag de clan d'un serveur, tel que renvoyé avec les membres. */
export interface MemberClanTag {
  id: string
  name: string
  color: number
  style?: unknown
}

export interface NameStyle {
  /** 0 = couleur par défaut, 1 = unie, 2 à NAME_COLORS_MAX = dégradé. */
  colors: number[]
  /** Angle du dégradé (web) ; ignoré sur mobile : le dégradé suit le nom, caractère par caractère. */
  angle?: number
  /** Type de dégradé (web) ; sur mobile, le dégradé suit le nom. */
  gradient?: NameGradient
  effect?: NameEffect | (string & {})
  /** Intensité de l'effet (1-10, 5 par défaut) : force de l'ombre sur mobile. */
  intensity?: number
  /** Vitesse de l'animation (1-10) : animations du web seulement. */
  speed?: number
  font?: NameFont | (string & {})
  /** Couleur du contour (0xRRGGBB), seulement si `outline_width` > 0. */
  outline?: number
  /** Épaisseur du contour en px (0 à OUTLINE_WIDTH_MAX). */
  outline_width?: number
  /** Style du contour (OUTLINE_STYLES). */
  outline_style?: OutlineStyle
  /** Trait extérieur du contour double (0xRRGGBB). */
  outline2?: number
  /** Style de l'étiquette perso. */
  tag?: TagStyle
}

/** Ce que GET /users/styles et UserPublic portent pour afficher un pseudo. */
export interface NameInfo {
  username: string
  display_name?: string | null
  name_style?: NameStyle | null
  profile_tag?: string | null
}

/** Rendu final : couleurs « #rrggbb » déjà lisibles sur le fond, effet et police. */
export interface ResolvedName {
  colors: string[]
  effect: string
  font: string
  /** Intensité de l'effet (1-10), seulement si différente de LEVEL_DEFAULT. */
  intensity?: number
  /** Contour choisi (« #rrggbb », épaisseur 1-6, style, couleur extérieure du contour double). */
  outline?: { color: string; width: number; style?: 'double' | 'glow'; color2?: string }
}

/** Effets qui imposent leur palette (comme le web) : couleurs choisies ignorées. */
export const EFFECT_PALETTES: Partial<Record<string, number[]>> = {
  rainbow: [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de],
  holo: [0xff9ff3, 0xa0e7ff, 0xc4ffb5, 0xfff3a0, 0xd0a8ff],
  fire: [0xffb300, 0xff6d00, 0xff3d00],
  frost: [0xffffff, 0x7fd3ff, 0xbdeeff],
  chrome: [0xffffff, 0x9aa4ae, 0xe9eef2, 0x7d8894],
  gold: [0xfff1b8, 0xf5c542, 0xc9971c, 0xffe27a],
  aurora: [0x7cffcb, 0x4fd1ff, 0xa77bff, 0xff7ad9],
  matrix: [0xd9ffe0, 0x00ff66, 0x00b347],
  vaporwave: [0xff71ce, 0x01cdfe, 0xb967ff, 0xfffb96],
  electric: [0xffffff, 0x7df9ff, 0x4dabff],
  galaxy: [0x8ef6ff, 0xa78bfa, 0xff7ad9, 0x7c9dff],
  lava: [0xffd000, 0xff8c00, 0xff3b00],
  toxic: [0xeaff00, 0x7dff00, 0x39ff14],
}

const isColor = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff
const inList = <T extends string>(list: readonly T[], v: unknown): T => ((list as readonly unknown[]).includes(v ?? '') ? ((v ?? '') as T) : ('' as T))
/** Niveau 1-10 (intensité, vitesse) ; absent ou invalide → LEVEL_DEFAULT. */
export const level = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(LEVEL_MAX, Math.max(1, Math.round(v))) : LEVEL_DEFAULT

/** Style de marque valide et non vide ? (même règle que le serveur). */
export function cleanTagStyle(s: unknown): TagStyle | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  const out: TagStyle = {}
  if (isColor(o.color)) out.color = o.color
  if (isColor(o.color2)) out.color2 = o.color2
  const font = inList(NAME_FONTS, o.font)
  const badge = inList(TAG_BADGES, o.badge)
  const icon = inList(TAG_ICONS, o.icon)
  if (font) out.font = font
  if (badge) out.badge = badge
  if (icon) out.icon = icon
  return Object.keys(out).length ? out : null
}

/**
 * Style reçu nettoyé (garde contre un cache ancien ou une valeur inattendue) : identifiants
 * en liste blanche, couleurs 0xRRGGBB, nombres bornés ; null = aucun style.
 */
export function cleanNameStyle(s: unknown): NameStyle | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Record<string, unknown>
  const colors = Array.isArray(o.colors) ? o.colors.filter(isColor).slice(0, NAME_COLORS_MAX) : []
  const effect = inList(NAME_EFFECTS, o.effect)
  const font = inList(NAME_FONTS, o.font)
  const angle = typeof o.angle === 'number' && Number.isFinite(o.angle) ? Math.min(360, Math.max(0, o.angle)) : 90
  const width = Number.isInteger(o.outline_width) ? Math.min(OUTLINE_WIDTH_MAX, Math.max(0, o.outline_width as number)) : 0
  const tag = cleanTagStyle(o.tag)
  if (!colors.length && !effect && !font && !width && !tag) return null
  const out: NameStyle = { colors, angle, effect, font }
  // Mêmes normalisations que le serveur : dégradé avec 2 couleurs, réglages avec un effet.
  const gradient = colors.length > 1 ? inList(NAME_GRADIENTS, o.gradient) : ''
  if (gradient) out.gradient = gradient
  if (effect) {
    const [intensity, speed] = [level(o.intensity), level(o.speed)]
    if (intensity !== LEVEL_DEFAULT) out.intensity = intensity
    if (speed !== LEVEL_DEFAULT) out.speed = speed
  }
  if (width) {
    out.outline_width = width
    out.outline = isColor(o.outline) ? o.outline : 0
    const os = inList(OUTLINE_STYLES, o.outline_style)
    if (os) out.outline_style = os
    if (os === 'double') out.outline2 = isColor(o.outline2) ? o.outline2 : 0xffffff
  }
  if (tag) out.tag = tag
  return out
}

export const DEFAULT_BG = 0x1e1f22
const MIN_CONTRAST = 3

export const toHex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`

/** « #rrggbb », « rrggbb » ou « #rgb » → entier ; null si invalide. */
export function parseHex(input: string | null | undefined): number | null {
  const s = (input ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) return parseInt(s.replace(/./g, (ch) => ch + ch), 16)
  return /^[0-9a-f]{6}$/i.test(s) ? parseInt(s, 16) : null
}

const channels = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const

function luminance(c: number): number {
  const [r, g, b] = channels(c).map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Ratio de contraste WCAG (1 à 21). */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Mélange linéaire de deux couleurs (t = 0 → a, 1 → b). */
export function mix(a: number, b: number, t: number): number {
  const ca = channels(a)
  const cb = channels(b)
  const [r, g, bl] = ca.map((v, i) => Math.round(v + (cb[i]! - v) * t))
  return (r! << 16) | (g! << 8) | bl!
}

/**
 * Couleur lisible sur `bg` : mélangée vers le blanc par pas de 10 % jusqu'à un contraste ≥ 3.
 * Sur un fond clair (thème clair), le mélange se fait vers le noir.
 */
export function ensureContrast(color: number, bg = DEFAULT_BG): number {
  const target = luminance(bg) > 0.4 ? 0x000000 : 0xffffff
  for (let step = 0; step <= 10; step++) {
    const c = mix(color, target, step / 10)
    if (contrastRatio(c, bg) >= MIN_CONTRAST) return c
  }
  return target
}

/** Une couleur par caractère, interpolée le long du nom (dégradé sans dépendance). */
export function gradientChars(text: string, colors: string[]): { ch: string; color: string }[] {
  const chars = Array.from(text)
  const stops = colors.map((c) => parseHex(c) ?? 0xffffff)
  if (stops.length < 2) return chars.map((ch) => ({ ch, color: colors[0] ?? '' }))
  return chars.map((ch, i) => {
    const pos = chars.length > 1 ? (i / (chars.length - 1)) * (stops.length - 1) : 0
    const k = Math.min(Math.floor(pos), stops.length - 2)
    return { ch, color: toHex(mix(stops[k]!, stops[k + 1]!, pos - k)) }
  })
}

/** Nom affiché : surnom de serveur > nom d'affichage > pseudo. */
export function displayNameOf(info: { username: string; display_name?: string | null }, nickname?: string | null): string {
  return nickname?.trim() || info.display_name?.trim() || info.username
}

/**
 * Priorité des couleurs. En serveur, si le membre a un rôle coloré et que le serveur laisse
 * la couleur des rôles gagner (`roleOverrides !== false`) : couleur du rôle, police perso
 * gardée, effet retiré. Sinon le style perso, sinon la couleur du rôle, sinon rien (défaut).
 */
export function resolveNameStyle({
  style,
  roleColor,
  roleOverrides,
  bg = DEFAULT_BG,
}: {
  style?: NameStyle | null
  /** « #rrggbb » ou entier ; seulement dans un contexte serveur. */
  roleColor?: string | number | null
  roleOverrides?: boolean
  bg?: number
}): ResolvedName | null {
  const role = typeof roleColor === 'number' ? roleColor || null : parseHex(roleColor)
  const font = typeof style?.font === 'string' ? style.font : ''
  const own = (style?.colors ?? []).filter(isColor).slice(0, NAME_COLORS_MAX)
  const fit = (cs: number[]) => cs.map((c) => toHex(ensureContrast(c, bg)))
  const w = Number.isInteger(style?.outline_width) ? Math.min(OUTLINE_WIDTH_MAX, Math.max(0, style!.outline_width!)) : 0
  // Police et contour perso gardés même quand la couleur du rôle passe devant (comme le web).
  const os = inList(OUTLINE_STYLES, style?.outline_style)
  const outline: Pick<ResolvedName, 'outline'> = w > 0
    ? {
        outline: {
          color: toHex(isColor(style?.outline) ? style!.outline! : 0),
          width: w,
          ...(os ? { style: os } : {}),
          ...(os === 'double' ? { color2: toHex(isColor(style?.outline2) ? style!.outline2! : 0xffffff) } : {}),
        },
      }
    : {}
  if (role != null && roleOverrides !== false) return { colors: fit([role]), effect: '', font, ...outline }
  const effect = typeof style?.effect === 'string' ? style.effect : ''
  const palette = EFFECT_PALETTES[effect]
  const cs = palette ?? (own.length ? own : role != null ? [role] : [])
  if (!cs.length && !effect && !font && !w) return null
  const intensity = effect ? level(style?.intensity) : LEVEL_DEFAULT
  return { colors: palette ? palette.map(toHex) : fit(cs), effect, font, ...(intensity !== LEVEL_DEFAULT ? { intensity } : {}), ...outline }
}
