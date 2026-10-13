import * as Font from 'expo-font'
import { Platform, type TextStyle } from 'react-native'

/**
 * Polices du pseudo et des marques (identifiants de lib/nameStyle NAME_FONTS). Polices système
 * (Android : familles génériques serif, monospace, casual, cursive, sans-serif-condensed… ;
 * iOS : polices livrées avec le système) et six polices OFL embarquées (assets/fonts, même
 * origine que le web : OFL.txt), chargées par expo-font au démarrage. Tant qu'une police
 * embarquée n'est pas chargée (ou si le chargement échoue), la police système proche la
 * remplace : jamais de famille inconnue passée au rendu. Certaines ajoutent un réglage
 * (graisse, chasse, casse) comme sur le web.
 */
export const BUNDLED_FONTS = {
  FCBookSerif: require('../../assets/fonts/fc-book-serif-400.ttf'),
  FCHumanist: require('../../assets/fonts/fc-humanist-400.ttf'),
  FCMetricSerif: require('../../assets/fonts/fc-metric-serif-400.ttf'),
  FCMetricSans: require('../../assets/fonts/fc-metric-sans-400.ttf'),
  FCMetricMono: require('../../assets/fonts/fc-metric-mono-400.ttf'),
  FCDisplay: require('../../assets/fonts/fc-display-700.otf'),
} as const
export type BundledFont = keyof typeof BUNDLED_FONTS

let loading: Promise<void> | null = null
/** Charge les polices embarquées une fois ; un échec laisse les polices système. */
export function loadNameFonts(): Promise<void> {
  loading ??= Font.loadAsync(BUNDLED_FONTS).catch(() => undefined)
  return loading
}

const sys = (ios: string, other: string) => Platform.select({ ios, default: other })
const serif = sys('Georgia', 'serif')
const mono = sys('Courier', 'monospace')
const sans = sys('Helvetica Neue', 'sans-serif')

export const NAME_FONT_STYLES: Record<string, TextStyle> = {
  serif: { fontFamily: serif },
  mono: { fontFamily: mono },
  cursive: { fontFamily: sys('Snell Roundhand', 'cursive') },
  rounded: { fontFamily: sys('Chalkboard SE', 'casual') },
  heavy: { fontWeight: '900' },
  slab: { fontFamily: sys('Rockwell', 'serif'), fontWeight: '700' },
  condensed: { fontFamily: sys('AvenirNextCondensed-Medium', 'sans-serif-condensed') },
  wide: { letterSpacing: 2, fontWeight: '600' },
  elegant: { fontFamily: sys('Didot', 'serif'), fontStyle: 'italic' },
  typewriter: { fontFamily: sys('American Typewriter', 'monospace') },
  gothic: { fontFamily: sys('Copperplate', 'serif'), fontWeight: '700' },
  comic: { fontFamily: sys('Chalkboard SE', 'casual') },
  impact: { fontFamily: sys('Futura-CondensedExtraBold', 'sans-serif-condensed'), fontWeight: '900' },
  smallcaps: { fontFamily: serif, fontVariant: ['small-caps'], letterSpacing: 0.5 },
  light: { fontWeight: '300', letterSpacing: 0.4 },
  handwritten: { fontFamily: sys('Bradley Hand', 'cursive') },
  futuristic: { fontFamily: sys('Avenir Next', 'sans-serif-medium'), letterSpacing: 1.2, textTransform: 'uppercase' },
  retro: { fontFamily: sys('Cochin', 'serif'), fontWeight: '800' },
  stencil: { fontFamily: sys('Futura-CondensedExtraBold', 'sans-serif-condensed'), textTransform: 'uppercase', letterSpacing: 1 },
  code: { fontFamily: sys('Menlo', 'monospace'), fontWeight: '700' },
  italic: { fontStyle: 'italic', fontWeight: '600' },
  arial: { fontFamily: sys('Arial', 'sans-serif') },
  times: { fontFamily: sys('Times New Roman', 'serif') },
  courier: { fontFamily: sys('Courier New', 'monospace') },
  cambria: { fontFamily: serif },
  calibri: { fontFamily: sans },
  display: { fontFamily: sans, fontWeight: '800' },
  inter: { fontFamily: sans },
  interthin: { fontFamily: sys('HelveticaNeue-Thin', 'sans-serif-thin'), fontWeight: '200' },
  jetbrains: { fontFamily: sys('Menlo', 'monospace') },
  georgia: { fontFamily: serif },
  palatino: { fontFamily: sys('Palatino', 'serif') },
  garamond: { fontFamily: sys('Baskerville', 'serif') },
  baskerville: { fontFamily: sys('Baskerville', 'serif') },
  bodoni: { fontFamily: sys('Bodoni 72', 'serif'), fontWeight: '700' },
  optima: { fontFamily: sys('Optima', 'sans-serif') },
  futura: { fontFamily: sys('Futura', 'sans-serif') },
  century: { fontFamily: sys('Futura', 'sans-serif'), letterSpacing: 0.3 },
  verdana: { fontFamily: sys('Verdana', 'sans-serif') },
  tahoma: { fontFamily: sys('Verdana', 'sans-serif') },
  trebuchet: { fontFamily: sys('Trebuchet MS', 'sans-serif') },
  gill: { fontFamily: sys('Gill Sans', 'sans-serif') },
  helvetica: { fontFamily: sans },
  avenir: { fontFamily: sys('Avenir Next', 'sans-serif') },
  copperplate: { fontFamily: sys('Copperplate', 'serif'), fontVariant: ['small-caps'], letterSpacing: 1 },
  papyrus: { fontFamily: sys('Papyrus', 'serif') },
  marker: { fontFamily: sys('Marker Felt', 'casual') },
  chalk: { fontFamily: sys('Chalkduster', 'casual') },
  brush: { fontFamily: sys('SnellRoundhand-Bold', 'cursive') },
  calligraphy: { fontFamily: sys('Zapfino', 'cursive') },
  console: { fontFamily: sys('Menlo', 'monospace') },
  arialblack: { fontFamily: sys('Arial', 'sans-serif'), fontWeight: '900' },
  franklin: { fontFamily: sys('Avenir Next Condensed', 'sans-serif-condensed'), fontWeight: '600' },
  bookman: { fontFamily: serif },
  segoe: { fontFamily: sans },
  hoefler: { fontFamily: sys('Hoefler Text', 'serif') },
  candara: { fontFamily: sys('Optima', 'sans-serif') },
  cascadia: { fontFamily: sys('Menlo', 'monospace') },
  lucida: { fontFamily: sans },
  caps: { textTransform: 'uppercase', letterSpacing: 1.4, fontWeight: '700' },
  spaced: { letterSpacing: 4 },
  tight: { letterSpacing: -0.6, fontWeight: '800' },
  serifcaps: { fontFamily: serif, textTransform: 'uppercase', letterSpacing: 1.6 },
  monocaps: { fontFamily: mono, textTransform: 'uppercase', letterSpacing: 0.6 },
  lower: { textTransform: 'lowercase', fontWeight: '300', letterSpacing: 0.3 },
}

