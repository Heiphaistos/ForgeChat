import { create } from 'zustand'
import api from '../api/client'

interface ChannelNotifState {
  mutedChannels: Set<string>
  mutedServers: Set<string>
  loaded: boolean
  fetch: () => Promise<void>
  setMuted: (channelId: string, muted: boolean) => void
  isMuted: (channelId: string) => boolean
  setServerMuted: (serverId: string, muted: boolean) => void
  isServerMuted: (serverId: string) => boolean
}

export const useChannelNotif = create<ChannelNotifState>((set, get) => ({
  mutedChannels: new Set(),
  mutedServers: new Set(),
  loaded: false,

  fetch: async () => {
    try {
      const [channelRes, serverRes] = await Promise.all([
        api.get('/user/channel-notif'),
        api.get('/user/notification-overrides'),
      ])
      const mutedChannels = new Set<string>(
        (channelRes.data as { channel_id: string; muted: boolean }[])
          .filter(r => r.muted)
          .map(r => r.channel_id)
      )
      const mutedServers = new Set<string>(
        (serverRes.data as { server_id: string; muted: boolean }[])
          .filter(r => r.muted)
          .map(r => r.server_id)
      )
      set({ mutedChannels, mutedServers, loaded: true })
    } catch {}
  },

  setMuted: (channelId, muted) =>
    set(s => {
      const next = new Set(s.mutedChannels)
      if (muted) next.add(channelId)
      else next.delete(channelId)
      return { mutedChannels: next }
    }),

  isMuted: (channelId) => get().mutedChannels.has(channelId),

  setServerMuted: (serverId, muted) =>
    set(s => {
      const next = new Set(s.mutedServers)
      if (muted) next.add(serverId)
      else next.delete(serverId)
      return { mutedServers: next }
    }),

  isServerMuted: (serverId) => get().mutedServers.has(serverId),
}))
