import { activityApi } from '@/api/activity'
import { filterActivity, normalizeActivity } from '@/features/social/activityFeed'
import { http } from '@/lib/http'

jest.mock('@/lib/http', () => ({ ...jest.requireActual('@/lib/http'), http: { get: jest.fn() } }))

const U = '9b1f4c2e-0d3a-4e5b-8c6d-7e8f9a0b1c2d'
const S = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const C = '5aa172f3-305c-4685-bd77-64faf6b911eb'
const raw = [
  { id: 'a', type: 'server_join', actor: { id: U, username: 'ana' }, server: { id: S, name: 'Srv' }, timestamp: '2026-10-14T10:00:00Z' },
  { id: 'b', type: 'friend_join_server', actor: { id: U, username: 'bob', avatar: null }, server: { id: S, name: 'Srv' }, timestamp: '2026-10-14T09:00:00Z' },
  { id: 'c', type: 'message_pin', actor: { id: U, username: 'cid' }, server: { id: S, name: 'Srv' }, channel: { id: C, name: 'général' }, timestamp: '2026-10-14T08:00:00Z' },
  { id: 'd', type: 'achievement', actor: { id: U, username: 'x' }, timestamp: '2026-10-14T07:00:00Z' },
  { id: 'e', type: 'server_join', actor: { id: 'nope', username: 'x' }, timestamp: '2026-10-14T07:00:00Z' },
  { id: 'f', type: 'server_join', actor: { id: U, username: 'x' } },
]

describe('normalizeActivity (users.rs::get_activity_feed)', () => {
  it('garde les 3 types connus, écarte types inconnus et lignes incomplètes', () => {
    const items = normalizeActivity(raw)
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(items[2]).toMatchObject({ type: 'message_pin', actor: 'cid', actorId: U, serverId: S, channelId: C, channelName: 'général' })
    expect(items[0]?.channelId).toBeNull()
    expect(normalizeActivity({})).toEqual([])
  })
})

describe('filterActivity (mêmes filtres que le web)', () => {
  const items = normalizeActivity(raw)
  it('Amis = arrivées d’amis, Serveurs = arrivées + épingles, Tout = tout', () => {
    expect(filterActivity(items, 'friends').map((i) => i.id)).toEqual(['b'])
    expect(filterActivity(items, 'servers').map((i) => i.id)).toEqual(['a', 'c'])
    expect(filterActivity(items, 'all')).toHaveLength(3)
  })
})

describe('activityApi', () => {
  it('appelle /activity-feed?limit', async () => {
    ;(http.get as jest.Mock).mockResolvedValue(raw)
    expect(await activityApi.feed(30)).toHaveLength(3)
    expect(http.get).toHaveBeenCalledWith('/activity-feed', { query: { limit: 30 } })
  })
})
