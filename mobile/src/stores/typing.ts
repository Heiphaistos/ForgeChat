import { create } from 'zustand'

/** Indicateurs de saisie : conversationId → userId → { name, expiresAt } */
interface TypingState {
  byConversation: Record<string, Record<string, { name: string; until: number }>>
  add: (conversationId: string, userId: string, name: string) => void
  remove: (conversationId: string, userId: string) => void
  prune: () => void
  reset: () => void
}

const TTL = 6000

export const useTyping = create<TypingState>((set, get) => ({
  byConversation: {},
  add: (cid, uid, name) =>
    set((s) => ({
      byConversation: { ...s.byConversation, [cid]: { ...s.byConversation[cid], [uid]: { name, until: Date.now() + TTL } } },
    })),
  remove: (cid, uid) =>
    set((s) => {
      const conv = { ...s.byConversation[cid] }
      delete conv[uid]
      return { byConversation: { ...s.byConversation, [cid]: conv } }
    }),
  prune: () => {
    const now = Date.now()
    const cur = get().byConversation
    let changed = false
    const next: TypingState['byConversation'] = {}
    for (const [cid, users] of Object.entries(cur)) {
      const kept: Record<string, { name: string; until: number }> = {}
      for (const [uid, v] of Object.entries(users)) {
        if (v.until > now) kept[uid] = v
        else changed = true
      }
      next[cid] = kept
    }
    if (changed) set({ byConversation: next })
  },
  reset: () => set({ byConversation: {} }),
}))
