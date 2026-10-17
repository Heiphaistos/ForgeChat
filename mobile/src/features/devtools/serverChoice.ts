import * as SecureStore from 'expo-secure-store'
import { checkServerUrl } from '@/config/serverUrl'

/**
 * Serveur choisi dans l'APK DEV (et le build de développement). Jamais chargé en production :
 * src/config/env.ts ne requiert ce module que si EXPO_PUBLIC_APP_ENV ≠ production.
 * Pas en LAN : Android n'y autorise le HTTP que vers l'IP fixée au build.
 */

const KEY = 'forgechat.devServerOrigin'

export const serverChoiceEnabled = (appEnv: string) => appEnv === 'preview' || appEnv === 'development'

/**
 * Origine enregistrée, revalidée à chaque lecture (une valeur invalide est ignorée).
 * Lecture asynchrone au démarrage (la lecture synchrone pendant l'évaluation du bundle faisait
 * planter le thread JS par intermittence).
 */
export async function storedOrigin(appEnv: string): Promise<string | null> {
  if (!serverChoiceEnabled(appEnv)) return null
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    if (!raw) return null
    const r = checkServerUrl(raw)
    return r.ok ? r.origin : null
  } catch {
    return null
  }
}

export async function saveOrigin(origin: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, origin, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
}

export async function clearOrigin(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY)
}
