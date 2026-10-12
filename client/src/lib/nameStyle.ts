// Style du pseudo (gratuit pour tous) : couleur unie ou dégradé, effet, police.
// Fonctions pures, testées par scripts/nameStyle.test.mjs ; le mobile applique les
// mêmes règles (mobile/src/lib/nameStyle.ts). Le serveur ne stocke que des couleurs
// 0xRRGGBB et des identifiants en liste blanche (server/src/models/profile_style.rs) :
// aucun CSS venant d'un utilisateur n'arrive jamais ici.

export const NAME_EFFECTS = [
  '', 'shimmer', 'glow', 'outline', 'neon', 'rainbow', 'wave', 'glitch', 'shadow3d',
  'fire', 'frost', 'pulse', 'holo', 'chrome', 'retro', 'float', 'sparkle',
] as const
export const NAME_FONTS = [
  '', 'serif', 'mono', 'rounded', 'heavy', 'cursive', 'slab', 'condensed', 'wide', 'elegant',
  'typewriter', 'gothic', 'comic', 'impact', 'smallcaps', 'light', 'handwritten', 'futuristic',
  'retro', 'stencil', 'code', 'italic',
] as const
/** Fonds d'une marque de clan (étiquette perso ou tag de serveur). */
export const TAG_BADGES = ['', 'solid', 'soft', 'outline', 'gradient', 'glass', 'pill', 'neon', 'plain'] as const
/** Icônes d'une marque (identifiants traduits en icônes par components/ui/ClanTag.tsx). */
export const TAG_ICONS = [
  '', 'star', 'crown', 'shield', 'flame', 'bolt', 'heart', 'skull', 'leaf', 'diamond',
  'moon', 'sword', 'gem', 'paw', 'music', 'gamepad',
] as const
/** Épaisseur maximale du contour du pseudo (px), comme le serveur. */
export const OUTLINE_WIDTH_MAX = 4

export type NameEffect = (typeof NAME_EFFECTS)[number]
export type NameFont = (typeof NAME_FONTS)[number]
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

export interface NameStyle {
  colors?: number[]
  angle?: number
  effect?: NameEffect
  font?: NameFont
  /** Couleur du contour (0xRRGGBB), seulement si `outline_width` > 0. */
  outline?: number
  /** Épaisseur du contour en px (0 à OUTLINE_WIDTH_MAX). */
  outline_width?: number
  /** Style de l'étiquette perso. */
  tag?: TagStyle
}

/** Effets qui imposent leur propre palette (les couleurs choisies sont ignorées). */
const PALETTES: Partial<Record<NameEffect, string[]>> = {
  rainbow: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff3b30'],
  holo: ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff', '#ff9ff3'],
  fire: ['#fff3b0', '#ffb300', '#ff6d00', '#ff3d00'],
  frost: ['#ffffff', '#bdeeff', '#7fd3ff', '#ffffff'],
  chrome: ['#ffffff', '#c7ced6', '#7d8894', '#e9eef2', '#9aa4ae', '#ffffff'],
}
/** Effets animés : la classe CSS fc-name-<effet> porte l'animation (profileStyles.css). */
const ANIMATED: ReadonlySet<string> = new Set(['shimmer', 'neon', 'rainbow', 'wave', 'glitch', 'fire', 'pulse', 'holo', 'chrome', 'float', 'sparkle'])

/** Fond sombre par défaut de l'appli (contraste minimal calculé contre lui). */
export const DEFAULT_BG = 0x1e1f22
/** Ratio WCAG minimal d'un pseudo coloré (texte gras/grand : 3:1). */
export const MIN_CONTRAST = 3

/**
 * Polices : uniquement des piles de polices système (ou JetBrains Mono, déjà embarquée),
 * rien n'est téléchargé (CSP font-src 'self'). Une police absente retombe sur la famille
 * générique ; certaines ajoutent un réglage (graisse, chasse, petites capitales).
 */
