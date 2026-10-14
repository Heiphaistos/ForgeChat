/**
 * Carte de profil (users.profile_card) — logique pure, même contrat que
 * server/src/models/profile_card.rs : listes dans le même ordre, mêmes bornes, valeurs par défaut
 * omises du PATCH (tout par défaut => null). Les couleurs viennent de profile_color_primary/accent.
 */
export const CARD_LAYOUTS = ['classic', 'centered', 'compact', 'wide'] as const
export const CARD_STYLES = ['solid', 'gradient', 'glass', 'outline', 'neon'] as const
/** Même liste que les motifs des thèmes (theme/themeCore::PATTERNS). */
export const CARD_PATTERNS = ['none', 'dots', 'grid', 'lines', 'diagonal', 'checker', 'waves'] as const
export const BANNER_FX = ['none', 'blur', 'dim', 'fade', 'duotone'] as const
export const NAME_ALIGNS = ['left', 'center'] as const
export const CARD_RADIUS_MAX = 24
export const PROFILE_CARD_MAX_BYTES = 512

export type CardLayout = (typeof CARD_LAYOUTS)[number]
export type CardStyle = (typeof CARD_STYLES)[number]
export type CardPattern = (typeof CARD_PATTERNS)[number]
export type BannerFx = (typeof BANNER_FX)[number]
export type NameAlign = (typeof NAME_ALIGNS)[number]

export interface ProfileCard {
  layout: CardLayout
  card: CardStyle
  pattern: CardPattern
  /** Point focal vertical de la bannière (%). */
  banner_y: number
  banner_fx: BannerFx
  radius: number
  /** Angle du dégradé de carte (degrés, 180 = haut → bas). */
  angle: number
  show_badges: boolean
  show_links: boolean
  name_align: NameAlign
}

export const CARD_DEFAULT: Readonly<ProfileCard> = {
  layout: 'classic', card: 'solid', pattern: 'none', banner_y: 50, banner_fx: 'none', radius: 12, angle: 180,
  show_badges: true, show_links: true, name_align: 'left',
}
/** Bornes numériques [min, max]. */
export const CARD_RANGES = { banner_y: [0, 100], radius: [0, CARD_RADIUS_MAX], angle: [0, 360] } as const

const pick = <T extends string>(list: readonly T[], v: unknown, def: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : def)
const num = (v: unknown, [min, max]: readonly [number, number], def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

/** Carte reçue (serveur, cache ancien) nettoyée, toujours complète ; toute valeur inconnue => défaut. */
export function cleanCard(raw: unknown): ProfileCard {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    layout: pick(CARD_LAYOUTS, o.layout, CARD_DEFAULT.layout),
    card: pick(CARD_STYLES, o.card, CARD_DEFAULT.card),
    pattern: pick(CARD_PATTERNS, o.pattern, CARD_DEFAULT.pattern),
    banner_y: num(o.banner_y, CARD_RANGES.banner_y, CARD_DEFAULT.banner_y),
    banner_fx: pick(BANNER_FX, o.banner_fx, CARD_DEFAULT.banner_fx),
    radius: num(o.radius, CARD_RANGES.radius, CARD_DEFAULT.radius),
    angle: num(o.angle, CARD_RANGES.angle, CARD_DEFAULT.angle),
    show_badges: typeof o.show_badges === 'boolean' ? o.show_badges : true,
    show_links: typeof o.show_links === 'boolean' ? o.show_links : true,
    name_align: pick(NAME_ALIGNS, o.name_align, CARD_DEFAULT.name_align),
  }
}

/** Corps du PATCH : seulement les valeurs hors défaut ; null = tout par défaut (efface la colonne). */
export function cardPayload(c: ProfileCard): Partial<ProfileCard> | null {
  const clean = cleanCard(c)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(CARD_DEFAULT) as (keyof ProfileCard)[]) if (clean[k] !== CARD_DEFAULT[k]) out[k] = clean[k]
  return Object.keys(out).length ? (out as Partial<ProfileCard>) : null
}

const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`

/** `n` couleurs interpolées de a à b (dégradé approché par bandes, sans dépendance native). */
export function gradientStops(a: number, b: number, n: number): string[] {
  const ch = (c: number, s: number) => (c >> s) & 0xff
  const len = Math.max(2, n)
  return Array.from({ length: len }, (_, i) => {
    const t = i / (len - 1)
    const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t)
    return hex((mix(16) << 16) | (mix(8) << 8) | mix(0))
  })
}

/**
 * Axe des bandes du dégradé pour un angle CSS, arrondi au quart de tour le plus proche :
 * 180 = haut → bas, 90 = gauche → droite, 0 = bas → haut, 270 = droite → gauche.
 */
export function gradientAxis(angle: number): { row: boolean; reverse: boolean } {
  const q = Math.round((((angle % 360) + 360) % 360) / 90) % 4
  return { row: q % 2 === 1, reverse: q === 0 || q === 3 }
}

/** Texte clair sur fond coloré : seulement pour les cartes pleines ou en dégradé avec des couleurs. */
export const cardOnColor = (card: CardStyle, hasColors: boolean) => hasColors && (card === 'solid' || card === 'gradient')

/** En-tête de la fiche selon la disposition : taille d'avatar, avatar à côté du nom, alignements. */
export function cardHeader(c: ProfileCard) {
  return {
    avatar: c.layout === 'compact' ? 64 : c.layout === 'wide' ? 112 : 96,
    row: c.layout === 'compact',
    avatarCenter: c.layout === 'centered',
    textCenter: c.layout === 'centered' || c.name_align === 'center',
  }
}

/** Glyphe répété par ligne pour approcher chaque motif (aucun SVG sur mobile). */
export const PATTERN_GLYPH: Record<Exclude<CardPattern, 'none'>, string> = {
  dots: '•', grid: '┼', lines: '─', diagonal: '╱', checker: '▚', waves: '∿',
}
