import { adminApi, inviteLink } from '@/api/admin'
import { http } from '@/lib/http'

jest.mock('@/lib/http', () => {
  const actual = jest.requireActual('@/lib/http')
  return { ...actual, http: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }
})
const m = http as unknown as Record<'get' | 'post' | 'put' | 'delete', jest.Mock>

beforeEach(() => Object.values(m).forEach((f) => f.mockReset()))

describe('administration (rôle El Patron)', () => {
  it('le lien d’invitation pré-remplit le code, sans tirets ni double barre', () => {
    expect(inviteLink('https://chat.example.org/', 'ABCD-EFGH-JKMN')).toBe('https://chat.example.org/register?code=ABCDEFGHJKMN')
  })

  it('me() : admin et propriétaire reconnus, 403 = aucun accès', async () => {
    m.get.mockResolvedValueOnce({ admin: true, owner: true })
    await expect(adminApi.me()).resolves.toEqual({ admin: true, owner: true })
    m.get.mockResolvedValueOnce({ admin: true })
    await expect(adminApi.me()).resolves.toEqual({ admin: true, owner: false })
    m.get.mockRejectedValueOnce(new Error('403'))
    await expect(adminApi.me()).resolves.toEqual({ admin: false, owner: false })
  })

  it('les actions visent les bonnes routes du serveur', async () => {
    m.post.mockResolvedValue(undefined)
    m.put.mockResolvedValue(undefined)
    m.delete.mockResolvedValue(undefined)
    const id = '11111111-1111-1111-1111-111111111111'
    await adminApi.ban(id, '  spam  ')
    expect(m.post).toHaveBeenCalledWith(`/admin/users/${id}/ban`, { reason: 'spam' })
    await adminApi.unban(id)
    expect(m.delete).toHaveBeenCalledWith(`/admin/users/${id}/ban`)
    await adminApi.forceLogout(id)
    expect(m.post).toHaveBeenCalledWith(`/admin/users/${id}/logout`)
    await adminApi.setPatron(id, true)
    expect(m.put).toHaveBeenCalledWith(`/admin/users/${id}/patron`, { patron: true })
    await adminApi.setMode('closed')
    expect(m.put).toHaveBeenCalledWith('/admin/settings', { registration_mode: 'closed' })
  })

  it('supervision, suspension et suppression visent les routes /admin/servers', async () => {
    m.post.mockResolvedValue(undefined)
    m.delete.mockResolvedValue(undefined)
    const id = '22222222-2222-2222-2222-222222222222'
    await adminApi.supervise(id)
    expect(m.post).toHaveBeenCalledWith(`/admin/servers/${id}/supervise`)
    await adminApi.endSupervision(id)
    expect(m.delete).toHaveBeenCalledWith(`/admin/servers/${id}/supervise`)
    await adminApi.suspend(id, ' abus ')
    expect(m.post).toHaveBeenLastCalledWith(`/admin/servers/${id}/suspend`, { reason: 'abus' })
    await adminApi.unsuspend(id)
    expect(m.delete).toHaveBeenLastCalledWith(`/admin/servers/${id}/suspend`)
    await adminApi.deleteServer(id, 'secret')
    expect(m.delete).toHaveBeenLastCalledWith(`/admin/servers/${id}`, { body: { password: 'secret' } })
    m.get.mockResolvedValue({ total: 0, servers: [] })
    await adminApi.servers(' jotun ', 'supervised')
    expect(m.get).toHaveBeenLastCalledWith('/admin/servers', { query: { q: 'jotun', filter: 'supervised', limit: 100 } })
  })

  it('la liste des comptes envoie filtre et recherche (vide = absent)', async () => {
    m.get.mockResolvedValue({ total: 0, users: [] })
    await adminApi.users('  léa ', 'banned')
    expect(m.get).toHaveBeenLastCalledWith('/admin/users', { query: { q: 'léa', filter: 'banned', limit: 100 } })
    await adminApi.users('', 'all')
    expect(m.get).toHaveBeenLastCalledWith('/admin/users', { query: { q: undefined, filter: 'all', limit: 100 } })
  })

  it('une invitation sans expiration n’envoie pas de durée', async () => {
    m.post.mockResolvedValue({ code: 'X' })
    await adminApi.createInvite('  ', 2, 0)
    expect(m.post).toHaveBeenCalledWith('/admin/invites', { note: undefined, max_uses: 2, expires_in_days: undefined })
    await adminApi.createInvite('Léa', 1, 7)
    expect(m.post).toHaveBeenLastCalledWith('/admin/invites', { note: 'Léa', max_uses: 1, expires_in_days: 7 })
  })
})
