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
}

export interface FriendInvite {
  code: string
  user: { id: string; username: string; discriminator: string; avatar: string | null; status: string }
}

export const friendInviteApi = {
  get: (code: string) => http.get<FriendInvite>(path`/friend-invite/${code}`, { auth: false }),
  accept: (code: string) => http.post(path`/friend-invite/${code}/accept`),
}
