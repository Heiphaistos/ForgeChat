import Constants from 'expo-constants'

/**
 * Configuration runtime, dérivée de app.config.ts (champ `extra`).
 * Toute l'app passe par ce module : aucune URL codée en dur ailleurs.
 */

type Extra = { apiUrl?: string; appEnv?: string }
const extra = (Constants.expoConfig?.extra ?? {}) as Extra

export type AppEnv = 'development' | 'preview' | 'production'

export const APP_ENV: AppEnv =
  extra.appEnv === 'production' || extra.appEnv === 'preview' ? extra.appEnv : 'development'

function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`[config] apiUrl invalide: "${value}"`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('[config] apiUrl doit être http(s)')
  }
  // Hors développement, refuser tout transport non chiffré.
  if (parsed.protocol !== 'https:' && (APP_ENV !== 'development' || !__DEV__)) {
    throw new Error('[config] HTTPS obligatoire hors développement')
  }
  return `${parsed.protocol}//${parsed.host}`
}

/** Origine du serveur, ex. https://forgechat.heiphaistos.org */
export const API_ORIGIN = normalizeBaseUrl(extra.apiUrl ?? 'https://forgechat.heiphaistos.org')
/** Préfixe REST */
export const API_BASE = `${API_ORIGIN}/api`
/** Endpoint WebSocket (wss:// en production) */
export const WS_URL = `${API_ORIGIN.replace(/^http/, 'ws')}/ws`
/** Host utilisé pour valider les liens entrants (universal links) */
export const API_HOST = new URL(API_ORIGIN).host

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

/** Limites alignées sur le serveur */
export const LIMITS = {
  messageMaxChars: 4000,
  uploadMaxBytes: 50 * 1024 * 1024,
  avatarMaxBytes: 8 * 1024 * 1024,
  pageSize: 50,
} as const

/** Extensions acceptées par le serveur pour les pièces jointes (handlers/uploads.rs). */
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mkv',
  'mp3', 'ogg', 'wav', 'flac', 'pdf', 'txt', 'md', 'zip', 'tar', 'gz', '7z',
  'rar', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
])
