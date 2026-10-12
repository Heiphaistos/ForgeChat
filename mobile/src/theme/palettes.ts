/**
 * Palettes du mobile, tirées du catalogue partagé avec le web et le bureau (./themeCore, copie
 * conforme de client/src/theme/themeCore.ts). Module pur : testé par __tests__/theme.test.ts.
 */
import { cssGradient, findPreset, findTheme, isHex, isTranslucent, mix, over, PRESETS, tuneTheme, type Preset, type ThemeSpec } from './themeCore'

export type ColorKey =
  | 'bg'
  | 'bgAlt'
  | 'bgDeep'
  | 'bgElevated'
  | 'bgHover'
  | 'border'
  | 'primary'
  | 'primaryPressed'
  | 'text'
  | 'textSecondary'
  | 'textMuted'
  | 'textFaint'
  | 'danger'
  | 'success'
  | 'warning'
  | 'mention'
  | 'link'
  | 'codeBg'
  | 'overlay'

export type Palette = Record<ColorKey, string>

export const DEFAULT_THEME = 'dark'

/** Palette historique du mobile (Sombre). */
const DARK: Palette = {
  bg: '#313338',
  bgAlt: '#2b2d31',
  bgDeep: '#1e1f22',
  bgElevated: '#383a40',
  bgHover: '#404249',
  border: '#3f4147',
  primary: '#5865f2',
  primaryPressed: '#4752c4',
  text: '#f2f3f5',
  textSecondary: '#dbdee1',
  textMuted: '#949ba4',
  textFaint: '#6d6f78',
  danger: '#f23f43',
  success: '#23a55a',
  warning: '#f0b232',
  mention: 'rgba(250, 168, 26, 0.12)',
  link: '#00a8fc',
  codeBg: '#2b2d31',
  overlay: 'rgba(0,0,0,0.6)',
}

/** Couleurs d'état lisibles sur fond clair. */
const LIGHT_STATES = {
  danger: '#da373c',
  success: '#1f8b4c',
  warning: '#a8650a',
  mention: 'rgba(250, 168, 26, 0.22)',
  overlay: 'rgba(0,0,0,0.4)',
}

const LIGHT: Palette = {
  ...DARK,
  ...LIGHT_STATES,
  bg: '#ffffff',
  bgAlt: '#f2f3f5',
  bgDeep: '#e3e5e8',
  bgElevated: '#ebedef',
  bgHover: '#dfe1e5',
  border: '#d4d7dc',
  text: '#060607',
  textSecondary: '#313338',
  textMuted: '#5c5e66',
  textFaint: '#80848e',
  link: '#006ce7',
  codeBg: '#f2f3f5',
}

export const isHexColor = isHex

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/**
 * Thème (catalogue ou thème perso) → palette opaque. Les panneaux translucides d'un dégradé sont
 * « posés » sur une couleur du dégradé (barre, écran, cartes : chacun la sienne) ; sur une image,
 * sur le pire cas du voile (le mobile n'affiche pas l'image derrière les écrans).
 */
export function paletteFromSpec(raw: ThemeSpec): Palette {
  // Saturation du thème appliquée (contraste revérifié) ; motif et second accent : propres au web.
  const s = tuneTheme(raw)
  const c = s.colors
  const a = isTranslucent(s) ? s.opacity : 1
  const stops = s.gradient?.stops ?? []
  const veil = s.scheme === 'dark' ? '#000000' : '#ffffff'
  const fallback = s.image ? over(veil, s.image.dim, s.scheme === 'dark' ? '#ffffff' : '#000000') : c.bg
  const under = (i: number) => (s.image ? fallback : (stops[i] ?? stops[0] ?? fallback))
  const bg = over(c.bg, a, under(1))
  const bgAlt = over(c.channel, a, over(c.bg, a, under(stops.length - 1)))
  const bgDeep = over(c.sidebar, a, over(c.bg, a, under(0)))
  return {
    ...DARK,
    ...(s.scheme === 'light' ? LIGHT_STATES : {}),
    bg,
    bgAlt,
    bgDeep,
    bgElevated: over(c.input, a, bgAlt),
    bgHover: over(c.hover, a, bgAlt),
    border: c.border,
    primary: c.accent,
    primaryPressed: mix(c.accent, '#000000', 0.2),
    text: c.text,
    textSecondary: mix(c.text, c.muted, 0.15),
    textMuted: c.muted,
    textFaint: mix(c.muted, bg, 0.25),
    mention: rgba(c.mention, s.scheme === 'light' ? 0.22 : 0.15),
    link: c.link,
    codeBg: bgDeep,
  }
}

export interface ThemeEntry {
  id: string
  group: Preset['group']
  label: Preset['label']
  readonly spec: ThemeSpec
  readonly palette: Palette
  /** Dégradé du thème (experimental_backgroundImage), null pour un thème uni. */
  readonly gradient: string | null
}

const paletteCache = new Map<string, Palette>()
/** Palette d'un préréglage, calculée à la première demande (plus de 1 200 thèmes). */
function presetPalette(p: Preset): Palette {
  if (p.id === 'dark') return DARK
  if (p.id === 'light') return LIGHT
  let pal = paletteCache.get(p.id)
  if (!pal) {
    pal = paletteFromSpec(p.spec)
    paletteCache.set(p.id, pal)
  }
  return pal
}

/** Thèmes du web (ordre et libellés du catalogue partagé). Sombre et Clair gardent la palette du mobile. */
export const THEMES: ThemeEntry[] = PRESETS.map((p) => ({
  id: p.id,
  group: p.group,
  label: p.label,
  get spec() {
    return p.spec
  },
  get palette() {
    return presetPalette(p)
  },
  get gradient() {
    return p.spec.gradient ? cssGradient(p.spec.gradient) : null
  },
}))

/** Thème clair : thèmes prédéfinis par identifiant, thème perso par son style. */
export const isLightTheme = (id: string, custom?: ThemeSpec | null) =>
  (custom && id.startsWith('c-') ? custom.scheme : findTheme(id)?.scheme) === 'light'

/** Le thème réclame des bordures fines (AMOLED) : les cartes noires sur fond noir ont besoin d'un trait. */
export const isOutlined = (id: string, custom?: ThemeSpec | null) =>
  (custom && id.startsWith('c-') ? custom.outline : findTheme(id)?.outline) === true

/**
 * Palette du thème `id` (inconnu → Sombre). Un thème perso (`c-…`) se lit dans `custom` et garde son
 * accent ; sur un thème prédéfini, l'accent personnalisé du compte remplace celui du thème.
 */
export function resolvePalette(id: string, accent?: string | null, custom?: ThemeSpec | null): Palette {
  if (custom && id.startsWith('c-')) return paletteFromSpec(custom)
  const preset = findPreset(id)
  const base = preset ? presetPalette(preset) : DARK
  return isHexColor(accent) ? { ...base, primary: accent, primaryPressed: mix(accent, '#000000', 0.2) } : { ...base }
}
