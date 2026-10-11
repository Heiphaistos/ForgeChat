import { serverKeyForNewOwner } from '@/e2e/serverKey'
import { passwordProof } from '@/e2e/accountKey'
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

/** Champs avancés renvoyés par le serveur (models/server.rs), absents du type de base. */
export interface ServerFull extends Server {
  welcome_message: string | null
  verification_enabled: boolean
  verification_rules: string | null
  afk_channel_id: string | null
  afk_timeout_minutes: number
  vanity_url: string | null
  content_filter: string
  boost_count?: number
}

/** PATCH /servers/:id (UpdateServerRequest) ; `null` vide un salon système/AFK/règles ou l'adresse personnalisée. */
export interface ServerPatch {
  role_color_overrides_name?: boolean
  name?: string
  description?: string
  is_public?: boolean
  welcome_message?: string
  system_channel_id?: string | null
  afk_channel_id?: string | null
  afk_timeout?: number
  rules_channel_id?: string | null
  vanity_url?: string | null
  content_filter?: string
}

export const serversApi = {
  list: () => http.get<Server[]>('/servers'),
  /** Serveur + salons visibles + rôles + mes rôles (calcul des permissions : features/servers/perms). */
  detail: (id: string) => http.get<ServerDetail>(path`/servers/${id}`),
  /** Propriétaire seulement. */
  update: (id: string, patch: ServerPatch) => http.patch<ServerFull>(path`/servers/${id}`, patch),
  /** Barrière de vérification (propriétaire) ; `rules: null` vide le texte. */
  updateVerification: (id: string, enabled: boolean, rules: string | null) =>
    http.patch<ServerFull>(path`/servers/${id}/verification`, { verification_enabled: enabled, verification_rules: rules }),
  /** Un boost par membre et par serveur (cosmétique). */
  boost: (id: string) => http.post<{ boost_count: number; boost_level: number }>(path`/servers/${id}/boost`),
  /** Enregistre salons, catégories et rôles comme modèle (propriétaire). */
  saveTemplate: (id: string, name: string, isPublic: boolean) => http.post(path`/servers/${id}/template`, { name: name.trim(), is_public: isPublic }),
  /** Propriétaire seulement : mot de passe + code 2FA si activée (features/servers/deleteServer). */
  remove: async (id: string, { password, ...rest }: { password: string; totp_code?: string }) =>
    http.delete(path`/servers/${id}`, { body: { ...(await passwordProof(password)), ...rest } }),
  uploadImage: (id: string, kind: 'icon' | 'banner', file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append(kind, file as unknown as Blob)
    return http.upload<{ icon?: string; banner?: string }>(path`/servers/${id}/${kind}`, fd)
  },
  /** Clé de récupération du serveur ré-enveloppée pour le nouveau propriétaire (null : il saisira le code). */
  transfer: async (id: string, userId: string, password: string) =>
    http.post(path`/servers/${id}/transfer`, { user_id: userId, ...(await passwordProof(password)), server_key_owner_wrapped: await serverKeyForNewOwner(id, userId) }),
  /** Pseudo sur ce serveur ; null = retirer. */
  setNickname: (id: string, nickname: string | null) => http.patch(path`/servers/${id}/nickname`, { nickname }),
  /** Pseudo d'un autre membre (« Gérer les pseudos ») ; null = retirer. */
  setMemberNickname: (id: string, userId: string, nickname: string | null) =>
    http.patch(path`/servers/${id}/members/${userId}/nickname`, { nickname }),
  /** Profil propre à ce serveur : bio (null = celle du compte). */
  setServerBio: (id: string, bio: string | null) => http.patch(path`/servers/${id}/profile`, { bio }),
  /** Avatar ou bannière propre à ce serveur (8 / 10 Mo, PNG JPG GIF WEBP). */
  uploadServerProfileImage: (id: string, kind: 'avatar' | 'banner', file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append('file', file as unknown as Blob)
    return http.upload(path`/servers/${id}/profile/${kind}`, fd)
  },
  /** Revient à l'avatar / la bannière du compte. */
  clearServerProfileImage: (id: string, kind: 'avatar' | 'banner') => http.delete(path`/servers/${id}/profile/${kind}`),
  /** `template` : modèle intégré (GET /templates → builtin), structure créée par le serveur. */
  create: (name: string, description?: string, template?: string) =>
    http.post<Server>('/servers', { name: name.trim(), description: description?.trim() || undefined, template }),
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
  /** `secondary_color` négatif = retirer le dégradé ; `icon` : emoji, ou "" pour retirer l'icône. */
  updateRole: (
    serverId: string,
    roleId: string,
    patch: { name?: string; color?: number; permissions?: number; hoisted?: boolean; mentionable?: boolean; secondary_color?: number; icon?: string },
  ) => http.patch<Role>(path`/servers/${serverId}/roles/${roleId}`, patch),
  /** Image d'icône du rôle (png/jpg/gif/webp, 256 Ko max). */
  uploadRoleIcon: (serverId: string, roleId: string, file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append('icon', file as unknown as Blob)
    return http.upload<Role>(path`/servers/${serverId}/roles/${roleId}/icon`, fd)
  },
  deleteRole: (serverId: string, roleId: string) => http.delete(path`/servers/${serverId}/roles/${roleId}`),
  /** Tous les rôles sauf @everyone, du plus haut au plus bas (features/servers/reorder). */
  reorderRoles: (serverId: string, roleIds: string[]) => http.patch(path`/servers/${serverId}/roles/order`, { role_ids: roleIds }),
  roleMembers: (serverId: string, roleId: string) =>
    http.get<{ id: string; username: string; avatar: string | null; nick: string | null }[]>(path`/servers/${serverId}/roles/${roleId}/members`),
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
