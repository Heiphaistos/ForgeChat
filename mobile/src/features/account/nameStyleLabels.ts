import type { Key } from '@/i18n'

/** Libellés historiques ; les autres effets et polices : settings.nameStyle.fx.<id> / font.<id>. */
const EFFECT_LABEL: Record<string, Key> = {
  '': 'settings.nameStyle.none',
  shimmer: 'settings.nameStyle.shimmer',
  glow: 'settings.nameStyle.glow',
  outline: 'settings.nameStyle.outline',
}
const FONT_LABEL: Record<string, Key> = {
  '': 'settings.nameStyle.fontDefault',
  serif: 'settings.nameStyle.serif',
  mono: 'settings.nameStyle.mono',
  rounded: 'settings.nameStyle.rounded',
  heavy: 'settings.nameStyle.heavy',
  cursive: 'settings.nameStyle.cursive',
}
export const effectLabel = (e: string): Key => EFFECT_LABEL[e] ?? (`settings.nameStyle.fx.${e}` as Key)
export const fontLabel = (f: string): Key => FONT_LABEL[f] ?? (`settings.nameStyle.font.${f}` as Key)
