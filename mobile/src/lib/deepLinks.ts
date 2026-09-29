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
