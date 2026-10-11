// Centre de notifications (même contenu que client/src/pages/NotificationsPage.tsx) : réglages
// par serveur, catégorie et salon, lus en une fois et gardés en mémoire pour l'écran et pour les
// alertes locales décidées sur l'appareil (nouveau post de forum, services/keepAlive). Les
// mentions restent décidées par le serveur (notify.rs), qui applique la même hiérarchie.
import { create } from 'zustand'
import { serversApi } from '@/api/servers'
import { http, path } from '@/lib/http'
import { queryClient, qk } from '@/lib/queryClient'
import type { Server } from '@/types/models'
import { forumPostAlerts, resolveLevel, stillMuted, type Effective, type NotifLevel } from './notifLevels'

export interface ServerPrefs {
  level: NotifLevel
  muted: boolean
  mutedUntil: string | null
  suppressEveryone: boolean
  suppressRoles: boolean
  forumPosts: boolean
}

export interface ChannelPrefs {
  serverId: string | null
  name: string | null
  level: NotifLevel
  muted: boolean
  mutedUntil: string | null
}

interface Center {
  categories: { category_id: string; server_id: string; level: Effective; channel_ids: string[] }[]
  channels: { channel_id: string; server_id: string; channel_name: string }[]
}

type ServerRow = { server_id: string; level: NotifLevel; muted: boolean; muted_until: string | null; suppress_everyone?: boolean; suppress_roles?: boolean; forum_posts?: boolean }

export const notifApi = {
  center: () => http.get<Center>('/user/notif-center'),
  serverRows: () => http.get<ServerRow[]>('/user/notification-overrides'),
  /** Champs absents : inchangés côté serveur (sauf niveau et sourdine, toujours envoyés). */
  setServer: (serverId: string, p: ServerPrefs, muteMinutes?: number) =>
    http.post('/user/notification-overrides', {
      server_id: serverId, level: p.level, muted: p.muted, mute_minutes: muteMinutes,
      suppress_everyone: p.suppressEveryone, suppress_roles: p.suppressRoles, forum_posts: p.forumPosts,
    }),
  setCategory: (categoryId: string, level: NotifLevel) => http.post(path`/user/category-notif/${categoryId}`, { level }),
  /** Sans serverId : tous les serveurs (les MP ne changent pas). */
  reset: (serverId?: string) => http.delete('/user/notification-overrides', serverId ? { query: { server_id: serverId } } : undefined),
  everywhere: (level: 'mentions' | 'nothing') => http.put('/user/notification-overrides/everywhere', { level }),
}

export const DEFAULT_SERVER: ServerPrefs = { level: 'inherit', muted: false, mutedUntil: null, suppressEveryone: false, suppressRoles: false, forumPosts: false }

interface State {
  servers: Record<string, ServerPrefs>
  channels: Record<string, ChannelPrefs>
  categories: Record<string, { serverId: string; level: Effective }>
  /** Salon → catégorie, pour les seules catégories réglées. */
  channelCategory: Record<string, string>
  loaded: boolean
  fetch: () => Promise<void>
}

export const useNotifCenter = create<State>()((set) => ({
  servers: {},
  channels: {},
  categories: {},
  channelCategory: {},
  loaded: false,
  fetch: async () => {
    const [srows, crows, center] = await Promise.all([
      notifApi.serverRows(),
      serversApi.channelNotif(),
      notifApi.center().catch((): Center => ({ categories: [], channels: [] })),
    ])
    const names = new Map(center.channels.map((c) => [c.channel_id, c]))
    set({
      servers: Object.fromEntries(srows.map((r) => [r.server_id, {
        level: r.level ?? 'inherit', muted: stillMuted(r.muted, r.muted_until), mutedUntil: r.muted_until,
        suppressEveryone: !!r.suppress_everyone, suppressRoles: !!r.suppress_roles, forumPosts: !!r.forum_posts,
      }])),
      channels: Object.fromEntries(crows.map((r) => [r.channel_id, {
        serverId: names.get(r.channel_id)?.server_id ?? null, name: names.get(r.channel_id)?.channel_name ?? null,
        level: r.level ?? 'inherit', muted: stillMuted(r.muted, r.muted_until), mutedUntil: r.muted_until,
      }])),
      categories: Object.fromEntries(center.categories.map((c) => [c.category_id, { serverId: c.server_id, level: c.level }])),
      channelCategory: Object.fromEntries(center.categories.flatMap((c) => c.channel_ids.map((ch) => [ch, c.category_id]))),
      loaded: true,
    })
  },
}))

/** Niveau par défaut choisi par les admins (liste des serveurs en cache). */
export const serverDefault = (serverId: string) =>
  queryClient.getQueryData<(Server & { default_notification_level?: string })[]>(qk.servers)?.find((s) => s.id === serverId)?.default_notification_level

/** Niveau effectif d'un salon (salon > catégorie > serveur > défaut). */
export function effectiveLevel(s: Pick<State, 'servers' | 'channels' | 'categories' | 'channelCategory'>, channelId: string, serverId: string): Effective {
  const cat = s.channelCategory[channelId]
  return resolveLevel(s.channels[channelId]?.level, cat ? s.categories[cat]?.level : undefined, s.servers[serverId]?.level, serverDefault(serverId))
}

/** Nouveau post de forum : faut-il une alerte sur cet appareil ? (sourdines de salon et de serveur comprises) */
export function forumPostWanted(channelId: string, serverId: string): boolean {
  const s = useNotifCenter.getState()
  if (!s.loaded) return false
  const ch = s.channels[channelId]
  const sv = s.servers[serverId]
  if (stillMuted(ch?.muted, ch?.mutedUntil) || stillMuted(sv?.muted, sv?.mutedUntil)) return false
  return forumPostAlerts(effectiveLevel(s, channelId, serverId), !!sv?.forumPosts)
}
