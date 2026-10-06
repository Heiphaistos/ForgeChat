import { http, path } from '@/lib/http'
import type { MentionItem, UnreadItem, User } from '@/types/models'

export interface UpdateProfile {
  username?: string
  bio?: string
  custom_status?: string
  pronouns?: string
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
  unread: () => http.get<UnreadItem[]>('/unread'),
  markAllRead: () => http.post('/unread/mark-all'),
  mentions: () => http.get<MentionItem[]>('/user/mentions'),
  deleteAccount: (password: string) => http.delete('/users/me', { body: { password } }),
}