const FONT_CSS: Record<string, Css> = {
  serif: { fontFamily: 'Georgia, "Times New Roman", serif' },
  mono: { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
  rounded: { fontFamily: 'ui-rounded, "Nunito", "Segoe UI Rounded", "Arial Rounded MT Bold", sans-serif' },
  heavy: { fontWeight: '900' },
  cursive: { fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' },
  slab: { fontFamily: 'Rockwell, "Roboto Slab", "Zilla Slab", "Clarendon", "Courier New", serif', fontWeight: '700' },
  condensed: { fontFamily: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "Helvetica Neue", sans-serif', fontStretch: 'condensed' },
  wide: { fontStretch: 'expanded', letterSpacing: '0.14em', fontWeight: '600' },
  elegant: { fontFamily: 'Didot, "Bodoni 72", "Bodoni MT", "Playfair Display", "Hoefler Text", Georgia, serif', fontStyle: 'italic' },
  typewriter: { fontFamily: '"American Typewriter", "Courier New", Courier, monospace' },
  gothic: { fontFamily: '"Old English Text MT", "UnifrakturMaguntia", "Luminari", "Apple Chancery", fantasy' },
  comic: { fontFamily: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", Chalkboard, cursive' },
  impact: { fontFamily: 'Impact, Haettenschweiler, "Arial Black", "Franklin Gothic Bold", sans-serif', letterSpacing: '0.02em' },
  smallcaps: { fontFamily: 'Georgia, "Times New Roman", serif', fontVariant: 'small-caps', letterSpacing: '0.04em' },
  light: { fontWeight: '300', letterSpacing: '0.03em' },
  handwritten: { fontFamily: '"Bradley Hand", "Segoe Print", "Ink Free", Chalkduster, "Comic Neue", cursive' },
  futuristic: { fontFamily: 'Eurostile, Orbitron, "Bank Gothic", "Agency FB", Michroma, "Segoe UI", sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase' },
  retro: { fontFamily: '"Cooper Black", "Cooper Std", Souvenir, "Bookman Old Style", Georgia, serif', fontWeight: '800' },
  stencil: { fontFamily: 'Stencil, "Stencil Std", "Big John", Impact, fantasy', textTransform: 'uppercase', letterSpacing: '0.06em' },
  code: { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: '700' },
  italic: { fontStyle: 'italic', fontWeight: '600' },
}

/** CSS (forme React) d'une police de la liste blanche ; {} si inconnue. */
export function fontCss(font?: string | null): Css {
  return (font && FONT_CSS[font]) || {}
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

const isColor = (c: unknown): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff
const inList = <T extends string>(list: readonly T[], v: unknown): T => ((list as readonly unknown[]).includes(v ?? '') ? (v ?? '') as T : '' as T)

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

/** Style valide et non vide ? (le serveur l'a déjà validé ; garde contre un cache ancien). */
export function cleanStyle(s: unknown): NameStyle | null {
  if (!s || typeof s !== 'object') return null
  const o = s as NameStyle
  const colors = Array.isArray(o.colors) ? o.colors.filter(isColor).slice(0, 3) : []
  const effect = inList(NAME_EFFECTS, o.effect)
  const font = inList(NAME_FONTS, o.font)
  const angle = Number.isFinite(o.angle) ? Math.min(360, Math.max(0, o.angle!)) : 90
  const width = Number.isInteger(o.outline_width) ? Math.min(OUTLINE_WIDTH_MAX, Math.max(0, o.outline_width!)) : 0
  const tag = cleanTagStyle(o.tag)
  if (!colors.length && !effect && !font && !width && !tag) return null
  const out: NameStyle = { colors, angle, effect, font }
  if (width) { out.outline_width = width; out.outline = isColor(o.outline) ? o.outline : 0 }
  if (tag) out.tag = tag
  return out
}

/**
 * Priorité rôle / perso. Dans un serveur où la couleur des rôles remplace celle du
 * pseudo (réglage du serveur, vrai par défaut), un rôle coloré l'emporte sur les
 * couleurs et l'effet perso (la police perso est gardée). En MP, ou si le serveur
 * laisse chacun sa couleur, le style perso l'emporte ; sans style perso, le rôle.
 */
export function pickNameStyle(personal: NameStyle | null, hasRoleColor: boolean, roleOverrides: boolean): { personal: NameStyle | null; useRole: boolean } {
  if (hasRoleColor && (roleOverrides || !personal?.colors?.length)) {
    // Police et contour perso gardés (ils ne changent pas la couleur du rôle).
    if (!personal?.font && !personal?.outline_width) return { personal: null, useRole: true }
    const kept: NameStyle = {}
    if (personal.font) kept.font = personal.font
    if (personal.outline_width) { kept.outline = personal.outline; kept.outline_width = personal.outline_width }
    return { personal: kept, useRole: true }
  }
  return { personal, useRole: false }
}

export type Css = Record<string, string | undefined>

/** Ombres : text-shadow sur un texte plein ; drop-shadow (filtre) sur un texte en dégradé,
 *  où text-shadow serait peint par-dessus le fond découpé. */
function addShadows(css: Css, clipped: boolean, shadows: string[]) {
  if (!shadows.length) return
  if (clipped) css.filter = [css.filter, ...shadows.map(s => `drop-shadow(${s})`)].filter(Boolean).join(' ')
  else css.textShadow = [css.textShadow, ...shadows].filter(Boolean).join(', ')
}

function clipText(css: Css, image: string) {
  css.backgroundImage = image
  css.WebkitBackgroundClip = 'text'
  css.backgroundClip = 'text'
  css.color = 'transparent'
}

/**
 * Propriétés CSS (forme React) d'un pseudo stylé. `bg` : fond derrière le texte.
 * Seules des couleurs « #rrggbb » issues d'entiers validés et des valeurs écrites ici
 * arrivent dans le style : jamais de texte venu d'un utilisateur.
 */
export function nameCss(s: NameStyle | null, bg = DEFAULT_BG): Css {
  if (!s) return {}
  const css: Css = { ...fontCss(s.font) }
  const effect = s.effect ?? ''
  const own = (s.colors ?? []).map(c => hex(readable(c, bg)))
  const palette = PALETTES[effect]
  const colors = palette ?? own
  const angle = s.angle ?? 90
  let clipped = false
  if (effect === 'shimmer') {
    // Reflet qui glisse sur la couleur (ou le dégradé) : animé par la classe fc-name-shimmer.
    const base = colors.length ? colors : ['var(--fc-text, #f2f3f5)']
    const stops = base.length === 1 ? [base[0], base[0]] : base
    clipText(css, `linear-gradient(${angle}deg, ${stops.join(', ')}), linear-gradient(100deg, transparent 35%, rgba(255,255,255,.75) 50%, transparent 65%)`)
    css.backgroundSize = '100% 100%, 250% 100%'
    css.backgroundBlendMode = 'screen'
    clipped = true
  } else if (palette) {
    // Palette animée (arc-en-ciel, holo, feu, givre, chrome) : le fond glisse (profileStyles.css).
    clipText(css, `linear-gradient(${effect === 'fire' || effect === 'frost' ? 0 : angle}deg, ${palette.join(', ')})`)
    css.backgroundSize = effect === 'fire' || effect === 'frost' ? '100% 200%' : '300% 100%'
    clipped = true
  } else if (colors.length > 1 && effect !== 'wave') {
    // « wave » : une couleur par lettre (waveColors), le dégradé suivrait mal les lettres qui bougent.
    clipText(css, `linear-gradient(${angle}deg, ${colors.join(', ')})`)
    clipped = true
  } else if (colors.length >= 1) {
    css.color = colors[0]
  }
  const main = own[0] ?? palette?.[1] ?? 'currentColor'
  if (effect === 'glow' || effect === 'pulse') addShadows(css, clipped, [`0 0 6px ${main}`])
  // Contour (ancien effet) : ombres sombres, fonctionne aussi sur un dégradé.
  if (effect === 'outline') css.filter = 'drop-shadow(0 0 1px rgba(0,0,0,.9)) drop-shadow(0 0 1px rgba(0,0,0,.9))'
  if (effect === 'neon') addShadows(css, clipped, ['0 0 1px #fff', `0 0 4px ${main}`, `0 0 10px ${main}`, `0 0 18px ${main}`])
  if (effect === 'shadow3d') addShadows(css, clipped, ['1px 1px 0 rgba(0,0,0,.55)', '2px 2px 0 rgba(0,0,0,.45)', '3px 3px 0 rgba(0,0,0,.35)'])
  if (effect === 'retro') addShadows(css, clipped, ['2px 2px 0 #ff2bd6', '4px 4px 0 #00e5ff'])
  if (effect === 'fire') addShadows(css, clipped, ['0 0 4px rgba(255,109,0,.8)'])
  if (effect === 'frost') addShadows(css, clipped, ['0 0 4px rgba(127,211,255,.9)'])
  if (effect === 'holo') addShadows(css, clipped, ['0 0 3px rgba(208,168,255,.7)'])
  // Contour choisi (couleur + épaisseur) : trait dessiné sous le remplissage.
  const w = Math.min(OUTLINE_WIDTH_MAX, Math.max(0, s.outline_width ?? 0))
  if (w > 0) {
    css.WebkitTextStroke = `${w}px ${hex(s.outline ?? 0)}`
    css.paintOrder = 'stroke fill'
  }
  return css
}

/** Classes CSS d'un pseudo stylé (animations de profileStyles.css, figées si « réduire les animations »). */
export function nameClass(s: NameStyle | null): string {
  const e = s?.effect
  if (!e || !ANIMATED.has(e)) return ''
  return e === 'shimmer' ? ' fc-name-shimmer' : ` fc-name-fx fc-name-${e}`
}

/** « wave » : une couleur par lettre, interpolée le long du nom. */
export function waveColors(text: string, s: NameStyle | null, bg = DEFAULT_BG): { ch: string; color?: string }[] {
  const chars = Array.from(text)
  const stops = (s?.colors ?? []).map(c => readable(c, bg))
  if (stops.length < 2) return chars.map(ch => ({ ch }))
  return chars.map((ch, i) => {
    const pos = chars.length > 1 ? (i / (chars.length - 1)) * (stops.length - 1) : 0
    const k = Math.min(Math.floor(pos), stops.length - 2)
    const t = pos - k
    const [a, b] = [channels(stops[k]), channels(stops[k + 1])]
    const mixed = a.map((v, j) => Math.round(v + (b[j] - v) * t))
    return { ch, color: hex((mixed[0] << 16) | (mixed[1] << 8) | mixed[2]) }
  })
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
