// Clé de récupération d'un serveur côté mobile (docs/CHIFFREMENT-E2E.md §11).
// Même logique que client/src/e2e/serverKey.ts : le propriétaire peut toujours
// relire tous les salons de son serveur, la plateforme jamais. La clé privée du
// serveur n'existe en clair qu'en mémoire, le temps d'une opération.
import { http, path } from '@/lib/http'
import { useAccountKey } from './accountKey'
import * as c from './crypto'
import { forgetConv } from './conversations'
import { pinOwnServerKey } from './keyPins'

export interface ServerKeyResponse {
  exists: boolean
  public?: string
  fingerprint?: string
  /** Propriétaire seulement : clé privée chiffrée par le code de récupération du serveur. */
  recovery?: c.WrappedKey
  /** Propriétaire seulement : la même pour sa clé de compte (null après un transfert sans ré-enveloppe). */
  owner_wrapped?: c.ConvWrapped | null
  /** Signature de la clé par le compte `signed_by` (son propriétaire), vérifiée par les membres. */
  signature?: string | null
  signed_by?: string | null
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
    const pub = c.b64uEncode(kp.pub)
    await http.put(path`/servers/${serverId}/e2e/server-key`, {
      public: pub,
      // Signée par ma clé de compte : les membres qui me connaissent l'acceptent sans question.
      signature: await c.signServerKey(priv, serverId, id, pub),
      recovery: await c.wrapKey(kp.priv, code, c.serverRecoveryAad(serverId)),
      owner_wrapped: await c.wrapServerKey(priv, kp.pub, kp.priv, serverId, id),
    })
  } finally {
    kp.priv.fill(0)
  }
  // Ma propre clé de serveur : épinglée d'office (pas d'alerte « clé changée » chez moi).
  await pinOwnServerKey(serverId, c.b64uEncode(kp.pub))
  // Les prochaines époques devront l'inclure : états des salons rechargés.
  forgetConv()
  return code
}

/**
 * Propriétaire : signe la clé existante si elle ne l'est pas par moi (clé créée avant les
 * signatures, ou serveur reçu par transfert). Sans effet pour un autre membre.
 */
export async function ensureServerKeySigned(serverId: string, k?: ServerKeyResponse): Promise<void> {
  const { priv, userId } = useAccountKey.getState()
  if (!priv || !userId) return
  const key = k ?? (await getServerKey(serverId))
  // `recovery` n'est rendu qu'au propriétaire.
  if (!key.exists || !key.public || !key.recovery || key.signed_by === userId) return
  await http.put(path`/servers/${serverId}/e2e/server-key/signature`, {
    signature: await c.signServerKey(priv, serverId, userId, key.public),
  })
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

interface RecoveryEnvelope { epoch: number; wrapped: c.ConvWrapped; wrapped_by: string | null; wrapped_by_pub: string }
interface RecoveryChannel { channel_id: string; name: string; type: string; epochs: RecoveryEnvelope[] }
interface RawChannelMessage {
  id: string; content: string | null; enc?: c.EncPayload | null; client_msg_id?: string | null
  author_id: string; author_username: string; created_at: string
  attachments?: { url: string; filename: string }[]
}
/** Fichier chiffré d'un message récupéré : adresse du blob et sa clé (`entry`, §12). */
export interface RecoveredFile { url: string; name: string; type: string; size: number; entry: c.FileEntry }
export interface RecoveredMessage {
  id: string; author: string; created_at: string; text: string | null; encrypted: boolean
  files?: RecoveredFile[]
}
export interface RecoveredChannel { channel_id: string; name: string; messages: RecoveredMessage[] }

const PAGE = 100
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * « Récupérer le contenu du serveur » : ouvre toutes les époques de tous les salons
 * avec la clé du serveur, puis déchiffre leurs messages SUR L'APPAREIL (même logique
 * que le web). Rien n'est renvoyé en clair à la plateforme.
 */
export async function recoverServer(
  serverId: string, code?: string, onProgress?: (done: number, total: number) => void,
): Promise<RecoveredChannel[]> {
  const { priv } = await openServerKey(serverId, code)
  try {
    const data = await http.get<{ channels: RecoveryChannel[] }>(path`/servers/${serverId}/e2e/recovery`)
    const out: RecoveredChannel[] = []
    for (const [i, ch] of data.channels.entries()) {
      onProgress?.(i, data.channels.length)
      const conv = c.convName('channel', ch.channel_id)
      const keys = new Map<number, Uint8Array>()
      for (const e of ch.epochs) {
        if (!e.wrapped_by) continue
        try {
          keys.set(e.epoch, await c.unwrapConvKey(priv, c.b64uDecode(e.wrapped_by_pub), e.wrapped, conv, e.epoch, c.serverMember(serverId), e.wrapped_by))
        } catch { /* enveloppe altérée : les messages de cette époque restent illisibles */ }
        await yieldUi()
      }
      const messages: RecoveredMessage[] = []
      for (let before: string | undefined; ;) {
        const page = await http.get<RawChannelMessage[]>(path`/servers/${serverId}/channels/${ch.channel_id}/messages`, {
          query: { limit: PAGE, before },
        })
        for (const m of [...page].reverse()) {
          let text = m.content
          let files: RecoveredFile[] = []
          if (m.enc && m.client_msg_id) {
            const key = keys.get(m.enc.epoch)
            const body = key ? await c.decryptMessage(key, conv, m.enc, m.author_id, m.client_msg_id).catch(() => null) : null
            text = body?.t ?? null
            // Clés des fichiers dans le message : l'export permet de les déchiffrer plus tard.
            const entries = new Map(c.fileEntries(body).map((e) => [c.blobName(e.id), e]))
            files = (m.attachments ?? []).flatMap((a) => {
              const e = entries.get(a.filename)
              return e ? [{ url: a.url, name: e.n, type: e.m, size: e.s, entry: e }] : []
            })
          }
          messages.push({ id: m.id, author: m.author_username, created_at: m.created_at, text, encrypted: !!m.enc, ...(files.length ? { files } : {}) })
        }
        await yieldUi()
        if (page.length < PAGE || !page[0]) break
        before = page[0].id
      }
      out.push({ channel_id: ch.channel_id, name: ch.name, messages: messages.reverse() })
    }
    onProgress?.(data.channels.length, data.channels.length)
    return out
  } finally {
    priv.fill(0)
  }
}

/** Export texte lisible : un bloc par salon, une ligne par message (illisible : `unreadable`). */
export function recoveredAsText(channels: readonly RecoveredChannel[], unreadable: string): string {
  return channels
    .map((ch) => [`# ${ch.name}`, ...ch.messages.map((m) =>
      `[${m.created_at}] ${m.author}: ${m.text ?? unreadable}` + (m.files ?? []).map((f) => `\n  📎 ${f.name} (${f.size} o)`).join(''))].join('\n'))
    .join('\n\n')
}
