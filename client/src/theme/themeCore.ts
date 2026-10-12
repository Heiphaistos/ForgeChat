/**
 * Thèmes ForgeChat : modèle, catalogue, validation et contraste.
 * Module PUR, copié à l'identique dans mobile/src/theme/themeCore.ts (vérifié par
 * client/scripts/themes.test.mjs) : web, bureau et Android partagent les mêmes thèmes.
 *
 * Un thème n'est que des DONNÉES validées (couleurs #rrggbb, nombres bornés, URL https) :
 * jamais de CSS libre, un thème importé ne peut donc rien injecter.
 */

export const SURFACES = ['bg', 'sidebar', 'channel', 'chat', 'input', 'hover'] as const
export const COLOR_KEYS = [...SURFACES, 'border', 'text', 'muted', 'accent', 'link', 'mention'] as const
export type ColorKey = (typeof COLOR_KEYS)[number]
export type ThemeColors = Record<ColorKey, string>
export type Scheme = 'dark' | 'light'

export interface ThemeGradient {
  /** Angle CSS en degrés (0-360). */
  angle: number
  /** 2 ou 3 couleurs #rrggbb. */
  stops: string[]
}

export interface ThemeImage {
  /** https://… ou data:image/(png|jpeg|webp|gif);base64,… (fichier local). */
  url: string
  /** Flou de l'image en px (0-30). */
  blur: number
  /** Voile (noir en sombre, blanc en clair) posé sur l'image, 0-0.9. */
  dim: number
}

export interface ThemeSpec {
  name: string
  scheme: Scheme
  colors: ThemeColors
  gradient: ThemeGradient | null
  image: ThemeImage | null
  /** Opacité des panneaux au-dessus d'un dégradé ou d'une image (0.15-1). */
  opacity: number
  /** Flou « verre dépoli » des menus et fenêtres flottantes, px (0-40). */
  blur: number
  /** Facteur des arrondis (0 = carré, 1 = normal, 2 = très arrondi). */
  radius: number
  /** Bordures fines autour des panneaux (indispensable en AMOLED). */
  outline: boolean
  /** Seconde couleur d'accent : boutons et pastilles en dégradé accent → accent2 (null = accent uni). */
  accent2: string | null
  /** Motif discret dessiné sur le fond (couleur du texte, très atténuée). */
  pattern: Pattern
  /** Opacité du motif (0-0.4). */
  patternOpacity: number
  /** Saturation des couleurs du thème (0 = niveaux de gris, 1 = telle quelle, 2 = très vive). */
  saturation: number
}

export const PATTERNS = ['none', 'dots', 'grid', 'lines', 'diagonal', 'checker', 'waves'] as const
export type Pattern = (typeof PATTERNS)[number]

export interface CustomTheme extends ThemeSpec {
  id: string
}

export const PRESET_GROUPS = [
  'base', 'gradient', 'classic', 'tinted', 'light', 'amoled', 'pastel', 'neon', 'retro',
  'iridescent', 'glass', 'contrast', 'nature', 'seasonal',
] as const
export type PresetGroup = (typeof PRESET_GROUPS)[number]
export interface Preset {
  id: string
  group: PresetGroup
  label: { fr: string; en: string }
  /** Construit à la première lecture (plus d'un millier de thèmes : rien n'est calculé au chargement). */
  readonly spec: ThemeSpec
  /** Teinte dominante (0-360) des thèmes générés, pour le filtre par couleur. */
  hue?: number
  /** Famille du thème généré (FAMILIES). */
  family?: string
}

// ─── Couleurs ────────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{6}$/i
export const isHex = (c: unknown): c is string => typeof c === 'string' && HEX_RE.test(c)

export function rgbOf(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}

const h2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** Mélange : t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return `#${h2(x[0] + (y[0] - x[0]) * t)}${h2(x[1] + (y[1] - x[1]) * t)}${h2(x[2] + (y[2] - x[2]) * t)}`
}

/** Teinte (degrés), saturation et luminosité (0-100) → #rrggbb. */
export function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360
  const ss = Math.min(100, Math.max(0, s)) / 100
  const ll = Math.min(100, Math.max(0, l)) / 100
  const a = ss * Math.min(ll, 1 - ll)
  const f = (n: number) => {
    const k = (n + hh / 30) % 12
    return (ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255
  }
  return `#${h2(f(0))}${h2(f(8))}${h2(f(4))}`
}

