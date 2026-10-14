import { accountsApi } from '@/api/accounts'
import { PLATFORMS, addAccountBody, normalizeAccounts } from '@/features/account/connectedAccounts'
import { http } from '@/lib/http'

jest.mock('@/lib/http', () => ({ ...jest.requireActual('@/lib/http'), http: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }))

describe('normalizeAccounts (user_settings.rs::ConnectedAccount)', () => {
  it('lit les champs, ne garde que les liens http(s)', () => {
    expect(
      normalizeAccounts([
        { id: '1', platform: 'github', platform_username: 'momo', platform_url: 'https://github.com/momo', verified: true, visible: true },
        { id: '2', platform: 'steam', platform_username: 's', platform_url: 'javascript:alert(1)' },
        { id: '3', platform: 'x' },
        null,
      ]),
    ).toEqual([
      { id: '1', platform: 'github', username: 'momo', url: 'https://github.com/momo', verified: true, visible: true },
      { id: '2', platform: 'steam', username: 's', url: null, verified: false, visible: false },
    ])
    expect(normalizeAccounts(undefined)).toEqual([])
  })
})

describe('addAccountBody', () => {
  it('dérive l’URL du modèle (GitHub, Twitch, Reddit) sans « @ » ni « / » de tête', () => {
    expect(addAccountBody('github', ' momo ', '')).toEqual({ platform: 'github', platform_username: 'momo', platform_url: 'https://github.com/momo' })
    expect(addAccountBody('reddit', '@u', '')?.platform_url).toBe('https://reddit.com/user/u')
    expect(addAccountBody('steam', 'x', '')?.platform_url).toBeNull()
  })
  it('refuse pseudo vide et URL non http(s) ; garde l’URL saisie', () => {
    expect(addAccountBody('github', '  ', '')).toBeNull()
    expect(addAccountBody('github', 'a', 'javascript:alert(1)')).toBeNull()
    expect(addAccountBody('steam', 'a', 'https://steamcommunity.com/id/a')?.platform_url).toBe('https://steamcommunity.com/id/a')
  })
  it('10 plateformes, celles du serveur', () => {
    expect(PLATFORMS.map((p) => p.id).sort()).toEqual(['github', 'instagram', 'linkedin', 'reddit', 'spotify', 'steam', 'tiktok', 'twitch', 'twitter', 'youtube'])
  })
})

describe('accountsApi', () => {
  beforeEach(() => jest.clearAllMocks())
  it('utilise /user/connected-accounts', async () => {
    ;(http.get as jest.Mock).mockResolvedValue([{ id: '1', platform: 'github', platform_username: 'm' }])
    expect((await accountsApi.list())[0]?.platform).toBe('github')
    await accountsApi.add({ platform: 'github', platform_username: 'm', platform_url: null })
    expect(http.post).toHaveBeenCalledWith('/user/connected-accounts', { platform: 'github', platform_username: 'm', platform_url: null })
    await accountsApi.setVisible('github', true)
    expect(http.patch).toHaveBeenCalledWith('/user/connected-accounts/github', { visible: true })
    await accountsApi.remove('github')
    expect(http.delete).toHaveBeenCalledWith('/user/connected-accounts/github')
  })
})
