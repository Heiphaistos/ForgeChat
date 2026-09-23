import { create } from 'zustand'
import api from '../api/client'
import { queryClient } from '../main'

export type NotifLevel = 'inherit' | 'all' | 'mentions' | 'nothing'
type Effective = Exclude<NotifLevel, 'inherit'>

/** Échéance d'une sourdine en ms epoch ; `null` = jusqu'à réactivation. */
type MuteUntil = number | null

interface OverrideRow {
  level?: NotifLevel
  muted: boolean
  muted_until?: string | null
}

// Réglages lus par App.tsx pour décider des alertes en direct. Le serveur
// applique la même règle pour les mentions et le Web Push (notify.rs) :
// niveau du salon > niveau du serveur > défaut du serveur ; sourdine
// éventuellement temporaire (muted_until).
interface ChannelNotifState {
  mutedChannels: Map<string, MuteUntil>
  mutedServers: Map<string, MuteUntil>
  channelLevels: Map<string, NotifLevel>
  serverLevels: Map<string, NotifLevel>
  suppressEveryone: Set<string>
  loaded: boolean
  fetch: () => Promise<void>
  setMuted: (channelId: string, muted: boolean, until?: MuteUntil) => void
  isMuted: (channelId: string) => boolean
  setServerMuted: (serverId: string, muted: boolean, until?: MuteUntil) => void
  isServerMuted: (serverId: string) => boolean
  setLevel: (channelId: string, level: NotifLevel) => void
  getLevel: (channelId: string) => NotifLevel
  setServerPrefs: (serverId: string, level: NotifLevel, suppressEveryone: boolean) => void
  /** Niveau effectif d'un salon, défaut du serveur compris. */
  effectiveLevel: (channelId: string, serverId?: string) => Effective
}

const untilOf = (r: OverrideRow): MuteUntil => (r.muted_until ? new Date(r.muted_until).getTime() : null)
const active = (m: Map<string, MuteUntil>, id: string) => {
  if (!m.has(id)) return false
  const until = m.get(id)
  return until == null || until > Date.now()
}
const withMute = (m: Map<string, MuteUntil>, id: string, muted: boolean, until: MuteUntil = null) => {
  const next = new Map(m)
  if (muted) next.set(id, until)
  else next.delete(id)
  return next
}

export const EMPTY_NOTIF_STATE = {
  mutedChannels: new Map<string, MuteUntil>(),
  mutedServers: new Map<string, MuteUntil>(),
  channelLevels: new Map<string, NotifLevel>(),
  serverLevels: new Map<string, NotifLevel>(),
  suppressEveryone: new Set<string>(),
  loaded: false,
}

export const useChannelNotif = create<ChannelNotifState>((set, get) => ({
  ...EMPTY_NOTIF_STATE,

  fetch: async () => {
    try {
      const [channelRes, serverRes] = await Promise.all([
        api.get('/user/channel-notif'),
        api.get('/user/notification-overrides'),
      ])
      const rows = channelRes.data as (OverrideRow & { channel_id: string })[]
      const srows = serverRes.data as (OverrideRow & { server_id: string; suppress_everyone?: boolean })[]
      set({
        mutedChannels: new Map(rows.filter(r => r.muted).map(r => [r.channel_id, untilOf(r)])),
        channelLevels: new Map(rows.filter(r => r.level && r.level !== 'inherit').map(r => [r.channel_id, r.level as NotifLevel])),
        mutedServers: new Map(srows.filter(r => r.muted).map(r => [r.server_id, untilOf(r)])),
        serverLevels: new Map(srows.filter(r => r.level && r.level !== 'inherit').map(r => [r.server_id, r.level as NotifLevel])),
        suppressEveryone: new Set(srows.filter(r => r.suppress_everyone).map(r => r.server_id)),
        loaded: true,
      })
    } catch {}
  },

  setMuted: (channelId, muted, until = null) => set(s => ({ mutedChannels: withMute(s.mutedChannels, channelId, muted, until) })),
  isMuted: (channelId) => active(get().mutedChannels, channelId),

  setServerMuted: (serverId, muted, until = null) => set(s => ({ mutedServers: withMute(s.mutedServers, serverId, muted, until) })),
  isServerMuted: (serverId) => active(get().mutedServers, serverId),

  setLevel: (channelId, level) =>
    set(s => {
      const next = new Map(s.channelLevels)
      if (level === 'inherit') next.delete(channelId)
      else next.set(channelId, level)
      return { channelLevels: next }
    }),

  getLevel: (channelId) => get().channelLevels.get(channelId) ?? 'inherit',

  setServerPrefs: (serverId, level, suppressEveryone) =>
    set(s => {
      const serverLevels = new Map(s.serverLevels)
      if (level === 'inherit') serverLevels.delete(serverId)
      else serverLevels.set(serverId, level)
      const next = new Set(s.suppressEveryone)
      if (suppressEveryone) next.add(serverId)
      else next.delete(serverId)
      return { serverLevels, suppressEveryone: next }
    }),

  effectiveLevel: (channelId, serverId) => {
    const s = get()
    const ch = s.channelLevels.get(channelId)
    if (ch && ch !== 'inherit') return ch
    const sv = serverId ? s.serverLevels.get(serverId) : undefined
    if (sv && sv !== 'inherit') return sv
    const def = serverId
      ? queryClient.getQueryData<{ default_notification_level?: string }>(['server', serverId])?.default_notification_level
      : undefined
    return def === 'all' || def === 'nothing' ? def : 'mentions'
  },
}))
