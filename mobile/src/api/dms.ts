import { http, path } from '@/lib/http'
import type { ConversationSummary, GroupDetails } from '@/types/models'

export const dmsApi = {
  list: () => http.get<ConversationSummary[]>('/dms'),
  open: (userId: string) => http.post<{ dm_id: string }>(path`/dms/${userId}`),
  group: (groupId: string) => http.get<GroupDetails>(path`/dms/groups/${groupId}`),
  createGroup: (name: string, memberIds: string[]) =>
    http.post<{ id: string; name: string }>('/dms/group', { name: name.trim(), user_ids: memberIds }),
  leaveGroup: (groupId: string) => http.post(path`/dms/groups/${groupId}/leave`),
  setSettings: (dmId: string, settings: { muted?: boolean; archived?: boolean }) =>
    http.patch(path`/dms/${dmId}/settings`, settings),
}
