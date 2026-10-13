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
  /** « Marquer comme non lu » (réponse de POST …/unread ou READ_STATE_UPDATE {unread:true}) :
   *  compteurs posés tels quels, même pour la conversation ouverte. Mentions : salons seulement. */
  setUnread: (conversationId: string, count: number, mentionCount: number, serverId?: string | null) => void
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
  setUnread: (id, count, mentionCount, serverId) =>
    set((s) => {
      const counts = { ...s.counts }
      const mentions = { ...s.mentions }
      const sid = serverId ?? s.serverOf[id]
      if (count > 0) counts[id] = count
      else delete counts[id]
      if (sid && mentionCount > 0) mentions[id] = mentionCount
      else delete mentions[id]
      return { counts, mentions, serverOf: sid ? { ...s.serverOf, [id]: sid } : s.serverOf }
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
