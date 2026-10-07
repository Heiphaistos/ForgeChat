import { normalizeSearch, searchQuery, withLocalResults } from '@/features/search/search'

const A = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const B = '5aa172f3-305c-4685-bd77-64faf6b911eb'
const C = '0b8f3c1e-2d4a-4e5f-9a6b-7c8d9e0f1a2b'
const AT = '2026-09-30T10:00:00Z'

describe('searchQuery', () => {
  it('exige 2 à 100 caractères après trim', () => {
    expect(searchQuery(' a ')).toBeNull()
    expect(searchQuery('  ab ')).toBe('ab')
    expect(searchQuery('x'.repeat(100))).toHaveLength(100)
    expect(searchQuery('x'.repeat(101))).toBeNull()
  })
})

describe('normalizeSearch', () => {
  it('lit les trois sections', () => {
    const r = normalizeSearch({
      messages: [{ id: A, content: 'salut', created_at: AT, author_username: 'bob', author_avatar: null, channel_name: 'général', channel_id: B, server_id: C }],
      users: [{ id: A.toUpperCase(), username: 'bob', avatar: null, status: 'online' }],
      channels: [{ id: B, name: 'général', type: 'text', server_id: C, server_name: 'Serveur' }],
    })
    expect(r.messages).toEqual([
      { id: A, content: 'salut', createdAt: AT, authorName: 'bob', authorAvatar: null, channelName: 'général', conversation: { kind: 'channel', serverId: C, channelId: B } },
    ])
    expect(r.users).toEqual([{ id: A, username: 'bob', avatar: null, status: 'online' }])
    expect(r.channels).toEqual([{ id: B, name: 'général', type: 'text', serverId: C, serverName: 'Serveur' }])
  })

  it('ignore les entrées aux identifiants invalides et les réponses mal formées', () => {
    const r = normalizeSearch({
      messages: [{ id: A, created_at: AT, channel_id: '../x', server_id: C }, null],
      users: [{ id: 'nope', username: 'x' }, { id: A }],
      channels: 'pas une liste',
    })
    expect(r).toEqual({ messages: [], users: [], channels: [] })
    expect(normalizeSearch(null)).toEqual({ messages: [], users: [], channels: [] })
  })
})

describe('withLocalResults (MP/groupe chiffré)', () => {
  const msg = (id: string, content: string, at: string, e2e?: 'ok' | 'locked') => ({
    id, content, createdAt: at, editedAt: null, authorId: A, authorName: 'bob', authorAvatar: null, authorIsBot: false,
    reply: null, forwardedFrom: null, attachments: [], reactions: [], pinned: false, e2e,
  })
  it('ajoute les messages déchiffrés qui correspondent, sans doublon ni message verrouillé', () => {
    const scope = { kind: 'dm' as const, dmId: B }
    const server = [{ id: C, content: 'salut ancien', createdAt: '2026-09-01T00:00:00Z', authorName: 'bob', authorAvatar: null, channelName: 'x', conversation: scope }]
    const cached = [
      msg(A, 'Salut chiffré', '2026-10-01T00:00:00Z', 'ok'),
      msg(C, 'salut ancien', '2026-09-01T00:00:00Z', 'ok'),
      msg('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'salut verrouillé', '2026-10-02T00:00:00Z', 'locked'),
      msg('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'autre chose', '2026-10-03T00:00:00Z', 'ok'),
    ]
    const r = withLocalResults(server, cached, 'SALUT', scope, 'ici')
    expect(r.map((m) => m.id)).toEqual([A, C])
    expect(r[0]!.conversation).toEqual(scope)
  })
})
