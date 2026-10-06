import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { DEFAULT_THEME, isHexColor } from './palettes'

/**
 * Préférences d'apparence de cet appareil. Lues de façon SYNCHRONE au chargement de theme/index.ts,
 * avant tout StyleSheet.create : les couleurs et tailles de texte s'appliquent donc au démarrage
 * (changer de thème = redémarrer l'app).
 */
export interface AppearancePrefs {
  theme: string
  /** Couleur d'accent personnalisée (#rrggbb, champ accent_color du serveur) ou null. */
  accent: string | null
  timeFormat: '12h' | '24h'
  /** Facteur appliqué aux tailles de `font` (réglage local, pas celui du web pensé pour un écran de bureau). */
  textScale: number
  /** Mode streamer (streamer_mode du serveur) : masque le tag et les codes d'invitation. */
  streamerMode: boolean
}

export const TEXT_SCALES = [
  { value: 0.9, label: 'Petit' },
  { value: 1, label: 'Normal' },
  { value: 1.15, label: 'Grand' },
  { value: 1.3, label: 'Très grand' },
] as const

export const DEFAULT_PREFS: AppearancePrefs = { theme: DEFAULT_THEME, accent: null, timeFormat: '24h', textScale: 1, streamerMode: false }

/** Valeur stockée → préférences valides (tout champ invalide reprend sa valeur par défaut). */
export function parsePrefs(raw: string | null | undefined): AppearancePrefs {
  let v: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>
  } catch {
    /* valeur corrompue : défauts */
  }
  return {
    theme: typeof v.theme === 'string' ? v.theme : DEFAULT_PREFS.theme,
    accent: isHexColor(v.accent) ? v.accent : null,
    timeFormat: v.timeFormat === '12h' ? '12h' : '24h',
    textScale: TEXT_SCALES.some((s) => s.value === v.textScale) ? (v.textScale as number) : 1,
    streamerMode: v.streamerMode === true,
  }
}

const KEY = 'fc.appearance.v1'
// Après le premier déverrouillage : lisible quand l'app est lancée par une notification, écran verrouillé.
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.prefs',
}

function read(): string | null {
  try {
    return SecureStore.getItem(KEY, OPTS)
  } catch {
    return null
  }
}

/** Préférences en cours (mutées par saveAppearance : l'heure suit tout de suite, les couleurs au redémarrage). */
export const appearance: AppearancePrefs = parsePrefs(read())

/** Préférences enregistrées, telles qu'elles s'appliqueront au prochain lancement (réactif, pour les écrans). */
export const useAppearance = create<AppearancePrefs>(() => ({ ...appearance }))

export function saveAppearance(patch: Partial<AppearancePrefs>): void {
  useAppearance.setState(patch)
  const savedAppearance = useAppearance.getState()
  // Effets immédiats seulement : thème, accent et taille de texte attendent le redémarrage.
  appearance.timeFormat = savedAppearance.timeFormat
  appearance.streamerMode = savedAppearance.streamerMode
  try {
    // Synchrone : l'écriture doit être faite avant un redémarrage immédiat.
    SecureStore.setItem(KEY, JSON.stringify(savedAppearance), OPTS)
  } catch {
    /* stockage indisponible : le choix vaut pour cette session seulement */
  }
}
