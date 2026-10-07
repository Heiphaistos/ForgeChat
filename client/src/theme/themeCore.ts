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
}

export interface CustomTheme extends ThemeSpec {
  id: string
}

export type PresetGroup = 'base' | 'gradient' | 'classic'
export interface Preset {
  id: string
  group: PresetGroup
  label: { fr: string; en: string }
  spec: ThemeSpec
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
  const { name, scheme, colors, gradient, image, opacity, blur, radius, outline } = s
  return { format: 'forgechat-theme', version: 1, name, scheme, colors, gradient, image, opacity, blur, radius, outline }
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

export const PRESETS: Preset[] = [
  { id: 'dark', group: 'base', label: { fr: 'Sombre', en: 'Dark' }, spec: DARK },
  { id: 'onyx', group: 'base', label: { fr: 'Plus sombre', en: 'Darker' }, spec: ONYX },
  { id: 'darker', group: 'base', label: { fr: 'AMOLED', en: 'AMOLED' }, spec: AMOLED },
  { id: 'light', group: 'base', label: { fr: 'Clair', en: 'Light' }, spec: LIGHT },
  ...GRADIENTS.map(([id, fr, en, scheme, stops, accent, angle]): Preset => ({
    id,
    group: 'gradient',
    label: { fr, en },
    spec: gradient(fr, scheme, stops, accent, angle),
  })),
  ...CLASSIC.map(([id, fr, en, [bg, sidebar, channel, input, hover, text, muted, accent], scheme]): Preset => ({
    id,
    group: 'classic',
    label: { fr, en },
    spec: solid(fr, scheme ?? 'dark', [bg, sidebar, channel, bg, input, hover, text, muted, accent]),
  })),
]

export const DEFAULT_THEME_ID = 'dark'
export const DEFAULT_SPEC = DARK

/** Thème `id` parmi les préréglages puis les thèmes perso (inconnu → null). */
export function findTheme(id: string, customs: readonly CustomTheme[] = []): ThemeSpec | null {
  return PRESETS.find((p) => p.id === id)?.spec ?? customs.find((c) => c.id === id) ?? null
}

/** Applique une couleur d'accent personnalisée (réglage accent_color du compte) au thème. */
export function withAccent(s: ThemeSpec, accent: string | null | undefined): ThemeSpec {
  return isHex(accent) ? { ...s, colors: { ...s.colors, accent: accent.toLowerCase(), mention: accent.toLowerCase() } } : s
}

/** Valeur CSS du dégradé (construite à partir de valeurs validées uniquement). */
export function cssGradient(g: ThemeGradient): string {
  return `linear-gradient(${Math.round(g.angle)}deg, ${g.stops.filter(isHex).join(', ')})`
}
