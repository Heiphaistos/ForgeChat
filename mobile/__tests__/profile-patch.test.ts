import { effectiveRing } from '@/components/avatarRingCore'
import { profileForm, profilePatch } from '@/features/account/profilePatch'
import { serverProfileChanges } from '@/features/servers/memberProfile'
import { fromHsl, toHsl } from '@/lib/nameStyle'
import type { User } from '@/types/models'

const user: User = {
  id: 'u1', username: 'bob', discriminator: '0001', avatar: null, banner: null, bio: 'ma bio', status: 'online', custom_status: null,
  display_name: 'Bob', profile_tag: 'CLAN', name_style: { colors: [0xff0000], angle: 90, effect: '', font: '' },
  profile_color_primary: 0x123456, avatar_ring: { colors: [1], width: 3, style: 'solid' },
}
const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

describe('PATCH /users/me : seulement les champs modifiés (audit M1)', () => {
  it('formulaire intact → corps vide (rien écrasé)', () => {
    expect(strip(profilePatch(user, profileForm(user)))).toEqual({})
  })
  it('un champ modifié → ce champ seul ; vidé → valeur de retrait', () => {
    const f = profileForm(user)
    expect(strip(profilePatch(user, { ...f, bio: '  autre ' }))).toEqual({ bio: 'autre' })
    expect(strip(profilePatch(user, { ...f, cosmetics: { ...f.cosmetics, primary: null } }))).toEqual({ profile_color_primary: -1 })
    expect(strip(profilePatch(user, { ...f, ring: null }))).toEqual({ avatar_ring: null })
    expect(strip(profilePatch(user, { ...f, nameStyle: { ...f.nameStyle, tag: { badge: 'neon' } } }))).toEqual({
      name_style: { colors: [0xff0000], angle: 90, effect: '', font: '', tag: { badge: 'neon' } },
    })
  })
  it('statut : renvoyé seulement s’il change ou si une durée est choisie', () => {
    const f = profileForm(user)
    expect(strip(profilePatch(user, { ...f, clearAfter: 60 }))).toEqual({ custom_status: '', custom_status_clear_after: 60 })
  })
})

describe('profil de serveur : seulement ce qui change (audit M11)', () => {
  const member = { nickname: 'Bobby', server_bio: null, server_avatar_ring: null, server_name_style: null }
  it('rien de changé → aucune requête', () => {
    expect(serverProfileChanges(member, { nick: 'Bobby', bio: '', ring: null, style: null })).toEqual({ profile: {} })
  })
  it('pseudo retiré, style propre, anneau', () => {
    const r = serverProfileChanges(member, { nick: ' ', bio: 'b', ring: { colors: [2], width: 3, style: 'solid' }, style: { colors: [1] } })
    expect(r.nickname).toBeNull()
    expect(r.profile).toEqual({ bio: 'b', avatar_ring: { colors: [2], width: 3, style: 'solid' }, name_style: { colors: [1], angle: 90, effect: '', font: '' } })
    // Style du compte de nouveau : {} efface le style propre.
    expect(serverProfileChanges({ ...member, server_name_style: { colors: [1] } }, { nick: 'Bobby', bio: '', ring: null, style: null }).profile).toEqual({ name_style: {} })
  })
})

describe('anneau effectif et couleur libre', () => {
  it('anneau du serveur, sinon global, sinon repli', () => {
    const g = { colors: [1], width: 3, style: 'solid' }
    expect(effectiveRing({ server_avatar_ring: { colors: [2] }, avatar_ring: g })?.colors).toEqual([2])
    expect(effectiveRing({ server_avatar_ring: null, avatar_ring: g })?.colors).toEqual([1])
    expect(effectiveRing(null, g)?.colors).toEqual([1])
    expect(effectiveRing(undefined)).toBeNull()
  })
  it('HSL aller-retour sur des couleurs franches', () => {
    for (const c of [0xff0000, 0x00ff00, 0x0000ff, 0x5865f2, 0xffffff, 0x000000]) expect(fromHsl(...toHsl(c))).toBe(c)
    expect(fromHsl(120, 1, 0.5)).toBe(0x00ff00)
    expect(fromHsl(-240, 1, 0.5)).toBe(0x00ff00)
  })
})
