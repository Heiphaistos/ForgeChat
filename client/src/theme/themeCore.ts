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

/** Retouches facultatives d'un thème classique (lien distinct, second accent, bordures, arrondis, motif). */
type ClassicExtra = { link?: string; accent2?: string; outline?: boolean; radius?: number; pattern?: Pattern }

/**
 * Collection « Classiques » : palettes d'éditeurs et d'applications connues (dans leur esprit) et
 * créations ForgeChat. Fond, barre, salons, saisie, survol, texte, atténué, accent. Les 25 premiers
 * gardent leurs identifiants historiques ; le contraste AA est garanti par fixContrast (solid).
 */
const CLASSIC: [id: string, fr: string, en: string, c: [string, string, string, string, string, string, string, string], scheme?: Scheme, extra?: ClassicExtra][] = [
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
  ['dracula-midnight', 'Dracula minuit', 'Dracula midnight', ['#21222c', '#191a21', '#1d1e26', '#343746', '#2c2e3a', '#f8f8f2', '#7970a9', '#ff79c6'], undefined, { accent2: '#8be9fd' }],
  ['alucard', 'Alucard (Dracula clair)', 'Alucard (Dracula light)', ['#fffbeb', '#efeddc', '#f5f2e1', '#e6e3cf', '#dedbc6', '#1f1f1f', '#635d97', '#644ac9'], 'light'],
  ['nord-light', 'Nord clair', 'Nord light', ['#eceff4', '#d8dee9', '#e5e9f0', '#d8dee9', '#cfd6e2', '#2e3440', '#4c566a', '#5e81ac'], 'light'],
  ['nord-aurora', 'Nord aurore', 'Nord aurora', ['#3b4252', '#2e3440', '#353c4a', '#4c566a', '#434c5e', '#eceff4', '#a3acbd', '#88c0d0'], undefined, { accent2: '#b48ead' }],
  ['polar-night', 'Nuit polaire', 'Polar night', ['#242933', '#1d2129', '#2e3440', '#3b4252', '#353b48', '#d8dee9', '#81899b', '#81a1c1']],
  ['gruvbox-medium', 'Gruvbox moyen', 'Gruvbox medium', ['#282828', '#1d2021', '#32302f', '#504945', '#3c3836', '#ebdbb2', '#a89984', '#fabd2f'], undefined, { link: '#83a598' }],
  ['gruvbox-soft', 'Gruvbox doux', 'Gruvbox soft', ['#32302f', '#282828', '#3c3836', '#665c54', '#504945', '#ebdbb2', '#a89984', '#8ec07c']],
  ['gruvbox-light', 'Gruvbox clair', 'Gruvbox light', ['#fbf1c7', '#ebdbb2', '#f2e5bc', '#ebdbb2', '#d5c4a1', '#3c3836', '#7c6f64', '#af3a03'], 'light', { link: '#076678' }],
  ['gruvbox-light-soft', 'Gruvbox clair doux', 'Gruvbox light soft', ['#f2e5bc', '#e6d6ac', '#ebdbb2', '#d5c4a1', '#d5c4a1', '#3c3836', '#665c54', '#076678'], 'light'],
  ['gruvbox-material', 'Gruvbox Material', 'Gruvbox Material', ['#282828', '#1d2021', '#32302f', '#45403d', '#3c3836', '#d4be98', '#928374', '#7daea3']],
  ['solarized-light', 'Solarized clair', 'Solarized light', ['#fdf6e3', '#eee8d5', '#f5efdc', '#eee8d5', '#e4ddc8', '#073642', '#586e75', '#268bd2'], 'light'],
  ['selenized-dark', 'Selenized sombre', 'Selenized dark', ['#103c48', '#0c3340', '#0e3641', '#2d5b69', '#184956', '#adbcbc', '#72898f', '#4695f7']],
  ['selenized-light', 'Selenized clair', 'Selenized light', ['#fbf3db', '#ece3cc', '#f3ebd3', '#d5cdb6', '#e4dcc4', '#53676d', '#909995', '#0072d4'], 'light'],
  ['selenized-black', 'Selenized noir', 'Selenized black', ['#181818', '#101010', '#1c1c1c', '#3b3b3b', '#252525', '#b9b9b9', '#777777', '#368aeb']],
  ['monokai-pro', 'Monokai Pro', 'Monokai Pro', ['#2d2a2e', '#221f22', '#272428', '#403e41', '#363337', '#fcfcfa', '#939293', '#ffd866'], undefined, { accent2: '#ff6188' }],
  ['monokai-machine', 'Monokai Machine', 'Monokai Machine', ['#273136', '#1d2528', '#222b2f', '#3a4449', '#2f393e', '#f2fffc', '#8b9798', '#a2e57b']],
  ['monokai-octagon', 'Monokai Octagon', 'Monokai Octagon', ['#282a3a', '#1e1f2b', '#232533', '#3a3d4b', '#303242', '#eaf2f1', '#888d94', '#ff9b5e']],
  ['monokai-ristretto', 'Monokai Ristretto', 'Monokai Ristretto', ['#2c2525', '#211c1c', '#272020', '#403838', '#352e2e', '#fff1f3', '#948a8b', '#f38d70']],
  ['monokai-spectrum', 'Monokai Spectrum', 'Monokai Spectrum', ['#222222', '#191919', '#1e1e1e', '#363537', '#2c2c2c', '#f7f1ff', '#8b888f', '#fc618d'], undefined, { accent2: '#7bd88f' }],
  ['monokai-light', 'Monokai clair', 'Monokai light', ['#fafafa', '#ececec', '#f3f3f3', '#e6e6e6', '#dedede', '#272822', '#6e6e66', '#d33682'], 'light'],
  ['onelight', 'One Light', 'One Light', ['#fafafa', '#eaeaeb', '#f0f0f1', '#e5e5e6', '#dbdbdc', '#383a42', '#696c77', '#4078f2'], 'light'],
  ['onedark-vivid', 'One Dark vif', 'One Dark vivid', ['#282c34', '#1e2227', '#23272e', '#3e4451', '#2c313a', '#abb2bf', '#7f848e', '#c678dd'], undefined, { link: '#61afef' }],
  ['onedark-darker', 'One Dark plus sombre', 'One Dark darker', ['#21252b', '#181a1f', '#1c1f24', '#333842', '#2a2e36', '#abb2bf', '#7f848e', '#e5c07b'], undefined, { link: '#61afef' }],
  ['tokyonight-storm', 'Tokyo Night Storm', 'Tokyo Night Storm', ['#24283b', '#1f2335', '#222539', '#414868', '#292e42', '#c0caf5', '#737aa2', '#7aa2f7']],
  ['tokyonight-moon', 'Tokyo Night Moon', 'Tokyo Night Moon', ['#222436', '#1e2030', '#1f2133', '#3b4261', '#2f334d', '#c8d3f5', '#828bb8', '#82aaff'], undefined, { accent2: '#c099ff' }],
  ['tokyonight-day', 'Tokyo Night Day', 'Tokyo Night Day', ['#e1e2e7', '#d0d5e3', '#d8dbe4', '#c4c8da', '#c8ccdb', '#343b58', '#6172b0', '#2e7de9'], 'light'],
  ['tokyo-city', 'Tokyo City', 'Tokyo City', ['#171d23', '#11151a', '#141a1f', '#28323a', '#1d252c', '#d8e2ec', '#7e8b98', '#5ccc96']],
  ['catppuccin-latte', 'Catppuccin Latte', 'Catppuccin Latte', ['#eff1f5', '#dce0e8', '#e6e9ef', '#ccd0da', '#d5d8e0', '#4c4f69', '#6c6f85', '#8839ef'], 'light', { link: '#1e66f5' }],
  ['catppuccin-frappe', 'Catppuccin Frappé', 'Catppuccin Frappé', ['#303446', '#232634', '#292c3c', '#414559', '#3b3f52', '#c6d0f5', '#a5adce', '#ca9ee6'], undefined, { link: '#8caaee' }],
  ['catppuccin-macchiato', 'Catppuccin Macchiato', 'Catppuccin Macchiato', ['#24273a', '#181926', '#1e2030', '#363a4f', '#2e3248', '#cad3f5', '#a5adcb', '#8aadf4'], undefined, { accent2: '#c6a0f6' }],
  ['catppuccin-mocha', 'Catppuccin Mocha', 'Catppuccin Mocha', ['#1e1e2e', '#11111b', '#181825', '#313244', '#282839', '#cdd6f4', '#a6adc8', '#89b4fa'], undefined, { accent2: '#f5c2e7' }],
  ['rosepine-moon', 'Rosé Pine Moon', 'Rosé Pine Moon', ['#232136', '#1e1c31', '#2a273f', '#393552', '#312e49', '#e0def4', '#908caa', '#c4a7e7'], undefined, { link: '#9ccfd8' }],
  ['rosepine-dawn', 'Rosé Pine Dawn', 'Rosé Pine Dawn', ['#faf4ed', '#f2e9e1', '#fffaf3', '#f2e9e1', '#ebe0d6', '#575279', '#797593', '#b4637a'], 'light', { link: '#286983' }],
  ['everforest-hard', 'Everforest dur', 'Everforest hard', ['#272e33', '#1e2326', '#2e383c', '#414b50', '#374145', '#d3c6aa', '#859289', '#83c092']],
  ['everforest-soft', 'Everforest doux', 'Everforest soft', ['#333c43', '#293136', '#3a464c', '#4d5960', '#434f55', '#d3c6aa', '#9da9a0', '#dbbc7f']],
  ['everforest-light', 'Everforest clair', 'Everforest light', ['#fdf6e3', '#efebd4', '#f4f0d9', '#e6e2cc', '#e0dcc7', '#5c6a72', '#829181', '#35a77c'], 'light'],
  ['kanagawa-dragon', 'Kanagawa Dragon', 'Kanagawa Dragon', ['#181616', '#0d0c0c', '#12120f', '#393836', '#282727', '#c5c9c5', '#a6a69c', '#8ba4b0']],
  ['kanagawa-lotus', 'Kanagawa Lotus', 'Kanagawa Lotus', ['#f2ecbc', '#e5ddb0', '#e7dba0', '#dcd5ac', '#d5cea3', '#545464', '#716e61', '#4d699b'], 'light'],
  ['ayu-dark', 'Ayu sombre', 'Ayu dark', ['#0d1017', '#0b0e14', '#0f131a', '#1c212b', '#141821', '#bfbdb6', '#636a72', '#e6b450'], undefined, { link: '#59c2ff' }],
  ['ayu-mirage', 'Ayu Mirage', 'Ayu Mirage', ['#1f2430', '#1c212b', '#232834', '#33415e', '#2a3040', '#cccac2', '#707a8c', '#ffcc66'], undefined, { link: '#73d0ff' }],
  ['ayu-light', 'Ayu clair', 'Ayu light', ['#fcfcfc', '#f3f4f5', '#f8f9fa', '#e7eaed', '#e1e5ea', '#5c6166', '#8a9199', '#fa8d3e'], 'light', { link: '#399ee6' }],
  ['material-darker', 'Material plus sombre', 'Material darker', ['#212121', '#1a1a1a', '#1e1e1e', '#424242', '#2c2c2c', '#eeffff', '#848484', '#ff9800']],
  ['material-ocean', 'Material Océan', 'Material Ocean', ['#0f111a', '#090b10', '#0c0e14', '#1f2233', '#1a1c25', '#a6accd', '#717cb4', '#84ffff']],
  ['palenight', 'Palenight', 'Palenight', ['#292d3e', '#1b1e2b', '#202331', '#444267', '#32374d', '#a6accd', '#676e95', '#c792ea'], undefined, { link: '#82aaff' }],
  ['material-lighter', 'Material plus clair', 'Material lighter', ['#fafafa', '#eeeeee', '#f5f5f5', '#e7e7e8', '#e0e0e0', '#546e7a', '#90a4ae', '#39adb5'], 'light'],
  ['material-volcano', 'Material Volcan', 'Material Volcano', ['#390000', '#2b0000', '#330000', '#5a0b0b', '#4a0505', '#ffeaea', '#c78787', '#ff5b5b']],
  ['github-dark', 'GitHub sombre', 'GitHub dark', ['#0d1117', '#010409', '#161b22', '#21262d', '#1c2128', '#e6edf3', '#7d8590', '#2f81f7']],
  ['github-dimmed', 'GitHub tamisé', 'GitHub dimmed', ['#22272e', '#1c2128', '#2d333b', '#373e47', '#323942', '#adbac7', '#768390', '#539bf5']],
  ['github-light', 'GitHub clair', 'GitHub light', ['#ffffff', '#eaeef2', '#f6f8fa', '#eaeef2', '#e2e7ec', '#1f2328', '#656d76', '#0969da'], 'light'],
  ['github-dark-hc', 'GitHub contraste fort', 'GitHub high contrast', ['#0a0c10', '#010409', '#0d1016', '#272b33', '#1c2128', '#f0f3f6', '#9ea7b3', '#409eff'], undefined, { outline: true }],
  ['github-light-hc', 'GitHub clair contraste fort', 'GitHub light high contrast', ['#ffffff', '#e7ecf0', '#f2f5f7', '#e7ecf0', '#dde3e8', '#0e1116', '#4b535d', '#0349b4'], 'light', { outline: true }],
  ['nightowl', 'Night Owl', 'Night Owl', ['#011627', '#010e1a', '#01111d', '#1d3b53', '#0b2942', '#d6deeb', '#637777', '#82aaff'], undefined, { accent2: '#c792ea' }],
  ['light-owl', 'Light Owl', 'Light Owl', ['#fbfbfb', '#f0f0f0', '#f6f6f6', '#e0e7ea', '#e6e9ec', '#403f53', '#90a7b2', '#4876d6'], 'light'],
  ['cobalt2', 'Cobalt2', 'Cobalt2', ['#193549', '#122738', '#15232d', '#234e6d', '#1f4662', '#ffffff', '#aaaaaa', '#ffc600'], undefined, { link: '#9effff' }],
  ['synthwave84', "Synthwave '84", "Synthwave '84", ['#262335', '#1e1a2b', '#241b2f', '#34294f', '#2a2139', '#f0eff1', '#848bbd', '#ff7edb'], undefined, { accent2: '#36f9f6', link: '#36f9f6' }],
  ['oceanic-next', 'Oceanic Next', 'Oceanic Next', ['#1b2b34', '#16232a', '#192830', '#343d46', '#22343e', '#d8dee9', '#65737e', '#6699cc']],
  ['horizon', 'Horizon', 'Horizon', ['#1c1e26', '#16161c', '#1a1c23', '#2e303e', '#232530', '#d5d8da', '#6c6f93', '#e95678'], undefined, { accent2: '#fab795' }],
  ['horizon-bright', 'Horizon clair', 'Horizon bright', ['#fdf0ed', '#fadad1', '#f9e9e5', '#f9cec3', '#f7d6cd', '#1c1e26', '#6c6f93', '#da103f'], 'light'],
  ['poimandres', 'Poimandres', 'Poimandres', ['#1b1e28', '#171922', '#191c25', '#303340', '#252837', '#e4f0fb', '#a6accd', '#5de4c7'], undefined, { accent2: '#add7ff' }],
  ['vesper', 'Vesper', 'Vesper', ['#101010', '#0b0b0b', '#141414', '#232323', '#1c1c1c', '#ffffff', '#a0a0a0', '#ffc799'], undefined, { link: '#99ffe4' }],
  ['moonlight', 'Moonlight', 'Moonlight', ['#212337', '#191a2a', '#1e2030', '#2f334d', '#2a2c45', '#e4f3fa', '#7a88cf', '#ff98a4'], undefined, { link: '#82aaff' }],
  ['shades-of-purple', 'Shades of Purple', 'Shades of Purple', ['#2d2b55', '#1e1e3f', '#28284e', '#3b3a6e', '#35346a', '#ffffff', '#a599e9', '#fad000'], undefined, { link: '#9effff' }],
  ['panda', 'Panda', 'Panda', ['#292a2b', '#242526', '#2b2c2e', '#3e4045', '#31353a', '#e6e6e6', '#757575', '#ff75b5'], undefined, { accent2: '#19f9d8' }],
  ['andromeda', 'Andromeda', 'Andromeda', ['#23262e', '#1f2229', '#20232a', '#3a3f4b', '#2b2f38', '#d5ced9', '#a0a1a7', '#00e8c6'], undefined, { accent2: '#c74ded' }],
  ['noctis', 'Noctis', 'Noctis', ['#052529', '#03191b', '#041d20', '#0b3a40', '#08303a', '#b2cacd', '#5b858b', '#40d4e7']],
  ['noctis-bordo', 'Noctis Bordo', 'Noctis Bordo', ['#322a2d', '#272022', '#2c2427', '#4a3c41', '#3d3236', '#cbbec2', '#8d7b81', '#f18eb0']],
  ['noctis-azureus', 'Noctis Azureus', 'Noctis Azureus', ['#07273b', '#051e2d', '#062234', '#0d3b57', '#0b324b', '#becfda', '#5d8099', '#49ace9']],
  ['noctis-uva', 'Noctis Uva', 'Noctis Uva', ['#292640', '#201e33', '#252239', '#3d3a5d', '#332f4f', '#c5c2d6', '#7f7aa3', '#998ef1']],
  ['noctis-obscuro', 'Noctis Obscuro', 'Noctis Obscuro', ['#031417', '#020e10', '#031114', '#0c2e33', '#08242a', '#b2cacd', '#4e7377', '#16a3b6']],
  ['noctis-minimus', 'Noctis Minimus', 'Noctis Minimus', ['#1b2932', '#141f26', '#182730', '#2c414e', '#233541', '#c5cdd3', '#5e7887', '#72b7c0']],
  ['noctis-lux', 'Noctis Lux', 'Noctis Lux', ['#fef8ec', '#f6eddc', '#faf2e3', '#f2e6d0', '#ecdfc6', '#005661', '#888477', '#0094f0'], 'light'],
  ['noctis-lilac', 'Noctis Lilac', 'Noctis Lilac', ['#f2f1f8', '#e9e7f3', '#efedf7', '#e2dff0', '#dcd8ee', '#0c006b', '#5c5788', '#8e7ed4'], 'light'],
  ['iceberg', 'Iceberg', 'Iceberg', ['#161821', '#0f1117', '#13151e', '#2a3158', '#1e2132', '#c6c8d1', '#6b7089', '#84a0c6']],
  ['iceberg-light', 'Iceberg clair', 'Iceberg light', ['#e8e9ec', '#dcdfe7', '#e2e4ea', '#cad0de', '#d2d6e0', '#33374c', '#8389a3', '#2d539e'], 'light'],
  ['tomorrow-night', 'Tomorrow Night', 'Tomorrow Night', ['#1d1f21', '#151718', '#1a1c1e', '#373b41', '#282a2e', '#c5c8c6', '#969896', '#81a2be']],
  ['tomorrow-eighties', 'Tomorrow Night Eighties', 'Tomorrow Night Eighties', ['#2d2d2d', '#232323', '#292929', '#515151', '#393939', '#cccccc', '#999999', '#cc99cc'], undefined, { link: '#6699cc' }],
  ['tomorrow-bright', 'Tomorrow Night Bright', 'Tomorrow Night Bright', ['#000000', '#000000', '#0a0a0a', '#2a2a2a', '#1a1a1a', '#eaeaea', '#969896', '#7aa6da']],
  ['tomorrow-blue', 'Tomorrow Night Blue', 'Tomorrow Night Blue', ['#002451', '#001b3e', '#00204a', '#003f8e', '#00346e', '#ffffff', '#7285b7', '#bbdaff']],
  ['tomorrow', 'Tomorrow', 'Tomorrow', ['#ffffff', '#efefef', '#f7f7f7', '#e0e0e0', '#d6d6d6', '#4d4d4c', '#8e908c', '#4271ae'], 'light'],
  ['zenburn', 'Zenburn', 'Zenburn', ['#3f3f3f', '#2b2b2b', '#383838', '#5f5f5f', '#4f4f4f', '#dcdccc', '#9f9f8f', '#8cd0d3'], undefined, { link: '#f0dfaf' }],
  ['sonokai', 'Sonokai', 'Sonokai', ['#2c2e34', '#222327', '#33353f', '#414550', '#3b3e48', '#e2e2e3', '#7f8490', '#76cce0']],
  ['sonokai-atlantis', 'Sonokai Atlantis', 'Sonokai Atlantis', ['#2a2f38', '#20262c', '#333846', '#3f4555', '#373c4b', '#e1e3e4', '#828a9a', '#9dd274']],
  ['sonokai-andromeda', 'Sonokai Andromeda', 'Sonokai Andromeda', ['#2b2d3a', '#1c1e27', '#333648', '#3f445b', '#363a4e', '#e1e3e4', '#7e8294', '#bb97ee']],
  ['sonokai-shusia', 'Sonokai Shusia', 'Sonokai Shusia', ['#2d2a2e', '#211f21', '#37343a', '#423f46', '#3b383e', '#e3e1e4', '#848089', '#f69c5e']],
  ['sonokai-maia', 'Sonokai Maia', 'Sonokai Maia', ['#273136', '#1c2326', '#313b42', '#3d4a51', '#353f46', '#e1e2e3', '#82878b', '#e3d367']],
  ['sonokai-espresso', 'Sonokai Espresso', 'Sonokai Espresso', ['#2b2421', '#211c19', '#362f2b', '#443b36', '#3b332f', '#e4e3e1', '#90817b', '#f86882']],
  ['edge-dark', 'Edge sombre', 'Edge dark', ['#2c2e34', '#202023', '#30323a', '#414550', '#383b43', '#c5cdd9', '#7f8490', '#d38aea'], undefined, { link: '#6cb6eb' }],
  ['edge-light', 'Edge clair', 'Edge light', ['#fafafa', '#eef1f4', '#f4f5f7', '#dde2e7', '#e5e8ec', '#4b505b', '#8790a0', '#5079be'], 'light'],
  ['oled-black', 'OLED noir', 'OLED black', ['#000000', '#000000', '#000000', '#000000', '#121212', '#ffffff', '#a8a8a8', '#3b82f6'], undefined, { outline: true }],
  ['oled-gold', 'OLED or', 'OLED gold', ['#000000', '#000000', '#000000', '#000000', '#121008', '#fff8e1', '#c9b98a', '#ffc400'], undefined, { outline: true }],
  ['paper', 'Papier', 'Paper', ['#f8f5ec', '#ede8da', '#f3efe3', '#e7e1d0', '#e2dbc8', '#2b2722', '#6b6257', '#b5562a'], 'light'],
  ['sepia', 'Sépia', 'Sepia', ['#f4ecd8', '#e8dcc0', '#efe4cc', '#e3d5b5', '#dccdab', '#433422', '#76624a', '#8b5a2b'], 'light'],
  ['parchment', 'Parchemin', 'Parchment', ['#f1e7d0', '#e2d3b3', '#eadcc0', '#ddcda9', '#d6c49e', '#3b2f1e', '#6f5d43', '#7a3b12'], 'light'],
  ['newsprint', 'Papier journal', 'Newsprint', ['#f2f2ee', '#e4e4de', '#ebebe6', '#dcdcd5', '#d4d4cc', '#1a1a1a', '#5c5c58', '#a01e1e'], 'light'],
  ['e-ink', 'Encre électronique', 'E-ink', ['#ffffff', '#f0f0f0', '#f7f7f7', '#e6e6e6', '#dddddd', '#000000', '#4a4a4a', '#000000'], 'light', { outline: true, radius: 0.5 }],
  ['kraft', 'Papier kraft', 'Kraft paper', ['#e8d6b5', '#d9c39b', '#e0cca8', '#d2ba90', '#cbb187', '#2e2213', '#5e4a30', '#8a3c0f'], 'light'],
  ['notebook', 'Cahier', 'Notebook', ['#fdfdf6', '#eef2fb', '#f6f8fd', '#e3e9f7', '#dbe2f3', '#1f2a44', '#56617c', '#d64045'], 'light', { pattern: 'lines' }],
  ['max-black', 'Contraste maximal noir', 'Maximum contrast black', ['#000000', '#000000', '#000000', '#000000', '#1a1a1a', '#ffffff', '#e0e0e0', '#ffff00'], undefined, { outline: true, link: '#00ffff' }],
  ['max-white', 'Contraste maximal blanc', 'Maximum contrast white', ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#e8e8e8', '#000000', '#1a1a1a', '#0000cc'], 'light', { outline: true }],
  ['max-amber', 'Contraste ambre', 'Amber contrast', ['#000000', '#000000', '#000000', '#0d0900', '#1a1200', '#ffd000', '#e6bb00', '#ffd000'], undefined, { outline: true }],
  ['max-cyan', 'Contraste cyan', 'Cyan contrast', ['#000814', '#000814', '#000814', '#001428', '#00213f', '#ffffff', '#bfefff', '#00e5ff'], undefined, { outline: true }],
  ['vscode-dark-modern', 'VS Code sombre moderne', 'VS Code Dark Modern', ['#1f1f1f', '#181818', '#1c1c1c', '#313131', '#2a2d2e', '#cccccc', '#9d9d9d', '#0078d4']],
  ['vscode-light-modern', 'VS Code clair moderne', 'VS Code Light Modern', ['#ffffff', '#f8f8f8', '#f3f3f3', '#e8e8e8', '#e4e6f1', '#3b3b3b', '#6e6e6e', '#005fb8'], 'light'],
  ['dark-plus', 'Dark+', 'Dark+', ['#1e1e1e', '#333333', '#252526', '#3c3c3c', '#2a2d2e', '#d4d4d4', '#858585', '#007acc']],
  ['xcode-dark', 'Xcode sombre', 'Xcode dark', ['#1f1f24', '#18181c', '#1c1c20', '#3a3a40', '#2a2a30', '#dfdfe0', '#7f8c98', '#fc5fa3'], undefined, { link: '#5dd8ff' }],
  ['xcode-light', 'Xcode clair', 'Xcode light', ['#ffffff', '#f0f0f2', '#f7f7f8', '#e5e5ea', '#ececf0', '#262626', '#707f8c', '#9b2393'], 'light'],
  ['mariana', 'Mariana', 'Mariana', ['#303841', '#262c33', '#2b3239', '#4f5b66', '#3a434d', '#d8dee9', '#a6acb9', '#f9ae58'], undefined, { link: '#6699cc' }],
  ['darcula', 'Darcula', 'Darcula', ['#2b2b2b', '#3c3f41', '#313335', '#45494a', '#4b4f51', '#a9b7c6', '#808080', '#cc7832'], undefined, { link: '#6897bb' }],
  ['islands-dark', 'Îles sombre', 'Islands dark', ['#1e1f22', '#2b2d30', '#25272a', '#393b40', '#2e3034', '#dfe1e5', '#868a91', '#3574f0']],
  ['intellij-light', 'IntelliJ clair', 'IntelliJ light', ['#ffffff', '#f2f2f2', '#f7f8fa', '#ebecf0', '#dfe1e5', '#000000', '#6c707e', '#2675bf'], 'light'],
  ['obsidian-np', 'Obsidienne', 'Obsidian', ['#293134', '#22292b', '#262e30', '#3f4b4e', '#33393c', '#e0e2e4', '#818e96', '#93c763']],
  ['vault', 'Coffre violet', 'Purple vault', ['#1e1e1e', '#262626', '#202020', '#363636', '#2f2f2f', '#dadada', '#999999', '#a882ff']],
  ['spacemacs-dark', 'Spacemacs sombre', 'Spacemacs dark', ['#292b2e', '#212026', '#262729', '#444155', '#34323e', '#b2b2b2', '#7a7a7a', '#bc6ec5'], undefined, { link: '#4f97d7' }],
  ['spacemacs-light', 'Spacemacs clair', 'Spacemacs light', ['#fbf8ef', '#efeae9', '#f6f1e1', '#e3dedd', '#e6e0d6', '#655370', '#a094a2', '#6c3163'], 'light'],
  ['nightfox', 'Nightfox', 'Nightfox', ['#192330', '#131a24', '#1d2a38', '#2b3b51', '#212e3f', '#cdcecf', '#738091', '#719cd6']],
  ['dayfox', 'Dayfox', 'Dayfox', ['#f6f2ee', '#e4dcd4', '#efe9e4', '#dbd1dd', '#e0d6cd', '#3d2b5a', '#643f61', '#2848a9'], 'light'],
  ['carbonfox', 'Carbonfox', 'Carbonfox', ['#161616', '#0c0c0c', '#131313', '#2a2a2a', '#252525', '#f2f4f8', '#7b7c7e', '#78a9ff'], undefined, { accent2: '#ff7eb6' }],
  ['terafox', 'Terafox', 'Terafox', ['#152528', '#0f1c1e', '#1d3337', '#2f4b50', '#254147', '#e6eaea', '#6d7f8b', '#5a93aa']],
  ['melange-dark', 'Mélange sombre', 'Melange dark', ['#292522', '#211d1b', '#34302c', '#403a36', '#3a3430', '#ece1d7', '#a38d78', '#e49b5d']],
  ['melange-light', 'Mélange clair', 'Melange light', ['#f1f1f1', '#e9e1db', '#ede8e4', '#ddd3cb', '#e3d9d1', '#54433a', '#7d6658', '#bc5c00'], 'light'],
  ['aubergine', 'Aubergine', 'Aubergine', ['#1a1d21', '#3f0e40', '#350d36', '#2c2d30', '#4d2a51', '#d1d2d3', '#9a9b9e', '#1164a3'], undefined, { link: '#1d9bd1' }],
  ['messenger-green', 'Messagerie verte', 'Green messenger', ['#0b141a', '#111b21', '#0f1a20', '#2a3942', '#202c33', '#e9edef', '#8696a0', '#00a884']],
  ['night-messenger', 'Messagerie de nuit', 'Night messenger', ['#17212b', '#0e1621', '#141d26', '#242f3d', '#202b36', '#f5f5f5', '#708499', '#5288c1']],
  ['dim-blue', 'Bleu tamisé', 'Dim blue', ['#15202b', '#10171e', '#192734', '#253341', '#1e2d3c', '#f7f9f9', '#8b98a5', '#1d9bf0']],
  ['studio-green', 'Studio vert', 'Green studio', ['#121212', '#000000', '#181818', '#2a2a2a', '#282828', '#ffffff', '#b3b3b3', '#1db954']],
  ['studio-purple', 'Studio violet', 'Purple studio', ['#0e0e10', '#18181b', '#1f1f23', '#3a3a3d', '#26262c', '#efeff1', '#adadb8', '#9147ff']],
  ['aubergine-terminal', 'Terminal aubergine', 'Aubergine terminal', ['#300a24', '#2c001e', '#3a0d2d', '#5e2750', '#4a1a3d', '#ffffff', '#c7a7bd', '#e95420']],
  ['luna', 'Luna', 'Luna', ['#ece9d8', '#d6dff7', '#f1efe2', '#e3e0cf', '#dcd8c4', '#000000', '#4d4d4d', '#245edb'], 'light'],
  ['workbench', 'Workbench', 'Workbench', ['#0055aa', '#004488', '#004c99', '#0066cc', '#005fbb', '#ffffff', '#cfe0f2', '#ff8800'], undefined, { radius: 0.25 }],
  ['c64', 'C64', 'C64', ['#352879', '#2a1f66', '#30247a', '#4a3d99', '#42358f', '#b8b0f0', '#8f84d8', '#6c5eb5'], undefined, { radius: 0, outline: true }],
  ['borland', 'Borland', 'Borland', ['#0000aa', '#000088', '#00009a', '#0000cc', '#1515b8', '#ffff55', '#55ffff', '#00aaaa'], undefined, { radius: 0, link: '#55ffff' }],
  ['amber-phosphor', 'Ambre phosphore', 'Amber phosphor', ['#100800', '#0a0500', '#140b00', '#2a1800', '#201200', '#ffb000', '#c98a00', '#ffb000'], undefined, { radius: 0.25, pattern: 'lines' }],
  ['gotham', 'Gotham', 'Gotham', ['#0c1014', '#090c0f', '#0a0f14', '#11151c', '#091f2e', '#99d1ce', '#599cab', '#2aa889']],
  ['jellybeans', 'Jellybeans', 'Jellybeans', ['#151515', '#0f0f0f', '#1c1c1c', '#333333', '#262626', '#e8e8d3', '#888888', '#8197bf'], undefined, { link: '#fad07a' }],
  ['badwolf', 'Badwolf', 'Badwolf', ['#1c1b1a', '#141413', '#242321', '#45413b', '#35322d', '#f8f6f2', '#857f78', '#aeee00']],
  ['papercolor-light', 'PaperColor clair', 'PaperColor light', ['#eeeeee', '#e4e4e4', '#e8e8e8', '#d0d0d0', '#dadada', '#444444', '#878787', '#d70087'], 'light', { link: '#005f87' }],
  ['papercolor-dark', 'PaperColor sombre', 'PaperColor dark', ['#1c1c1c', '#121212', '#262626', '#3a3a3a', '#303030', '#d0d0d0', '#808080', '#5fafd7']],
  ['flexoki-dark', 'Flexoki sombre', 'Flexoki dark', ['#100f0f', '#0b0a0a', '#1c1b1a', '#343331', '#282726', '#cecdc3', '#878580', '#da702c']],
  ['flexoki-light', 'Flexoki clair', 'Flexoki light', ['#fffcf0', '#f2f0e5', '#f7f4e8', '#e6e4d9', '#dad8ce', '#100f0f', '#6f6e69', '#205ea6'], 'light'],
  ['cyberdream', 'Cyberdream', 'Cyberdream', ['#16181a', '#0f1112', '#1e2124', '#3c4048', '#2a2d31', '#ffffff', '#7b8496', '#5ef1ff'], undefined, { accent2: '#ff5ef1' }],
  ['apprentice', 'Apprentice', 'Apprentice', ['#262626', '#1c1c1c', '#2a2a2a', '#444444', '#303030', '#bcbcbc', '#6c6c6c', '#87af87']],
  ['srcery', 'Srcery', 'Srcery', ['#1c1b19', '#121110', '#262521', '#3a3836', '#2d2c29', '#fce8c3', '#918175', '#ff5f00']],
  ['moonfly', 'Moonfly', 'Moonfly', ['#080808', '#000000', '#121212', '#323437', '#1c1c1c', '#bdbdbd', '#808080', '#74b2ff']],
  ['challenger-deep', 'Challenger Deep', 'Challenger Deep', ['#1e1c31', '#151325', '#2b2942', '#3e3859', '#312e48', '#cbe3e7', '#8a889d', '#aaffe4'], undefined, { accent2: '#ff8080' }],
  ['lucario', 'Lucario', 'Lucario', ['#2b3e50', '#22313f', '#263747', '#3e5266', '#344759', '#f8f8f2', '#8baac0', '#66d9ef']],
  ['everblush', 'Everblush', 'Everblush', ['#141b1e', '#0f1517', '#192226', '#2d3437', '#232a2d', '#dadada', '#8f979a', '#67b0e8']],
  ['bearded-arc', 'Bearded Arc', 'Bearded Arc', ['#1c2433', '#161c28', '#19202e', '#2e3a50', '#243048', '#c3cfd9', '#8196b5', '#69c3ff']],
  ['aura', 'Aura', 'Aura', ['#15141b', '#110f18', '#1a1922', '#2d2b38', '#211f2a', '#edecee', '#6d6d6d', '#a277ff'], undefined, { accent2: '#61ffca' }],
  ['kimbie', 'Kimbie sombre', 'Kimbie dark', ['#221a0f', '#1a140b', '#2a2012', '#423523', '#362a1b', '#d3af86', '#a57a4c', '#dc3958']],
  ['quiet-light', 'Lumière calme', 'Quiet light', ['#f5f5f5', '#e8e8e8', '#efefef', '#e0e0e0', '#d9d9e8', '#333333', '#777777', '#7a3e9d'], 'light'],
  ['abyss', 'Abysse', 'Abyss', ['#000c18', '#060621', '#051336', '#10192c', '#082050', '#6688cc', '#384887', '#2277ff']],
  ['forge-ember', 'Braise de forge', 'Forge ember', ['#1c1512', '#140f0c', '#191210', '#3a2a22', '#2a1f19', '#f1e4da', '#a88f80', '#ff6a2b'], undefined, { accent2: '#ffb347' }],
  ['anvil', 'Enclume', 'Anvil', ['#1d2024', '#15171a', '#1a1c20', '#33373e', '#272a30', '#e3e6ea', '#8d939c', '#5d7ea8'], undefined, { outline: true }],
  ['molten', 'Métal en fusion', 'Molten metal', ['#170806', '#0f0403', '#140605', '#3a120b', '#2a0d08', '#ffe9d6', '#d08c70', '#ffae00'], undefined, { accent2: '#ff3d00' }],
  ['quench', 'Trempe', 'Quench', ['#0e1a22', '#09131a', '#0c171f', '#1f3442', '#162733', '#dbeaf3', '#7f9cb0', '#36b5e0']],
  ['bronze', 'Bronze', 'Bronze', ['#1e1a14', '#16130e', '#1b1712', '#3b3227', '#2b251c', '#efe3cf', '#a8957a', '#cd8f3c']],
  ['verdigris', 'Vert-de-gris', 'Verdigris', ['#13201d', '#0d1715', '#111c1a', '#24403a', '#1b302c', '#dcefe9', '#86a89f', '#4fb39a']],
  ['spark', 'Étincelle', 'Spark', ['#fff8f2', '#ffe8d6', '#fff1e6', '#ffe2cc', '#ffd9bd', '#2a1a10', '#7a5a45', '#d9480f'], 'light'],
  ['forge-night', 'Nuit de forge', 'Forge night', ['#120f1a', '#0c0a12', '#100d17', '#2a2338', '#1e1929', '#ece6f6', '#9a8fb0', '#ff7b3a']],
  ['blueprint', "Plan d'architecte", 'Blueprint', ['#0d2b52', '#0a2242', '#0b264a', '#1a4478', '#143a68', '#e8f1ff', '#9db8dd', '#ffd166'], undefined, { pattern: 'grid', radius: 0.5 }],
  ['chalkboard', 'Tableau noir', 'Chalkboard', ['#263a30', '#1d2e25', '#22352b', '#38503f', '#2f4537', '#f2f2ea', '#b3c2b5', '#f4d35e']],
  ['graphite-light', 'Graphite clair', 'Light graphite', ['#e9eaec', '#d8dadd', '#e1e3e6', '#cfd2d6', '#c8cbd0', '#1b1d21', '#4f545c', '#3d4451'], 'light'],
  ['ink-wash', "Lavis d'encre", 'Ink wash', ['#f4f1ea', '#e6e1d6', '#ede9e0', '#dcd6c9', '#d5cebf', '#1c1a17', '#5a554c', '#3a3f58'], 'light'],
  ['rust', 'Rouille', 'Rust', ['#1f1410', '#170e0b', '#1c110d', '#3d2519', '#2d1b13', '#f3dfd2', '#b08b78', '#d9622b']],
  ['smithy', 'Atelier', 'Smithy', ['#24201c', '#1a1714', '#201c18', '#403830', '#322c26', '#eee5da', '#a39684', '#e8a33d']],
]

/** Thème classique : couleurs pleines, retouches facultatives, contraste revérifié après le lien. */
function classicTheme(name: string, scheme: Scheme, c: Solid, x: ClassicExtra = {}): ThemeSpec {
  const base = solid(name, scheme, c, x.link ? { link: x.link } : {})
  return {
    ...base,
    outline: x.outline ?? base.outline,
    radius: x.radius ?? base.radius,
    accent2: x.accent2 ?? base.accent2,
    pattern: x.pattern ?? base.pattern,
    patternOpacity: x.pattern ? 0.06 : base.patternOpacity,
  }
}

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
  ...CLASSIC.map(([id, fr, en, [bg, sidebar, channel, input, hover, text, muted, accent], scheme, x]): Preset =>
    lazy(id, 'classic', { fr, en }, () => classicTheme(fr, scheme ?? 'dark', [bg, sidebar, channel, bg, input, hover, text, muted, accent], x))),
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
