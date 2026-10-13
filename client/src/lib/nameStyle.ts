// Style du pseudo (gratuit pour tous) : couleur unie ou dégradé, effet, police, contour.
// Fonctions pures, testées par scripts/nameStyle.test.mjs ; le mobile applique les
// mêmes règles (mobile/src/lib/nameStyle.ts). Le serveur ne stocke que des couleurs
// 0xRRGGBB, des nombres bornés et des identifiants en liste blanche
// (server/src/models/profile_style.rs) : aucun CSS venant d'un utilisateur n'arrive ici.

/** Effets : même liste, dans le même ordre, que le serveur et le mobile (vérifié par les tests). */
export const NAME_EFFECTS = [
  '', 'shimmer', 'glow', 'outline', 'neon', 'rainbow', 'wave', 'glitch', 'shadow3d',
  'fire', 'frost', 'pulse', 'holo', 'chrome', 'retro', 'float', 'sparkle',
  'glow2', 'flicker', 'huecycle', 'electric', 'bounce', 'typewriter', 'breathe', 'gold',
  'aurora', 'matrix', 'draw', 'longshadow', 'vaporwave', 'gradshift', 'jelly', 'shake',
  'blurin', 'scanline', 'emboss', 'letterpress', 'comic', 'stencil', 'smoke', 'stars',
  'candy', 'pixel', 'galaxy', 'lava', 'toxic', 'ghost', 'heartbeat',
] as const
/** Polices : même liste que le serveur et le mobile. */
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
/** Type de dégradé : '' = linéaire (avec angle), radial, conique, flow = linéaire animé. */
export const NAME_GRADIENTS = ['', 'radial', 'conic', 'flow'] as const
/** Style du contour : '' = trait simple, double (2ᵉ couleur à l'extérieur), lumineux. */
export const OUTLINE_STYLES = ['', 'double', 'glow'] as const
/** Fonds d'une marque de clan (étiquette perso ou tag de serveur). */
export const TAG_BADGES = ['', 'solid', 'soft', 'outline', 'gradient', 'glass', 'pill', 'neon', 'plain'] as const
/** Icônes d'une marque (identifiants traduits en icônes par components/ui/ClanTag.tsx). */
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

