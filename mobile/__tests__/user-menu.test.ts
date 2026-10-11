import { buildConvMenu, buildUserMenu, pinnedFirst, stillClosed, type UserFacts } from '@/features/userMenu/model'

const facts = (patch: Partial<UserFacts> = {}): UserFacts => ({
  relation: 'none', favorite: false, ignored: false, dm: null, canInvite: true, volume: false, hasAvatar: true, ...patch,
})

describe('buildUserMenu', () => {
  it('inconnu : message, appel, note, invitation, ami, ignorer, bloquer', () => {
    expect(buildUserMenu(facts())).toEqual(['profile', 'message', 'call', 'note', 'invite', 'addFriend', 'ignore', 'block', 'viewAvatar', 'copyId'])
  })

  it('ami avec MP muet, en vocal : pseudo d’ami, volume, favori, réactiver', () => {
    const m = buildUserMenu(facts({ relation: 'friend', favorite: true, dm: { muted: true }, volume: true, ignored: true }))
    expect(m).toEqual(['profile', 'message', 'call', 'note', 'friendNick', 'volume', 'invite', 'removeFriend', 'unfavorite', 'unmute', 'unignore', 'block', 'viewAvatar', 'copyId'])
  })

  it('moi : profil et identifiant seulement ; bloqué : ni message ni appel ni invitation', () => {
    expect(buildUserMenu(facts({ relation: 'self', hasAvatar: false, volume: true }))).toEqual(['profile', 'copyId'])
    const blocked = buildUserMenu(facts({ relation: 'blocked' }))
    expect(blocked).not.toContain('message')
    expect(blocked).not.toContain('invite')
    expect(blocked).not.toContain('addFriend')
    expect(blocked).toContain('unblock')
  })

  it('demande reçue : accepter ; envoyée : rien à faire', () => {
    expect(buildUserMenu(facts({ relation: 'received' }))).toContain('acceptFriend')
    const sent = buildUserMenu(facts({ relation: 'sent' }))
    expect(sent.some((a) => a.endsWith('Friend'))).toBe(false)
  })
})

describe('buildConvMenu', () => {
  it('MP non lu ; groupe muet épinglé et archivé', () => {
    expect(buildConvMenu({ group: false, pinned: false, muted: false, archived: false, unread: true })).toEqual(['markRead', 'pin', 'archive', 'close', 'copyConvId'])
    expect(buildConvMenu({ group: true, pinned: true, muted: true, archived: true, unread: false })).toEqual(['unpin', 'unmuteGroup', 'unarchive', 'close', 'leave', 'copyConvId'])
  })

  it('épinglées en haut, ordre conservé ; fermée masquée jusqu’au prochain message', () => {
    expect(pinnedFirst(['a', 'b', 'c', 'd'], (x) => x === 'c' || x === 'd')).toEqual(['c', 'd', 'a', 'b'])
    const at = Date.parse('2026-10-01T10:00:00Z')
    expect(stillClosed(undefined, null)).toBe(false)
    expect(stillClosed(at, null)).toBe(true)
    expect(stillClosed(at, '2026-10-01T09:00:00Z')).toBe(true)
    expect(stillClosed(at, '2026-10-01T11:00:00Z')).toBe(false)
  })
})
