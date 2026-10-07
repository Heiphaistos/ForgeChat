// Clé de récupération d'un serveur (docs/CHIFFREMENT-E2E.md §11) : le
// propriétaire peut toujours relire tous les salons de son serveur (privés
// compris), la plateforme jamais. La clé privée du serveur n'existe en clair
// que dans la mémoire de l'appli du propriétaire, le temps d'une opération.
import api from '../api/client'
import { useAuth } from '../store/auth'
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

const me = () => useAuth.getState().user?.id ?? null

export const getServerKey = (serverId: string) =>
  api.get<ServerKeyResponse>(`/servers/${serverId}/e2e/server-key`).then(r => r.data)

function account() {
  const priv = useAccountKey.getState().priv
  const id = me()
  if (!priv || !id) throw new Error('E2E_LOCKED')
  return { priv, id }
}

/** Crée la clé du serveur (propriétaire) ; rend le code de récupération, à afficher UNE fois. */
export async function createServerKey(serverId: string): Promise<string> {
  const { priv, id } = account()
  const kp = await c.generateKeyPair()
  const code = c.generateRecoveryCode()
  try {
    await api.put(`/servers/${serverId}/e2e/server-key`, {
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
    // Nouveau propriétaire, ou nouvelle clé de compte : plus besoin du code ensuite.
    if (!k.owner_wrapped) {
      await api.put(`/servers/${serverId}/e2e/server-key/owner`, {
        owner_wrapped: await c.wrapServerKey(mine, pub, priv, serverId, id),
      }).catch(() => {})
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
    await api.put(`/servers/${serverId}/e2e/server-key/recovery`, {
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
    const { priv, pub } = await openServerKey(serverId)
    const { data } = await api.get<{ public: string }>(`/users/${newOwnerId}/keys/public`)
    const sk = await c.importPrivateKey(priv, pub)
    const w = await c.wrapServerKey(sk, c.b64uDecode(data.public), priv, serverId, newOwnerId)
    priv.fill(0)
    return w
  } catch {
    return null // sans clé de compte chez le nouveau propriétaire : il saisira le code
  }
}

interface RecoveryEnvelope { epoch: number; wrapped: c.ConvWrapped; wrapped_by: string | null; wrapped_by_pub: string }
interface RecoveryChannel { channel_id: string; name: string; type: string; epochs: RecoveryEnvelope[] }
interface RawChannelMessage {
  id: string; content: string | null; enc?: c.EncPayload | null; client_msg_id?: string | null
  author_id: string; author_username: string; created_at: string
}
export interface RecoveredMessage { id: string; author: string; created_at: string; text: string | null; encrypted: boolean }
export interface RecoveredChannel { channel_id: string; name: string; messages: RecoveredMessage[] }

/**
 * « Récupérer le contenu du serveur » : ouvre toutes les époques de tous les
 * salons avec la clé du serveur, puis déchiffre leurs messages SUR L'APPAREIL.
 * Rien n'est renvoyé en clair à la plateforme.
 */
export async function recoverServer(
  serverId: string, code?: string, onProgress?: (done: number, total: number) => void,
): Promise<RecoveredChannel[]> {
  const { priv, pub } = await openServerKey(serverId, code)
  const sk = await c.importPrivateKey(priv, pub)
  priv.fill(0)
  const { data } = await api.get<{ channels: RecoveryChannel[] }>(`/servers/${serverId}/e2e/recovery`)
  const out: RecoveredChannel[] = []
  for (const [i, ch] of data.channels.entries()) {
    onProgress?.(i, data.channels.length)
    const conv = c.convName('channel', ch.channel_id)
    const keys = new Map<number, Uint8Array>()
    for (const e of ch.epochs) {
      if (!e.wrapped_by) continue
      try {
        keys.set(e.epoch, await c.unwrapConvKey(sk, c.b64uDecode(e.wrapped_by_pub), e.wrapped, conv, e.epoch, c.serverMember(serverId), e.wrapped_by))
      } catch { /* enveloppe altérée : les messages de cette époque restent illisibles */ }
    }
    const messages: RecoveredMessage[] = []
    for (let before: string | undefined; ;) {
      const { data: page } = await api.get<RawChannelMessage[]>(`/servers/${serverId}/channels/${ch.channel_id}/messages`, {
        params: { limit: 100, ...(before ? { before } : {}) },
      })
      for (const m of [...page].reverse()) {
        let text = m.content
        if (m.enc && m.client_msg_id) {
          const key = keys.get(m.enc.epoch)
          text = key ? await c.decryptMessage(key, conv, m.enc, m.author_id, m.client_msg_id).then(b => b.t).catch(() => null) : null
        }
        messages.push({ id: m.id, author: m.author_username, created_at: m.created_at, text, encrypted: !!m.enc })
      }
      if (page.length < 100) break
      before = page[0].id
    }
    out.push({ channel_id: ch.channel_id, name: ch.name, messages: messages.reverse() })
  }
  onProgress?.(data.channels.length, data.channels.length)
  return out
}
