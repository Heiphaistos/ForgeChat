import { http, path } from '@/lib/http'
import type { FriendsResponse } from '@/types/models'

export type FriendFilter = 'all' | 'online' | 'pending' | 'blocked'

export const friendsApi = {
  list: (filter: FriendFilter = 'all') => http.get<FriendsResponse>('/friends/v2', { query: { filter } }),
  /** name : "pseudo" ou "pseudo#1234" */
  addByName: (name: string, message?: string) =>
    http.post('/friends/by-name', { name: name.trim(), message: message?.trim() || undefined }),
  accept: (friendshipId: string) => http.post(path`/friends/${friendshipId}/accept`),
  decline: (friendshipId: string) => http.post(path`/friends/${friendshipId}/decline`),
  cancel: (friendshipId: string) => http.delete(path`/friends/${friendshipId}/cancel`),
  remove: (userId: string) => http.delete(path`/friends/${userId}`),
  block: (userId: string) => http.post(path`/friends/block/${userId}`),
  unblock: (userId: string) => http.delete(path`/friends/block/${userId}`),
  /** Lien d'invitation d'ami (valable 7 jours). */
  createInvite: () => http.post<{ code: string; url: string }>('/friends/invite'),
  suggestions: () => http.get<FriendSuggestion[]>('/friends/suggestions'),
  calls: () => http.get<CallEntry[]>('/friends/calls'),
  /** Surnom privé donné à un ami ; '' si aucun. */
  nickname: (userId: string) => http.get<{ nickname: string }>(path`/friends/${userId}/nickname`),
  /** '' = retirer le surnom. */
  setNickname: (userId: string, nickname: string) => http.put(path`/friends/${userId}/nickname`, { nickname }),
}

export interface FriendSuggestion {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  status: string
  mutual_friends: number
  mutual_servers: number
}

export interface CallEntry {
  id: string
  call_type: string
  status: string
  direction: 'outgoing' | 'incoming'
  started_at: string
  ended_at: string | null
  duration_s: number | null
  dm_id: string | null
  other_user: { id: string; username: string; avatar: string | null }
}

export interface FriendInvite {
  code: string
  user: { id: string; username: string; discriminator: string; avatar: string | null; status: string }
}

export const friendInviteApi = {
  get: (code: string) => http.get<FriendInvite>(path`/friend-invite/${code}`, { auth: false }),
  accept: (code: string) => http.post(path`/friend-invite/${code}/accept`),
}
