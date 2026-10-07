// Clé de récupération d'un serveur côté mobile (docs/CHIFFREMENT-E2E.md §11).
// Même logique que client/src/e2e/serverKey.ts : le propriétaire peut toujours
// relire tous les salons de son serveur, la plateforme jamais. La clé privée du
// serveur n'existe en clair qu'en mémoire, le temps d'une opération.
import { http, path } from '@/lib/http'
import { useAccountKey } from './accountKey'
import * as c from './crypto'
import { forgetConv } from './conversations'

export interface ServerKeyResponse {
  exists: boolean
  public?: string
  fingerprint?: string
  /** Propriétaire seulement : clé privée chiffrée par le code de récupération du serveur. */
  recovery?: c.WrappedKey
  /** Propriétaire seulement : la même pour sa clé de compte (null après un transfert sans ré-enveloppe). */
  owner_wrapped?: c.ConvWrapped | null
}

export const getServerKey = (serverId: string) => http.get<ServerKeyResponse>(path`/servers/${serverId}/e2e/server-key`)

function account() {
  const { priv, userId } = useAccountKey.getState()
  if (!priv || !userId) throw new Error('E2E_LOCKED')
  return { priv, id: userId }
}

/** Crée la clé du serveur (propriétaire) ; rend le code de récupération, à afficher UNE fois. */
export async function createServerKey(serverId: string): Promise<string> {
  const { priv, id } = account()
  const kp = await c.generateKeyPair()
  const code = c.generateRecoveryCode()
  try {
    await http.put(path`/servers/${serverId}/e2e/server-key`, {
      public: c.b64uEncode(kp.pub),
      recovery: await c.wrapKey(kp.priv, code, c.serverRecoveryAad(serverId)),
      owner_wrapped: await c.wrapServerKey(priv, kp.pub, kp.priv, serverId, id),
    })
  } finally {
    kp.priv.fill(0)
  }
  // Les prochaines époques devront l'inclure : états des salons rechargés.
  forgetConv()
  return code
}

/** Clé privée du serveur : par ma clé de compte, sinon par le code (et ré-enveloppée pour moi). */
export async function openServerKey(serverId: string, code?: string): Promise<{ priv: Uint8Array; pub: Uint8Array }> {
  const k = await getServerKey(serverId)
  if (!k.exists || !k.public || !k.recovery) throw new Error('NO_SERVER_KEY')
  const pub = c.b64uDecode(k.public)
  const { priv: mine, id } = account()
  if (code) {
    const norm = c.normalizeRecoveryCode(code)
    if (!norm) throw new Error('BAD_CODE')
    const priv = await c.unwrapKey(k.recovery, norm, c.serverRecoveryAad(serverId)).catch(() => { throw new Error('BAD_CODE') })
    if (!k.owner_wrapped) {
      await http.put(path`/servers/${serverId}/e2e/server-key/owner`, {
        owner_wrapped: await c.wrapServerKey(mine, pub, priv, serverId, id),
      }).catch(() => undefined)
    }
    return { priv, pub }
  }
  if (!k.owner_wrapped) throw new Error('NEED_CODE')
  try {
    return { priv: await c.unwrapServerKey(mine, pub, k.owner_wrapped, serverId, id), pub }
  } catch {
    throw new Error('NEED_CODE')
  }
}

/** Nouveau code de récupération du serveur (l'ancien cesse de fonctionner) ; rendu pour affichage unique. */
export async function regenerateServerRecovery(serverId: string, code?: string): Promise<string> {
  const { priv } = await openServerKey(serverId, code)
  const fresh = c.generateRecoveryCode()
  try {
    await http.put(path`/servers/${serverId}/e2e/server-key/recovery`, {
      recovery: await c.wrapKey(priv, fresh, c.serverRecoveryAad(serverId)),
    })
  } finally {
    priv.fill(0)
  }
  return fresh
}

/** Transfert de propriété : la clé du serveur ré-enveloppée pour le nouveau propriétaire (null si impossible). */
export async function serverKeyForNewOwner(serverId: string, newOwnerId: string): Promise<c.ConvWrapped | null> {
  try {
    const k = await getServerKey(serverId)
    if (!k.exists) return null
    const { priv } = await openServerKey(serverId)
    const data = await http.get<{ public: string }>(path`/users/${newOwnerId}/keys/public`)
    const w = await c.wrapServerKey(priv, c.b64uDecode(data.public), priv, serverId, newOwnerId)
    priv.fill(0)
    return w
  } catch {
    return null // sans clé de compte chez le nouveau propriétaire : il saisira le code
  }
}
