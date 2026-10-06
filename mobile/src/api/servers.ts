import { http, path } from '@/lib/http'
import type { Ban, Category, Channel, Invite, InviteInfo, Member, Role, Server, ServerDetail } from '@/types/models'

/** Niveaux de notification acceptés par user_settings.rs. */
export type NotifLevel = 'inherit' | 'all' | 'mentions' | 'nothing'
/** Réglage de notification d'un serveur ou d'un salon ; `mute_minutes` : 15, 60, 480, 1440, 0 = jusqu'à réactivation. */
export interface NotifOverride {
  level: NotifLevel
  muted: boolean
  muted_until: string | null
  suppress_everyone?: boolean
}


export const serversApi = {
  list: () => http.get<Server[]>('/servers'),
  /** Serveur + salons visibles + rôles + mes rôles (calcul des permissions : features/servers/perms). */
  detail: (id: string) => http.get<ServerDetail>(path`/servers/${id}`),
  /** Propriétaire seulement. */
  update: (id: string, patch: { name?: string; description?: string }) => http.patch<Server>(path`/servers/${id}`, patch),
  /** Propriétaire seulement : mot de passe + code 2FA si activée (features/servers/deleteServer). */
  remove: (id: string, body: { password: string; totp_code?: string }) => http.delete(path`/servers/${id}`, { body }),
  uploadImage: (id: string, kind: 'icon' | 'banner', file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append(kind, file as unknown as Blob)
    return http.upload<{ icon?: string; banner?: string }>(path`/servers/${id}/${kind}`, fd)
  },
  transfer: (id: string, userId: string, password: string) => http.post(path`/servers/${id}/transfer`, { user_id: userId, password }),
  /** Pseudo sur ce serveur ; null = retirer. */
  setNickname: (id: string, nickname: string | null) => http.patch(path`/servers/${id}/nickname`, { nickname }),
  create: (name: string, description?: string) =>
    http.post<Server>('/servers', { name: name.trim(), description: description?.trim() || undefined }),
  leave: (id: string) => http.post(path`/servers/${id}/leave`),
  channels: (id: string) => http.get<Channel[]>(path`/servers/${id}/channels`),
  createChannel: (serverId: string, name: string, type: 'text' | 'voice' | 'announcement' | (string & {}), categoryId?: string | null) =>
    http.post<Channel>(path`/servers/${serverId}/channels`, { name: name.trim(), type, category_id: categoryId ?? undefined }),
  categories: (id: string) => http.get<Category[]>(path`/servers/${id}/categories`),
  createCategory: (serverId: string, name: string) => http.post<Category>(path`/servers/${serverId}/categories`, { name: name.trim() }),
  deleteChannel: (serverId: string, channelId: string) => http.delete(path`/servers/${serverId}/channels/${channelId}`),
  updateChannel: (serverId: string, channelId: string, patch: { name?: string; topic?: string }) =>
    http.patch<Channel>(path`/servers/${serverId}/channels/${channelId}`, patch),
  /** `null` : sortir le salon de sa catégorie. */
  moveChannel: (channelId: string, categoryId: string | null) => http.patch(path`/channels/${channelId}/move`, { category_id: categoryId }),
  deleteCategory: (serverId: string, categoryId: string) => http.delete(path`/servers/${serverId}/categories/${categoryId}`),
  createRole: (serverId: string, name: string) => http.post<Role>(path`/servers/${serverId}/roles`, { name: name.trim() }),
  updateRole: (serverId: string, roleId: string, patch: { name?: string; color?: number; permissions?: number }) =>
    http.patch<Role>(path`/servers/${serverId}/roles/${roleId}`, patch),
  deleteRole: (serverId: string, roleId: string) => http.delete(path`/servers/${serverId}/roles/${roleId}`),
  assignRole: (serverId: string, userId: string, roleId: string) => http.put(path`/servers/${serverId}/members/${userId}/roles/${roleId}`),
  removeRole: (serverId: string, userId: string, roleId: string) => http.delete(path`/servers/${serverId}/members/${userId}/roles/${roleId}`),
  kick: (serverId: string, userId: string) => http.post(path`/servers/${serverId}/members/${userId}/kick`),
  /** Sans durée : définitif (BAN_MEMBERS) ; avec durée : BAN_MEMBERS ou BAN_TEMP. */
  ban: (serverId: string, userId: string, reason?: string, durationHours?: number) =>
    http.post(path`/servers/${serverId}/members/${userId}/ban`, { reason: reason?.trim() || undefined, duration_hours: durationHours }),
  /** Exclusion temporaire (MANAGE_MESSAGES), 1 à 10080 minutes. */
  timeout: (serverId: string, userId: string, minutes: number) =>
    http.post(path`/servers/${serverId}/members/${userId}/timeout`, { duration_minutes: minutes }),
  removeTimeout: (serverId: string, userId: string) => http.delete(path`/servers/${serverId}/members/${userId}/timeout`),
  bans: (serverId: string) => http.get<Ban[]>(path`/servers/${serverId}/bans`),
  unban: (serverId: string, userId: string) => http.delete(path`/servers/${serverId}/bans/${userId}`),
  serverNotif: () => http.get<(NotifOverride & { server_id: string })[]>('/user/notification-overrides'),
  setServerNotif: (serverId: string, level: NotifLevel, muted: boolean, muteMinutes: number | undefined, suppressEveryone: boolean) =>
    http.post('/user/notification-overrides', { server_id: serverId, level, muted, mute_minutes: muteMinutes, suppress_everyone: suppressEveryone }),
  channelNotif: () => http.get<(NotifOverride & { channel_id: string })[]>('/user/channel-notif'),
  setChannelNotif: (channelId: string, level: NotifLevel, muted: boolean, muteMinutes: number | undefined) =>
    http.post(path`/user/channel-notif/${channelId}`, { level, muted, mute_minutes: muteMinutes }),
  /** Modèles partagés : publics + les miens (données brutes, lues par features/servers/templates). */
  templates: () => http.get<unknown>('/templates'),
  /** Crée un serveur depuis un modèle partagé (le serveur recrée catégories, salons et rôles). */
  useTemplate: (templateId: string, name: string) => http.post<Server>(path`/templates/${templateId}/use`, { name: name.trim() }),
  members: (id: string) => http.get<Member[]>(path`/servers/${id}/members`),
  /** Emojis personnalisés (données brutes : filtrées par features/chat/customEmojis.buildEmojiMap). */
  emojis: (id: string) => http.get<unknown>(path`/servers/${id}/emojis`),
  /** Stickers image du serveur (données brutes, validées par features/composer/stickers). */
  stickers: (id: string) => http.get<unknown>(path`/servers/${id}/stickers`),
  join: (code: string) => http.post<Server>(path`/servers/join/${code}`),
  invite: (code: string) => http.get<InviteInfo>(path`/invites/${code}`, { auth: false }),
  createInvite: (serverId: string, maxUses?: number, expiresHours?: number) =>
    http.post<{ code: string }>(path`/servers/${serverId}/invites`, {
      max_uses: maxUses ?? null,
      expires_hours: expiresHours ?? 24,
    }),
  /** Invitations du serveur (exige MANAGE_SERVER). `uses` : nombre d'utilisations. */
  invites: (serverId: string) => http.get<Invite[]>(path`/servers/${serverId}/invites`),
  deleteInvite: (serverId: string, code: string) => http.delete(path`/servers/${serverId}/invites/${code}`),
  markRead: (serverId: string) => http.post(path`/servers/${serverId}/read`),
}