/** #rrggbb → [teinte 0-360, saturation 0-100, luminosité 0-100]. */
export function toHsl(c: string): [number, number, number] {
  const [r, g, b] = rgbOf(c).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

/** Multiplie la saturation d'une couleur (0 = gris). */
export function saturate(c: string, factor: number): string {
  if (factor === 1) return c
  const [h, s, l] = toHsl(c)
  return hsl(h, s * factor, l)
}

/** Couleur `fg` d'opacité `alpha` posée sur `bg` (opaque). */
export const over = (fg: string, alpha: number, bg: string) => mix(bg, fg, alpha)

function luminance(c: string): number {
  const [r, g, b] = rgbOf(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Rapport de contraste WCAG (1 à 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const minContrast = (fg: string, bgs: string[]) => Math.min(...bgs.map((b) => contrast(fg, b)))

/** Rapproche `fg` du blanc (sombre) ou du noir (clair) jusqu'à atteindre `min` sur tous les fonds. */
export function ensureContrast(fg: string, bgs: string[], min: number, scheme: Scheme): string {
  const target = scheme === 'dark' ? '#ffffff' : '#000000'
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(fg, target, t)
    if (minContrast(c, bgs) >= min) return c
  }
  return target
}

// ─── Fond et surfaces effectives (pour le contraste) ────────────────────────

/** Le thème laisse-t-il voir un fond (dégradé ou image) à travers les panneaux ? */
export const isTranslucent = (s: ThemeSpec) => !!(s.gradient || s.image) && s.opacity < 1

/** Couleurs possibles sous les panneaux. Image : pire cas (pixel le plus clair en sombre, le plus foncé en clair). */
export function backdropSamples(s: ThemeSpec): string[] {
  if (s.image) {
    const veil = s.scheme === 'dark' ? '#000000' : '#ffffff'
    return [over(veil, s.image.dim, '#ffffff'), over(veil, s.image.dim, '#000000')]
  }
  if (s.gradient) {
    const st = s.gradient.stops
    const out = [...st]
    for (let i = 0; i + 1 < st.length; i++) out.push(mix(st[i] ?? '#000000', st[i + 1] ?? '#000000', 0.5))
    return out
  }
  return [s.colors.bg]
}

/** Couleurs réellement vues : `main` = fonds de texte courant, `all` = + saisie et survol. */
export function effectiveSurfaces(s: ThemeSpec): { main: string[]; all: string[] } {
  const a = isTranslucent(s) ? s.opacity : 1
  const c = s.colors
  const main: string[] = []
  const all: string[] = []
  for (const base of backdropSamples(s)) {
    const root = over(c.bg, a, base)
    const channel = over(c.channel, a, root)
    const m = [root, over(c.sidebar, a, root), channel, over(c.chat, a, root)]
    main.push(...m)
    all.push(...m, over(c.input, a, channel), over(c.hover, a, channel))
  }
  return { main, all }
}

/** Contrastes minimaux du thème (texte sur tout, atténué / liens / accent sur les fonds principaux). */
export function contrastReport(s: ThemeSpec) {
  const { main, all } = effectiveSurfaces(s)
  return {
    text: minContrast(s.colors.text, all),
    muted: minContrast(s.colors.muted, main),
    link: minContrast(s.colors.link, main),
    accent: minContrast(s.colors.accent, main),
  }
}

/** Corrige les couleurs de texte trop peu contrastées (AA 4.5 ; mentions 3). L'accent (boutons) reste au choix. */
export function fixContrast(s: ThemeSpec): ThemeSpec {
  const { main, all } = effectiveSurfaces(s)
  const text = ensureContrast(s.colors.text, all, 4.5, s.scheme)
  return {
    ...s,
    colors: {
      ...s.colors,
      text,
      muted: ensureContrast(s.colors.muted, main, 4.5, s.scheme),
      link: ensureContrast(s.colors.link, main, 4.5, s.scheme),
      mention: ensureContrast(s.colors.mention, main, 3, s.scheme),
    },
  }
}

// ─── Validation (import, synchronisation, stockage) ─────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function num(v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
}

export const MAX_DATA_IMAGE = 3_000_000
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/

/** Image de fond acceptée : https sans identifiants ni caractères qui sortiraient de url(), ou image locale en base64. */
export function isSafeImageUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false
  if (u.startsWith('data:')) return u.length <= MAX_DATA_IMAGE && DATA_IMAGE_RE.test(u)
  if (u.length > 2048 || /[\s"'()\\<>`]/.test(u)) return false
  try {
    const p = new URL(u)
    return p.protocol === 'https:' && !!p.hostname && !p.username && !p.password
  } catch {
    return false
  }
}

/** Nom affichable : sans caractères de contrôle, 40 caractères au plus. */
function cleanName(v: unknown, def: string): string {
  if (typeof v !== 'string') return def
  const n = [...v].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join('').trim().slice(0, 40)
  return n || def
}

/** Donnée quelconque → thème valide, ou null. Toute couleur absente/invalide reprend celle de Sombre. */
export function sanitizeTheme(raw: unknown): ThemeSpec | null {
  if (!isObj(raw)) return null
  const src = isObj(raw.theme) ? raw.theme : raw
  if (!isObj(src.colors)) return null
  const rc = src.colors
  const scheme: Scheme = src.scheme === 'light' ? 'light' : 'dark'
  const fallback = (scheme === 'light' ? LIGHT : DARK).colors
  const colors = {} as ThemeColors
  for (const k of COLOR_KEYS) colors[k] = isHex(rc[k]) ? rc[k].toLowerCase() : fallback[k]

  let gradient: ThemeGradient | null = null
  if (isObj(src.gradient) && Array.isArray(src.gradient.stops)) {
    const stops = src.gradient.stops.filter(isHex).map((c) => c.toLowerCase()).slice(0, 3)
    if (stops.length >= 2) gradient = { angle: Math.round(num(src.gradient.angle, 0, 360, 135)), stops }
  }
  let image: ThemeImage | null = null
  if (isObj(src.image) && isSafeImageUrl(src.image.url)) {
    image = { url: src.image.url, blur: Math.round(num(src.image.blur, 0, 30, 0)), dim: num(src.image.dim, 0, 0.9, 0.4) }
  }
  return {
    name: cleanName(src.name, scheme === 'light' ? 'Clair' : 'Sombre'),
    scheme,
    colors,
    gradient,
    image,
    opacity: num(src.opacity, 0.15, 1, 1),
    blur: Math.round(num(src.blur, 0, 40, 0)),
    radius: num(src.radius, 0, 2, 1),
    outline: src.outline === true,
    // Champs ajoutés ensuite : absents des anciens codes → valeurs neutres (rendu identique).
    accent2: isHex(src.accent2) ? src.accent2.toLowerCase() : null,
    pattern: PATTERNS.includes(src.pattern as Pattern) ? (src.pattern as Pattern) : 'none',
    patternOpacity: Math.round(num(src.patternOpacity, 0, 0.4, FX.patternOpacity) * 100) / 100,
    saturation: Math.round(num(src.saturation, 0, 2, 1) * 100) / 100,
  }
}

export const CUSTOM_ID_RE = /^c-[a-z0-9]{4,24}$/
export const MAX_CUSTOM_THEMES = 30

export function sanitizeCustom(raw: unknown): CustomTheme | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !CUSTOM_ID_RE.test(raw.id)) return null
  const spec = sanitizeTheme(raw)
  return spec ? { ...spec, id: raw.id } : null
}

export function sanitizeCustomList(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: CustomTheme[] = []
  for (const r of raw) {
    const c = sanitizeCustom(r)
    if (c && !seen.has(c.id) && out.length < MAX_CUSTOM_THEMES) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}

export const newCustomId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ─── Export / import (code texte ou fichier JSON) ───────────────────────────

const CODE_PREFIX = 'FCTHEME1:'
const MAX_IMPORT = 4_200_000

/** Thème → code texte copiable (préfixe + JSON en base64). */
export function encodeTheme(s: ThemeSpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify(toExport(s)))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return CODE_PREFIX + btoa(bin)
}

/** Objet JSON exporté (fichier) : seulement les champs du modèle. */
export function toExport(s: ThemeSpec) {
  const { name, scheme, colors, gradient, image, opacity, blur, radius, outline, accent2, pattern, patternOpacity, saturation } = s
  // Même format (version 1) : les anciennes versions ignorent simplement les champs ajoutés.
  return {
    format: 'forgechat-theme', version: 1, name, scheme, colors, gradient, image, opacity, blur, radius, outline,
    accent2, pattern, patternOpacity, saturation,
  }
}

/** Code texte ou contenu de fichier JSON → thème validé, ou null. */
export function decodeTheme(text: string): ThemeSpec | null {
  const t = text.trim()
  if (!t || t.length > MAX_IMPORT) return null
  try {
    if (t.startsWith(CODE_PREFIX)) {
      const bin = atob(t.slice(CODE_PREFIX.length).replace(/\s/g, ''))
      const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
      return sanitizeTheme(JSON.parse(new TextDecoder().decode(bytes)))
    }
    if (t.startsWith('{')) return sanitizeTheme(JSON.parse(t))
  } catch {
    return null
  }
  return null
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

type Solid = [bg: string, sidebar: string, channel: string, chat: string, input: string, hover: string, text: string, muted: string, accent: string]

/** Effets neutres (pas de second accent, pas de motif, saturation d'origine). */
const FX = { accent2: null, pattern: 'none', patternOpacity: 0.08, saturation: 1 } as const satisfies Partial<ThemeSpec>

function solid(name: string, scheme: Scheme, [bg, sidebar, channel, chat, input, hover, text, muted, accent]: Solid, extra: Partial<ThemeColors> = {}): ThemeSpec {
  return fixContrast({
    name,
    scheme,
    colors: { bg, sidebar, channel, chat, input, hover, border: hover, text, muted, accent, link: accent, mention: accent, ...extra },
    gradient: null,
    image: null,
    opacity: 1,
    blur: 0,
    radius: 1,
    outline: false,
    ...FX,
  })
}

const DARK: ThemeSpec = solid('Sombre', 'dark', ['#1a1b1e', '#1e2124', '#232428', '#36393f', '#40444b', '#2c2f33', '#dcddde', '#72767d', '#5865f2'], { link: '#00aff4' })
const LIGHT: ThemeSpec = solid('Clair', 'light', ['#f2f3f5', '#e3e5e8', '#ebedef', '#ffffff', '#e3e5e8', '#d4d7dc', '#060607', '#5c5e66', '#5865f2'], { link: '#006ce7', border: '#d4d7dc' })
const ONYX: ThemeSpec = solid('Plus sombre', 'dark', ['#111214', '#0b0b0d', '#0e0f11', '#131416', '#1c1d21', '#1e1f23', '#e3e5e8', '#9a9ca3', '#5865f2'], { link: '#00aff4', border: '#232428' })
/** AMOLED : NOIR PUR partout, les reliefs passent par des bordures fines et des survols discrets. */
const AMOLED: ThemeSpec = {
  ...solid('AMOLED', 'dark', ['#000000', '#000000', '#000000', '#000000', '#000000', '#141414', '#f2f3f5', '#a3a6aa', '#5865f2'], { link: '#00aff4', border: '#262626' }),
  outline: true,
}

/** Thèmes historiques (mêmes identifiants qu'avant) : fond, barre, salons, saisie, survol, texte, atténué, accent. */
const CLASSIC: [id: string, fr: string, en: string, c: [string, string, string, string, string, string, string, string], scheme?: Scheme][] = [
  ['dracula', 'Dracula', 'Dracula', ['#282a36', '#21222c', '#1e1f2b', '#44475a', '#353746', '#f8f8f2', '#6272a4', '#bd93f9']],
  ['nord', 'Nord', 'Nord', ['#2e3440', '#272c36', '#3b4252', '#4c566a', '#434c5e', '#e5e9f0', '#7b8394', '#5e81ac']],
  ['catppuccin', 'Catppuccin', 'Catppuccin', ['#1e1e2e', '#181825', '#181825', '#45475a', '#313244', '#cdd6f4', '#585b70', '#cba6f7']],
  ['gruvbox', 'Gruvbox', 'Gruvbox', ['#1d2021', '#181a1b', '#282828', '#504945', '#3c3836', '#ebdbb2', '#928374', '#d65d0e']],
  ['tokyonight', 'Tokyo Night', 'Tokyo Night', ['#1a1b2e', '#141423', '#1f2040', '#303550', '#24283b', '#c0caf5', '#565f89', '#7aa2f7']],
  ['onedark', 'One Dark', 'One Dark', ['#282c34', '#21252b', '#2c313c', '#3f4451', '#3b4048', '#abb2bf', '#5c6370', '#61afef']],
  ['cyberpunk', 'Cyberpunk', 'Cyberpunk', ['#0d0d0d', '#0a0a0a', '#111111', '#1a1a1a', '#161616', '#e0e0e0', '#555555', '#f0e14a']],
  ['monokai', 'Monokai', 'Monokai', ['#272822', '#1e1f1c', '#2d2e2a', '#3e3e37', '#383830', '#f8f8f2', '#75715e', '#a6e22e']],
  ['solarized', 'Solarized', 'Solarized', ['#002b36', '#00212b', '#073642', '#083f4d', '#0d4a5c', '#93a1a1', '#586e75', '#268bd2']],
  ['forest', 'Forêt', 'Forest', ['#1a2318', '#141d12', '#1e2a1c', '#2d3e2a', '#243222', '#c8dbc4', '#5a7255', '#6cb340']],
  ['ocean', 'Océan', 'Ocean', ['#0f2340', '#0a1929', '#0d2238', '#1a3557', '#112a47', '#a8c8e8', '#4a7a9b', '#00d4ff']],
  ['neon', 'Néon', 'Neon', ['#0a0a14', '#080810', '#0d0d1a', '#161630', '#111120', '#e0e0ff', '#444466', '#00ff88']],
  ['matrix', 'Matrix', 'Matrix', ['#000000', '#000000', '#040804', '#0a140a', '#060c06', '#33cc33', '#1a4d1a', '#00ff00']],
  ['rosepine', 'Rosé Pine', 'Rosé Pine', ['#191724', '#1f1d2e', '#26233a', '#2a273f', '#403d52', '#e0def4', '#6e6a86', '#eb6f92']],
  ['everforest', 'Everforest', 'Everforest', ['#2d353b', '#272e33', '#343f44', '#3d484d', '#374145', '#d3c6aa', '#7a8478', '#a7c080']],
  ['kanagawa', 'Kanagawa', 'Kanagawa', ['#1f1f28', '#16161d', '#2a2a37', '#363646', '#2d2d3f', '#dcd7ba', '#727169', '#7e9cd8']],
  ['midnight', 'Minuit', 'Midnight', ['#0c0e1a', '#080910', '#101220', '#1a1d30', '#151828', '#c8cde4', '#444466', '#6272a4']],
  ['sunset', 'Crépuscule rouge', 'Red dusk', ['#1a1014', '#14090c', '#22141a', '#2e1a22', '#27151c', '#f0c8b8', '#7a4858', '#f07050']],
  ['coffee', 'Café', 'Coffee', ['#1e1510', '#160f0a', '#271a12', '#33201a', '#2c1c14', '#d4b896', '#7a5a3a', '#c87941']],
  ['winter', 'Hiver', 'Winter', ['#f0f4f8', '#dce8f0', '#e8f0f8', '#ffffff', '#d0e4f0', '#2c3e50', '#8aacbe', '#3498db'], 'light'],
  ['emerald', 'Émeraude', 'Emerald', ['#0d1f18', '#091610', '#122820', '#1a3428', '#162e22', '#a8f0c8', '#3d6e52', '#2ecc71']],
  ['bloodmoon', 'Lune de sang', 'Blood moon', ['#120a0a', '#0c0606', '#1a0e0e', '#2a1414', '#221010', '#f0c8c8', '#6e3030', '#cc2222']],
  ['violet', 'Violet', 'Violet', ['#160d24', '#100918', '#1e1130', '#281640', '#221238', '#d4b8f0', '#6840a0', '#9b59b6']],
  ['slate', 'Ardoise', 'Slate', ['#1c2230', '#141b26', '#222c3c', '#2a364a', '#263042', '#c0ccd8', '#5a6a7a', '#5d8aa8']],
  ['retro', 'Rétro', 'Retro', ['#2b2017', '#221810', '#352a1e', '#43342a', '#3c2e22', '#e8d5b0', '#8a6a4a', '#d4883a']],
]

/** Thème « dégradé » façon Discord : fond à 2-3 couleurs vu à travers des panneaux translucides. */
function gradient(name: string, scheme: Scheme, stops: string[], accent: string, angle = 135): ThemeSpec {
  const tint = stops.reduce((acc, c, i) => mix(acc, c, 1 / (i + 1)))
  const dark = scheme === 'dark'
  const toward = dark ? '#000000' : '#ffffff'
  const text = dark ? '#f5f5f8' : '#14141c'
  return fixContrast({
    name,
    scheme,
    colors: {
      bg: mix(tint, toward, dark ? 0.55 : 0.6),
      sidebar: mix(tint, toward, dark ? 0.7 : 0.45),
      channel: mix(tint, toward, dark ? 0.62 : 0.5),
      chat: mix(tint, toward, dark ? 0.55 : 0.6),
      input: mix(tint, toward, dark ? 0.35 : 0.82),
      hover: dark ? mix(tint, '#ffffff', 0.14) : mix(tint, '#000000', 0.12),
      border: dark ? mix(tint, '#ffffff', 0.2) : mix(tint, '#000000', 0.18),
      text,
      muted: mix(text, tint, 0.4),
      accent,
      link: accent,
      mention: accent,
    },
    gradient: { angle, stops },
    image: null,
    opacity: 0.55,
    blur: 18,
    radius: 1,
    outline: false,
    ...FX,
  })
}

const GRADIENTS: [id: string, fr: string, en: string, scheme: Scheme, stops: string[], accent: string, angle?: number][] = [
  ['g-aurora', 'Aurore boréale', 'Aurora', 'dark', ['#062e2b', '#123a6b', '#3d1a63'], '#3ee6b5'],
  ['g-sunset', 'Coucher de soleil', 'Sunset', 'dark', ['#2b1240', '#8a2846', '#d9622b'], '#ffa25c', 160],
  ['g-lavender', 'Lavande', 'Lavender', 'light', ['#e9dcff', '#d6c2f5', '#f6e8ff'], '#6a3dbf'],
  ['g-mint', 'Menthe', 'Mint', 'light', ['#d4f7e8', '#bfeee0', '#e8fff6'], '#0f7a55'],
  ['g-ocean', 'Océan profond', 'Deep ocean', 'dark', ['#021b33', '#05456b', '#0a7a8a'], '#3fd0ff', 180],
  ['g-ember', 'Braise', 'Ember', 'dark', ['#1a0602', '#5c1508', '#a8320c'], '#ff7a3d', 200],
  ['g-forest', 'Forêt', 'Forest', 'dark', ['#071a0e', '#163d22', '#2f5e2a'], '#7fd36b'],
  ['g-neon', 'Néon', 'Neon', 'dark', ['#12002b', '#3d0066', '#00334d'], '#ff3df2'],
  ['g-retro', 'Rétro', 'Retro', 'dark', ['#2d1b4e', '#6b2d5c', '#c2563a'], '#ffc24d', 170],
  ['g-cotton', 'Barbe à papa', 'Cotton candy', 'light', ['#ffd6ec', '#d9e4ff', '#e8d6ff'], '#b8246f'],
  ['g-peach', 'Pêche', 'Peach', 'light', ['#ffe3d3', '#ffd0c2', '#fff1d6'], '#b0441f'],
  ['g-sky', "Ciel d'été", 'Summer sky', 'light', ['#cfe8ff', '#e3f2ff', '#d6ecff'], '#1a62bd', 180],
  ['g-sakura', 'Sakura', 'Sakura', 'light', ['#ffe4ec', '#ffd1e0', '#f9eef5'], '#b3335f'],
  ['g-citrus', 'Agrumes', 'Citrus', 'light', ['#fff5c2', '#ffe0a3', '#e8f7c4'], '#a14d08'],
  ['g-dusk', 'Crépuscule', 'Dusk', 'dark', ['#141433', '#3a2459', '#6b3a5c'], '#c79bff', 160],
  ['g-blue-midnight', 'Minuit bleuté', 'Blue midnight', 'dark', ['#050a1f', '#0d1a4a', '#1d2f7a'], '#7b97ff'],
  ['g-galaxy', 'Galaxie', 'Galaxy', 'dark', ['#0b0221', '#2a0a4f', '#0b2a5c'], '#b57bff', 120],
  ['g-crimson', 'Lune pourpre', 'Crimson moon', 'dark', ['#12000a', '#4a0418', '#7a0a1f'], '#ff5c7a'],
  ['g-mars', 'Mars', 'Mars', 'dark', ['#1f0b05', '#5c2410', '#8a4a1f'], '#ff8a4d', 180],
  ['g-lagoon', 'Lagon', 'Lagoon', 'dark', ['#03262b', '#0b5560', '#127a6b'], '#4dffd2'],
  ['g-storm', 'Orage', 'Storm', 'dark', ['#0f141c', '#26334a', '#3d4f6b'], '#8fb3ff', 170],
  ['g-chroma', 'Chroma', 'Chroma', 'dark', ['#2b0a3d', '#0a3d5c', '#2f4a0a'], '#f7d14d', 110],
  ['g-twilight', 'Crépuscule violet', 'Blurple twilight', 'dark', ['#1a1c4d', '#3b2f8a', '#5865f2'], '#b4bdff'],
  ['g-desert', 'Désert', 'Desert', 'light', ['#f2e3c9', '#e8cfa8', '#f7ecd9'], '#8f4a1c'],
  ['g-glacier', 'Glacier', 'Glacier', 'light', ['#e6f6ff', '#d1ecf7', '#f0fbff'], '#0b6f94', 180],
  ['g-lofi', 'Lo-fi', 'Lo-fi', 'light', ['#e8dcef', '#f3d9d0', '#d9e6ef'], '#6e4590'],
  ['g-matcha', 'Matcha', 'Matcha', 'dark', ['#0f1f0f', '#2d4a1e', '#5c6b2a'], '#c5e86c'],
  ['g-cyber', 'Cyber', 'Cyber', 'dark', ['#000814', '#001d3d', '#3c096c'], '#00f5d4'],
  ['g-rosegold', 'Or rose', 'Rose gold', 'dark', ['#24131a', '#5c2a3a', '#8a5a4a'], '#ffb4a2'],
  ['g-abyss', 'Abysse', 'Abyss', 'dark', ['#000000', '#000d1a', '#001a33'], '#3da9fc', 180],
]

// ─── Familles générées (teinte × famille) ───────────────────────────────────
// Chaque famille est une recette (surfaces, texte, accent) appliquée à 48 teintes nommées :
// plus d'un millier de thèmes à partir d'une table compacte. Le contraste AA est garanti par
// fixContrast, comme pour les thèmes écrits à la main.

/** 48 teintes (pas de 7,5°) : nom français, nom anglais (l'identifiant en dérive). */
export const HUES: [fr: string, en: string][] = [
  ['Rubis', 'Ruby'], ['Vermillon', 'Vermilion'], ['Corail', 'Coral'], ['Cuivre', 'Copper'],
  ['Mandarine', 'Tangerine'], ['Abricot', 'Apricot'], ['Ambre', 'Amber'], ['Safran', 'Saffron'],
  ['Citron', 'Lemon'], ['Soufre', 'Sulfur'], ['Olive', 'Olive'], ['Citron vert', 'Lime'],
  ['Chartreuse', 'Chartreuse'], ['Pistache', 'Pistachio'], ['Prairie', 'Meadow'], ['Fougère', 'Fern'],
  ['Trèfle', 'Clover'], ['Basilic', 'Basil'], ['Émeraude', 'Emerald'], ['Jade', 'Jade'],
  ['Menthe', 'Mint'], ['Malachite', 'Malachite'], ['Aigue-marine', 'Aquamarine'], ['Turquoise', 'Turquoise'],
  ['Cyan', 'Cyan'], ['Lagon', 'Lagoon'], ['Azur', 'Azure'], ['Céruléen', 'Cerulean'],
  ['Ciel', 'Sky'], ['Acier', 'Steel'], ['Saphir', 'Sapphire'], ['Cobalt', 'Cobalt'],
  ['Bleuet', 'Cornflower'], ['Outremer', 'Ultramarine'], ['Iris', 'Iris'], ['Indigo', 'Indigo'],
  ['Violet', 'Violet'], ['Améthyste', 'Amethyst'], ['Pourpre', 'Purple'], ['Orchidée', 'Orchid'],
  ['Magenta', 'Magenta'], ['Prune', 'Plum'], ['Fuchsia', 'Fuchsia'], ['Pivoine', 'Peony'],
  ['Rose', 'Pink'], ['Framboise', 'Raspberry'], ['Cerise', 'Cherry'], ['Carmin', 'Carmine'],
]
export const hueOfIndex = (i: number) => i * 7.5

export interface Family {
  /** Préfixe des identifiants (`<id>-<teinte>`). */
  id: string
  group: PresetGroup
  /** Libellés : {h} = nom de la teinte. */
  fr: string
  en: string
  build: (h: number, name: string) => ThemeSpec
}

/** Solide teinté : 6 luminosités de surface (fond, barre, salons, discussion, saisie, survol). */
function tint(name: string, scheme: Scheme, h: number, sat: number, l: number[], text: string, muted: string, accent: string, extra: Partial<ThemeColors> = {}): ThemeSpec {
  const [bg, sidebar, channel, chat, input, hover] = l.map((x) => hsl(h, sat, x)) as [string, string, string, string, string, string]
  return solid(name, scheme, [bg, sidebar, channel, chat, input, hover, text, muted, accent], extra)
}

/** Dégradé translucide + effets (second accent, motif, opacité et flou des panneaux). */
function grad(name: string, scheme: Scheme, stops: string[], accent: string, angle: number, fx: Partial<ThemeSpec> = {}): ThemeSpec {
  const g = gradient(name, scheme, stops, accent, angle)
  return Object.keys(fx).length ? fixContrast({ ...g, ...fx }) : g
}

const BLACK = '#000000'
const WHITE = '#ffffff'

export const FAMILIES: Family[] = [
  { id: 'tn', group: 'tinted', fr: '{h} sombre', en: 'Dark {h}', build: (h, n) =>
    tint(n, 'dark', h, 14, [10, 8, 12, 17, 22, 20], hsl(h, 15, 91), hsl(h, 10, 68), hsl(h, 70, 62), { link: hsl(h + 20, 80, 72), border: hsl(h, 12, 24) }) },
  { id: 'dm', group: 'tinted', fr: '{h} tamisé', en: 'Dim {h}', build: (h, n) =>
    tint(n, 'dark', h, 10, [20, 17, 22, 25, 31, 29], hsl(h, 12, 93), hsl(h, 10, 76), hsl(h, 65, 66), { link: hsl(h + 20, 75, 78), border: hsl(h, 10, 33) }) },
  { id: 'nt', group: 'tinted', fr: 'Nuit {h}', en: '{h} night', build: (h, n) =>
    tint(n, 'dark', h, 40, [6, 4, 8, 10, 15, 13], hsl(h, 30, 90), hsl(h, 25, 70), hsl(h, 85, 65), { link: hsl(h + 25, 90, 74), border: hsl(h, 35, 18) }) },
  { id: 'am', group: 'amoled', fr: 'AMOLED {h}', en: 'AMOLED {h}', build: (h, n) => ({
    ...solid(n, 'dark', [BLACK, BLACK, BLACK, BLACK, BLACK, hsl(h, 30, 6), hsl(h, 10, 95), hsl(h, 10, 70), hsl(h, 85, 60)], { link: hsl(h, 90, 72), border: hsl(h, 45, 20) }),
    outline: true,
  }) },
  { id: 'ag', group: 'amoled', fr: 'AMOLED lueur {h}', en: '{h} AMOLED glow', build: (h, n) => ({
    ...solid(n, 'dark', [BLACK, BLACK, BLACK, BLACK, BLACK, hsl(h, 40, 6), hsl(h, 20, 95), hsl(h, 40, 72), hsl(h, 95, 60)], { link: hsl(h, 95, 72), mention: hsl(h, 95, 66), border: hsl(h, 80, 35) }),
    outline: true,
    accent2: hsl(h + 40, 90, 60),
  }) },
  { id: 'lt', group: 'light', fr: '{h} clair', en: 'Light {h}', build: (h, n) =>
    tint(n, 'light', h, 22, [95, 90, 93, 99, 89, 85], hsl(h, 30, 9), hsl(h, 12, 36), hsl(h, 70, 42), { link: hsl(h, 80, 34), border: hsl(h, 18, 82) }) },
  { id: 'pp', group: 'light', fr: 'Papier {h}', en: '{h} paper', build: (h, n) => {
    const paper = (l: number) => mix(hsl(40, 35, l), hsl(h, 50, l), 0.25)
    return { ...solid(n, 'light', [paper(93), paper(88), paper(91), paper(97), paper(86), paper(82), hsl(30, 25, 12), hsl(30, 12, 36), hsl(h, 65, 38)], { border: paper(80) }), radius: 0.75 }
  } },
  { id: 'ps', group: 'pastel', fr: 'Pastel {h}', en: 'Pastel {h}', build: (h, n) =>
    ({ ...tint(n, 'light', h, 60, [92, 88, 90, 96, 85, 82], hsl(h, 35, 14), hsl(h, 20, 34), hsl(h, 55, 45), { link: hsl(h, 70, 32), border: hsl(h, 40, 80) }), radius: 1.5 }) },
  { id: 'pn', group: 'pastel', fr: 'Pastel nocturne {h}', en: 'Pastel night {h}', build: (h, n) =>
    ({ ...tint(n, 'dark', h, 18, [15, 12, 17, 20, 26, 24], hsl(h, 40, 92), hsl(h, 25, 76), hsl(h, 75, 80), { link: hsl(h + 30, 80, 82), border: hsl(h, 20, 28) }), radius: 1.5 }) },
  { id: 'ne', group: 'neon', fr: 'Néon {h}', en: 'Neon {h}', build: (h, n) => ({
    ...tint(n, 'dark', h, 45, [5, 3, 6, 8, 12, 11], hsl(h, 30, 92), hsl(h, 30, 70), hsl(h, 100, 58), { link: hsl(h, 100, 70), border: hsl(h, 80, 28) }),
    accent2: hsl(h + 60, 100, 60), pattern: 'grid', patternOpacity: 0.06,
  }) },
  { id: 'sw', group: 'neon', fr: 'Synthwave {h}', en: '{h} synthwave', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 60, 8), hsl(h + 40, 65, 22), hsl(h + 80, 70, 32)], hsl(h + 40, 100, 66), 180, { accent2: hsl(h + 80, 100, 62), pattern: 'grid', patternOpacity: 0.1 }) },
  { id: 'rt', group: 'retro', fr: 'Rétro {h}', en: 'Retro {h}', build: (h, n) => {
    const w = (l: number) => mix(hsl(30, 24, l), hsl(h, 24, l), 0.35)
    return { ...solid(n, 'dark', [w(13), w(10), w(15), w(18), w(23), w(21), hsl(40, 45, 86), hsl(35, 20, 66), hsl(h, 60, 58)], { border: w(26) }), radius: 0.5 }
  } },
  { id: 'tm', group: 'retro', fr: 'Terminal {h}', en: '{h} terminal', build: (h, n) => ({
    ...tint(n, 'dark', h, 30, [3, 2, 4, 5, 8, 9], hsl(h, 90, 62), hsl(h, 55, 52), hsl(h, 100, 55), { link: hsl(h, 100, 72), border: hsl(h, 60, 18) }),
    radius: 0.25, outline: true, pattern: 'lines', patternOpacity: 0.07,
  }) },
  { id: 'vt', group: 'retro', fr: 'Vintage {h}', en: 'Vintage {h}', build: (h, n) => {
    const sepia = (l: number) => mix(hsl(38, 40, l), hsl(h, 30, l), 0.3)
    return { ...solid(n, 'light', [sepia(88), sepia(83), sepia(86), sepia(92), sepia(80), sepia(77), hsl(25, 35, 13), hsl(25, 18, 32), hsl(h, 55, 36)], { border: sepia(72) }), radius: 0.5 }
  } },
  { id: 'ir', group: 'iridescent', fr: '{h} irisé', en: 'Iridescent {h}', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 60, 20), hsl(h + 40, 60, 24), hsl(h + 80, 60, 28)], hsl(h + 40, 90, 70), 135, { accent2: hsl(h + 80, 90, 68) }) },
  { id: 'nc', group: 'iridescent', fr: 'Nacre {h}', en: '{h} pearl', build: (h, n) =>
    grad(n, 'light', [hsl(h, 70, 90), hsl(h + 50, 70, 88), hsl(h + 100, 70, 91)], hsl(h, 60, 38), 120, { accent2: hsl(h + 50, 60, 40) }) },
  { id: 'au', group: 'iridescent', fr: 'Aurore {h}', en: '{h} aurora', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 55, 9), hsl(h + 150, 60, 22), hsl(h + 60, 55, 17)], hsl(h + 150, 85, 62), 160) },
  { id: 'du', group: 'iridescent', fr: 'Duo {h}', en: '{h} duotone', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 55, 18), hsl(h + 180, 55, 22)], hsl(h + 180, 85, 68), 135, { accent2: hsl(h, 85, 66) }) },
  { id: 'vr', group: 'glass', fr: 'Verre {h}', en: '{h} glass', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 55, 28), hsl(h + 25, 60, 34)], hsl(h, 90, 74), 135, { opacity: 0.35, blur: 28, radius: 1.25, pattern: 'dots', patternOpacity: 0.05 }) },
  { id: 'gv', group: 'glass', fr: 'Givre {h}', en: '{h} frost', build: (h, n) =>
    grad(n, 'light', [hsl(h, 60, 80), hsl(h + 25, 60, 86)], hsl(h, 70, 36), 135, { opacity: 0.45, blur: 24, radius: 1.25 }) },
  { id: 'hc', group: 'contrast', fr: '{h} contraste fort', en: '{h} high contrast', build: (h, n) => ({
    ...solid(n, 'dark', [BLACK, BLACK, BLACK, BLACK, hsl(h, 20, 7), hsl(h, 25, 14), WHITE, '#e6e6e6', hsl(h, 100, 65)], { link: hsl(h, 100, 78), mention: hsl(h, 100, 72), border: hsl(h, 100, 70) }),
    outline: true,
  }) },
  { id: 'hl', group: 'contrast', fr: '{h} contraste clair', en: '{h} high contrast light', build: (h, n) => ({
    ...solid(n, 'light', [WHITE, WHITE, WHITE, WHITE, hsl(h, 20, 96), hsl(h, 30, 90), BLACK, '#1f1f1f', hsl(h, 100, 28)], { link: hsl(h, 100, 24), mention: hsl(h, 100, 30), border: hsl(h, 100, 25) }),
    outline: true,
  }) },
  { id: 'ab', group: 'gradient', fr: 'Aube {h}', en: '{h} dawn', build: (h, n) =>
    grad(n, 'light', [hsl(h, 75, 90), hsl(h + 30, 80, 86), hsl(h - 30, 70, 93)], hsl(h, 65, 38), 180) },
  { id: 'cr', group: 'gradient', fr: 'Crépuscule {h}', en: '{h} dusk', build: (h, n) =>
    grad(n, 'dark', [hsl(h, 50, 6), hsl(h + 20, 55, 18), hsl(h + 40, 60, 30)], hsl(h + 40, 90, 68), 180) },
]

