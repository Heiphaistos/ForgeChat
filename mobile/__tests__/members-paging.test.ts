// Membres d'un serveur : lecture de toutes les pages (GET /servers/:id/members?after=&limit=).
jest.mock('@/lib/http', () => ({
  http: { get: jest.fn() },
  path: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((acc, p, i) => acc + p + (i < v.length ? String(v[i]) : ''), ''),
}))
jest.mock('@/e2e/serverKey', () => ({ serverKeyForNewOwner: jest.fn() }))
jest.mock('@/e2e/accountKey', () => ({ passwordProof: jest.fn() }))

import { http } from '@/lib/http'
import { MEMBERS_PAGE, serversApi } from '@/api/servers'

const get = http.get as jest.Mock
const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ user_id: `u${from + i}`, username: `user${String(from + i).padStart(5, '0')}` }))

beforeEach(() => get.mockReset())

describe('membres paginés', () => {
  it('suit le curseur jusqu’à la page incomplète', async () => {
    get.mockResolvedValueOnce(page(0, MEMBERS_PAGE)).mockResolvedValueOnce(page(MEMBERS_PAGE, MEMBERS_PAGE)).mockResolvedValueOnce(page(2 * MEMBERS_PAGE, 3))
    const all = await serversApi.members('s1')
    expect(all).toHaveLength(2 * MEMBERS_PAGE + 3)
    expect(get).toHaveBeenCalledTimes(3)
    expect(get.mock.calls[0]).toEqual(['/servers/s1/members', { query: { limit: MEMBERS_PAGE, after: undefined } }])
    expect(get.mock.calls[1][1].query.after).toBe(`user${String(MEMBERS_PAGE - 1).padStart(5, '0')}`)
    expect(get.mock.calls[2][1].query.after).toBe(`user${String(2 * MEMBERS_PAGE - 1).padStart(5, '0')}`)
  })

  it('une seule requête pour un petit serveur ou une page vide', async () => {
    get.mockResolvedValueOnce(page(0, 2))
    expect(await serversApi.members('s1')).toHaveLength(2)
    get.mockResolvedValueOnce([])
    expect(await serversApi.members('s2')).toEqual([])
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('s’arrête si le serveur ignore le curseur (même page renvoyée)', async () => {
    get.mockResolvedValue(page(0, MEMBERS_PAGE))
    const all = await serversApi.members('s1')
    expect(get).toHaveBeenCalledTimes(2)
    expect(all).toHaveLength(2 * MEMBERS_PAGE)
  })
})
