import { http, path } from '@/lib/http'
import type { Category, Channel, InviteInfo, Member, Server } from '@/types/models'

export const serversApi = {
  list: () => http.get<Server[]>('/servers'),
  get: (id: string) => http.get<Server>(path`/servers/${id}`),
  create: (name: string, description?: string) =>
    http.post<Server>('/servers', { name: name.trim(), description: description?.trim() || undefined }),
  leave: (id: string) => http.post(path`/servers/${id}/leave`),
  channels: (id: string) => http.get<Channel[]>(path`/servers/${id}/channels`),
  createChannel: (serverId: string, name: string, type: 'text' | 'voice', categoryId?: string | null) =>
    http.post<Channel>(path`/servers/${serverId}/channels`, { name: name.trim(), type, category_id: categoryId ?? undefined }),
  categories: (id: string) => http.get<Category[]>(path`/servers/${id}/categories`),
  members: (id: string) => http.get<Member[]>(path`/servers/${id}/members`),
  /** Emojis personnalisés (données brutes : filtrées par features/chat/customEmojis.buildEmojiMap). */
  emojis: (id: string) => http.get<unknown>(path`/servers/${id}/emojis`),
  join: (code: string) => http.post<Server>(path`/servers/join/${code}`),
  invite: (code: string) => http.get<InviteInfo>(path`/invites/${code}`, { auth: false }),
  createInvite: (serverId: string, maxUses?: number, expiresHours?: number) =>
    http.post<{ code: string }>(path`/servers/${serverId}/invites`, {
      max_uses: maxUses ?? null,
      expires_hours: expiresHours ?? 24,
    }),
  /** Invitations du serveur (exige MANAGE_SERVER). `uses` : nombre d'utilisations. */
  invites: (serverId: string) => http.get<{ code: string; uses: number }[]>(path`/servers/${serverId}/invites`),
  deleteInvite: (serverId: string, code: string) => http.delete(path`/servers/${serverId}/invites/${code}`),
  markRead: (serverId: string) => http.post(path`/servers/${serverId}/read`),
}
