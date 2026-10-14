import { create } from 'zustand'
import api from '../api/client'
import { queryClient } from '../main'
import { useWs } from './ws'
import { resolveLevel, type Effective, type NotifLevel } from './notifLevels'

export { resolveLevel, forumPostAlerts, type Effective, type NotifLevel } from './notifLevels'

/** Échéance d'une sourdine en ms epoch ; `null` = jusqu'à réactivation. */
type MuteUntil = number | null

interface OverrideRow {
  level?: NotifLevel
  muted: boolean
  muted_until?: string | null
}

/** Salon réglé à part, affiché par le centre de notifications. */
export interface ChannelInfo { serverId: string; name: string }

// Réglages lus par App.tsx pour décider des alertes en direct. Le serveur
// applique la même règle pour les mentions et le Web Push (notify.rs) :
// salon > catégorie > serveur > défaut du serveur ; sourdine
// éventuellement temporaire (muted_until).
interface ChannelNotifState {
  mutedChannels: Map<string, MuteUntil>
  mutedServers: Map<string, MuteUntil>
  channelLevels: Map<string, NotifLevel>
  serverLevels: Map<string, NotifLevel>
  suppressEveryone: Set<string>
  suppressRoles: Set<string>
  /** Serveurs où chaque nouveau post de forum alerte. */
  forumPosts: Set<string>
  categoryLevels: Map<string, Effective>
  categoryServer: Map<string, string>
  /** Salon → catégorie, pour les seules catégories réglées. */
  channelCategory: Map<string, string>
  channelInfo: Map<string, ChannelInfo>
  loaded: boolean
  fetch: () => Promise<void>
  setMuted: (channelId: string, muted: boolean, until?: MuteUntil) => void
  isMuted: (channelId: string) => boolean
  setServerMuted: (serverId: string, muted: boolean, until?: MuteUntil) => void
  isServerMuted: (serverId: string) => boolean
  setLevel: (channelId: string, level: NotifLevel) => void
  getLevel: (channelId: string) => NotifLevel
  setServerPrefs: (serverId: string, level: NotifLevel, suppressEveryone: boolean) => void
  setServerFlags: (serverId: string, flags: { suppressRoles: boolean; forumPosts: boolean }) => void
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
  suppressRoles: new Set<string>(),
  forumPosts: new Set<string>(),
  categoryLevels: new Map<string, Effective>(),
  categoryServer: new Map<string, string>(),
  channelCategory: new Map<string, string>(),
  channelInfo: new Map<string, ChannelInfo>(),
  loaded: false,
}

interface CenterResponse {
  categories: { category_id: string; server_id: string; level: Effective; channel_ids: string[] }[]
  channels: { channel_id: string; server_id: string; channel_name: string }[]
}

const toggled = (set: Set<string>, id: string, on: boolean) => {
  const next = new Set(set)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

/** Niveau par défaut choisi par les admins du serveur (fiche serveur ou liste des serveurs en cache). */
export function serverDefault(serverId: string): string | undefined {
  type WithDefault = { id?: string; default_notification_level?: string }
  return queryClient.getQueryData<WithDefault>(['server', serverId])?.default_notification_level
    ?? queryClient.getQueryData<WithDefault[]>(['servers'])?.find(x => x.id === serverId)?.default_notification_level
}

let retryArmed = false

export const useChannelNotif = create<ChannelNotifState>((set, get) => ({
  ...EMPTY_NOTIF_STATE,

  fetch: async () => {
    try {
      const [channelRes, serverRes, centerRes] = await Promise.all([
        api.get('/user/channel-notif'),
        api.get('/user/notification-overrides'),
        api.get('/user/notif-center').catch(() => ({ data: { categories: [], channels: [] } })),
      ])
      const rows = channelRes.data as (OverrideRow & { channel_id: string })[]
      const srows = serverRes.data as (OverrideRow & { server_id: string; suppress_everyone?: boolean; suppress_roles?: boolean; forum_posts?: boolean })[]
      const center = centerRes.data as CenterResponse
      set({
        mutedChannels: new Map(rows.filter(r => r.muted).map(r => [r.channel_id, untilOf(r)])),
        channelLevels: new Map(rows.filter(r => r.level && r.level !== 'inherit').map(r => [r.channel_id, r.level as NotifLevel])),
        mutedServers: new Map(srows.filter(r => r.muted).map(r => [r.server_id, untilOf(r)])),
        serverLevels: new Map(srows.filter(r => r.level && r.level !== 'inherit').map(r => [r.server_id, r.level as NotifLevel])),
        suppressEveryone: new Set(srows.filter(r => r.suppress_everyone).map(r => r.server_id)),
        suppressRoles: new Set(srows.filter(r => r.suppress_roles).map(r => r.server_id)),
        forumPosts: new Set(srows.filter(r => r.forum_posts).map(r => r.server_id)),
        categoryLevels: new Map(center.categories.map(c => [c.category_id, c.level])),
        categoryServer: new Map(center.categories.map(c => [c.category_id, c.server_id])),
        channelCategory: new Map(center.categories.flatMap(c => c.channel_ids.map(ch => [ch, c.category_id] as const))),
        channelInfo: new Map(center.channels.map(c => [c.channel_id, { serverId: c.server_id, name: c.channel_name }])),
        loaded: true,
      })
    } catch (e) {
      console.warn('[channelNotif] réglages de notification non chargés ; nouvel essai à la reconnexion', e)
      // Un seul nouvel essai armé à la fois, à la prochaine (re)connexion du WebSocket.
      if (retryArmed) return
      retryArmed = true
      const off = useWs.getState().onOpen(() => { off(); retryArmed = false; void get().fetch() })
    }
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
      return { serverLevels, suppressEveryone: toggled(s.suppressEveryone, serverId, suppressEveryone) }
    }),

  setServerFlags: (serverId, { suppressRoles, forumPosts }) =>
    set(s => ({ suppressRoles: toggled(s.suppressRoles, serverId, suppressRoles), forumPosts: toggled(s.forumPosts, serverId, forumPosts) })),

  effectiveLevel: (channelId, serverId) => {
    const s = get()
    const cat = s.channelCategory.get(channelId)
    return resolveLevel(
      s.channelLevels.get(channelId),
      cat ? s.categoryLevels.get(cat) : undefined,
      serverId ? s.serverLevels.get(serverId) : undefined,
      serverId ? serverDefault(serverId) : undefined,
    )
  },
}))
