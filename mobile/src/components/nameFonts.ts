import { Platform, type TextStyle } from 'react-native'

/**
 * Polices du pseudo et des marques (identifiants de lib/nameStyle NAME_FONTS) : polices
 * système uniquement, aucune police embarquée ni téléchargée. Android : familles génériques
 * (serif, monospace, casual, cursive, sans-serif-condensed…) ; iOS : polices livrées avec le
 * système. Une police absente retombe sur la police par défaut ; certaines ajoutent un
 * réglage (graisse, chasse, majuscules) comme sur le web.
 */
export const NAME_FONT_STYLES: Record<string, TextStyle> = {
  serif: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }) },
  mono: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) },
  cursive: { fontFamily: Platform.select({ ios: 'Snell Roundhand', default: 'cursive' }) },
  rounded: { fontFamily: Platform.select({ ios: 'Chalkboard SE', default: 'casual' }) },
  heavy: { fontWeight: '900' },
  slab: { fontFamily: Platform.select({ ios: 'Rockwell', default: 'serif' }), fontWeight: '700' },
  condensed: { fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Medium', default: 'sans-serif-condensed' }) },
  wide: { letterSpacing: 2, fontWeight: '600' },
  elegant: { fontFamily: Platform.select({ ios: 'Didot', default: 'serif' }), fontStyle: 'italic' },
  typewriter: { fontFamily: Platform.select({ ios: 'American Typewriter', default: 'monospace' }) },
  gothic: { fontFamily: Platform.select({ ios: 'Copperplate', default: 'serif' }), fontWeight: '700' },
  comic: { fontFamily: Platform.select({ ios: 'Chalkboard SE', default: 'casual' }) },
  impact: { fontFamily: Platform.select({ ios: 'Futura-CondensedExtraBold', default: 'sans-serif-condensed' }), fontWeight: '900' },
  smallcaps: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontVariant: ['small-caps'], letterSpacing: 0.5 },
  light: { fontWeight: '300', letterSpacing: 0.4 },
  handwritten: { fontFamily: Platform.select({ ios: 'Bradley Hand', default: 'cursive' }) },
  futuristic: { fontFamily: Platform.select({ ios: 'Avenir Next', default: 'sans-serif-medium' }), letterSpacing: 1.2, textTransform: 'uppercase' },
  retro: { fontFamily: Platform.select({ ios: 'Cochin', default: 'serif' }), fontWeight: '800' },
  stencil: { fontFamily: Platform.select({ ios: 'Futura-CondensedExtraBold', default: 'sans-serif-condensed' }), textTransform: 'uppercase', letterSpacing: 1 },
  code: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontWeight: '700' },
  italic: { fontStyle: 'italic', fontWeight: '600' },
}

export const nameFontStyle = (font?: string | null): TextStyle | null => (font ? NAME_FONT_STYLES[font] ?? null : null)