export interface NameStyle {
  colors?: number[]
  angle?: number
  /** Type de dégradé (2 couleurs ou plus). */
  gradient?: NameGradient
  effect?: NameEffect
  /** Intensité de l'effet (1-10, 5 par défaut). */
  intensity?: number
  /** Vitesse de l'animation (1-10, 5 par défaut). */
  speed?: number
  font?: NameFont
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

/** Effets qui imposent leur propre palette (les couleurs choisies sont ignorées). */
const PALETTES: Partial<Record<NameEffect, string[]>> = {
  rainbow: ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff3b30'],
  holo: ['#ff9ff3', '#a0e7ff', '#c4ffb5', '#fff3a0', '#d0a8ff', '#ff9ff3'],
  fire: ['#fff3b0', '#ffb300', '#ff6d00', '#ff3d00'],
  frost: ['#ffffff', '#bdeeff', '#7fd3ff', '#ffffff'],
  chrome: ['#ffffff', '#c7ced6', '#7d8894', '#e9eef2', '#9aa4ae', '#ffffff'],
  gold: ['#fff1b8', '#f5c542', '#b8860b', '#ffe27a', '#c9971c'],
  aurora: ['#7cffcb', '#4fd1ff', '#a77bff', '#ff7ad9', '#7cffcb'],
  matrix: ['#d9ffe0', '#00ff66', '#00b347', '#00ff66'],
  vaporwave: ['#ff71ce', '#01cdfe', '#b967ff', '#fffb96', '#ff71ce'],
  electric: ['#ffffff', '#7df9ff', '#4dabff', '#ffffff'],
  galaxy: ['#8ef6ff', '#a78bfa', '#ff7ad9', '#7c9dff', '#8ef6ff'],
  lava: ['#ffd000', '#ff8c00', '#ff3b00', '#ff8c00', '#ffd000'],
  toxic: ['#eaff00', '#7dff00', '#39ff14', '#b6ff00'],
}
/** Palettes verticales (le fond glisse de bas en haut). */
const VERTICAL: ReadonlySet<string> = new Set(['fire', 'frost', 'matrix'])
/** Effets sans couleur choisie qui ont besoin d'un dégradé de base. */
const FALLBACK = ['#ff5c8a', '#5ee7df']
const NEEDS_COLORS: ReadonlySet<string> = new Set(['huecycle', 'gradshift', 'candy', 'stars', 'scanline'])
/** Effets animés : la classe CSS fc-name-<effet> porte l'animation (profileStyles.css). */
const ANIMATED: ReadonlySet<string> = new Set([
  'shimmer', 'neon', 'rainbow', 'wave', 'glitch', 'fire', 'pulse', 'holo', 'chrome', 'float', 'sparkle',
  'flicker', 'huecycle', 'electric', 'bounce', 'typewriter', 'breathe', 'gold', 'aurora', 'matrix', 'draw',
  'vaporwave', 'gradshift', 'jelly', 'shake', 'blurin', 'scanline', 'smoke', 'stars', 'candy', 'galaxy',
  'lava', 'toxic', 'ghost', 'heartbeat',
])
/** Effets rendus lettre par lettre (un <span class="fc-ch"> par caractère, texte React). */
const PER_LETTER: ReadonlySet<string> = new Set(['wave', 'bounce', 'jelly', 'typewriter'])
/** Durée de l'animation selon la vitesse 1-10 (multiplicateur, 1 = normal). */
const SPEED_K = [2.5, 2, 1.6, 1.25, 1, 0.8, 0.65, 0.5, 0.4, 0.3]

/** Fond sombre par défaut de l'appli (contraste minimal calculé contre lui). */
export const DEFAULT_BG = 0x1e1f22
/** Ratio WCAG minimal d'un pseudo coloré (texte gras/grand : 3:1). */
export const MIN_CONTRAST = 3

export type Css = Record<string, string | undefined>

/**
 * Polices : piles de polices système, Inter / JetBrains Mono (@fontsource) et six polices
 * OFL embarquées (client/public/fonts, @font-face dans bundledFonts.css : « FC … »). Rien
 * n'est téléchargé ailleurs (CSP font-src 'self'). Une police absente retombe sur la suivante
 * de la pile, puis sur une police embarquée ; certaines ajoutent un réglage (graisse, chasse,
 * casse, petites capitales). Chaque pile tient en 100 caractères (user_settings.font_family).
 */
const SERIF = 'Georgia, "Times New Roman", "FC Metric Serif", serif'
const MONO = 'ui-monospace, "Cascadia Code", Consolas, "FC Metric Mono", monospace'
const FONT_CSS: Record<string, Css> = {
  serif: { fontFamily: SERIF },
  mono: { fontFamily: MONO },
  rounded: { fontFamily: 'ui-rounded, "Nunito", "Segoe UI Rounded", "Arial Rounded MT Bold", sans-serif' },
  heavy: { fontWeight: '900' },
  cursive: { fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' },
  slab: { fontFamily: 'Rockwell, "Roboto Slab", "Zilla Slab", "Clarendon", "Courier New", serif', fontWeight: '700' },
  condensed: { fontFamily: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", sans-serif', fontStretch: 'condensed' },
  wide: { fontStretch: 'expanded', letterSpacing: '0.14em', fontWeight: '600' },
  elegant: { fontFamily: 'Didot, "Bodoni 72", "Bodoni MT", "Playfair Display", "Hoefler Text", Georgia, serif', fontStyle: 'italic' },
  typewriter: { fontFamily: '"American Typewriter", "Courier New", Courier, "FC Metric Mono", monospace' },
  gothic: { fontFamily: '"Old English Text MT", "UnifrakturMaguntia", "Luminari", "Apple Chancery", fantasy' },
  comic: { fontFamily: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", Chalkboard, cursive' },
  impact: { fontFamily: 'Impact, Haettenschweiler, "Arial Black", "Franklin Gothic Bold", sans-serif', letterSpacing: '0.02em' },
  smallcaps: { fontFamily: SERIF, fontVariant: 'small-caps', letterSpacing: '0.04em' },
  light: { fontWeight: '300', letterSpacing: '0.03em' },
  handwritten: { fontFamily: '"Bradley Hand", "Segoe Print", "Ink Free", Chalkduster, "Comic Neue", cursive' },
  futuristic: { fontFamily: 'Eurostile, Orbitron, "Bank Gothic", "Agency FB", Michroma, "Segoe UI", sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase' },
  retro: { fontFamily: '"Cooper Black", "Cooper Std", Souvenir, "Bookman Old Style", Georgia, serif', fontWeight: '800' },
  stencil: { fontFamily: 'Stencil, "Stencil Std", "Big John", Impact, fantasy', textTransform: 'uppercase', letterSpacing: '0.06em' },
  code: { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: '700' },
  italic: { fontStyle: 'italic', fontWeight: '600' },
  arial: { fontFamily: 'Arial, Helvetica, "FC Metric Sans", sans-serif' },
  times: { fontFamily: '"Times New Roman", Times, "FC Metric Serif", serif' },
  courier: { fontFamily: '"Courier New", Courier, "FC Metric Mono", monospace' },
  cambria: { fontFamily: 'Cambria, "FC Book Serif", Georgia, serif' },
  calibri: { fontFamily: 'Calibri, "FC Humanist", "Segoe UI", sans-serif' },
  display: { fontFamily: '"FC Display", "Inter Variable", sans-serif', letterSpacing: '-0.01em' },
  inter: { fontFamily: '"Inter Variable", Inter, sans-serif' },
  interthin: { fontFamily: '"Inter Variable", Inter, sans-serif', fontWeight: '200', letterSpacing: '0.02em' },
  jetbrains: { fontFamily: '"JetBrains Mono", "FC Metric Mono", monospace', fontWeight: '400' },
  georgia: { fontFamily: 'Georgia, "FC Book Serif", serif' },
  palatino: { fontFamily: '"Palatino Linotype", Palatino, "Book Antiqua", "FC Book Serif", serif' },
  garamond: { fontFamily: 'Garamond, "EB Garamond", "Adobe Garamond Pro", "FC Book Serif", serif' },
  baskerville: { fontFamily: 'Baskerville, "Baskerville Old Face", "Libre Baskerville", "FC Book Serif", serif' },
  bodoni: { fontFamily: '"Bodoni 72", "Bodoni MT", Didot, "FC Metric Serif", serif', fontWeight: '700' },
  optima: { fontFamily: 'Optima, Candara, "Segoe UI", "FC Humanist", sans-serif' },
  futura: { fontFamily: 'Futura, "Century Gothic", "Trebuchet MS", "FC Metric Sans", sans-serif' },
  century: { fontFamily: '"Century Gothic", AppleGothic, Futura, "FC Metric Sans", sans-serif' },
  verdana: { fontFamily: 'Verdana, Geneva, "DejaVu Sans", "FC Humanist", sans-serif' },
  tahoma: { fontFamily: 'Tahoma, Geneva, "FC Humanist", sans-serif' },
  trebuchet: { fontFamily: '"Trebuchet MS", "Lucida Grande", "FC Humanist", sans-serif' },
  gill: { fontFamily: '"Gill Sans", "Gill Sans MT", Calibri, "FC Humanist", sans-serif' },
  helvetica: { fontFamily: '"Helvetica Neue", Helvetica, Arial, "FC Metric Sans", sans-serif' },
  avenir: { fontFamily: '"Avenir Next", Avenir, "Segoe UI", "FC Humanist", sans-serif' },
  copperplate: { fontFamily: 'Copperplate, "Copperplate Gothic Light", "FC Book Serif", serif', fontVariant: 'small-caps', letterSpacing: '0.08em' },
  papyrus: { fontFamily: 'Papyrus, Herculanum, "FC Book Serif", fantasy' },
  marker: { fontFamily: '"Marker Felt", "Segoe Print", "Comic Sans MS", cursive' },
  chalk: { fontFamily: 'Chalkduster, "Chalkboard SE", "Segoe Print", cursive' },
  brush: { fontFamily: '"Brush Script MT", "Brush Script Std", "Segoe Script", cursive' },
  calligraphy: { fontFamily: '"Snell Roundhand", Zapfino, "Lucida Handwriting", "Apple Chancery", cursive' },
  console: { fontFamily: '"Lucida Console", Monaco, "Lucida Sans Typewriter", "FC Metric Mono", monospace' },
  arialblack: { fontFamily: '"Arial Black", "Arial Bold", Gadget, "FC Display", sans-serif', fontWeight: '900' },
  franklin: { fontFamily: '"Franklin Gothic Medium", "Franklin Gothic", "ITC Franklin Gothic", "FC Metric Sans", sans-serif' },
  bookman: { fontFamily: '"Bookman Old Style", "URW Bookman", Bookman, "FC Book Serif", serif' },
  segoe: { fontFamily: '"Segoe UI", "Segoe UI Variable", "FC Humanist", sans-serif' },
  hoefler: { fontFamily: '"Hoefler Text", "Iowan Old Style", Constantia, "FC Book Serif", serif' },
  candara: { fontFamily: 'Candara, Optima, "FC Humanist", sans-serif' },
  cascadia: { fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", monospace' },
  lucida: { fontFamily: '"Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", "FC Humanist", sans-serif' },
  caps: { textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: '700' },
  spaced: { letterSpacing: '0.3em' },
  tight: { letterSpacing: '-0.05em', fontWeight: '800' },
  serifcaps: { fontFamily: SERIF, textTransform: 'uppercase', letterSpacing: '0.12em' },
  monocaps: { fontFamily: MONO, textTransform: 'uppercase', letterSpacing: '0.05em' },
  lower: { textTransform: 'lowercase', fontWeight: '300', letterSpacing: '0.02em' },
}

/** CSS (forme React) d'une police de la liste blanche ; {} si inconnue. */
export function fontCss(font?: string | null): Css {
  return (font && FONT_CSS[font]) || {}
}

/**
 * Polices du pseudo proposées aussi pour toute l'appli (Apparence > police) : celles qui
 * changent de famille, sans casse ni chasse imposée (illisible sur tout un écran).
 */
export function nameFontStacks(): { id: string; stack: string }[] {
  return NAME_FONTS.flatMap(id => {
    const css = FONT_CSS[id]
    if (!css?.fontFamily || css.textTransform || css.fontStyle || css.fontVariant) return []
    return [{ id, stack: css.fontFamily }]
  })
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
/** Niveau 1-10 (intensité, vitesse) ; absent ou invalide → LEVEL_DEFAULT. */
const level = (v: unknown) => (Number.isFinite(v) ? Math.min(LEVEL_MAX, Math.max(1, Math.round(v as number))) : LEVEL_DEFAULT)

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
 * Style valide et non vide ? (le serveur l'a déjà validé ; garde contre un cache ancien).
 * Mêmes normalisations que le serveur : dégradé seulement avec 2 couleurs, intensité et
 * vitesse seulement avec un effet, seconde couleur seulement pour le contour double.
 */
export function cleanStyle(s: unknown): NameStyle | null {
  if (!s || typeof s !== 'object') return null
  const o = s as NameStyle
  const colors = Array.isArray(o.colors) ? o.colors.filter(isColor).slice(0, NAME_COLORS_MAX) : []
  const effect = inList(NAME_EFFECTS, o.effect)
  const font = inList(NAME_FONTS, o.font)
  const angle = Number.isFinite(o.angle) ? Math.min(360, Math.max(0, o.angle!)) : 90
  const width = Number.isInteger(o.outline_width) ? Math.min(OUTLINE_WIDTH_MAX, Math.max(0, o.outline_width!)) : 0
  const tag = cleanTagStyle(o.tag)
  if (!colors.length && !effect && !font && !width && !tag) return null
  const out: NameStyle = { colors, angle, effect, font }
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
    if (personal.outline_width) {
      kept.outline = personal.outline
      kept.outline_width = personal.outline_width
      if (personal.outline_style) kept.outline_style = personal.outline_style
      if (personal.outline2 != null) kept.outline2 = personal.outline2
    }
    return { personal: kept, useRole: true }
  }
  return { personal, useRole: false }
}

/** Ombres : text-shadow sur un texte plein ; drop-shadow (filtre) sur un texte en dégradé,
 *  où text-shadow serait peint par-dessus le fond découpé. */
function addShadows(css: Css, clipped: boolean, shadows: string[]) {
  if (!shadows.length) return
  if (clipped) addFilter(css, shadows.map(s => `drop-shadow(${s})`))
  else css.textShadow = [css.textShadow, ...shadows].filter(Boolean).join(', ')
}

function addFilter(css: Css, parts: string[]) {
  css.filter = [css.filter, ...parts].filter(Boolean).join(' ')
}

function clipText(css: Css, image: string) {
  css.backgroundImage = image
  css.WebkitBackgroundClip = 'text'
  css.backgroundClip = 'text'
  css.color = 'transparent'
}

/** Dégradé des couleurs choisies selon le type (linéaire, radial, conique, flow). */
export function gradientImage(kind: string | undefined, angle: number, stops: string[]): string {
  if (kind === 'radial') return `radial-gradient(ellipse at center, ${stops.join(', ')})`
  if (kind === 'conic') return `conic-gradient(from ${angle}deg at 50% 50%, ${[...stops, stops[0]].join(', ')})`
  if (kind === 'flow') return `linear-gradient(${angle}deg, ${[...stops, stops[0]].join(', ')})`
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`

/** Masques (pochoir, pixels) : formes constantes, jamais de valeur venue d'un utilisateur. */
const MASKS: Record<string, { image: string; size?: string; composite?: string; webkitComposite?: string }> = {
  stencil: { image: 'linear-gradient(180deg, #000 0 46%, transparent 46% 56%, #000 56%)' },
  pixel: {
    image: 'linear-gradient(90deg, #000 70%, transparent 0), linear-gradient(#000 70%, transparent 0)',
    size: '2px 2px',
    composite: 'intersect',
    webkitComposite: 'source-in',
  },
}

/** Points d'étoiles (deux trames décalées) posés sur un fond de texte découpé. */
const STAR_LAYERS = 'radial-gradient(circle, #fff 0 1px, transparent 1.5px), radial-gradient(circle, rgba(255,255,255,.75) 0 .6px, transparent 1px)'

/**
 * Propriétés CSS (forme React) d'un pseudo stylé. `bg` : fond derrière le texte.
 * Seules des couleurs « #rrggbb » issues d'entiers validés, des nombres bornés et des
 * valeurs écrites ici arrivent dans le style : jamais de texte venu d'un utilisateur.
 */
export function nameCss(s: NameStyle | null, bg = DEFAULT_BG): Css {
  if (!s) return {}
  const css: Css = { ...fontCss(s.font) }
  const effect = s.effect ?? ''
  const ownRaw = (s.colors ?? []).slice(0, NAME_COLORS_MAX).map(c => hex(readable(c, bg)))
  const own = !ownRaw.length && NEEDS_COLORS.has(effect) ? FALLBACK : ownRaw
  const palette = PALETTES[effect]
  const colors = palette ?? own
  const angle = s.angle ?? 90
  const f = (effect ? level(s.intensity) : LEVEL_DEFAULT) / LEVEL_DEFAULT
  const letters = PER_LETTER.has(effect)
  const main = own[0] ?? palette?.[1] ?? 'currentColor'
  const second = own[1] ?? palette?.[2] ?? main
  const base = colors.length ? colors : ['var(--fc-text, #f2f3f5)']
  const baseImage = gradientImage(s.gradient === 'flow' ? '' : s.gradient, angle, base.length === 1 ? [base[0], base[0]] : base)
  let clipped = false
  if (effect === 'shimmer' || effect === 'gold') {
    // Reflet qui glisse sur la couleur (ou le dégradé) : animé par la classe de l'effet.
    clipText(css, `${baseImage}, linear-gradient(100deg, transparent 35%, rgba(255,255,255,.75) 50%, transparent 65%)`)
    css.backgroundSize = '100% 100%, 250% 100%'
    css.backgroundBlendMode = 'screen'
    clipped = true
  } else if (effect === 'candy') {
    clipText(css, `repeating-linear-gradient(45deg, ${main} 0 6px, ${own[1] ?? '#ffffff'} 6px 12px)`)
    clipped = true
  } else if (effect === 'scanline') {
    clipText(css, `repeating-linear-gradient(0deg, rgba(0,0,0,.45) 0 1px, transparent 1px 3px), ${baseImage}`)
    clipped = true
  } else if (effect === 'stars' || effect === 'galaxy') {
    clipText(css, `${STAR_LAYERS}, ${effect === 'galaxy' ? gradientImage('', 90, colors) : baseImage}`)
    css.backgroundSize = effect === 'galaxy' ? '7px 7px, 11px 9px, 300% 100%' : '7px 7px, 11px 9px, 100% 100%'
    clipped = true
  } else if (effect === 'lava') {
    clipText(css, `radial-gradient(circle at 20% 50%, ${colors[0]} 0, transparent 40%), radial-gradient(circle at 80% 50%, ${colors[1]} 0, transparent 45%), linear-gradient(90deg, ${colors[2]}, ${colors[1]}, ${colors[2]})`)
    css.backgroundSize = '200% 100%'
    clipped = true
  } else if (palette) {
    // Palette (arc-en-ciel, holo, feu, givre, chrome, aurore…) : le fond glisse (profileStyles.css).
    const vertical = VERTICAL.has(effect)
    clipText(css, `linear-gradient(${vertical ? 0 : angle}deg, ${palette.join(', ')})`)
    css.backgroundSize = vertical ? '100% 300%' : effect === 'aurora' ? '400% 100%' : '300% 100%'
    clipped = true
  } else if (effect === 'draw') {
    // Trait puis remplissage : couleur pleine (le remplissage est animé par la classe).
    css.color = main === 'currentColor' ? undefined : main
  } else if (colors.length > 1 && !letters) {
    // Lettre par lettre (vague, rebond…) : une couleur par lettre (waveColors), le dégradé suivrait mal.
    clipText(css, gradientImage(s.gradient, angle, colors))
    if (s.gradient === 'flow' || effect === 'gradshift') css.backgroundSize = '200% 100%'
    clipped = true
  } else if (colors.length >= 1) {
    css.color = colors[0]
  }
  switch (effect) {
    case 'glow':
    case 'pulse':
      addShadows(css, clipped, [`0 0 ${px(6 * f)} ${main}`])
      break
    case 'glow2':
      addShadows(css, clipped, [`0 0 ${px(3 * f)} ${main}`, `0 0 ${px(10 * f)} ${second}`, `0 0 ${px(18 * f)} ${second}`])
      break
    case 'outline':
      // Contour (ancien effet) : ombres sombres, fonctionne aussi sur un dégradé.
      addFilter(css, ['drop-shadow(0 0 1px rgba(0,0,0,.9))', 'drop-shadow(0 0 1px rgba(0,0,0,.9))'])
      break
    case 'neon':
    case 'flicker':
      addShadows(css, clipped, ['0 0 1px #fff', `0 0 ${px(4 * f)} ${main}`, `0 0 ${px(10 * f)} ${main}`, `0 0 ${px(18 * f)} ${main}`])
      break
    case 'shadow3d':
      addShadows(css, clipped, ['1px 1px 0 rgba(0,0,0,.55)', '2px 2px 0 rgba(0,0,0,.45)', '3px 3px 0 rgba(0,0,0,.35)'])
      break
    case 'longshadow': {
      const n = Math.max(2, Math.min(16, Math.round(8 * f)))
      addShadows(css, clipped, Array.from({ length: n }, (_, i) => `${i + 1}px ${i + 1}px 0 rgba(0,0,0,${(0.5 * (1 - i / n)).toFixed(2)})`))
      break
    }
    case 'retro':
      addShadows(css, clipped, ['2px 2px 0 #ff2bd6', '4px 4px 0 #00e5ff'])
      break
    case 'vaporwave':
      addShadows(css, clipped, [`0 0 ${px(5 * f)} rgba(255,113,206,.7)`, '2px 2px 0 rgba(1,205,254,.6)'])
      break
    case 'fire':
    case 'lava':
      addShadows(css, clipped, [`0 0 ${px(4 * f)} rgba(255,109,0,.8)`])
      break
    case 'frost':
      addShadows(css, clipped, [`0 0 ${px(4 * f)} rgba(127,211,255,.9)`])
      break
    case 'holo':
      addShadows(css, clipped, [`0 0 ${px(3 * f)} rgba(208,168,255,.7)`])
      break
    case 'gold':
      addShadows(css, clipped, [`0 0 ${px(3 * f)} rgba(255,200,60,.6)`])
      break
    case 'aurora':
      addShadows(css, clipped, [`0 0 ${px(5 * f)} rgba(124,255,203,.5)`])
      break
    case 'matrix':
      addShadows(css, clipped, [`0 0 ${px(4 * f)} rgba(0,255,102,.8)`])
      break
    case 'electric':
      addShadows(css, clipped, [`0 0 ${px(3 * f)} #7df9ff`, `0 0 ${px(8 * f)} #4dabff`])
      break
    case 'galaxy':
      addShadows(css, clipped, [`0 0 ${px(4 * f)} rgba(167,139,250,.6)`])
      break
    case 'toxic':
      addShadows(css, clipped, [`0 ${px(2 * f)} 0 #39ff14`, `0 ${px(3 * f)} ${px(4 * f)} rgba(80,255,0,.6)`])
      break
    case 'emboss':
      addShadows(css, clipped, ['-1px -1px 0 rgba(255,255,255,.35)', '1px 1px 0 rgba(0,0,0,.7)'])
      break
    case 'letterpress':
      addShadows(css, clipped, ['0 1px 0 rgba(255,255,255,.2)', '0 -1px 0 rgba(0,0,0,.85)'])
      css.opacity = '0.9'
      break
    case 'comic':
      if (!s.outline_width) {
        css.WebkitTextStroke = `${Math.max(1, Math.round(1.5 * f))}px #000000`
        css.paintOrder = 'stroke fill'
      }
      addShadows(css, clipped, [`${px(2 * f)} ${px(2 * f)} 0 #000`])
      break
    case 'smoke':
      addShadows(css, clipped, [`0 0 ${px(4 * f)} rgba(200,200,210,.6)`])
      break
    case 'ghost':
      addShadows(css, clipped, [`0 0 ${px(6 * f)} rgba(255,255,255,.6)`])
      break
    case 'heartbeat':
      addShadows(css, clipped, [`0 0 ${px(6 * f)} #ff4d8d`])
      break
    case 'pixel':
      addShadows(css, clipped, ['1px 1px 0 rgba(0,0,0,.6)'])
      break
    case 'draw':
      if (!s.outline_width) {
        css.WebkitTextStroke = `${Math.max(1, Math.round(f))}px ${main === 'currentColor' ? 'currentColor' : main}`
        css.paintOrder = 'stroke fill'
      }
      break
  }
  const mask = MASKS[effect]
  if (mask) {
    css.WebkitMaskImage = mask.image
    css.maskImage = mask.image
    if (mask.size) { css.WebkitMaskSize = mask.size; css.maskSize = mask.size }
    if (mask.composite) { css.WebkitMaskComposite = mask.webkitComposite; css.maskComposite = mask.composite }
  }
  // Réglages lus par les animations (profileStyles.css) : nombres bornés seulement.
  const animated = ANIMATED.has(effect) || flowing(s)
  if (animated) {
    css['--fc-fx-k'] = String(SPEED_K[level(s.speed) - 1])
    css['--fc-fx-i'] = String(f)
  }
  // Contour choisi (couleur + épaisseur + style) : trait dessiné sous le remplissage.
  const w = Math.min(OUTLINE_WIDTH_MAX, Math.max(0, s.outline_width ?? 0))
  if (w > 0) {
    const oc = hex(s.outline ?? 0)
    css.WebkitTextStroke = `${w}px ${oc}`
    css.paintOrder = 'stroke fill'
    if (s.outline_style === 'double') {
      const ring = hex(s.outline2 ?? 0xffffff)
      addFilter(css, [`drop-shadow(1px 0 0 ${ring})`, `drop-shadow(-1px 0 0 ${ring})`, `drop-shadow(0 1px 0 ${ring})`, `drop-shadow(0 -1px 0 ${ring})`])
    } else if (s.outline_style === 'glow') {
      addFilter(css, [`drop-shadow(0 0 ${w + 2}px ${oc})`, `drop-shadow(0 0 ${2 * w + 4}px ${oc})`])
    }
  }
  return css
}

/** Dégradé animé (« flow ») sans effet animé qui prendrait la main sur l'animation. */
function flowing(s: NameStyle | null): boolean {
  const e = s?.effect ?? ''
  return s?.gradient === 'flow' && (s.colors?.length ?? 0) > 1 && !ANIMATED.has(e) && !PALETTES[e] && !PER_LETTER.has(e) && e !== 'draw'
}

/** Classes CSS d'un pseudo stylé (animations de profileStyles.css, figées si « réduire les animations »). */
export function nameClass(s: NameStyle | null): string {
  const e = s?.effect
  if (e && ANIMATED.has(e)) return e === 'shimmer' ? ' fc-name-shimmer' : ` fc-name-fx fc-name-${e}`
  return flowing(s) ? ' fc-name-fx fc-name-flow' : ''
}

/** Effet rendu lettre par lettre (vague, rebond, gelée, machine à écrire) ? */
export function perLetter(s: NameStyle | null): boolean {
  return PER_LETTER.has(s?.effect ?? '')
}

/** Une couleur par lettre, interpolée le long du nom (effets lettre par lettre). */
export function waveColors(text: string, s: NameStyle | null, bg = DEFAULT_BG): { ch: string; color?: string }[] {
  const chars = Array.from(text)
  const stops = (s?.colors ?? []).slice(0, NAME_COLORS_MAX).map(c => readable(c, bg))
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

/** Décalage d'animation de la i-ième lettre (suit la vitesse via --fc-fx-k). */
export const letterDelay = (i: number) => `calc(${(i * 0.08).toFixed(2)}s * var(--fc-fx-k, 1))`

/** Nom affiché : surnom de serveur > nom d'affichage > nom d'utilisateur. */
export function shownName(username: string, displayName?: string | null, nickname?: string | null): string {
  return nickname?.trim() || displayName?.trim() || username
}

/** Version fixe (première image) d'un avatar/bannière animé : `a_<id>.gif` → `a_<id>_s.gif`. */
export function stillUrl(url: string): string | null {
  const m = url.match(/^(.*\/a_[0-9a-f-]+)\.(gif|png|webp)$/i)
  return m ? `${m[1]}_s.${m[2]}` : null
}

/** Valeur d'un <input type="color"> (« #rrggbb ») → entier 0xRRGGBB ; null si invalide. */
export function colorFromInput(v: string): number | null {
  return /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : null
}

/** Entier borné (curseurs, épaisseurs) : NaN → `min`. */
export function clampInt(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min
}
