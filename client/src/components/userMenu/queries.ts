// Requêtes partagées par le menu utilisateur et les pages qui affichent les mêmes listes
// (mêmes clés de cache, même forme de données).
import api from '../../api/client'
import { t } from '../../i18n'

export interface DmRow {
  id: string
  is_group: boolean
  other_user_id?: string
  username?: string
  name?: string
  avatar?: string | null
  is_muted: boolean
  is_pinned?: boolean
  is_archived: boolean
  status?: string
  member_count?: number
  last_message_at?: string | null
  last_message_author?: string | null
  last_message_content?: string | null
  last_message_encrypted?: boolean
}

export interface FriendRowLite {
  id: string
  friend_id: string
  status: 'accepted' | 'pending'
  direction?: 'received' | 'sent'
  is_favorite?: boolean
}

/** Liste des conversations (barre latérale) ; le dernier message chiffré n'a pas de texte côté serveur. */
export const dmsQuery = {
  queryKey: ['dms'],
  queryFn: () => api.get<DmRow[]>('/dms').then(r => r.data.map(d =>
    d.last_message_encrypted && d.last_message_content == null ? { ...d, last_message_content: `🔒 ${t('e2e.conv.encrypted')}` } : d)),
  staleTime: 30_000,
}

export const friendsQuery = {
  queryKey: ['friends'],
  queryFn: () => api.get<{ friends: FriendRowLite[] }>('/friends/v2?filter=all').then(r => r.data),
  staleTime: 30_000,
}

export const blockedQuery = {
  queryKey: ['friends_blocked'],
  queryFn: () => api.get<{ id: string }[]>('/friends/blocked').then(r => r.data),
  staleTime: 30_000,
}

export const friendGroupsQuery = {
  queryKey: ['friend-groups'],
  queryFn: () => api.get<{ id: string; name: string; member_ids: string[] }[]>('/friends/groups').then(r => r.data),
  staleTime: 30_000,
}

export const serversQuery = {
  queryKey: ['servers'],
  queryFn: () => api.get<{ id: string; name: string; owner_id: string }[]>('/servers').then(r => r.data),
  staleTime: 30_000,
}
