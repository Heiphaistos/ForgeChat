import { isLightTheme, resolvePalette, type Palette } from './palettes'
import { appearance } from './prefs'

/**
 * Design tokens — palette du thème choisi (Réglages → Apparence), mêmes thèmes que le web.
 * Remplie ici, au chargement du module : tout `StyleSheet.create` qui importe `colors` la voit déjà.
 */
export const colors: Palette = resolvePalette(appearance.theme, appearance.accent)

/** Thème clair : barre d'état sombre, thème de navigation clair. */
export const isLight = isLightTheme(appearance.theme)

/** Couleurs de présence : voir lib/status.ts (mêmes que le web). */
export const statusColors: Record<string, string> = {
  online: '#3ba55c',
  idle: '#faa81a',
  away: '#faa81a',
  dnd: '#ed4245',
  invisible: '#80848e',
  offline: '#80848e',
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const
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
