import { buildConvMenu, buildUserMenu, pinnedFirst, stillClosed, type ModFacts, type UserFacts } from '@/features/userMenu/model'

const facts = (patch: Partial<UserFacts> = {}): UserFacts => ({
  relation: 'none', favorite: false, ignored: false, dm: null, canInvite: true, volume: false, hasAvatar: true, ...patch,
})

describe('buildUserMenu', () => {
  it('inconnu : message, appel, note, invitation, ami, ignorer, bloquer', () => {
    expect(buildUserMenu(facts())).toEqual(['profile', 'message', 'call', 'note', 'safetyCode', 'invite', 'addFriend', 'ignore', 'block', 'viewAvatar', 'copyId'])
  })

  it('ami avec MP muet, en vocal : pseudo d’ami, volume, favori, réactiver', () => {
    const m = buildUserMenu(facts({ relation: 'friend', favorite: true, dm: { muted: true }, volume: true, ignored: true }))
    expect(m).toEqual([
      'profile', 'message', 'call', 'note', 'friendNick', 'volume', 'voiceMute', 'soundboardMute', 'videoOff', 'safetyCode',
      'invite', 'removeFriend', 'unfavorite', 'unmute', 'unignore', 'block', 'viewAvatar', 'copyId',
    ])
  })

  it('moi : profil et identifiant seulement ; bloqué : ni message ni appel ni invitation', () => {
    expect(buildUserMenu(facts({ relation: 'self', hasAvatar: false, volume: true }))).toEqual(['profile', 'copyId'])
    const blocked = buildUserMenu(facts({ relation: 'blocked' }))
    expect(blocked).not.toContain('message')
    expect(blocked).not.toContain('invite')
    expect(blocked).not.toContain('addFriend')
    expect(blocked).toContain('unblock')
  })

  const allMod: ModFacts = { roles: true, move: true, mute: true, deafen: true, inVoice: true, kick: true, ban: true, timeout: true, nickname: true }

  it('modération : après le blocage, dans l’ordre de Discord ; déplacer / déconnecter seulement en vocal', () => {
    const m = buildUserMenu(facts({ volume: true, mod: allMod }))
    expect(m.slice(m.indexOf('block') + 1)).toEqual(['roles', 'moveTo', 'serverMute', 'serverDeafen', 'disconnect', 'kick', 'ban', 'timeout', 'viewAvatar', 'copyId'])
    const away = buildUserMenu(facts({ mod: { ...allMod, inVoice: false } }))
    expect(away).not.toContain('moveTo')
    expect(away).not.toContain('disconnect')
    expect(away).toContain('serverMute')
    expect(buildUserMenu(facts({ mod: null }))).not.toContain('kick')
    // « Changer le pseudo » juste après le code de vérification, comme le web.
    expect(m[m.indexOf('safetyCode') + 1]).toBe('nickname')
    expect(buildUserMenu(facts({ mod: { ...allMod, nickname: false } }))).not.toContain('nickname')
  })

  it('moi en vocal : ni volume ni réglages locaux, mais muet serveur permis ; jamais m’expulser', () => {
    expect(buildUserMenu(facts({ relation: 'self', volume: true, hasAvatar: false, mod: allMod }))).toEqual([
      'profile', 'nickname', 'roles', 'moveTo', 'serverMute', 'serverDeafen', 'disconnect', 'copyId',
    ])
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
