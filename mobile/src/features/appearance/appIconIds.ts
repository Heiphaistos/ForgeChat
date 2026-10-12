/**
 * Identifiants des icônes d'application : les mêmes que le web et le bureau (`preset:N`, 1 à 50,
 * client/src/lib/appIcon.ts) ; null = icône d'origine. Côté natif, la variante N s'appelle
 * « PresetN » (alias Android .AppIconPresetN, icône alternative iOS, plugins/withAppIcons.js).
 */
export const APP_ICON_COUNT = 50

export type AppIconId = `preset:${number}`

export const APP_ICON_NUMBERS: readonly number[] = Array.from({ length: APP_ICON_COUNT }, (_, i) => i + 1)

/** Numéro de la variante (1 à 50), ou null si `v` n'est pas un identifiant valide. */
export function presetNumber(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = /^preset:([1-9][0-9]?)$/.exec(v)
  const n = m ? Number(m[1]) : NaN
  return n >= 1 && n <= APP_ICON_COUNT ? n : null
}

export const isAppIconId = (v: unknown): v is AppIconId => presetNumber(v) !== null

export const presetId = (n: number): AppIconId => `preset:${n}`

/** Nom natif de l'icône (null = icône d'origine). */
export function nativeIconName(id: AppIconId | null): string | null {
  const n = presetNumber(id)
  return n === null ? null : `Preset${n}`
}

/** Icône renvoyée par le module natif → identifiant (inconnue ou absente = icône d'origine). */
export function iconIdFromNative(name: unknown): AppIconId | null {
  const m = typeof name === 'string' ? /^Preset([1-9][0-9]?)$/.exec(name) : null
  return m ? (presetNumber(`preset:${m[1]}`) === null ? null : presetId(Number(m[1]))) : null
}
