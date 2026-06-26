import { create } from 'zustand'
import api from '../api/client'

interface UnreadState {
  counts: Record<string, number>
  serverCounts: Record<string, number>
  increment: (channelId: string, serverId?: string) => void
  reset: (channelId: string) => void
  resetServer: (serverId: string) => void
  fetchAll: () => Promise<void>
  markRead: (channelId: string) => Promise<void>
}

export const useUnread = create<UnreadState>((set, get) => ({
  counts: {},
  serverCounts: {},

  increment: (channelId, serverId) =>
    set(s => ({
      counts: { ...s.counts, [channelId]: (s.counts[channelId] ?? 0) + 1 },
      serverCounts: serverId
        ? { ...s.serverCounts, [serverId]: (s.serverCounts[serverId] ?? 0) + 1 }
        : s.serverCounts,
    })),

  reset: (channelId) =>
    set(s => { const c = { ...s.counts }; delete c[channelId]; return { counts: c } }),

  resetServer: (serverId) =>
    set(s => { const c = { ...s.serverCounts }; delete c[serverId]; return { serverCounts: c } }),

  fetchAll: async () => {
    try {
      const { data } = await api.get('/unread')
      const counts: Record<string, number> = {}
      for (const item of data) counts[item.channel_id] = item.count
      set({ counts })
    } catch {}
  },

  markRead: async (channelId) => {
    get().reset(channelId)
    try { await api.post(`/channels/${channelId}/read`) } catch {}
  },
}))