const slug = (en: string) => en.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** Libellé d'une famille pour une teinte : « {h} sombre » → « Rubis sombre », « Nuit {h} » → « Nuit rubis ». */
export function familyLabel(tpl: string, hueName: string): string {
  if (tpl.startsWith('{h}')) return tpl.replace('{h}', hueName)
  return tpl.replace('{h}', hueName.charAt(0).toLowerCase() + hueName.slice(1))
}

/** Thème d'une famille pour une teinte libre (éditeur : « générer à partir d'une couleur »). */
export function familyTheme(familyId: string, hue: number, name: string): ThemeSpec | null {
  const f = FAMILIES.find((x) => x.id === familyId)
  return f ? f.build(hue, name) : null
}

// ─── Collections écrites à la main : nature et saisons ──────────────────────

type Curated = [id: string, fr: string, en: string, scheme: Scheme, stops: string[], accent: string, angle?: number]

const NATURE: Curated[] = [
  ['n-taiga', 'Taïga', 'Taiga', 'dark', ['#0b1a14', '#1d3a2a', '#2f4d3a'], '#8fd18a'],
  ['n-redwood', 'Séquoia', 'Redwood', 'dark', ['#1a0d08', '#3d1f12', '#5c3a1f'], '#e0955a'],
  ['n-bamboo', 'Bambou', 'Bamboo', 'light', ['#e6f5d0', '#cfe8b0', '#f2f9e4'], '#3d6b14'],
  ['n-moss', 'Mousse', 'Moss', 'dark', ['#10170c', '#26331a', '#3b4a22'], '#b5d46a'],
  ['n-fjord', 'Fjord', 'Fjord', 'dark', ['#06141f', '#123247', '#2a5a6b'], '#7fd4ff', 180],
  ['n-glacier-lake', 'Lac glaciaire', 'Glacier lake', 'light', ['#dff6f7', '#c3ecef', '#eefbfb'], '#0d6d78'],
  ['n-canyon', 'Canyon', 'Canyon', 'dark', ['#1f0c05', '#5a2410', '#94461f'], '#ffb070', 170],
  ['n-dune', 'Dune', 'Dune', 'light', ['#f7e7c6', '#efd29e', '#fbf1dc'], '#8a4b12'],
  ['n-savanna', 'Savane', 'Savanna', 'light', ['#f3e3b5', '#e3cb85', '#f6edcf'], '#7a5410'],
  ['n-coral-reef', 'Récif corallien', 'Coral reef', 'dark', ['#03202b', '#0b4a5a', '#c4515a'], '#ffb3a0', 160],
  ['n-deep-sea', 'Grands fonds', 'Deep sea', 'dark', ['#000510', '#001428', '#002a40'], '#3de0ff', 180],
  ['n-tropical-lagoon', 'Lagon tropical', 'Tropical lagoon', 'light', ['#d4f7f2', '#b5ede6', '#e9fbf8'], '#06706a'],
  ['n-volcano', 'Volcan', 'Volcano', 'dark', ['#0d0302', '#3d0a05', '#8a1f05'], '#ff6a2b', 200],
  ['n-lava', 'Lave', 'Lava', 'dark', ['#1a0500', '#6b1a00', '#c23b00'], '#ffc14d', 160],
  ['n-tundra', 'Toundra', 'Tundra', 'light', ['#e8ecef', '#d5dde3', '#f2f4f6'], '#3b5a73'],
  ['n-meadow', 'Prairie fleurie', 'Flower meadow', 'light', ['#e9f7d9', '#d6efc0', '#f4fbe9'], '#2f6b1a'],
  ['n-lavender-field', 'Champ de lavande', 'Lavender field', 'light', ['#ece3fb', '#dccbf5', '#f5f0fd'], '#5b3a9e'],
  ['n-sunflower', 'Tournesol', 'Sunflower', 'light', ['#fff4c2', '#ffe58a', '#fff9df'], '#8a5a00'],
  ['n-mangrove', 'Mangrove', 'Mangrove', 'dark', ['#07140f', '#163326', '#2b4a35'], '#5fd3a0'],
  ['n-rainforest', 'Forêt tropicale', 'Rainforest', 'dark', ['#031a0a', '#0a3d1a', '#14592a'], '#5cff8a'],
  ['n-storm-sea', "Mer d'orage", 'Stormy sea', 'dark', ['#0b1218', '#1d2c38', '#33475a'], '#9ec3e6', 170],
  ['n-far-north', 'Grand Nord', 'Far north', 'dark', ['#020a14', '#06303d', '#2a1a4d'], '#5cffc8'],
  ['n-stone', 'Pierre', 'Stone', 'dark', ['#141414', '#262626', '#3a3a3a'], '#c9b18a'],
  ['n-sandstone', 'Grès', 'Sandstone', 'light', ['#f5e1cf', '#ebcbb0', '#f9ece0'], '#8f3f1a'],
  ['n-cherry-trees', 'Cerisiers', 'Cherry trees', 'light', ['#ffe8ef', '#ffd5e2', '#fff3f7'], '#a8325a'],
  ['n-moonlight', 'Clair de lune', 'Moonlight', 'dark', ['#05070f', '#141a33', '#2a3352'], '#c9d6ff', 180],
  ['n-alpine-dawn', "Sommet à l'aube", 'Alpine dawn', 'light', ['#ffe3cc', '#ffd1dc', '#dfe8ff'], '#9c3d1a', 180],
  ['n-undergrowth', 'Sous-bois', 'Undergrowth', 'dark', ['#17110b', '#2e2216', '#433224'], '#d9a066'],
  ['n-wheat', 'Blé', 'Wheat', 'light', ['#f8edd0', '#efdcae', '#fbf4e2'], '#7d5512'],
  ['n-polar-sky', 'Ciel polaire', 'Polar sky', 'dark', ['#000814', '#05304a', '#1a5c4a'], '#7affd4', 160],
  ['n-night-lagoon', 'Lagune de nuit', 'Night lagoon', 'dark', ['#020d14', '#06283a', '#0a4a52'], '#56e0d0'],
  ['n-olive-grove', 'Oliveraie', 'Olive grove', 'light', ['#eef0dc', '#dde3bf', '#f6f7ec'], '#4f5c14'],
]

