import {
  addableFriends,
  canAddMember,
  canRemoveMember,
  groupCreateError,
  groupCreateIds,
  normalizeGroupName,
} from '@/features/groups/rules'
import type { Friend } from '@/types/models'

const ME = 'me'
const friend = (friend_id: string, direction: Friend['direction'] = 'accepted'): Friend => ({
  id: `f-${friend_id}`,
  friend_id,
  status: direction === 'accepted' ? 'accepted' : 'pending',
  direction,
  username: friend_id,
  discriminator: '0001',
  avatar: null,
  user_status: 'online',
})
const members = (...ids: string[]) => ids.map((id) => ({ id, username: id, discriminator: '0001', avatar: null, status: 'online' as const }))

describe('création de groupe', () => {
  it('retire les doublons et soi-même', () => {
    expect(groupCreateIds(['a', 'b', 'a', ME], ME)).toEqual(['a', 'b'])
  })

  it('exige 2 à 9 autres membres, comptés après nettoyage', () => {
    expect(groupCreateError(['a'], ME)).toMatch(/au moins 2/)
    expect(groupCreateError(['a', ME], ME)).toMatch(/au moins 2/) // le serveur accepterait [moi, a] : on refuse côté app
    expect(groupCreateError(['a', 'a'], ME)).toMatch(/au moins 2/)
    expect(groupCreateError(['a', 'b'], ME)).toBeNull()
    expect(groupCreateError('abcdefghi'.split(''), ME)).toBeNull()
    expect(groupCreateError('abcdefghij'.split(''), ME)).toMatch(/9 amis au maximum/)
  })
})

describe('nom de groupe', () => {
  it('trim et coupe à 64 caractères, vide → null', () => {
    expect(normalizeGroupName('  Potes  ')).toBe('Potes')
    expect(normalizeGroupName('   ')).toBeNull()
    expect(normalizeGroupName('x'.repeat(80))).toHaveLength(64)
  })

  it('ne coupe pas un emoji en deux', () => {
    const n = normalizeGroupName('a'.repeat(63) + '🎉🎉')
    expect(n).toBe('a'.repeat(63) + '🎉')
  })
})

describe('gestion des membres', () => {
  it('propose seulement les amis acceptés absents du groupe', () => {
    const list = [friend('a'), friend('b'), friend('c', 'received'), friend('d', 'sent')]
    expect(addableFriends(list, { members: members(ME, 'a') }).map((f) => f.friend_id)).toEqual(['b'])
  })

  it('bloque l’ajout à 10 membres', () => {
    expect(canAddMember({ members: members(...'abcdefghi'.split('')) })).toBe(true)
    expect(canAddMember({ members: members(...'abcdefghij'.split('')) })).toBe(false)
  })

  it('réserve l’exclusion au propriétaire, jamais sur lui-même', () => {
    expect(canRemoveMember({ owner_id: ME }, ME, 'a')).toBe(true)
    expect(canRemoveMember({ owner_id: ME }, ME, ME)).toBe(false)
    expect(canRemoveMember({ owner_id: 'a' }, ME, 'b')).toBe(false)
    expect(canRemoveMember({ owner_id: ME }, null, 'a')).toBe(false)
  })
})
