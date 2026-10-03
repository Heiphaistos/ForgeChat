import Constants from 'expo-constants'

/**
 * Configuration runtime, dérivée de app.config.ts (champ `extra`).
 * Toute l'app passe par ce module : aucune URL codée en dur ailleurs.
 */

type Extra = { apiUrl?: string; appEnv?: string; livekitHost?: string | null }
const extra = (Constants.expoConfig?.extra ?? {}) as Extra

export type AppEnv = 'development' | 'lan' | 'preview' | 'production'

export const APP_ENV: AppEnv =
  extra.appEnv === 'production' || extra.appEnv === 'preview' || extra.appEnv === 'lan'
    ? extra.appEnv
    : 'development'

/** APK de test sur le réseau local (jamais distribué) : bandeau, pas de push. */
export const IS_LAN = APP_ENV === 'lan'

const PRIVATE_IPV4 = /^(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/

function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  // APK DEV : le build peut ne pas fixer de serveur (pré-prod non renseignée) ; il se choisit dans l'app.
  if (!value && APP_ENV === 'preview') return ''
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`[config] apiUrl invalide: "${value}"`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('[config] apiUrl doit être http(s)')
  }
  // Hors développement, refuser tout transport non chiffré — sauf en LAN vers une IPv4 privée
  // (le build l'impose déjà, et Android n'autorise le clair que vers cet hôte).
  const lanHttp = APP_ENV === 'lan' && PRIVATE_IPV4.test(parsed.hostname)
  if (parsed.protocol !== 'https:' && !lanHttp && (APP_ENV !== 'development' || !__DEV__)) {
    throw new Error('[config] HTTPS obligatoire hors développement')
  }
  return `${parsed.protocol}//${parsed.host}`
}

/** Serveur fixé à la compilation (aucun défaut : bêta = celui du build ; APK DEV = pré-prod éventuelle). */
export const BUILD_API_ORIGIN = normalizeBaseUrl(extra.apiUrl)

// Choix de serveur (écran « Serveur » des Infos dev) : code retiré du bundle de production.
const serverChoice =
  process.env.EXPO_PUBLIC_APP_ENV === 'production'
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/features/devtools/serverChoice') as typeof import('@/features/devtools/serverChoice'))

let origin = BUILD_API_ORIGIN

/** Origine du serveur, ex. https://chat.example.org (vide : APK DEV sans serveur choisi). */
export const apiOrigin = () => origin
/** Préfixe REST */
export const apiBase = () => `${origin}/api`
/** Endpoint WebSocket (wss:// en production) */
export const wsUrl = () => `${origin.replace(/^http/, 'ws')}/ws`
/** Host utilisé pour valider les liens entrants (universal links) */
export const apiHost = () => (origin ? new URL(origin).host : '')
/** Nom d'hôte seul (sans port) du serveur : sert à valider l'adresse LiveKit reçue. */
export const apiHostname = () => (origin ? new URL(origin).hostname : '')
/** Hôte LiveKit fixé au build (bêta), s'il diffère de celui du serveur (FORGECHAT_LIVEKIT_URL). */
export const BUILD_LIVEKIT_HOST: string | null = extra.livekitHost ?? null

/** Au démarrage, avant toute requête : applique le serveur choisi dans l'APK DEV (rien en production). */
export async function loadServerChoice(): Promise<void> {
  const stored = await serverChoice?.storedOrigin(APP_ENV)
  if (stored) setApiOrigin(stored)
}

const originListeners = new Set<() => void>()
/** Abonnement aux changements de serveur (pour useSyncExternalStore). */
export function subscribeApiOrigin(fn: () => void): () => void {
  originListeners.add(fn)
  return () => originListeners.delete(fn)
}

/** Change de serveur (APK DEV uniquement, après déconnexion complète : voir ServerPicker.tsx). */
export function setApiOrigin(next: string): void {
  if (process.env.EXPO_PUBLIC_APP_ENV === 'production') throw new Error('[config] serveur fixe en production')
  origin = next
  originListeners.forEach((fn) => fn())
}

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

/** Limites alignées sur le serveur */
export const LIMITS = {
  messageMaxChars: 4000,
  uploadMaxBytes: 50 * 1024 * 1024,
  avatarMaxBytes: 8 * 1024 * 1024,
  pageSize: 50,
} as const

/**
 * Extensions acceptées par le serveur pour un utilisateur normal. Liste identique pour les trois
 * routes d'upload : salon (handlers/uploads.rs), DM (friends.rs) et groupe (group_dms.rs). Un fichier
 * sans extension y est traité comme « bin ». Seuls propriétaire/modérateurs d'un serveur peuvent
 * envoyer d'autres types dans un salon : le mobile ne reproduit pas cette exception.
 */
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mkv',
  'mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'pdf', 'txt', 'md', 'zip', 'tar', 'gz', '7z',
  'rar', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'bin',
])
