import { openRaw } from '@/e2e/conversations'
import { passwordProof } from '@/e2e/accountKey'
import { http, path } from '@/lib/http'
import type { NameInfo, NameStyle } from '@/lib/nameStyle'
import type { MentionItem, ProfileLink, UnreadItem, User } from '@/types/models'

export interface UpdateProfile {
  username?: string
  bio?: string
  custom_status?: string
  pronouns?: string
  /** "" = retirer ; -1 = couleur par défaut. */
  avatar_decoration?: string
  profile_color_primary?: number
  profile_color_accent?: number
  profile_effect?: string
  /** "" = retirer. */
  display_name?: string
  /** {} = style par défaut. */
  name_style?: NameStyle | Record<string, never>
  profile_tag?: string
  /** [] = aucun lien. */
  profile_links?: ProfileLink[]
  /** Minutes (STATUS_CLEAR_AFTER) ; pris en compte seulement avec `custom_status`. */
  custom_status_clear_after?: number
  /** Activité (« listening » saisi à la main) ; "" = retirer. */
  activity_type?: string
  activity_name?: string
}

/** Durées d'effacement du statut perso acceptées par le serveur (minutes ; 0 = jamais). */
export const STATUS_CLEAR_AFTER = [0, 30, 60, 240, 1440, 4320, 10080] as const

export interface UserStyle extends NameInfo {
  id: string
}

export interface LoginEntry {
  id: string
  device_info: string | null
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
  /** Styles de pseudo de 100 utilisateurs au plus (cache stores/nameStyles). */
  styles: (ids: string[]) => http.get<UserStyle[]>(`/users/styles?ids=${ids.map(encodeURIComponent).join(',')}`),
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
  unread: () => http.get<UnreadItem[]>('/unread'),
  markAllRead: () => http.post('/unread/mark-all'),
  /** Mentions non lues ; celles d'un salon chiffré sont déchiffrées sur l'appareil pour l'aperçu. */
  mentions: async (): Promise<MentionItem[]> => {
    const list = await http.get<MentionItem[]>('/user/mentions')
    const out: MentionItem[] = []
    for (const m of Array.isArray(list) ? list : [])
      out.push(m.enc ? ((await openRaw('channel', m.channel_id, m as unknown as Record<string, unknown>)) as unknown as MentionItem) : m)
    return out
  },
  deleteAccount: async (password: string) => http.delete('/users/me', { body: await passwordProof(password) }),
}
