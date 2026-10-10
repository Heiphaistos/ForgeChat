import { http, path } from '@/lib/http'
import { passwordProof } from '@/e2e/accountKey'

/** Administration du site (rôle « El Patron », propriétaire inclus) : mêmes routes que le web, /admin/*. */
export interface AdminInfo {
  admin: boolean
  owner: boolean
}
export type RegistrationMode = 'open' | 'invite' | 'closed'
export interface Overview {
  total_users: number
  online_now: number
  active_24h: number
  active_7d: number
  new_24h: number
  new_7d: number
  new_30d: number
  banned: number
  patrons: number
  servers: number
  messages: number
  active_invites: number
  registration_mode: RegistrationMode
}
export interface AdminUser {
  id: string
  username: string
  email: string
  created_at: string
  is_bot: boolean
  is_owner: boolean
  is_patron: boolean
  banned_at: string | null
  ban_reason: string | null
  invited_by: string | null
  invite_note: string | null
  last_seen: string | null
  online: boolean
  server_count: number
  message_count: number
}
export interface Invite {
  id: string
  code: string
  note: string | null
  max_uses: number
  uses: number
  status: 'active' | 'used' | 'expired' | 'revoked'
  expires_at: string | null
  used_by: { id: string; username: string }[]
}
export interface AuditEntry {
  id: number
  action: string
  detail: { reason?: string; mode?: string; server?: string } | null
  created_at: string
  admin: string | null
  target: string | null
}
export type UserFilter = 'all' | 'online' | 'recent' | 'banned' | 'patrons'
export type ServerFilter = 'all' | 'public' | 'suspended' | 'supervised'
export interface AdminServer {
  id: string
  name: string
  is_public: boolean
  created_at: string
  owner: string | null
  members: number
  channels: number
  messages: number
  storage_bytes: number
  suspended_at: string | null
  suspended_reason: string | null
  joined: boolean
  supervising: boolean
}

export const adminApi = {
  /** 403 = pas El Patron : l'écran reste invisible. */
  async me(): Promise<AdminInfo> {
    try {
      const r = await http.get<{ owner?: boolean }>('/admin/me')
      return { admin: true, owner: !!r.owner }
    } catch {
      return { admin: false, owner: false }
    }
  },
  overview: () => http.get<Overview>('/admin/overview'),
  users: (q: string, filter: UserFilter) =>
    http.get<{ total: number; users: AdminUser[] }>('/admin/users', { query: { q: q.trim() || undefined, filter, limit: 100 } }),
  ban: (id: string, reason: string) => http.post(path`/admin/users/${id}/ban`, { reason: reason.trim() || undefined }),
  unban: (id: string) => http.delete(path`/admin/users/${id}/ban`),
  forceLogout: (id: string) => http.post(path`/admin/users/${id}/logout`),
  setPatron: (id: string, patron: boolean) => http.put(path`/admin/users/${id}/patron`, { patron }),
  servers: (q: string, filter: ServerFilter) =>
    http.get<{ total: number; servers: AdminServer[] }>('/admin/servers', { query: { q: q.trim() || undefined, filter, limit: 100 } }),
  /** Supervision VISIBLE (membre + journal d'audit du serveur) : ni messages privés, ni clés des salons chiffrés. */
  supervise: (id: string) => http.post(path`/admin/servers/${id}/supervise`),
  endSupervision: (id: string) => http.delete(path`/admin/servers/${id}/supervise`),
  suspend: (id: string, reason: string) => http.post(path`/admin/servers/${id}/suspend`, { reason: reason.trim() || undefined }),
  unsuspend: (id: string) => http.delete(path`/admin/servers/${id}/suspend`),
  deleteServer: async (id: string, password: string) => http.delete(path`/admin/servers/${id}`, { body: await passwordProof(password) }),
  invites: () => http.get<{ invites: Invite[] }>('/admin/invites'),
  createInvite: (note: string, maxUses: number, days: number) =>
    http.post<{ code: string }>('/admin/invites', {
      note: note.trim() || undefined,
      max_uses: maxUses,
      expires_in_days: days > 0 ? days : undefined,
    }),
  revokeInvite: (id: string) => http.delete(path`/admin/invites/${id}`),
  setMode: (registration_mode: RegistrationMode) => http.put('/admin/settings', { registration_mode }),
  audit: () => http.get<{ entries: AuditEntry[] }>('/admin/audit'),
}

/** Lien d'invitation à envoyer : la page d'inscription pré-remplit le code. */
export function inviteLink(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}/register?code=${code.replace(/-/g, '')}`
}
