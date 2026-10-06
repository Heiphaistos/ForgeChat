/**
 * Thèmes de couleurs : mêmes identifiants et mêmes teintes que le web
 * (client/src/components/settings/AppearanceSection.tsx et client/src/index.css).
 * Module pur (aucune dépendance native) : testé par __tests__/theme.test.ts.
 */

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

const AMOLED: Palette = {
  ...DARK,
  bg: '#000000',
  bgAlt: '#0a0a0a',
  bgDeep: '#000000',
  bgElevated: '#1a1a1a',
  bgHover: '#141414',
  border: '#1f1f1f',
  codeBg: '#0a0a0a',
}

const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number]

/** Mélange deux couleurs #rrggbb : t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return `#${x.map((v, i) => hex(v + ((y[i] ?? 0) - v) * t)).join('')}`
}

export const isHexColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

/** Thème du web : fond (body), sidebar, channel, input, survol, texte, texte atténué, accent. */
type WebTheme = [bg: string, sidebar: string, channel: string, input: string, hover: string, text: string, muted: string, accent: string]

function fromWeb([bg, sidebar, channel, input, hover, text, muted, accent]: WebTheme, light = false): Palette {
  return {
    ...DARK,
    ...(light ? LIGHT_STATES : {}),
    bg,
    bgAlt: channel,
    bgDeep: sidebar,
    bgElevated: input,
    bgHover: hover,
    border: hover,
    primary: accent,
    primaryPressed: mix(accent, '#000000', 0.2),
    text,
    textSecondary: mix(text, muted, 0.15),
    // Le « muted » du web est parfois trop sombre pour du texte courant (Matrix, Neon…).
    textMuted: mix(muted, text, 0.35),
    textFaint: muted,
    link: accent,
    codeBg: channel,
  }
}

/** Valeurs relevées dans client/src/index.css ([data-theme="…"]). */
const WEB: Record<string, WebTheme> = {
  dracula: ['#282a36', '#21222c', '#1e1f2b', '#44475a', '#353746', '#f8f8f2', '#6272a4', '#bd93f9'],
  nord: ['#2e3440', '#272c36', '#3b4252', '#4c566a', '#434c5e', '#e5e9f0', '#7b8394', '#5e81ac'],
  catppuccin: ['#1e1e2e', '#181825', '#181825', '#45475a', '#313244', '#cdd6f4', '#585b70', '#cba6f7'],
  gruvbox: ['#1d2021', '#181a1b', '#282828', '#504945', '#3c3836', '#ebdbb2', '#928374', '#d65d0e'],
  tokyonight: ['#1a1b2e', '#141423', '#1f2040', '#303550', '#24283b', '#c0caf5', '#565f89', '#7aa2f7'],
  onedark: ['#282c34', '#21252b', '#2c313c', '#3f4451', '#3b4048', '#abb2bf', '#5c6370', '#61afef'],
  cyberpunk: ['#0d0d0d', '#0a0a0a', '#111111', '#1a1a1a', '#161616', '#e0e0e0', '#555555', '#f0e14a'],
  monokai: ['#272822', '#1e1f1c', '#2d2e2a', '#3e3e37', '#383830', '#f8f8f2', '#75715e', '#a6e22e'],
  solarized: ['#002b36', '#00212b', '#073642', '#083f4d', '#0d4a5c', '#839496', '#586e75', '#268bd2'],
  forest: ['#1a2318', '#141d12', '#1e2a1c', '#2d3e2a', '#243222', '#c8dbc4', '#5a7255', '#6cb340'],
  ocean: ['#0f2340', '#0a1929', '#0d2238', '#1a3557', '#112a47', '#a8c8e8', '#4a7a9b', '#00d4ff'],
  neon: ['#0a0a14', '#080810', '#0d0d1a', '#161630', '#111120', '#e0e0ff', '#444466', '#00ff88'],
  matrix: ['#000000', '#000000', '#040804', '#0a140a', '#060c06', '#33cc33', '#1a4d1a', '#00ff00'],
  rosepine: ['#191724', '#1f1d2e', '#26233a', '#2a273f', '#403d52', '#e0def4', '#6e6a86', '#eb6f92'],
  everforest: ['#2d353b', '#272e33', '#343f44', '#3d484d', '#374145', '#d3c6aa', '#7a8478', '#a7c080'],
  kanagawa: ['#1f1f28', '#16161d', '#2a2a37', '#363646', '#2d2d3f', '#dcd7ba', '#727169', '#7e9cd8'],
  midnight: ['#0c0e1a', '#080910', '#101220', '#1a1d30', '#151828', '#c8cde4', '#444466', '#6272a4'],
  sunset: ['#1a1014', '#14090c', '#22141a', '#2e1a22', '#27151c', '#f0c8b8', '#7a4858', '#f07050'],
  coffee: ['#1e1510', '#160f0a', '#271a12', '#33201a', '#2c1c14', '#d4b896', '#7a5a3a', '#c87941'],
  winter: ['#f0f4f8', '#dce8f0', '#e8f0f8', '#ffffff', '#d0e4f0', '#2c3e50', '#8aacbe', '#3498db'],
  emerald: ['#0d1f18', '#091610', '#122820', '#1a3428', '#162e22', '#a8f0c8', '#3d6e52', '#2ecc71'],
  bloodmoon: ['#120a0a', '#0c0606', '#1a0e0e', '#2a1414', '#221010', '#f0c8c8', '#6e3030', '#cc2222'],
  violet: ['#160d24', '#100918', '#1e1130', '#281640', '#221238', '#d4b8f0', '#6840a0', '#9b59b6'],
  slate: ['#1c2230', '#141b26', '#222c3c', '#2a364a', '#263042', '#c0ccd8', '#5a6a7a', '#5d8aa8'],
  retro: ['#2b2017', '#221810', '#352a1e', '#43342a', '#3c2e22', '#e8d5b0', '#8a6a4a', '#d4883a'],
}

