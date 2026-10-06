import { http, path } from '@/lib/http'
import type { Channel } from '@/types/models'

/** Champs de GET /servers/:id/channels absents du type de base (handlers/channels.rs::get_channels). */
export interface ChannelFull extends Channel {
  bitrate?: number | null
  is_auto_create?: boolean
  auto_create_name?: string | null
  is_temporary?: boolean
  default_sort?: string
  require_tag?: boolean
}

/** PATCH /servers/:sid/channels/:cid (UpdateChannelRequest). `user_limit` null ou 0 : sans limite. */
export interface ChannelPatch {
  name?: string
  topic?: string
  slowmode_delay?: number
  is_nsfw?: boolean
  user_limit?: number | null
  voice_password?: string
  remove_voice_password?: boolean
  is_auto_create?: boolean
  auto_create_name?: string | null
  bitrate?: number
  default_sort?: string
  require_tag?: boolean
}

/** Surcharge de permissions d'un salon pour un rôle ou un membre (masques allow / deny). */
export interface ChannelOverride {
  target_id: string
  target_type: 'role' | 'member'
  allow: number
  deny: number
}

export const channelsApi = {
  update: (serverId: string, channelId: string, patch: ChannelPatch) => http.patch<Channel>(path`/servers/${serverId}/channels/${channelId}`, patch),
  /** Bascule archivé / restauré ; renvoie le nouvel état. */
  toggleArchive: (serverId: string, channelId: string) => http.patch<{ archived: boolean }>(path`/servers/${serverId}/channels/${channelId}/archive`),
  /** Positions 0..n dans l'ordre donné (features/servers/reorder). */
  reorder: (serverId: string, channelIds: string[]) => http.patch(path`/servers/${serverId}/channels/reorder`, { channel_ids: channelIds }),
  /** Masquer pour soi seul (tout membre). */
  hide: (channelId: string) => http.post(path`/channels/${channelId}/hide`),
  unhide: (channelId: string) => http.delete(path`/channels/${channelId}/hide`),
  /** Supprime les `limit` derniers messages (max 1000, MANAGE_CHANNELS). */
  purge: (channelId: string, limit: number) => http.post<{ deleted: number }>(path`/channels/${channelId}/purge`, { limit }),
  permissions: (channelId: string) => http.get<ChannelOverride[]>(path`/channels/${channelId}/permissions`),
  setPermission: (channelId: string, o: ChannelOverride) =>
    http.put(path`/channels/${channelId}/permissions/${o.target_id}`, { target_type: o.target_type, allow: o.allow, deny: o.deny }),
  deletePermission: (channelId: string, targetId: string) => http.delete(path`/channels/${channelId}/permissions/${targetId}`),
  /** Tags officiels d'un forum (lecture : forumApi.tags). */
  createTag: (channelId: string, name: string) => http.post(path`/channels/${channelId}/tags`, { name: name.trim() }),
  deleteTag: (channelId: string, name: string) => http.delete(path`/channels/${channelId}/tags/${name}`),
}
