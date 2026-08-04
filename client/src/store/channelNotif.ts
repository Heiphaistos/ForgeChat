import { create } from 'zustand'
import api from '../api/client'

type NotifLevel = 'inherit' | 'all' | 'mentions' | 'nothing'

interface ChannelNotifState {
  mutedChannels: Set<string>
  mutedServers: Set<string>
  // ChannelNotifModal.tsx sauvegarde ce niveau par canal (PATCH /user/channel-notif/:id)
  // mais jusqu'ici rien ne le relisait -- App.tsx ne se basait que sur mutedChannels,
  // donc "Tous les messages" n'avait jamais d'effet réel (comportement toujours
  // figé sur "mentions seulement", même quand l'utilisateur choisissait "all").
  channelLevels: Map<string, NotifLevel>
  loaded: boolean
  fetch: () => Promise<void>
  setMuted: (channelId: string, muted: boolean) => void
  isMuted: (channelId: string) => boolean
  setServerMuted: (serverId: string, muted: boolean) => void
  isServerMuted: (serverId: string) => boolean
  setLevel: (channelId: string, level: NotifLevel) => void
  getLevel: (channelId: string) => NotifLevel
}

export const useChannelNotif = create<ChannelNotifState>((set, get) => ({
  mutedChannels: new Set(),
  mutedServers: new Set(),
  channelLevels: new Map(),
  loaded: false,

  fetch: async () => {
    try {
      const [channelRes, serverRes] = await Promise.all([
        api.get('/user/channel-notif'),
        api.get('/user/notification-overrides'),
      ])
      const rows = channelRes.data as { channel_id: string; muted: boolean; level?: NotifLevel }[]
      const mutedChannels = new Set<string>(rows.filter(r => r.muted).map(r => r.channel_id))
      const channelLevels = new Map<string, NotifLevel>(
        rows.filter(r => r.level && r.level !== 'inherit').map(r => [r.channel_id, r.level as NotifLevel])
      )
      const mutedServers = new Set<string>(
        (serverRes.data as { server_id: string; muted: boolean }[])
          .filter(r => r.muted)
          .map(r => r.server_id)
      )
      set({ mutedChannels, mutedServers, channelLevels, loaded: true })
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

  setLevel: (channelId, level) =>
    set(s => {
      const next = new Map(s.channelLevels)
      if (level === 'inherit') next.delete(channelId)
      else next.set(channelId, level)
      return { channelLevels: next }
    }),

  getLevel: (channelId) => get().channelLevels.get(channelId) ?? 'inherit',
}))
