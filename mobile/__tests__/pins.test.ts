import { conversationRefFromParams, normalizePins, pinsParams } from '@/features/chat/pins'

const M = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const P = '5aa172f3-305c-4685-bd77-64faf6b911eb'
const AT = '2026-09-30T10:00:00Z'

describe('normalizePins', () => {
  it('lit le format salon', () => {
    expect(normalizePins('channel', [{ id: M, content: 'hello', created_at: AT, author_username: 'alice', author_avatar: '/uploads/a.png' }])).toEqual([
      { messageId: M, content: 'hello', authorName: 'alice', authorAvatar: '/uploads/a.png', createdAt: AT },
    ])
  })

  it('lit le format DM (id du pin ≠ id du message)', () => {
    const raw = [{ id: P, message_id: M, pinned_at: AT, pinned_by: 'bob', message: { content: 'yo', sender_id: P, sender_name: 'bob', sender_avatar: null, created_at: AT } }]
    expect(normalizePins('dm', raw)).toEqual([{ messageId: M, content: 'yo', authorName: 'bob', authorAvatar: null, createdAt: AT }])
  })

  it('lit le format groupe', () => {
    expect(normalizePins('group', [{ id: M, content: null, created_at: AT, sender_id: P, sender_username: 'carol' }])).toEqual([
      { messageId: M, content: null, authorName: 'carol', authorAvatar: null, createdAt: AT },
    ])
  })

  it('normalise la casse et ignore les entrées invalides', () => {
    const raw = [
      { id: M.toUpperCase(), created_at: AT, author_username: 'a' },
      { id: 'pas-un-uuid', created_at: AT },
      { id: M }, // sans date
      null,
      'texte',
    ]
    expect(normalizePins('channel', raw).map((p) => p.messageId)).toEqual([M])
    expect(normalizePins('channel', { not: 'an array' })).toEqual([])
  })

  it('ne confond pas les formats : un pin DM lu comme salon est rejeté si id n’est pas un message', () => {
    expect(normalizePins('dm', [{ id: M, created_at: AT, content: 'x' }])).toEqual([])
  })
})

describe('conversationRefFromParams', () => {
  it('reconstruit chaque type et fait l’aller-retour avec pinsParams', () => {
    const refs = [
      { kind: 'channel', serverId: M, channelId: P },
      { kind: 'dm', dmId: M },
      { kind: 'group', groupId: P },
    ] as const
    for (const r of refs) expect(conversationRefFromParams(pinsParams(r))).toEqual(r)
  })

  it('refuse un type inconnu ou des identifiants invalides', () => {
    expect(conversationRefFromParams({ kind: 'server', serverId: M })).toBeNull()
    expect(conversationRefFromParams({ kind: 'channel', serverId: M })).toBeNull()
    expect(conversationRefFromParams({ kind: 'dm', dmId: '../settings' })).toBeNull()
    expect(conversationRefFromParams({})).toBeNull()
  })

  it('normalise la casse', () => {
    expect(conversationRefFromParams({ kind: 'dm', dmId: M.toUpperCase() })).toEqual({ kind: 'dm', dmId: M })
  })
})
