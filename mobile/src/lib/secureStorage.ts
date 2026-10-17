import * as SecureStore from 'expo-secure-store'
import type { StateStorage } from 'zustand/middleware'
import { logger } from './logger'

/**
 * Adaptateur de persistance Zustand adossé au Keychain/Keystore.
 * Réservé aux petites données (préférences de sécurité) — SecureStore limite
 * la taille des valeurs (~2 Ko sur certains appareils).
 */
const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.prefs',
}

const safeKey = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_')

export const secureStateStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return await SecureStore.getItemAsync(safeKey(name), opts)
    } catch {
      return null
    }
  },
  setItem: async (name, value) => {
    try {
      await SecureStore.setItemAsync(safeKey(name), value, opts)
    } catch (e) {
      logger.warn('secureStorage', 'écriture impossible', safeKey(name), e)
      // Épingles TOFU : l'appelant (keyPins) doit savoir que l'épingle n'est pas persistée.
      if (name.startsWith('fc_e2e_fp_')) throw e
      /* autres clés : stockage indisponible, on garde l'état en mémoire */
    }
  },
  removeItem: async (name) => {
    try {
      await SecureStore.deleteItemAsync(safeKey(name), opts)
    } catch {
      /* ignore */
    }
  },
}
