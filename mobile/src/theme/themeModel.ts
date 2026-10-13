/**
 * Thèmes ForgeChat : modèle, couleurs, contraste, validation, export et constructeurs.
 * Module PUR, copié à l'identique dans mobile/src/theme/ (vérifié par client/scripts/themes.test.mjs).
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

// ─── Constructeurs ──────────────────────────────────────────────────────────

export type Solid = [bg: string, sidebar: string, channel: string, chat: string, input: string, hover: string, text: string, muted: string, accent: string]

/** Effets neutres (pas de second accent, pas de motif, saturation d'origine). */
export const FX = { accent2: null, pattern: 'none', patternOpacity: 0.08, saturation: 1 } as const satisfies Partial<ThemeSpec>

export function solid(name: string, scheme: Scheme, [bg, sidebar, channel, chat, input, hover, text, muted, accent]: Solid, extra: Partial<ThemeColors> = {}): ThemeSpec {
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

export const DARK: ThemeSpec = solid('Sombre', 'dark', ['#1a1b1e', '#1e2124', '#232428', '#36393f', '#40444b', '#2c2f33', '#dcddde', '#72767d', '#5865f2'], { link: '#00aff4' })
export const LIGHT: ThemeSpec = solid('Clair', 'light', ['#f2f3f5', '#e3e5e8', '#ebedef', '#ffffff', '#e3e5e8', '#d4d7dc', '#060607', '#5c5e66', '#5865f2'], { link: '#006ce7', border: '#d4d7dc' })
export const ONYX: ThemeSpec = solid('Plus sombre', 'dark', ['#111214', '#0b0b0d', '#0e0f11', '#131416', '#1c1d21', '#1e1f23', '#e3e5e8', '#9a9ca3', '#5865f2'], { link: '#00aff4', border: '#232428' })
/** AMOLED : NOIR PUR partout, les reliefs passent par des bordures fines et des survols discrets. */
export const AMOLED: ThemeSpec = {
  ...solid('AMOLED', 'dark', ['#000000', '#000000', '#000000', '#000000', '#000000', '#141414', '#f2f3f5', '#a3a6aa', '#5865f2'], { link: '#00aff4', border: '#262626' }),
  outline: true,
}

/** Retouches facultatives d'un thème classique (lien distinct, second accent, bordures, arrondis, motif). */
export type ClassicExtra = { link?: string; accent2?: string; outline?: boolean; radius?: number; pattern?: Pattern }

/** Ligne de table « solide » : fond, barre, salons, saisie, survol, texte, atténué, accent (discussion = fond). */
export type ClassicRow = [id: string, fr: string, en: string, c: [string, string, string, string, string, string, string, string], scheme?: Scheme, extra?: ClassicExtra]

/** Thème classique : couleurs pleines, retouches facultatives, contraste revérifié après le lien. */
export function classicTheme(name: string, scheme: Scheme, c: Solid, x: ClassicExtra = {}): ThemeSpec {
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
export function gradient(name: string, scheme: Scheme, stops: string[], accent: string, angle = 135): ThemeSpec {
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

/** Solide teinté : 6 luminosités de surface (fond, barre, salons, discussion, saisie, survol). */
export function tint(name: string, scheme: Scheme, h: number, sat: number, l: number[], text: string, muted: string, accent: string, extra: Partial<ThemeColors> = {}): ThemeSpec {
  const [bg, sidebar, channel, chat, input, hover] = l.map((x) => hsl(h, sat, x)) as [string, string, string, string, string, string]
  return solid(name, scheme, [bg, sidebar, channel, chat, input, hover, text, muted, accent], extra)
}

/** Dégradé translucide + effets (second accent, motif, opacité et flou des panneaux). */
export function grad(name: string, scheme: Scheme, stops: string[], accent: string, angle: number, fx: Partial<ThemeSpec> = {}): ThemeSpec {
  const g = gradient(name, scheme, stops, accent, angle)
  return Object.keys(fx).length ? fixContrast({ ...g, ...fx }) : g
}

export type Curated = [id: string, fr: string, en: string, scheme: Scheme, stops: string[], accent: string, angle?: number]

/** Verre : dégradé vu à travers des panneaux très translucides et un flou marqué (comme les familles vr/gv). */
export function glassTheme(name: string, scheme: Scheme, stops: string[], accent: string, angle = 135): ThemeSpec {
  return grad(name, scheme, stops, accent, angle, scheme === 'dark' ? { opacity: 0.35, blur: 28, radius: 1.25 } : { opacity: 0.45, blur: 24, radius: 1.25 })
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
