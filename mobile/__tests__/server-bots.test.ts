import { botsApi } from '@/api/bots'
import { botName, botToken, normalizeBots } from '@/features/servers/bots'
import { PERM, serverPerms, settingsSections } from '@/features/servers/perms'
import { http } from '@/lib/http'
import type { Role, ServerDetail } from '@/types/models'

jest.mock('@/lib/http', () => ({ ...jest.requireActual('@/lib/http'), http: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }))

const B = '9b1f4c2e-0d3a-4e5b-8c6d-7e8f9a0b1c2d'
const S = '3af17b11-1c9a-4daf-8895-a2d3eec03894'

describe('normalizeBots (bots.rs::list_bots)', () => {
  it('lit les bots, écarte les lignes invalides', () => {
    expect(
      normalizeBots([
        { token_id: S, bot_user_id: B.toUpperCase(), name: 'Alfred', username: 'AlfredBot', avatar: null, created_at: '2026-10-01T10:00:00Z' },
        { bot_user_id: 'x', name: 'Mauvais' },
        { bot_user_id: S },
      ]),
    ).toEqual([{ botUserId: B, name: 'Alfred', username: 'AlfredBot', createdAt: '2026-10-01T10:00:00Z' }])
    expect(normalizeBots(null)).toEqual([])
  })
})

describe('botName (create_bot : 1-32 octets)', () => {
  it('rogne, refuse le vide et plus de 32 octets UTF-8', () => {
    expect(botName('  Alfred ')).toBe('Alfred')
    expect(botName('   ')).toBeNull()
    expect(botName('a'.repeat(32))).toBe('a'.repeat(32))
    expect(botName('a'.repeat(33))).toBeNull()
    expect(botName('é'.repeat(16))).toBe('é'.repeat(16)) // 32 octets
    expect(botName('é'.repeat(17))).toBeNull() // 34 octets : le serveur refuserait
  })
})

describe('botToken', () => {
  it('lit le jeton, jamais une chaîne vide', () => {
    expect(botToken({ token: 'abc', warning: 'x' })).toBe('abc')
    expect(botToken({ token: '' })).toBeNull()
    expect(botToken(undefined)).toBeNull()
  })
})

describe('droits : rubrique Bots = MANAGE_SERVER', () => {
  const role = (permissions: number): Role => ({ id: 'r', server_id: 's', name: 'r', color: 0, permissions, position: 1, is_everyone: false } as Role)
  const detail = (permissions: number): ServerDetail =>
    ({ server: { id: 's', owner_id: 'o' }, roles: [role(permissions)], my_role_ids: ['r'], channels: [], categories: [] }) as unknown as ServerDetail
  it('visible avec MANAGE_SERVER, absente sinon', () => {
    expect(settingsSections(serverPerms(detail(PERM.MANAGE_SERVER), 'me'))).toContain('bots')
    expect(settingsSections(serverPerms(detail(PERM.KICK_MEMBERS), 'me'))).not.toContain('bots')
  })
})

describe('botsApi', () => {
  beforeEach(() => jest.clearAllMocks())
  it('utilise les routes /servers/:id/bots', async () => {
    ;(http.get as jest.Mock).mockResolvedValue([{ bot_user_id: B, name: 'A' }])
    expect((await botsApi.list(S))[0]?.botUserId).toBe(B)
    expect(http.get).toHaveBeenCalledWith(`/servers/${S}/bots`)
    await botsApi.create(S, 'A')
    expect(http.post).toHaveBeenCalledWith(`/servers/${S}/bots`, { name: 'A' })
    await botsApi.regenerate(S, B)
    expect(http.post).toHaveBeenCalledWith(`/servers/${S}/bots/${B}/token`)
    await botsApi.remove(S, B)
    expect(http.delete).toHaveBeenCalledWith(`/servers/${S}/bots/${B}`)
  })
})
