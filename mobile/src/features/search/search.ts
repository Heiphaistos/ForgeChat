import { isUuid } from '@/lib/params'

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
  channelId: string
  channelName: string
  serverId: string
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

/** Lecture défensive de GET /search : toute entrée sans identifiants valides est ignorée (on navigue avec). */
export function normalizeSearch(raw: unknown): SearchResults {
  const r = obj(raw)
  const messages: SearchMessage[] = []
  for (const m of list(r.messages)) {
    const [id, channelId, serverId, createdAt] = [str(m.id), str(m.channel_id), str(m.server_id), str(m.created_at)]
    if (!isUuid(id) || !isUuid(channelId) || !isUuid(serverId) || !createdAt) continue
    messages.push({
      id: id.toLowerCase(),
      content: str(m.content),
      createdAt,
      authorName: str(m.author_username) ?? 'Inconnu',
      authorAvatar: str(m.author_avatar),
      channelId: channelId.toLowerCase(),
      channelName: str(m.channel_name) ?? 'salon',
      serverId: serverId.toLowerCase(),
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
