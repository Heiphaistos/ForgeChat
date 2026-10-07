import { shownProfile, userRoute } from '@/features/servers/memberProfile'

const user = { username: 'bob', avatar: '/uploads/a.png', banner: '/uploads/b.png', bio: 'compte' }

describe('profil par serveur', () => {
  it('le profil du serveur l’emporte, sinon celui du compte', () => {
    expect(shownProfile(user, { nickname: 'Bobby', avatar: '/uploads/s.png', server_banner: null, server_bio: 'serveur' })).toEqual({
      name: 'Bobby',
      avatar: '/uploads/s.png',
      banner: '/uploads/b.png',
      bio: 'serveur',
    })
    expect(shownProfile(user, null)).toEqual({ name: 'bob', avatar: '/uploads/a.png', banner: '/uploads/b.png', bio: 'compte' })
  })

  it('route de fiche avec ou sans serveur', () => {
    expect(userRoute('u1')).toBe('/user/u1')
    expect(userRoute('u1', 's1')).toBe('/user/u1?serverId=s1')
  })
})
