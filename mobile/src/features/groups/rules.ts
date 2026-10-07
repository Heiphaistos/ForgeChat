import { t } from '@/i18n'
import type { Friend, GroupDetails } from '@/types/models'

/** Bornes de handlers/group_dms.rs : 2 à 9 autres membres à la création, 10 membres au total. */
export const GROUP_MIN_OTHERS = 2
export const GROUP_MAX_OTHERS = 9
export const GROUP_MAX_MEMBERS = 10
export const GROUP_NAME_MAX = 64

/** Membres à envoyer à POST /dms/group : sans doublon ni soi-même. */
export function groupCreateIds(selected: readonly string[], myId: string | null): string[] {
  return [...new Set(selected)].filter((id) => id !== myId)
}

/** Message d'erreur si la sélection ne passera pas côté serveur, sinon null. */
export function groupCreateError(selected: readonly string[], myId: string | null): string | null {
  const n = groupCreateIds(selected, myId).length
  if (n < GROUP_MIN_OTHERS) return t('social.group.errMin', { n: GROUP_MIN_OTHERS })
  if (n > GROUP_MAX_OTHERS) return t('social.group.errMax', { n: GROUP_MAX_OTHERS })
  return null
}

/** Nom normalisé comme le serveur (trim, 64 caractères). Vide → null (le serveur met « Groupe »). */
export function normalizeGroupName(name: string): string | null {
  const n = [...name.trim()].slice(0, GROUP_NAME_MAX).join('')
  return n || null
}

/** Amis acceptés qui ne sont pas déjà dans le groupe. */
export function addableFriends(friends: readonly Friend[], group: Pick<GroupDetails, 'members'>): Friend[] {
  const inGroup = new Set(group.members.map((m) => m.id))
  return friends.filter((f) => f.direction === 'accepted' && !inGroup.has(f.friend_id))
}

export const canAddMember = (group: Pick<GroupDetails, 'members'>) => group.members.length < GROUP_MAX_MEMBERS

/** Seul le propriétaire exclut, et jamais lui-même (il passe par « Quitter »). */
export const canRemoveMember = (group: Pick<GroupDetails, 'owner_id'>, myId: string | null, targetId: string) =>
  myId !== null && group.owner_id === myId && targetId !== myId
