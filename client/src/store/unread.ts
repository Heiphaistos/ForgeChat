import { create } from 'zustand'
import api from '../api/client'

interface UnreadState {
  counts: Record<string, number>
  serverCounts: Record<string, number>
  increment: (channelId: string, serverId?: string) => void
  reset: (channelId: string, serverId?: string) => void
  resetServer: (serverId: string) => void
  fetchAll: () => Promise<void>
  markRead: (channelId: string, serverId?: string) => Promise<void>
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

  // Subtracts this channel's count from serverCounts instead of zeroing the server
  reset: (channelId, serverId) =>
    set(s => {
      const channelCount = s.counts[channelId] ?? 0
      const counts = { ...s.counts }
      delete counts[channelId]
      if (!serverId || !channelCount) return { counts }
      const prev = s.serverCounts[serverId] ?? 0
      const next = Math.max(0, prev - channelCount)
      const serverCounts = { ...s.serverCounts }
      if (next === 0) delete serverCounts[serverId]
      else serverCounts[serverId] = next
      return { counts, serverCounts }
    }),

  resetServer: (serverId) =>
    set(s => { const c = { ...s.serverCounts }; delete c[serverId]; return { serverCounts: c } }),

  fetchAll: async () => {
    try {
      const { data } = await api.get('/unread')
      const counts: Record<string, number> = {}
      const serverCounts: Record<string, number> = {}
      for (const item of data) {
        counts[item.channel_id] = item.count
        if (item.server_id) {
          serverCounts[item.server_id] = (serverCounts[item.server_id] ?? 0) + item.count
        }
      }
      set({ counts, serverCounts })
    } catch {}
  },

  markRead: async (channelId, serverId) => {
    get().reset(channelId, serverId)
    try { await api.post(`/channels/${channelId}/read`) } catch {}
  },
}))
