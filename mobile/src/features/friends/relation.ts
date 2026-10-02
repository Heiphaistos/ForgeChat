import type { Friend } from '@/types/models'

export type Relation =
  | { kind: 'none' }
  | { kind: 'friend' }
  | { kind: 'sent'; friendshipId: string }
  | { kind: 'received'; friendshipId: string }
  | { kind: 'blocked' }

/** Relation avec un utilisateur, d'après les listes d'amis (acceptés, en attente, bloqués). */
export function relationWith(userId: string, lists: readonly (readonly Friend[] | undefined)[]): Relation {
  for (const list of lists) {
    const f = list?.find((x) => x.friend_id === userId)
    if (!f) continue
    if (f.status === 'blocked' || f.direction === 'blocked') return { kind: 'blocked' }
    if (f.status === 'accepted') return { kind: 'friend' }
    if (f.direction === 'sent') return { kind: 'sent', friendshipId: f.id }
    if (f.direction === 'received') return { kind: 'received', friendshipId: f.id }
  }
  return { kind: 'none' }
}