const LIGHT_THEMES = new Set(['light', 'winter'])

const LABELS: Record<string, string> = {
  dark: 'Sombre',
  darker: 'AMOLED',
  light: 'Clair',
  dracula: 'Dracula',
  nord: 'Nord',
  catppuccin: 'Catppuccin',
  gruvbox: 'Gruvbox',
  tokyonight: 'Tokyo Night',
  onedark: 'One Dark',
  cyberpunk: 'Cyberpunk',
  monokai: 'Monokai',
  solarized: 'Solarized',
  forest: 'Forêt',
  ocean: 'Océan',
  neon: 'Neon',
  matrix: 'Matrix',
  rosepine: 'Rosé Pine',
  everforest: 'Everforest',
  kanagawa: 'Kanagawa',
  midnight: 'Minuit',
  sunset: 'Coucher de soleil',
  coffee: 'Café',
  winter: 'Hiver',
  emerald: 'Émeraude',
  bloodmoon: 'Lune de sang',
  violet: 'Violet',
  slate: 'Ardoise',
  retro: 'Rétro',
}

const PALETTES: Record<string, Palette> = {
  dark: DARK,
  darker: AMOLED,
  light: LIGHT,
  ...Object.fromEntries(Object.entries(WEB).map(([id, w]) => [id, fromWeb(w, LIGHT_THEMES.has(id))])),
}

/** Thèmes proposés, dans l'ordre du web. */
export const THEMES = Object.keys(LABELS).map((id) => ({ id, label: LABELS[id] ?? id, palette: PALETTES[id] ?? DARK }))

export const isLightTheme = (id: string) => LIGHT_THEMES.has(id)

/** Palette du thème `id` (inconnu → Sombre), avec la couleur d'accent personnalisée éventuelle. */
export function resolvePalette(id: string, accent?: string | null): Palette {
  const base = PALETTES[id] ?? DARK
  return isHexColor(accent) ? { ...base, primary: accent, primaryPressed: mix(accent, '#000000', 0.2) } : { ...base }
}
