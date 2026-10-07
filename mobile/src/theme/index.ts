import { isLightTheme, isOutlined, resolvePalette, type Palette } from './palettes'
import { appearance, DENSITIES } from './prefs'

/**
 * Design tokens — palette du thème choisi (Réglages → Apparence), mêmes thèmes que le web.
 * Remplie ici, au chargement du module : tout `StyleSheet.create` qui importe `colors` la voit déjà.
 */
export const colors: Palette = resolvePalette(appearance.theme, appearance.accent, appearance.custom)

/** Thème clair : barre d'état sombre, thème de navigation clair. */
export const isLight = isLightTheme(appearance.theme, appearance.custom)

/**
 * Thème à bordures fines (AMOLED) : cartes, champs et feuilles sont noirs comme le fond,
 * leur contour passe par `outline` (à étaler dans le style des surfaces surélevées).
 */
export const outlined = isOutlined(appearance.theme, appearance.custom)
export const outline = outlined ? { borderWidth: 1, borderColor: colors.border } : {}

/** Écrans d'appel : toujours sombres, noir pur en AMOLED. */
const amoled = outlined && colors.bg === '#000000'
export const callColors = { bg: amoled ? '#000000' : '#111214', tile: amoled ? '#000000' : '#2b2d31' }

/** Couleurs de présence : voir lib/status.ts (mêmes que le web). */
export const statusColors: Record<string, string> = {
  online: '#3ba55c',
  idle: '#faa81a',
  away: '#faa81a',
  dnd: '#ed4245',
  invisible: '#80848e',
  offline: '#80848e',
}

const densityScale = DENSITIES.find((d) => d.value === appearance.density)?.scale ?? 1
const spaced = (n: number) => Math.round(n * densityScale)
/** Espacements, multipliés par la densité choisie (Réglages → Apparence). */
export const spacing = { xs: spaced(4), sm: spaced(8), md: spaced(12), lg: spaced(16), xl: spaced(24), xxl: spaced(32) } as const
export const radius = { sm: 6, md: 10, lg: 16, full: 999 } as const
const scaled = (n: number) => Math.round(n * appearance.textScale)
export const font = {
  xs: scaled(11),
  sm: scaled(13),
  md: scaled(15),
  lg: scaled(17),
  xl: scaled(20),
  xxl: scaled(26),
} as const
