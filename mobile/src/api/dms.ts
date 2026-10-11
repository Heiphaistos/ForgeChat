import { t } from '@/i18n'
import { http, path } from '@/lib/http'
import type { ConversationSummary, GroupDetails } from '@/types/models'

export const dmsApi = {
  /** Dernier message chiffré : le serveur n'a pas le texte, on l'indique simplement. */
  list: async () =>
    (await http.get<ConversationSummary[]>('/dms')).map((c) =>
      c.last_message_encrypted && c.last_message_content == null ? { ...c, last_message_content: `🔒 ${t('e2e.conv.encrypted')}` } : c),
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
  /** Propriétaire seulement ; la cible doit être membre du groupe. */
  transferGroupOwner: (groupId: string, userId: string) => http.patch(path`/dms/groups/${groupId}/owner`, { user_id: userId }),
  /**
   * `pinned`, `closed` et `mute_minutes` (15, 60, 180, 480, 1440, 0 = illimitée) : serveur avec la
   * branche ux-menus ; un serveur plus ancien les ignore (sourdine alors illimitée).
   */
  setSettings: (dmId: string, settings: { muted?: boolean; archived?: boolean; pinned?: boolean; closed?: boolean; mute_minutes?: number }) =>
    http.patch(path`/dms/${dmId}/settings`, settings),
}
