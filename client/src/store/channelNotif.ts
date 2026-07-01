import { create } from 'zustand'
import api from '../api/client'

interface ChannelNotifState {
  mutedChannels: Set<string>
  loaded: boolean
  fetch: () => Promise<void>
  setMuted: (channelId: string, muted: boolean) => void
  isMuted: (channelId: string) => boolean
}

export const useChannelNotif = create<ChannelNotifState>((set, get) => ({
  mutedChannels: new Set(),
  loaded: false,

  fetch: async () => {
    try {
      const { data } = await api.get('/user/channel-notif')
      const muted = new Set<string>(
        (data as { channel_id: string; muted: boolean }[])
          .filter(r => r.muted)
          .map(r => r.channel_id)
      )
      set({ mutedChannels: muted, loaded: true })
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
}))
