/**
 * Style du pseudo (gratuit) : fonctions pures, mêmes règles que le web.
 * Le serveur (models/profile_style.rs) ne renvoie que des couleurs 0xRRGGBB et des identifiants
 * en liste blanche ; tout le rendu est décidé ici. Testé dans __tests__/name-style.test.ts.
 */

export const NAME_EFFECTS = ['', 'shimmer', 'glow', 'outline'] as const
export const NAME_FONTS = ['', 'serif', 'mono', 'rounded', 'heavy', 'cursive'] as const
export type NameEffect = (typeof NAME_EFFECTS)[number]
export type NameFont = (typeof NAME_FONTS)[number]

export interface NameStyle {
  /** 0 = couleur par défaut, 1 = unie, 2-3 = dégradé. */
  colors: number[]
  /** Angle du dégradé (web) ; ignoré sur mobile : le dégradé suit le nom, caractère par caractère. */
  angle?: number
  effect?: NameEffect | (string & {})
  font?: NameFont | (string & {})
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
  const own = (style?.colors ?? []).filter((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, 3)
  const fit = (cs: number[]) => cs.map((c) => toHex(ensureContrast(c, bg)))
  if (role != null && roleOverrides !== false) return { colors: fit([role]), effect: '', font }
  const effect = typeof style?.effect === 'string' ? style.effect : ''
  const cs = own.length ? own : role != null ? [role] : []
  if (!cs.length && !effect && !font) return null
  return { colors: fit(cs), effect, font }
}
