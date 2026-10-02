import { relationWith } from '@/features/friends/relation'
import type { Friend } from '@/types/models'

const f = (friend_id: string, status: Friend['status'], direction: Friend['direction']): Friend => ({
  id: `fs-${friend_id}`,
  friend_id,
  status,
  direction,
  username: friend_id,
  discriminator: '0001',
  avatar: null,
  user_status: 'online',
})

describe('relationWith', () => {
  it('inconnu → aucune relation (bouton « Ajouter en ami »)', () => {
    expect(relationWith('u1', [undefined, [], [f('u2', 'accepted', 'accepted')]])).toEqual({ kind: 'none' })
  })
  it('ami accepté → pas de bouton « Ajouter en ami »', () => {
    expect(relationWith('u1', [[], [f('u1', 'accepted', 'accepted')], []])).toEqual({ kind: 'friend' })
  })
  it('demandes en attente dans les deux sens', () => {
    expect(relationWith('u1', [[f('u1', 'pending', 'sent')]])).toEqual({ kind: 'sent', friendshipId: 'fs-u1' })
    expect(relationWith('u1', [[f('u1', 'pending', 'received')]])).toEqual({ kind: 'received', friendshipId: 'fs-u1' })
  })
  it('bloqué l’emporte', () => {
    expect(relationWith('u1', [[f('u1', 'blocked', 'blocked')], [f('u1', 'accepted', 'accepted')]])).toEqual({ kind: 'blocked' })
  })
})