const SEASONS: Curated[] = [
  ['s-spring', 'Printemps', 'Spring', 'light', ['#e6f9e0', '#ffe6f0', '#fff9d9'], '#2f7a2a'],
  ['s-summer', 'Été', 'Summer', 'light', ['#fff1c9', '#ffd9a8', '#c9ecff'], '#b0430d'],
  ['s-autumn', 'Automne', 'Autumn', 'dark', ['#1a0b05', '#4a1f0a', '#7a3d0f'], '#ffa040', 160],
  ['s-winter', 'Hiver givré', 'Frosty winter', 'light', ['#eaf4ff', '#dbe9f7', '#f5f9ff'], '#1f5a99'],
  ['s-winter-night', "Nuit d'hiver", 'Winter night', 'dark', ['#050a14', '#0f1d33', '#22344d'], '#a8d4ff', 180],
  ['s-halloween', 'Halloween', 'Halloween', 'dark', ['#0a0505', '#2a0f05', '#4a1a00'], '#ff7a1a', 180],
  ['s-christmas', 'Noël', 'Christmas', 'dark', ['#0a1a0e', '#14331d', '#5c0f14'], '#ff4d4d'],
  ['s-snow', 'Neige', 'Snow', 'light', ['#ffffff', '#eef4fa', '#f6f9fc'], '#2a5d8f'],
  ['s-valentine', 'Saint-Valentin', "Valentine's", 'light', ['#ffe0ea', '#ffc7d9', '#fff0f5'], '#b0154a'],
  ['s-easter', 'Pâques', 'Easter', 'light', ['#fff6cc', '#e5f7d6', '#efe3ff'], '#6b3fa0'],
  ['s-lunar-new-year', 'Nouvel An lunaire', 'Lunar New Year', 'dark', ['#1a0303', '#5c0a0a', '#8a1a0a'], '#ffcf4d', 160],
  ['s-new-year-eve', 'Réveillon', "New Year's Eve", 'dark', ['#05050f', '#151530', '#2a2147'], '#ffd86b'],
  ['s-summer-night', "Nuit d'été", 'Summer night', 'dark', ['#060b1f', '#1a1f4a', '#3d2a5c'], '#ffb86b', 180],
  ['s-grape-harvest', 'Vendanges', 'Grape harvest', 'dark', ['#14060c', '#3d1024', '#5c2a14'], '#e89a5c'],
  ['s-pumpkin', 'Citrouille', 'Pumpkin', 'light', ['#ffe6cc', '#ffd0a3', '#fff2e0'], '#a33d00'],
  ['s-first-snow', 'Premières neiges', 'First snow', 'light', ['#f0f4f8', '#e1e8f0', '#f8fafc'], '#3a5f85', 180],
  ['s-hanami', 'Hanami', 'Hanami', 'light', ['#ffeef3', '#fde0ea', '#f6f0ff'], '#a3265a'],
  ['s-solstice', 'Solstice', 'Solstice', 'light', ['#fff7d1', '#ffe4a8', '#e0f5d6'], '#875400'],
  ['s-monsoon', 'Mousson', 'Monsoon', 'dark', ['#0a1414', '#173030', '#22404a'], '#6ad6c8', 180],
  ['s-indian-summer', 'Été indien', 'Indian summer', 'dark', ['#1a0f05', '#4a2a0a', '#6b4a14'], '#ffc266'],
  ['s-carnival', 'Carnaval', 'Carnival', 'dark', ['#14052a', '#4a0a4a', '#0a3d4a'], '#ffdf33', 120],
  ['s-diwali', 'Diwali', 'Diwali', 'dark', ['#1a0a00', '#4a1a05', '#5c0a3d'], '#ffb733'],
  ['s-st-patrick', 'Saint-Patrick', "St. Patrick's", 'dark', ['#04140a', '#0a3319', '#145c2a'], '#7dff8a'],
  ['s-hanukkah', 'Hanoukka', 'Hanukkah', 'dark', ['#030a1f', '#0a1f4a', '#1a3a7a'], '#ffd966', 180],
  ['s-harvest', 'Récoltes', 'Harvest', 'light', ['#f7e6cc', '#efd0a3', '#f9eedc'], '#8a3d0a'],
  ['s-beach', 'Plage', 'Beach', 'light', ['#fdf0d5', '#d6f2f7', '#bfe8f5'], '#0b6b8a', 180],
  ['s-ski', 'Ski', 'Ski', 'light', ['#f4f8fc', '#e3edf7', '#dbe7f5'], '#b3261e'],
  ['s-frost-morning', 'Matin de gel', 'Frosty morning', 'light', ['#e8f1fa', '#f1e8fa', '#f8fbff'], '#3d4ea3'],
  ['s-golden-hour', 'Heure dorée', 'Golden hour', 'dark', ['#1a0d05', '#5c2a0a', '#a35a14'], '#ffd28a', 200],
  ['s-spring-rain', 'Pluie de printemps', 'Spring rain', 'light', ['#e3f0ea', '#d6e6ef', '#eef6f2'], '#2a6650', 180],
  ['s-dead-leaves', 'Feuilles mortes', 'Fallen leaves', 'light', ['#f7e3c9', '#f0cfa8', '#f9ecdb'], '#94400c'],
  ['s-funfair', 'Fête foraine', 'Funfair', 'light', ['#ffe0f0', '#e0f0ff', '#fff6d6'], '#a3168a'],
]

