import { create } from 'zustand'
import { isUuid } from '@/lib/params'
import type { ConversationRef } from '@/types/models'

/** Un message épinglé, quel que soit le type de conversation. */
export interface PinnedItem {
  messageId: string
  content: string | null
  authorName: string
  authorAvatar: string | null
  createdAt: string
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * Les 3 routes d'épinglés renvoient 3 formats différents :
 * - salon  (channels::get_pinned)       : { id, content, created_at, author_username, author_avatar }
 * - DM     (dm_extras::get_dm_pins)     : { id (du pin), message_id, message: { content, sender_name, sender_avatar, created_at } }
 * - groupe (group_dms::list_group_dm_pins) : { id, content, created_at, sender_username }
 * Toute entrée sans identifiant de message valide est ignorée.
 */
export function normalizePins(kind: ConversationRef['kind'], raw: unknown): PinnedItem[] {
  if (!Array.isArray(raw)) return []
  const out: PinnedItem[] = []
  for (const r of raw.map(obj)) {
    const m = kind === 'dm' ? obj(r.message) : r
    const messageId = str(kind === 'dm' ? r.message_id : r.id)
    const createdAt = str(m.created_at)
    if (!isUuid(messageId) || !createdAt) continue
    out.push({
      messageId: messageId.toLowerCase(),
      content: str(m.content),
      authorName: str(kind === 'channel' ? m.author_username : kind === 'dm' ? m.sender_name : m.sender_username) ?? 'Inconnu',
      authorAvatar: str(kind === 'channel' ? m.author_avatar : kind === 'dm' ? m.sender_avatar : null),
      createdAt,
    })
  }
  return out
}

/** Message vers lequel la conversation doit défiler (posé par l'écran des épinglés). */
interface ScrollTargetState {
  target: { conversationId: string; messageId: string } | null
  highlightId: string | null
  request: (conversationId: string, messageId: string) => void
  done: (highlightId: string | null) => void
}

export const useScrollTarget = create<ScrollTargetState>((set) => ({
  target: null,
  highlightId: null,
  request: (conversationId, messageId) => set({ target: { conversationId, messageId }, highlightId: null }),
  done: (highlightId) => set({ target: null, highlightId }),
}))

/**
 * Conversation désignée par les paramètres de l'écran des épinglés. Route atteignable par
 * lien profond : on n'accepte qu'un type connu avec des identifiants UUID, sinon null.
 */
export function conversationRefFromParams(p: Record<string, string | undefined>): ConversationRef | null {
  switch (p.kind) {
    case 'channel':
      return isUuid(p.serverId) && isUuid(p.channelId)
        ? { kind: 'channel', serverId: p.serverId.toLowerCase(), channelId: p.channelId.toLowerCase() }
        : null
    case 'dm':
      return isUuid(p.dmId) ? { kind: 'dm', dmId: p.dmId.toLowerCase() } : null
    case 'group':
      return isUuid(p.groupId) ? { kind: 'group', groupId: p.groupId.toLowerCase() } : null
    default:
      return null
  }
}

/** Paramètres de route à passer à l'écran des épinglés pour une conversation. */
export function pinsParams(ref: ConversationRef): Record<string, string> {
  switch (ref.kind) {
    case 'channel':
      return { kind: 'channel', serverId: ref.serverId, channelId: ref.channelId }
    case 'dm':
      return { kind: 'dm', dmId: ref.dmId }
    case 'group':
      return { kind: 'group', groupId: ref.groupId }
  }
}
