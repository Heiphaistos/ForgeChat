import { http, path } from '@/lib/http'
import type { ConversationSummary, GroupDetails } from '@/types/models'

export const dmsApi = {
  list: () => http.get<ConversationSummary[]>('/dms'),
  open: (userId: string) => http.post<{ dm_id: string }>(path`/dms/${userId}`),
  group: (groupId: string) => http.get<GroupDetails>(path`/dms/groups/${groupId}`),
  /** name null → le serveur nomme le groupe « Groupe ». */
  createGroup: (name: string | null, memberIds: string[]) =>
    http.post<{ id: string; name: string }>('/dms/group', { name: name ?? undefined, user_ids: memberIds }),
  leaveGroup: (groupId: string) => http.post(path`/dms/groups/${groupId}/leave`),
  addGroupMember: (groupId: string, userId: string) => http.post(path`/dms/groups/${groupId}/members`, { user_id: userId }),
  removeGroupMember: (groupId: string, userId: string) => http.delete(path`/dms/groups/${groupId}/members/${userId}`),
  renameGroup: (groupId: string, name: string) =>
    http.patch<{ ok: boolean; name: string }>(path`/dms/groups/${groupId}/rename`, { name }),
  setSettings: (dmId: string, settings: { muted?: boolean; archived?: boolean }) =>
    http.patch(path`/dms/${dmId}/settings`, settings),
}
