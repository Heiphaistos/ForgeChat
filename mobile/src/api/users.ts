import { http, path } from '@/lib/http'
import type { MentionItem, UnreadItem, User } from '@/types/models'

export interface UpdateProfile {
  username?: string
  bio?: string
  custom_status?: string
  pronouns?: string
  /** AAAA-MM-JJ ; null = effacer. */
  birthday?: string | null
  /** "" = retirer ; -1 = couleur par défaut. */
  avatar_decoration?: string
  profile_color_primary?: number
  profile_color_accent?: number
  profile_effect?: string
}

export interface LoginEntry {
  id: string
  device_info: string | null
  ip_address: string | null
  last_seen: string
  created_at: string
}

export interface MyStats {
  messages_sent: number
  servers_joined: number
  friends_count: number
  reactions_given: number
  reactions_received: number
  member_since: string
}

export interface MutualServer {
  id: string
  name: string
  icon: string | null
  member_role_names: string[]
}

export const usersApi = {
  get: (id: string) => http.get<User>(path`/users/${id}`),
  profile: (id: string) => http.get<User & Record<string, unknown>>(path`/users/${id}/profile`),
  updateMe: (patch: UpdateProfile) => http.patch<User>('/users/me', patch),
  setStatus: (status: 'online' | 'idle' | 'dnd' | 'invisible') => http.patch('/user/status', { status }),
  uploadAvatar: (file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    // React Native accepte { uri, name, type } comme Blob-like.
    fd.append('avatar', file as unknown as Blob)
    return http.upload<User>('/users/me/avatar', fd)
  },
  uploadBanner: (file: { uri: string; name: string; type: string }) => {
    const fd = new FormData()
    fd.append('banner', file as unknown as Blob)
    return http.upload<{ banner: string }>('/users/me/banner', fd)
  },
  stats: () => http.get<MyStats>('/users/me/stats'),
  loginHistory: () => http.get<LoginEntry[]>('/users/me/login-history'),
  /** Export RGPD : JSON brut (texte, pour le partager tel quel). */
  dataExport: () => http.get<unknown>('/users/me/data-export', { timeoutMs: 60_000 }),
  setFocusMode: (enabled: boolean) => http.patch<{ focus_mode: boolean }>('/user/focus-mode', { enabled }),
  mutualServers: (id: string) => http.get<MutualServer[]>(path`/users/${id}/mutual-servers`),
  /** Note privée sur un utilisateur (visible de moi seul) ; '' si aucune. */
  note: (id: string) => http.get<{ content: string }>(path`/notes/${id}`),
  setNote: (id: string, content: string) => http.put(path`/notes/${id}`, { content }),
  unread: () => http.get<UnreadItem[]>('/unread'),
  markAllRead: () => http.post('/unread/mark-all'),
  mentions: () => http.get<MentionItem[]>('/user/mentions'),
  deleteAccount: (password: string) => http.delete('/users/me', { body: { password } }),
}
