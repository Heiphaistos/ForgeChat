/**
 * Carte de profil (users.profile_card, validée par server/src/models/profile_card.rs) : mise en
 * page de la fiche et du popout. Mêmes listes et bornes que le serveur ; défauts jamais envoyés,
 * tout par défaut = null. Pur TypeScript : testé par scripts/profileCard.test.mjs.
 * Le style produit ne contient que des nombres et des « #rrggbb » issus d'entiers.
 */
export const CARD_LAYOUTS = ['classic', 'centered', 'compact', 'wide'] as const
export const CARD_STYLES = ['solid', 'gradient', 'glass', 'outline', 'neon'] as const
export const CARD_PATTERNS = ['none', 'dots', 'grid', 'lines', 'diagonal', 'checker', 'waves'] as const
export const BANNER_FX = ['none', 'blur', 'dim', 'fade', 'duotone'] as const
export const NAME_ALIGNS = ['left', 'center'] as const
export const CARD_RADIUS_MAX = 24

export type CardLayout = (typeof CARD_LAYOUTS)[number]
export type CardStyle = (typeof CARD_STYLES)[number]
export type CardPattern = (typeof CARD_PATTERNS)[number]
export type BannerFx = (typeof BANNER_FX)[number]
export type NameAlign = (typeof NAME_ALIGNS)[number]

export interface ProfileCard {
  layout: CardLayout
  card: CardStyle
  pattern: CardPattern
  /** Point focal vertical de la bannière, en %. */
  banner_y: number
  banner_fx: BannerFx
  radius: number
  /** Angle du dégradé de la carte, en degrés. */
  angle: number
  show_badges: boolean
  show_links: boolean
  name_align: NameAlign
}

export const CARD_DEFAULT: Readonly<ProfileCard> = {
  layout: 'classic', card: 'solid', pattern: 'none', banner_y: 50, banner_fx: 'none',
  radius: 12, angle: 180, show_badges: true, show_links: true, name_align: 'left',
}
const RANGES = { banner_y: [0, 100], radius: [0, CARD_RADIUS_MAX], angle: [0, 360] } as const

const oneOf = <T extends string>(list: readonly T[], v: unknown, def: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : def
const num = (v: unknown, [min, max]: readonly [number, number], def: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def

/** Carte reçue nettoyée (cache ancien ou hostile) : toujours complète, défauts compris. */
export function cleanCard(v: unknown): ProfileCard {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    layout: oneOf(CARD_LAYOUTS, o.layout, CARD_DEFAULT.layout),
    card: oneOf(CARD_STYLES, o.card, CARD_DEFAULT.card),
    pattern: oneOf(CARD_PATTERNS, o.pattern, CARD_DEFAULT.pattern),
    banner_y: num(o.banner_y, RANGES.banner_y, CARD_DEFAULT.banner_y),
    banner_fx: oneOf(BANNER_FX, o.banner_fx, CARD_DEFAULT.banner_fx),
    radius: num(o.radius, RANGES.radius, CARD_DEFAULT.radius),
    angle: num(o.angle, RANGES.angle, CARD_DEFAULT.angle),
    show_badges: typeof o.show_badges === 'boolean' ? o.show_badges : true,
    show_links: typeof o.show_links === 'boolean' ? o.show_links : true,
    name_align: oneOf(NAME_ALIGNS, o.name_align, CARD_DEFAULT.name_align),
  }
}

/** Corps du PATCH : seulement ce qui diffère du défaut ; null = carte par défaut (efface). */
export function cardPayload(c: ProfileCard): Partial<ProfileCard> | null {
  const clean = cleanCard(c)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(CARD_DEFAULT) as (keyof ProfileCard)[]) {
    if (clean[k] !== CARD_DEFAULT[k]) out[k] = clean[k]
  }
  return Object.keys(out).length ? (out as Partial<ProfileCard>) : null
}

const hex = (c: number) => '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0')
const VEIL = 'linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45))'

/**
 * Apparence de la carte : fond (couleurs du profil), bordure, rayon, motif et bannière.
 * « solid » sans couleur = fond par défaut de l'app (undefined), et avec couleurs = l'ancien
 * dégradé voilé : les profils existants ne changent pas.
 */
export function cardLook(c: ProfileCard, primary?: number | null, accent?: number | null) {
  const has = primary != null || accent != null
  const a = hex(primary ?? accent ?? 0x5865f2)
  const b = hex(accent ?? primary ?? 0xeb459e)
  const style: Record<string, string> = { borderRadius: `${c.radius}px`, '--card-a': a, '--card-b': b }
  switch (c.card) {
    case 'solid':
      if (has) style.background = `${VEIL}, linear-gradient(160deg, ${a} 0%, ${b} 100%)`
      break
    case 'gradient':
      style.background = `linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.3)), linear-gradient(${c.angle}deg, ${a} 0%, ${b} 100%)`
      break
    case 'glass':
      style.background = `linear-gradient(${c.angle}deg, ${a}55 0%, ${b}33 100%), rgba(20,20,28,.55)`
      style.backdropFilter = 'blur(14px) saturate(1.3)'
      style.border = '1px solid rgba(255,255,255,.14)'
      break
    case 'outline':
      style.border = `2px solid ${a}`
      break
    case 'neon':
      style.background = `linear-gradient(${c.angle}deg, ${a}22, ${b}22), #0b0b12`
      style.border = `1px solid ${a}`
      style.boxShadow = `0 0 14px ${a}aa, inset 0 0 18px ${b}44`
      break
  }
  const cover = c.layout === 'compact' || c.layout === 'wide'
  return {
    style,
    /** Bannière : rognée (cover) en mise en page compacte ou large, entière sinon. */
    banner: {
      cover,
      height: c.layout === 'compact' ? 72 : c.layout === 'wide' ? 170 : undefined,
      focus: `50% ${c.banner_y}%`,
      className: c.banner_fx === 'none' ? '' : `fc-bfx fc-bfx-${c.banner_fx}`,
    },
    pattern: c.pattern === 'none' ? null : c.pattern,
    centered: c.layout === 'centered',
    compact: c.layout === 'compact',
    nameCenter: c.name_align === 'center' || c.layout === 'centered',
  }
}
export type CardLook = ReturnType<typeof cardLook>
