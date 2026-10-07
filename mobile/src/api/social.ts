// Lot « Profil et social » : fiche sociale, favoris, groupes d'amis, anniversaires.
import { http, path } from '@/lib/http'

export interface DayMonth { month: number; day: number }
export interface UserSocial { in_call: boolean; badges: string[]; birthday: DayMonth | null }
export interface FriendGroup { id: string; name: string; position: number; member_ids: string[] }
export type BirthdayVisibility = 'nobody' | 'friends' | 'servers'
export interface MyBirthday {
  birthday: (DayMonth & { year: number | null }) | null
  visibility: BirthdayVisibility
  server_ids: string[]
}
export interface BirthdayPatch {
  birthday?: (DayMonth & { year: number | null }) | null
  visibility?: BirthdayVisibility
  server_ids?: string[]
}

export const socialKeys = {
  user: (id: string) => ['user-social', id] as const,
  groups: ['friend-groups'] as const,
  birthday: ['my-birthday'] as const,
  serverBirthday: (id: string) => ['birthday-channel', id] as const,
}

export const socialApi = {
  user: (id: string) => http.get<UserSocial>(path`/users/${id}/social`),
  setFavorite: (id: string, favorite: boolean) => http.put(path`/friends/${id}/favorite`, { favorite }),
  groups: () => http.get<FriendGroup[]>('/friends/groups'),
  createGroup: (name: string) => http.post('/friends/groups', { name }),
  renameGroup: (id: string, name: string) => http.put(path`/friends/groups/${id}`, { name }),
  deleteGroup: (id: string) => http.delete(path`/friends/groups/${id}`),
  orderGroups: (ids: string[]) => http.put('/friends/groups/order', { ids }),
  addToGroup: (id: string, userId: string) => http.post(path`/friends/groups/${id}/members`, { user_id: userId }),
  removeFromGroup: (id: string, userId: string) => http.delete(path`/friends/groups/${id}/members/${userId}`),
  myBirthday: () => http.get<MyBirthday>('/users/me/birthday'),
  setMyBirthday: (patch: BirthdayPatch) => http.put<MyBirthday>('/users/me/birthday', patch),
  serverBirthdayChannel: (serverId: string) => http.get<{ channel_id: string | null }>(path`/servers/${serverId}/birthday-channel`),
  setServerBirthdayChannel: (serverId: string, channelId: string | null) =>
    http.put<{ channel_id: string | null }>(path`/servers/${serverId}/birthday-channel`, { channel_id: channelId }),
}
