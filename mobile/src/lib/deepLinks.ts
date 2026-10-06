import { extractResetToken } from '@/features/account/rules'
import { isUuid } from './params'

const SCHEME = 'forgechat://'

export type ReplayablePath = `/dm/${string}` | `/group/${string}` | `/channel/${string}/${string}`

/**
 * Lien profond reçu app fermée : pendant le démarrage, les routes connectées n'existent pas
 * encore et le routeur retombe sur l'accueil. On rejoue le lien après connexion, mais
 * seulement pour les conversations, avec des identifiants validés. Toute autre URL : null.
 */
export function replayablePath(url: string): ReplayablePath | null {
  if (!url.toLowerCase().startsWith(SCHEME)) return null
  const parts = (url.slice(SCHEME.length).split(/[?#]/)[0] ?? '').split('/').filter(Boolean)
  const [kind, a, b] = parts
  if (kind === 'dm' && parts.length === 2 && isUuid(a)) return `/dm/${a.toLowerCase()}`
  if (kind === 'group' && parts.length === 2 && isUuid(a)) return `/group/${a.toLowerCase()}`
  if (kind === 'channel' && parts.length === 3 && isUuid(a) && isUuid(b)) return `/channel/${a.toLowerCase()}/${b.toLowerCase()}`
  return null
}

const CODE = /^[A-Za-z0-9_-]{4,32}$/

/**
 * Filtre de TOUT lien entrant (app/+native-intent) : Expo Router rend chaque route accessible
 * par lien profond, y compris les réglages (ex. forgechat://settings/password). On n'accepte que
 * les destinations prévues pour un lien, avec des paramètres valides ; tout le reste → accueil.
 * Accepte « forgechat://… », « https://<hôte>/… » (liens universels) ou un chemin « /… ».
 */
export function safeIncomingPath(raw: string): string {
  let pathname: string
  try {
    const u = new URL(raw, 'forgechat://app')
    // forgechat://dm/x : « dm » est l'hôte de l'URL ; https://hôte/invite/x : chemin seul.
    pathname = u.protocol === 'forgechat:' && u.host && u.host !== 'app' ? `/${u.host}${u.pathname}` : u.pathname
  } catch {
    return '/'
  }
  const parts = pathname.split('/').filter(Boolean)
  const [kind, a, b] = parts
  if (parts.length === 0) return '/'
  // Lien du mail de réinitialisation (jeton dans le fragment) : jeton revalidé, rien d'autre transmis.
  if (kind === 'reset-password' && parts.length === 1) {
    const token = extractResetToken(raw)
    return token ? `/reset-password?token=${token}` : '/reset-password'
  }
  if ((kind === 'invite' || kind === 'friend-invite') && parts.length === 2 && CODE.test(a ?? '')) return `/${kind}/${a}`
  if ((kind === 'dm' || kind === 'group' || kind === 'user') && parts.length === 2 && isUuid(a)) return `/${kind}/${a.toLowerCase()}`
  if (kind === 'channel' && parts.length === 3 && isUuid(a) && isUuid(b)) return `/channel/${a.toLowerCase()}/${b.toLowerCase()}`
  return '/'
}
