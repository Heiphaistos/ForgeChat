import { create } from 'zustand'
import type { UnreadItem } from '@/types/models'

/**
 * Compteurs de non-lus. Clé = id de salon / DM / groupe.
 * `activeConversation` : la conversation affichée à l'écran n'incrémente pas.
 * `mentions` : mentions non lues par salon (GET /unread puis MENTION_CREATE), pastille rouge comme Discord.
 */
interface UnreadState {
  counts: Record<string, number>
  mentions: Record<string, number>
  serverOf: Record<string, string>
  activeConversation: string | null
  load: (items: UnreadItem[]) => void
  increment: (conversationId: string, serverId?: string | null) => void
  addMention: (channelId: string) => void
  clear: (conversationId: string) => void
  setActive: (conversationId: string | null) => void
  reset: () => void
}

export const useUnread = create<UnreadState>((set, get) => ({
  counts: {},
  mentions: {},
  serverOf: {},
  activeConversation: null,
  load: (items) => {
    const counts: Record<string, number> = {}
    const mentions: Record<string, number> = {}
    const serverOf: Record<string, string> = {}
    for (const it of items) {
      if (it.count <= 0) continue
      counts[it.channel_id] = it.count
      if (it.server_id) serverOf[it.channel_id] = it.server_id
      if (it.server_id && (it.mention_count ?? 0) > 0) mentions[it.channel_id] = it.mention_count ?? 0
    }
    const active = get().activeConversation
    if (active) {
      delete counts[active]
      delete mentions[active]
    }
    set({ counts, mentions, serverOf })
  },
  increment: (id, serverId) => {
    if (get().activeConversation === id) return
    set((s) => ({
      counts: { ...s.counts, [id]: (s.counts[id] ?? 0) + 1 },
      serverOf: serverId ? { ...s.serverOf, [id]: serverId } : s.serverOf,
    }))
  },
  addMention: (id) => {
    if (get().activeConversation === id) return
    set((s) => ({ mentions: { ...s.mentions, [id]: (s.mentions[id] ?? 0) + 1 } }))
  },
  clear: (id) =>
    set((s) => {
      if (!s.counts[id] && !s.mentions[id]) return s
      const counts = { ...s.counts }
      const mentions = { ...s.mentions }
      delete counts[id]
      delete mentions[id]
      return { counts, mentions }
    }),
  setActive: (id) => {
    set({ activeConversation: id })
    if (id) get().clear(id)
  },
  reset: () => set({ counts: {}, mentions: {}, serverOf: {}, activeConversation: null }),
}))

export function serverUnread(counts: Record<string, number>, serverOf: Record<string, string>, serverId: string) {
  let total = 0
  for (const [cid, n] of Object.entries(counts)) if (serverOf[cid] === serverId) total += n
  return total
}

export function directUnread(counts: Record<string, number>, serverOf: Record<string, string>) {
  let total = 0
  for (const [cid, n] of Object.entries(counts)) if (!serverOf[cid]) total += n
  return total
}
