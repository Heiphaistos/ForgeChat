import * as SecureStore from 'expo-secure-store'

/**
 * Stockage des jetons d'authentification.
 *
 * - access token (JWT, courte durée) : UNIQUEMENT en mémoire. Jamais persisté,
 *   jamais loggé. Au démarrage à froid, on en obtient un nouveau via le refresh.
 * - refresh token (opaque, 30 j, rotation à chaque usage côté serveur) :
 *   Keychain iOS / Keystore Android via expo-secure-store, accessible
 *   uniquement quand l'appareil est déverrouillé et JAMAIS migré vers un autre
 *   appareil (sauvegardes iCloud/Google exclues : *_THIS_DEVICE_ONLY).
 */

const REFRESH_KEY = 'fc.refresh_token.v1'
const USER_ID_KEY = 'fc.user_id.v1'

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.auth',
}

let accessToken: string | null = null
let accessTokenExp = 0 // epoch seconds

/** Décode (sans vérifier — ce n'est pas le rôle du client) l'`exp` d'un JWT. */
export function readJwtExp(token: string): number {
  const part = token.split('.')[1]
  if (!part) return 0
  try {
    const json = JSON.parse(base64UrlDecode(part)) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp : 0
  } catch {
    return 0
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Décodeur base64url → UTF-8 sans dépendance (Hermes n'expose pas toujours atob). */
export function base64UrlDecode(input: string): string {
  const s = input.replace(/-/g, '+').replace(/_/g, '/')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of s) {
    if (ch === '=') break
    const v = B64.indexOf(ch)
    if (v < 0) throw new Error('base64 invalide')
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  // Décodage UTF-8 manuel
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!
    if (b < 0x80) out += String.fromCharCode(b)
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++]! & 0x3f))
    else if (b < 0xf0)
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f))
    else {
      const cp =
        (((b & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f)) -
        0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    }
  }
  return out
}

export const tokens = {
  getAccessToken(): string | null {
    return accessToken
  },

  /** true si le token expire dans moins de `marginSec` secondes (ou est absent). */
  accessTokenExpiresSoon(marginSec = 60): boolean {
    if (!accessToken) return true
    if (!accessTokenExp) return false
    return accessTokenExp - Date.now() / 1000 < marginSec
  },

  setAccessToken(token: string | null) {
    accessToken = token
    accessTokenExp = token ? readJwtExp(token) : 0
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY, SECURE_OPTS)
    } catch {
      // Keychain illisible (appareil verrouillé, restauration d'un autre appareil…)
      return null
    }
  },

  async setRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_KEY, token, SECURE_OPTS)
  },

  async getUserId(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(USER_ID_KEY, SECURE_OPTS)
    } catch {
      return null
    }
  },

  async setUserId(id: string): Promise<void> {
    await SecureStore.setItemAsync(USER_ID_KEY, id, SECURE_OPTS)
  },

  /** Efface TOUT l'état d'authentification local. */
  async clear(): Promise<void> {
    accessToken = null
    accessTokenExp = 0
    await Promise.allSettled([
      SecureStore.deleteItemAsync(REFRESH_KEY, SECURE_OPTS),
      SecureStore.deleteItemAsync(USER_ID_KEY, SECURE_OPTS),
    ])
  },
}
