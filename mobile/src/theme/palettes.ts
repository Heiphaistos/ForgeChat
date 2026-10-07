/**
 * Palettes du mobile, tirées du catalogue partagé avec le web et le bureau (./themeCore, copie
 * conforme de client/src/theme/themeCore.ts). Module pur : testé par __tests__/theme.test.ts.
 */
import { cssGradient, findTheme, isHex, isTranslucent, mix, over, PRESETS, type ThemeSpec } from './themeCore'

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
export function paletteFromSpec(s: ThemeSpec): Palette {
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

/** Thèmes du web (ordre et libellés du catalogue partagé). Sombre et Clair gardent la palette du mobile. */
export const THEMES = PRESETS.map((p) => ({
  id: p.id,
  group: p.group,
  label: p.label,
  spec: p.spec,
  palette: p.id === 'dark' ? DARK : p.id === 'light' ? LIGHT : paletteFromSpec(p.spec),
  /** Dégradé du thème (experimental_backgroundImage), null pour un thème uni. */
  gradient: p.spec.gradient ? cssGradient(p.spec.gradient) : null,
}))

const PALETTES: Record<string, Palette> = Object.fromEntries(THEMES.map((t) => [t.id, t.palette]))

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
  const base = PALETTES[id] ?? DARK
  return isHexColor(accent) ? { ...base, primary: accent, primaryPressed: mix(accent, '#000000', 0.2) } : { ...base }
}
