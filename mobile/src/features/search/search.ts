import { isUuid } from '@/lib/params'
import type { ConversationRef } from '@/types/models'

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