/** Police embarquée utilisée (si chargée) à la place de la famille système, comme sur le web. */
export const NAME_FONT_BUNDLED: Partial<Record<string, BundledFont>> = {
  serif: 'FCMetricSerif',
  times: 'FCMetricSerif',
  bodoni: 'FCMetricSerif',
  typewriter: 'FCMetricMono',
  courier: 'FCMetricMono',
  console: 'FCMetricMono',
  arial: 'FCMetricSans',
  helvetica: 'FCMetricSans',
  franklin: 'FCMetricSans',
  futura: 'FCMetricSans',
  century: 'FCMetricSans',
  cambria: 'FCBookSerif',
  georgia: 'FCBookSerif',
  palatino: 'FCBookSerif',
  garamond: 'FCBookSerif',
  baskerville: 'FCBookSerif',
  bookman: 'FCBookSerif',
  hoefler: 'FCBookSerif',
  papyrus: 'FCBookSerif',
  calibri: 'FCHumanist',
  optima: 'FCHumanist',
  candara: 'FCHumanist',
  verdana: 'FCHumanist',
  tahoma: 'FCHumanist',
  trebuchet: 'FCHumanist',
  gill: 'FCHumanist',
  avenir: 'FCHumanist',
  segoe: 'FCHumanist',
  lucida: 'FCHumanist',
  display: 'FCDisplay',
  arialblack: 'FCDisplay',
}

/** Sur iOS, la police système proche reste prioritaire (comme la pile du web) ; ailleurs, l'embarquée. */
const PREFER_SYSTEM_ON_IOS = new Set(['serif', 'times', 'georgia', 'palatino', 'baskerville', 'hoefler', 'optima', 'futura', 'avenir', 'arial', 'helvetica', 'verdana', 'trebuchet', 'gill', 'papyrus', 'bodoni', 'typewriter', 'courier', 'console'])

export function nameFontStyle(font?: string | null): TextStyle | null {
  if (!font) return null
  const base = NAME_FONT_STYLES[font] ?? null
  const bundled = NAME_FONT_BUNDLED[font]
  if (!bundled || (Platform.OS === 'ios' && PREFER_SYSTEM_ON_IOS.has(font))) return base
  let loaded = false
  try {
    loaded = Font.isLoaded(bundled)
  } catch {
    loaded = false
  }
  return loaded ? { ...base, fontFamily: bundled } : base
}