/** Préréglage construit à la première lecture de `spec`. */
function lazy(id: string, group: PresetGroup, label: { fr: string; en: string }, build: () => ThemeSpec, meta: { hue?: number; family?: string } = {}): Preset {
  let spec: ThemeSpec | null = null
  return {
    id,
    group,
    label,
    ...meta,
    get spec() {
      return (spec ??= build())
    },
  }
}

export const PRESETS: Preset[] = [
  { id: 'dark', group: 'base', label: { fr: 'Sombre', en: 'Dark' }, spec: DARK },
  { id: 'onyx', group: 'base', label: { fr: 'Plus sombre', en: 'Darker' }, spec: ONYX },
  { id: 'darker', group: 'base', label: { fr: 'AMOLED', en: 'AMOLED' }, spec: AMOLED },
  { id: 'light', group: 'base', label: { fr: 'Clair', en: 'Light' }, spec: LIGHT },
  ...GRADIENTS.map(([id, fr, en, scheme, stops, accent, angle]): Preset =>
    lazy(id, 'gradient', { fr, en }, () => gradient(fr, scheme, stops, accent, angle))),
  ...CLASSIC.map(([id, fr, en, [bg, sidebar, channel, input, hover, text, muted, accent], scheme]): Preset =>
    lazy(id, 'classic', { fr, en }, () => solid(fr, scheme ?? 'dark', [bg, sidebar, channel, bg, input, hover, text, muted, accent]))),
  ...FAMILIES.flatMap((f) => HUES.map(([hfr, hen], i): Preset => {
    const label = { fr: familyLabel(f.fr, hfr), en: familyLabel(f.en, hen) }
    return lazy(`${f.id}-${slug(hen)}`, f.group, label, () => f.build(hueOfIndex(i), label.fr), { hue: hueOfIndex(i), family: f.id })
  })),
  ...NATURE.map(([id, fr, en, scheme, stops, accent, angle]): Preset =>
    lazy(id, 'nature', { fr, en }, () => gradient(fr, scheme, stops, accent, angle))),
  ...SEASONS.map(([id, fr, en, scheme, stops, accent, angle]): Preset =>
    lazy(id, 'seasonal', { fr, en }, () => gradient(fr, scheme, stops, accent, angle))),
]

