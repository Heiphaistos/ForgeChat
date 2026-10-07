// Style du pseudo (gratuit pour tous) : couleur unie ou dégradé, effet, police.
// Fonctions pures, testées par scripts/nameStyle.test.mjs ; le mobile applique les
// mêmes règles (mobile/src/lib/nameStyle.ts). Le serveur ne stocke que des couleurs
// 0xRRGGBB et des identifiants en liste blanche (server/src/models/profile_style.rs) :
// aucun CSS venant d'un utilisateur n'arrive jamais ici.

export interface NameStyle {
  colors?: number[]
  angle?: number
  effect?: '' | 'shimmer' | 'glow' | 'outline'
  font?: '' | 'serif' | 'mono' | 'rounded' | 'heavy' | 'cursive'
}

export const NAME_EFFECTS = ['', 'shimmer', 'glow', 'outline'] as const
export const NAME_FONTS = ['', 'serif', 'mono', 'rounded', 'heavy', 'cursive'] as const

/** Fond sombre par défaut de l'appli (contraste minimal calculé contre lui). */
export const DEFAULT_BG = 0x1e1f22
/** Ratio WCAG minimal d'un pseudo coloré (texte gras/grand : 3:1). */
export const MIN_CONTRAST = 3

const FONT_STACKS: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  rounded: 'ui-rounded, "Nunito", "Segoe UI Rounded", "Arial Rounded MT Bold", sans-serif',
  cursive: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive',
}

export const hex = (c: number) => '#' + (c >>> 0 & 0xffffff).toString(16).padStart(6, '0')

const channels = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]

function luminance(c: number): number {
  const [r, g, b] = channels(c).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: number, b: number): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Mélange `c` vers le blanc (t = 0..1). */
export function lighten(c: number, t: number): number {
  const [r, g, b] = channels(c).map(v => Math.round(v + (255 - v) * t))
  return (r << 16) | (g << 8) | b
}

/** Mélange `c` vers le noir (t = 0..1). */
function darken(c: number, t: number): number {
  const [r, g, b] = channels(c).map(v => Math.round(v * (1 - t)))
  return (r << 16) | (g << 8) | b
}

/**
 * Couleur lisible sur `bg` : éclaircie (fond sombre) ou assombrie (fond clair) par
 * pas de 10 % jusqu'au ratio MIN_CONTRAST. La couleur choisie n'est jamais modifiée
 * en base, seulement à l'affichage.
 */
export function readable(c: number, bg = DEFAULT_BG): number {
  const toward = luminance(bg) < 0.5 ? lighten : darken
  let out = c
  for (let i = 1; i <= 10 && contrast(out, bg) < MIN_CONTRAST; i++) out = toward(c, i / 10)
  return out
}

/** Style valide et non vide ? (le serveur l'a déjà validé ; garde contre un cache ancien). */
export function cleanStyle(s: unknown): NameStyle | null {
  if (!s || typeof s !== 'object') return null
  const o = s as NameStyle
  const colors = Array.isArray(o.colors) ? o.colors.filter(c => Number.isInteger(c) && c >= 0 && c <= 0xffffff).slice(0, 3) : []
  const effect = (NAME_EFFECTS as readonly string[]).includes(o.effect ?? '') ? o.effect ?? '' : ''
  const font = (NAME_FONTS as readonly string[]).includes(o.font ?? '') ? o.font ?? '' : ''
  const angle = Number.isFinite(o.angle) ? Math.min(360, Math.max(0, o.angle!)) : 90
  if (!colors.length && !effect && !font) return null
  return { colors, angle, effect: effect as NameStyle['effect'], font: font as NameStyle['font'] }
}

/**
 * Priorité rôle / perso. Dans un serveur où la couleur des rôles remplace celle du
 * pseudo (réglage du serveur, vrai par défaut), un rôle coloré l'emporte sur les
 * couleurs et l'effet perso (la police perso est gardée). En MP, ou si le serveur
 * laisse chacun sa couleur, le style perso l'emporte ; sans style perso, le rôle.
 */
export function pickNameStyle(personal: NameStyle | null, hasRoleColor: boolean, roleOverrides: boolean): { personal: NameStyle | null; useRole: boolean } {
  if (hasRoleColor && (roleOverrides || !personal?.colors?.length)) {
    return { personal: personal?.font ? { font: personal.font } : null, useRole: true }
  }
  return { personal, useRole: false }
}

export type Css = Record<string, string | undefined>

/** Propriétés CSS (forme React) d'un pseudo stylé. `bg` : fond derrière le texte. */
export function nameCss(s: NameStyle | null, bg = DEFAULT_BG): Css {
  if (!s) return {}
  const css: Css = {}
  const colors = (s.colors ?? []).map(c => hex(readable(c, bg)))
  if (s.font === 'heavy') css.fontWeight = '900'
  else if (s.font && FONT_STACKS[s.font]) css.fontFamily = FONT_STACKS[s.font]
  if (s.effect === 'shimmer') {
    // Reflet qui glisse sur la couleur (ou le dégradé) : animé par la classe fc-name-shimmer.
    const base = colors.length ? colors : ['var(--fc-text, #f2f3f5)']
    const stops = base.length === 1 ? [base[0], base[0]] : base
    css.backgroundImage = `linear-gradient(${s.angle ?? 90}deg, ${stops.join(', ')}), linear-gradient(100deg, transparent 35%, rgba(255,255,255,.75) 50%, transparent 65%)`
    css.backgroundSize = '100% 100%, 250% 100%'
    css.backgroundBlendMode = 'screen'
    css.WebkitBackgroundClip = 'text'
    css.backgroundClip = 'text'
    css.color = 'transparent'
  } else if (colors.length > 1) {
    css.backgroundImage = `linear-gradient(${s.angle ?? 90}deg, ${colors.join(', ')})`
    css.WebkitBackgroundClip = 'text'
    css.backgroundClip = 'text'
    css.color = 'transparent'
  } else if (colors.length === 1) {
    css.color = colors[0]
  }
  if (s.effect === 'glow') css.textShadow = `0 0 6px ${colors[0] ?? 'currentColor'}`
  // Contour : ombres sombres (fonctionne aussi sur un dégradé, contrairement à text-stroke).
  if (s.effect === 'outline') css.filter = 'drop-shadow(0 0 1px rgba(0,0,0,.9)) drop-shadow(0 0 1px rgba(0,0,0,.9))'
  return css
}

/** Nom affiché : surnom de serveur > nom d'affichage > nom d'utilisateur. */
export function shownName(username: string, displayName?: string | null, nickname?: string | null): string {
  return nickname?.trim() || displayName?.trim() || username
}

/** Version fixe (première image) d'un avatar/bannière animé : `a_<id>.gif` → `a_<id>_s.gif`. */
export function stillUrl(url: string): string | null {
  const m = url.match(/^(.*\/a_[0-9a-f-]+)\.(gif|png|webp)$/i)
  return m ? `${m[1]}_s.${m[2]}` : null
}
