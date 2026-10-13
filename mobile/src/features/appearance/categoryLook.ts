// Style des en-têtes de catégorie choisi sur le web ou le bureau (Apparence → Disposition, ou
// « Apparence de ce serveur »), lu dans /user/theme-studio et traduit en styles natifs.
// Même format que client/src/theme/serverLook.ts (formes, polices, icônes : mêmes listes fermées).
import type { TextStyle, ViewStyle } from 'react-native'
import { colors } from '@/theme'

const SHAPES = [
  'auto', 'plain', 'outline', 'pill', 'card', 'bar', 'underline',
  'gradient', 'boxed', 'bracket', 'neon', 'smallcaps', 'divider', 'ribbon', 'banner', 'tag', 'chip',
  'outlined', 'shadow', 'dot', 'terminal', 'chiseled', 'glass', 'glow', 'double', 'dashed', 'stripes',
  'tab', 'fade', 'overline', 'highlight', 'arrow', 'slant', 'stamp',
] as const
type Shape = (typeof SHAPES)[number]
const FONTS = ['theme', 'sans', 'serif', 'mono', 'rounded', 'condensed', 'display', 'hand'] as const
const WEIGHTS = ['regular', 'semibold', 'bold', 'black'] as const
const ALIGNS = ['left', 'center', 'right'] as const
const ARROWS = ['chevron', 'caret', 'plus', 'arrow', 'none'] as const

/** Icône devant le titre (même liste que le web). */
export const CATEGORY_ICONS = {
  none: '', hash: '#', dot: '•', star: '★', sparkle: '✦', diamond: '◆', heart: '♥', arrow: '➤', square: '■', triangle: '▲',
  fire: '🔥', bolt: '⚡', leaf: '🌿', moon: '🌙', sun: '☀️', music: '🎵', game: '🎮', crown: '👑', pin: '📌',
  folder: '📁', chat: '💬', rocket: '🚀', gem: '💎', book: '📚', art: '🎨', shield: '🛡️', tools: '🛠️', megaphone: '📣',
} as const
type Icon = keyof typeof CATEGORY_ICONS
const ICONS = Object.keys(CATEGORY_ICONS) as Icon[]

export interface CategoryLook {
  shape: Shape
  color: string | null
  color2: string | null
  uppercase: boolean
  font: (typeof FONTS)[number]
  weight: (typeof WEIGHTS)[number]
  size: number
  spacing: number
  align: (typeof ALIGNS)[number]
  icon: Icon
  arrow: (typeof ARROWS)[number]
}

const HEX = /^#[0-9a-f]{6}$/i
export const DEFAULT_CATEGORY_LOOK: CategoryLook = {
  shape: 'auto', color: null, color2: null, uppercase: true, font: 'theme', weight: 'semibold', size: 12, spacing: 3,
  align: 'left', icon: 'none', arrow: 'chevron',
}

const oneOf = <T extends string>(v: unknown, values: readonly T[], def: T): T => (values.includes(v as T) ? (v as T) : def)
const intIn = (v: unknown, min: number, max: number, def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def
const hex = (v: unknown) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null)

function sanitize(raw: unknown): CategoryLook | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const d = DEFAULT_CATEGORY_LOOK
  return {
    shape: oneOf(v.shape, SHAPES, d.shape),
    color: hex(v.color),
    color2: hex(v.color2),
    uppercase: typeof v.uppercase === 'boolean' ? v.uppercase : d.uppercase,
    font: oneOf(v.font, FONTS, d.font),
    weight: oneOf(v.weight, WEIGHTS, d.weight),
    size: intIn(v.size, 9, 18, d.size),
    spacing: intIn(v.spacing, 0, 30, d.spacing),
    align: oneOf(v.align, ALIGNS, d.align),
    icon: oneOf(v.icon, ICONS, d.icon),
    arrow: oneOf(v.arrow, ARROWS, d.arrow),
  }
}

/** Style du serveur s'il en a un, sinon le style général, sinon celui par défaut. */
export function categoryLookFor(studio: unknown, serverId: string): CategoryLook {
  const s = studio && typeof studio === 'object' ? (studio as Record<string, unknown>) : {}
  const servers = s.servers && typeof s.servers === 'object' ? (s.servers as Record<string, { category?: unknown }>) : {}
  return sanitize(servers[serverId.toLowerCase()]?.category) ?? sanitize(s.category) ?? DEFAULT_CATEGORY_LOOK
}