export const DEFAULT_THEME_ID = 'dark'
export const DEFAULT_SPEC = DARK

let index: Map<string, Preset> | null = null
/** Préréglage par identifiant (index construit au premier appel). */
export function findPreset(id: string): Preset | undefined {
  index ??= new Map(PRESETS.map((p) => [p.id, p]))
  return index.get(id)
}

/** Thème `id` parmi les préréglages puis les thèmes perso (inconnu → null). */
export function findTheme(id: string, customs: readonly CustomTheme[] = []): ThemeSpec | null {
  return findPreset(id)?.spec ?? customs.find((c) => c.id === id) ?? null
}

/** Teinte dominante d'un préréglage (celle de la famille, sinon celle de son accent). */
export function presetHue(p: Preset): number {
  return p.hue ?? toHsl(p.spec.colors.accent)[0]
}

/**
 * Thème réellement affiché : saturation appliquée à toutes ses couleurs (puis contraste
 * revérifié). Saturation 1 → le thème lui-même.
 */
export function tuneTheme(s: ThemeSpec): ThemeSpec {
  if (s.saturation === 1) return s
  const f = s.saturation
  const colors = {} as ThemeColors
  for (const k of COLOR_KEYS) colors[k] = saturate(s.colors[k], f)
  return fixContrast({
    ...s,
    colors,
    gradient: s.gradient ? { ...s.gradient, stops: s.gradient.stops.map((c) => saturate(c, f)) } : null,
    accent2: s.accent2 ? saturate(s.accent2, f) : null,
  })
}

/** Applique une couleur d'accent personnalisée (réglage accent_color du compte) au thème. */
export function withAccent(s: ThemeSpec, accent: string | null | undefined): ThemeSpec {
  return isHex(accent) ? { ...s, colors: { ...s.colors, accent: accent.toLowerCase(), mention: accent.toLowerCase() } } : s
}

/** Valeur CSS du dégradé (construite à partir de valeurs validées uniquement). */
export function cssGradient(g: ThemeGradient): string {
  return `linear-gradient(${Math.round(g.angle)}deg, ${g.stops.filter(isHex).join(', ')})`
}
