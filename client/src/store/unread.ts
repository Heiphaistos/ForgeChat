import { create } from 'zustand'
import api from '../api/client'

// Non-lus (point blanc) et mentions (pastille rouge chiffrée) séparés, comme
// Discord. Un message privé non lu compte comme une mention.
interface UnreadState {
  counts: Record<string, number>
  serverCounts: Record<string, number>
  mentionCounts: Record<string, number>
  serverMentionCounts: Record<string, number>
  /** channel_id → server_id, pour effacer tout un serveur (READ_STATE_UPDATE). */
  channelServer: Record<string, string>
  increment: (channelId: string, serverId?: string) => void
  addMention: (channelId: string, serverId?: string) => void
  reset: (channelId: string, serverId?: string) => void
  resetServer: (serverId: string) => void
  fetchAll: () => Promise<void>
  markRead: (channelId: string, serverId?: string, messageId?: string) => Promise<void>
  /** Lecture continue : efface tout de suite, prévient le serveur avec anti-rebond. */
  markReadSoon: (readUrl: string, channelId: string, serverId?: string, messageId?: string) => void
  markAllRead: () => void
  clearAll: () => void
}

const bump = (m: Record<string, number>, k: string) => ({ ...m, [k]: (m[k] ?? 0) + 1 })
const subtract = (m: Record<string, number>, k: string, n: number) => {
  if (!n) return m
  const next = { ...m }
  const v = Math.max(0, (next[k] ?? 0) - n)
  if (v === 0) delete next[k]
  else next[k] = v
  return next
}

const READ_DEBOUNCE_MS = 1500
const pendingReads = new Map<string, ReturnType<typeof setTimeout>>()

export const useUnread = create<UnreadState>((set, get) => ({
  counts: {},
  serverCounts: {},
  mentionCounts: {},
  serverMentionCounts: {},
  channelServer: {},

  increment: (channelId, serverId) =>
    set(s => ({
      counts: bump(s.counts, channelId),
      serverCounts: serverId ? bump(s.serverCounts, serverId) : s.serverCounts,
      // DM / groupe : chaque message est une mention. Salon : MENTION_CREATE s'en charge.
      mentionCounts: serverId ? s.mentionCounts : bump(s.mentionCounts, channelId),
      channelServer: serverId ? { ...s.channelServer, [channelId]: serverId } : s.channelServer,
    })),

  addMention: (channelId, serverId) =>
    set(s => ({
      mentionCounts: bump(s.mentionCounts, channelId),
      serverMentionCounts: serverId ? bump(s.serverMentionCounts, serverId) : s.serverMentionCounts,
      channelServer: serverId ? { ...s.channelServer, [channelId]: serverId } : s.channelServer,
    })),

  reset: (channelId, serverId) =>
    set(s => {
      const sid = serverId ?? s.channelServer[channelId]
      const counts = { ...s.counts }
      const mentionCounts = { ...s.mentionCounts }
      delete counts[channelId]
      delete mentionCounts[channelId]
      return {
        counts,
        mentionCounts,
        serverCounts: sid ? subtract(s.serverCounts, sid, s.counts[channelId] ?? 0) : s.serverCounts,
        serverMentionCounts: sid ? subtract(s.serverMentionCounts, sid, s.mentionCounts[channelId] ?? 0) : s.serverMentionCounts,
      }
    }),

  resetServer: (serverId) =>
    set(s => {
      const counts = { ...s.counts }
      const mentionCounts = { ...s.mentionCounts }
      for (const [ch, sid] of Object.entries(s.channelServer)) {
        if (sid === serverId) { delete counts[ch]; delete mentionCounts[ch] }
      }
      const serverCounts = { ...s.serverCounts }
      const serverMentionCounts = { ...s.serverMentionCounts }
      delete serverCounts[serverId]
      delete serverMentionCounts[serverId]
      return { counts, mentionCounts, serverCounts, serverMentionCounts }
    }),

  fetchAll: async () => {
    try {
      const { data } = await api.get('/unread')
      const counts: Record<string, number> = {}
      const serverCounts: Record<string, number> = {}
      const mentionCounts: Record<string, number> = {}
      const serverMentionCounts: Record<string, number> = {}
      const channelServer: Record<string, string> = {}
      for (const item of data) {
        const mentions = item.mention_count ?? 0
        counts[item.channel_id] = item.count
        if (mentions > 0) mentionCounts[item.channel_id] = mentions
        if (item.server_id) {
          channelServer[item.channel_id] = item.server_id
          serverCounts[item.server_id] = (serverCounts[item.server_id] ?? 0) + item.count
          if (mentions > 0) serverMentionCounts[item.server_id] = (serverMentionCounts[item.server_id] ?? 0) + mentions
        }
      }
      set({ counts, serverCounts, mentionCounts, serverMentionCounts, channelServer })
    } catch {}
  },

  markRead: async (channelId, serverId, messageId) => {
    get().reset(channelId, serverId)
    try { await api.post(`/channels/${channelId}/read`, messageId ? { message_id: messageId } : undefined) } catch {}
  },

  markReadSoon: (readUrl, channelId, serverId, messageId) => {
    get().reset(channelId, serverId)
    clearTimeout(pendingReads.get(readUrl))
    const timer = setTimeout(() => {
      pendingReads.delete(readUrl)
      api.post(readUrl, messageId ? { message_id: messageId } : undefined).catch(() => {})
    }, READ_DEBOUNCE_MS)
    pendingReads.set(readUrl, timer)
  },

  markAllRead: () => {
    get().clearAll()
    api.post('/unread/mark-all').catch(() => {})
  },

  clearAll: () => set({ counts: {}, serverCounts: {}, mentionCounts: {}, serverMentionCounts: {} }),
}))