/** Noir ou blanc lisible sur une couleur pleine (bandeaux, étiquettes). */
export function inkOn(c: string): '#000000' | '#ffffff' {
  const lin = (i: number) => {
    const s = parseInt(c.slice(i, i + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5)
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#000000'
}

const FONT_FAMILY: Partial<Record<CategoryLook['font'], string>> = {
  serif: 'serif', mono: 'monospace', condensed: 'sans-serif-condensed', hand: 'casual', display: 'sans-serif-black', sans: 'sans-serif',
  rounded: 'sans-serif-medium',
}
const FONT_WEIGHT: Record<CategoryLook['weight'], TextStyle['fontWeight']> = { regular: '400', semibold: '600', bold: '700', black: '900' }

/** Texte du titre : majuscules, crochets, invite de terminal (pas de CSS ici, tout est natif). */
export function categoryTitle(look: CategoryLook, name: string): string {
  const base = look.shape === 'smallcaps' || look.shape === 'terminal' ? name.toLowerCase() : look.uppercase ? name.toUpperCase() : name
  if (look.shape === 'bracket') return `[ ${base} ]`
  if (look.shape === 'terminal') return `> ${base}_`
  return base
}

/** Icônes Ionicons de la flèche de repli (null = aucune). */
export function categoryArrow(look: CategoryLook, folded: boolean): 'chevron-forward' | 'chevron-down' | 'caret-forward' | 'caret-down' | 'add' | 'remove' | 'arrow-forward' | 'arrow-down' | null {
  switch (look.arrow) {
    case 'none': return null
    case 'caret': return folded ? 'caret-forward' : 'caret-down'
    case 'plus': return folded ? 'add' : 'remove'
    case 'arrow': return folded ? 'arrow-forward' : 'arrow-down'
    default: return folded ? 'chevron-forward' : 'chevron-down'
  }
}

/**
 * Styles de la ligne et du titre (alpha en suffixe hexadécimal : 1f ≈ 12 %, 29 ≈ 16 %, 2e ≈ 18 %,
 * 38 ≈ 22 %, 47 ≈ 28 %, 73 ≈ 45 %, 80 = 50 %, 99 = 60 %, b3 ≈ 70 %).
 */
export function categoryStyles(look: CategoryLook): { row: ViewStyle; text: TextStyle; icon: string } {
  const c = look.color ?? colors.primary
  const c2 = look.color2 ?? colors.primary
  const box: ViewStyle = { marginHorizontal: 8, paddingVertical: 6, paddingHorizontal: 8 }
  // Typographie commune (taille, espacement, police, graisse, alignement).
  const type: TextStyle = {
    fontSize: look.size,
    letterSpacing: (look.spacing / 100) * look.size,
    fontWeight: FONT_WEIGHT[look.weight],
    ...(FONT_FAMILY[look.font] ? { fontFamily: FONT_FAMILY[look.font] } : {}),
  }
  const align: ViewStyle = look.align === 'center' ? { justifyContent: 'center' } : look.align === 'right' ? { justifyContent: 'flex-end' } : {}
  const icon = CATEGORY_ICONS[look.icon]
  const out = (row: ViewStyle, text: TextStyle) => ({ row: { ...row, ...align }, text: { ...type, ...text }, icon })
  const ink = inkOn(c)
  switch (look.shape) {
    case 'outline': return out({ ...box, borderWidth: 1, borderColor: look.color ?? colors.border, borderRadius: 6 }, {})
    case 'pill': return out({ ...box, borderRadius: 999, backgroundColor: `${c}29` }, { color: c })
    case 'card': return out({ ...box, borderRadius: 8, backgroundColor: colors.bgHover, borderWidth: 1, borderColor: look.color ? `${c}99` : colors.border, elevation: 2 }, { color: colors.text })
    case 'bar': return out({ ...box, borderLeftWidth: 3, borderLeftColor: c, borderTopRightRadius: 6, borderBottomRightRadius: 6, backgroundColor: `${c}2e` }, { color: c })
    case 'underline': return out({ ...box, borderBottomWidth: 1, borderBottomColor: `${c}b3` }, { color: c })
    case 'gradient': return out({}, { color: c, textShadowColor: c2, textShadowOffset: { width: 1, height: 0 }, textShadowRadius: 1 })
    case 'boxed': return out({ ...box, borderWidth: 2, borderColor: c, borderRadius: 4 }, { color: c })
    case 'bracket': return out({}, { color: colors.text })
    case 'neon': return out({}, { color: c, textShadowColor: c, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 })
    case 'smallcaps': return out({}, { color: c, fontVariant: ['small-caps'] })
    case 'divider': return out({ ...box, borderBottomWidth: 1, borderBottomColor: `${c}80` }, { color: c })
    case 'ribbon': return out({ ...box, backgroundColor: c, borderTopRightRadius: 12, borderBottomRightRadius: 12 }, { color: ink })
    case 'banner': return out({ ...box, backgroundColor: c, borderRadius: 4, borderRightWidth: 6, borderRightColor: c2 }, { color: ink })
    case 'tag': return out({ marginHorizontal: 8 }, { color: ink, backgroundColor: c, paddingHorizontal: 8, borderRadius: 4, overflow: 'hidden' })
    case 'chip': return out({ marginHorizontal: 8 }, { color: c, backgroundColor: `${c}26`, borderWidth: 1, borderColor: `${c}80`, paddingHorizontal: 9, borderRadius: 999, overflow: 'hidden' })
    case 'outlined': return out({}, { color: colors.bgAlt, textShadowColor: c, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 2, fontWeight: '900' })
    case 'shadow': return out({}, { color: colors.text, textShadowColor: c, textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 0 })
    case 'dot': return { ...out({}, { color: colors.text }), icon: icon || '●' }
    case 'terminal': return out({ ...box, backgroundColor: '#00000047', borderRadius: 3 }, { color: c, fontFamily: 'monospace' })
    case 'chiseled': return out({ ...box, borderRadius: 4, backgroundColor: colors.bgHover, borderTopWidth: 1, borderTopColor: '#ffffff1f', borderBottomWidth: 1, borderBottomColor: '#00000066' }, { textShadowColor: '#00000099', textShadowOffset: { width: 0, height: -1 }, textShadowRadius: 0 })
    case 'glass': return out({ ...box, borderRadius: 10, backgroundColor: '#ffffff17', borderWidth: 1, borderColor: '#ffffff1f' }, { color: colors.text })
    case 'glow': return out({ ...box, borderRadius: 6, borderWidth: 1, borderColor: `${c}99`, shadowColor: c, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 }, { color: c })
    case 'double': return out({ ...box, borderBottomWidth: 3, borderBottomColor: c }, { color: c })
    case 'dashed': return out({ ...box, borderWidth: 1, borderStyle: 'dashed', borderColor: c, borderRadius: 6 }, { color: c })
    case 'stripes': return out({ ...box, borderRadius: 6, backgroundColor: `${c}1f`, borderLeftWidth: 6, borderLeftColor: `${c}47` }, { color: colors.text })
    case 'tab': return out({ ...box, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: `${c}38`, borderBottomWidth: 2, borderBottomColor: c }, { color: colors.text })
    case 'fade': return out({ ...box, backgroundColor: `${c}2e`, borderRadius: 999 }, { color: c })
    case 'overline': return out({ ...box, borderTopWidth: 2, borderTopColor: c }, { color: c })
    case 'highlight': return out({}, { color: colors.text, backgroundColor: `${c}73`, paddingHorizontal: 2 })
    case 'arrow': return out({ ...box, backgroundColor: `${c}33`, borderTopRightRadius: 999, borderBottomRightRadius: 999 }, { color: c })
    case 'slant': return out({ ...box, backgroundColor: `${c}3d`, transform: [{ skewX: '-12deg' }] }, { color: c })
    case 'stamp': return out({ marginHorizontal: 8 }, { color: c, borderWidth: 1.5, borderColor: c, borderRadius: 3, paddingHorizontal: 6, transform: [{ rotate: '-2deg' }] })
    default: return out({}, {})
  }
}
