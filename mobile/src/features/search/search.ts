import { isUuid } from '@/lib/params'
import type { IndexedMsg } from './localQuery'
import type { ChatMessage, ConversationRef } from '@/types/models'

/** Bornes de handlers/search.rs (min 2 caractères) ; au-delà de 100, inutile d'interroger le serveur. */
export const SEARCH_MIN = 2
export const SEARCH_MAX = 100
export const SEARCH_DEBOUNCE_MS = 350

export interface SearchMessage {
  id: string
  content: string | null
  createdAt: string
  authorName: string
  authorAvatar: string | null
  channelName: string
  /** Salon, DM ou groupe du message (champ `kind` de search.rs). */
  conversation: ConversationRef
}
export interface SearchUser {
  id: string
  username: string
  avatar: string | null
  status: string
}
export interface SearchChannel {
  id: string
  name: string
  type: string
  serverId: string
  serverName: string
}
export interface SearchResults {
  messages: SearchMessage[]
  users: SearchUser[]
  channels: SearchChannel[]
}

/** Texte envoyé au serveur, ou null si la saisie ne justifie pas de requête. */
export function searchQuery(input: string): string | null {
  const q = input.trim()
  return q.length >= SEARCH_MIN && q.length <= SEARCH_MAX ? q : null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : [])

/** Paramètres de portée de GET /search (search.rs::global_search) : une seule conversation. */
export function searchScope(ref: ConversationRef | null): Record<string, string> {
  if (!ref) return {}
  switch (ref.kind) {
    case 'channel':
      return { channel_id: ref.channelId }
    case 'dm':
      return { dm_id: ref.dmId }
    case 'group':
      return { group_id: ref.groupId }
  }
}

function messageConversation(kind: unknown, channelId: string, serverId: string | null): ConversationRef | null {
  if (kind === 'dm') return { kind: 'dm', dmId: channelId }
  if (kind === 'group') return { kind: 'group', groupId: channelId }
  return isUuid(serverId) ? { kind: 'channel', serverId: serverId.toLowerCase(), channelId } : null
}

/** Lecture défensive de GET /search : toute entrée sans identifiants valides est ignorée (on navigue avec). */
export function normalizeSearch(raw: unknown): SearchResults {
  const r = obj(raw)
  const messages: SearchMessage[] = []
  for (const m of list(r.messages)) {
    const [id, channelId, createdAt] = [str(m.id), str(m.channel_id), str(m.created_at)]
    if (!isUuid(id) || !isUuid(channelId) || !createdAt) continue
    const conversation = messageConversation(m.kind, channelId.toLowerCase(), str(m.server_id))
    if (!conversation) continue
    messages.push({
      id: id.toLowerCase(),
      content: str(m.content),
      createdAt,
      authorName: str(m.author_username) ?? 'Inconnu',
      authorAvatar: str(m.author_avatar),
      channelName: str(m.channel_name) ?? 'salon',
      conversation,
    })
  }
  const users: SearchUser[] = []
  for (const u of list(r.users)) {
    const id = str(u.id)
    const username = str(u.username)
    if (!isUuid(id) || !username) continue
    users.push({ id: id.toLowerCase(), username, avatar: str(u.avatar), status: str(u.status) ?? 'offline' })
  }
  const channels: SearchChannel[] = []
  for (const c of list(r.channels)) {
    const [id, serverId, name] = [str(c.id), str(c.server_id), str(c.name)]
    if (!isUuid(id) || !isUuid(serverId) || !name) continue
    channels.push({ id: id.toLowerCase(), name, type: str(c.type) ?? 'text', serverId: serverId.toLowerCase(), serverName: str(c.server_name) ?? '' })
  }
  return { messages, users, channels }
}

/**
 * MP et groupes chiffrés : le serveur ne peut pas chercher dans le texte. On complète ses
 * résultats (anciens messages en clair) par les messages déjà déchiffrés sur l'appareil.
 */
export function withLocalResults(server: SearchMessage[], cached: readonly ChatMessage[], q: string, scope: ConversationRef, channelName: string): SearchMessage[] {
  const needle = q.trim().toLowerCase()
  const known = new Set(server.map((m) => m.id))
  const local = cached
    .filter((m) => m.e2e === 'ok' && !known.has(m.id) && (m.content ?? '').toLowerCase().includes(needle))
    .map((m): SearchMessage => ({
      id: m.id, content: m.content, createdAt: m.createdAt, authorName: m.authorName, authorAvatar: m.authorAvatar, channelName, conversation: scope,
    }))
  return [...server, ...local].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Message de l'index local (déchiffré sur l'appareil) au format des résultats ; null si sa conversation est inconnue. */
export function fromIndexed(m: IndexedMsg): SearchMessage | null {
  const conversation: ConversationRef | null =
    m.kind === 'dm' ? { kind: 'dm', dmId: m.convId }
      : m.kind === 'group' ? { kind: 'group', groupId: m.convId }
        : m.serverId ? { kind: 'channel', serverId: m.serverId, channelId: m.convId } : null
  if (!conversation) return null
  return { id: m.id, content: m.text, createdAt: m.createdAt, authorName: m.authorName, authorAvatar: null, channelName: m.convName ?? '', conversation }
}

/**
 * Résultats du serveur complétés par l'index local : texte déchiffré des messages chiffrés
 * trouvés par métadonnées, et messages que seul l'index connaît. Du plus récent au plus ancien.
 */
export function mergeIndexed(server: SearchMessage[], indexed: SearchMessage[]): SearchMessage[] {
  const byId = new Map(indexed.map((m) => [m.id, m]))
  const merged = server.map((m) => (m.content == null && byId.has(m.id) ? { ...m, content: byId.get(m.id)!.content } : m))
  const known = new Set(merged.map((m) => m.id))
  return [...merged, ...indexed.filter((m) => !known.has(m.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
