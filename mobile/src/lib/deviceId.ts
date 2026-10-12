import * as SecureStore from 'expo-secure-store'

// Identifiant d'appareil (alerte « nouvelle connexion », amélioration n° 4 de l'audit 2026-10-12).
// Rendu par le serveur à la première connexion, gardé dans le trousseau (jamais sauvegardé ni
// synchronisé) et présenté seulement aux connexions suivantes. Le serveur n'en garde que
// l'empreinte SHA-256.
const KEY = 'fc_device_id'
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
export const DEVICE_RE = /^[A-Za-z0-9_-]{43}$/

export async function deviceHeaders(): Promise<Record<string, string>> {
  try {
    const id = await SecureStore.getItemAsync(KEY, OPTS)
    return id && DEVICE_RE.test(id) ? { 'X-ForgeChat-Device': id } : {}
  } catch {
    return {}
  }
}

export async function rememberDevice(id: unknown): Promise<void> {
  if (typeof id !== 'string' || !DEVICE_RE.test(id)) return
  try {
    await SecureStore.setItemAsync(KEY, id, OPTS)
  } catch {
    /* trousseau indisponible : l'appareil sera vu comme nouveau à la prochaine connexion */
  }
}
