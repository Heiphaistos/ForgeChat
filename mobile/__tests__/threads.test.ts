import { fromThreadMessage } from '@/features/chat/adapters'
import { createThreadBody, normalizeThreads, olderCursor, threadsByParent } from '@/features/chat/threads'

const T = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const P = '5aa172f3-305c-4685-bd77-64faf6b911eb'
const U = '9b1f4c2e-0d3a-4e5b-8c6d-7e8f9a0b1c2d'

describe('normalizeThreads', () => {
  it('lit threads.rs::list_threads et indexe par message d’origine', () => {
    const list = normalizeThreads([
      { id: T, parent_message_id: P, title: 'Sujet', message_count: 3, unread_count: 1, archived: false, locked: true },
      { id: U, parent_message_id: null, title: 'Libre', message_count: 1 },
      { id: 'x', parent_message_id: P },
    ])
    expect(list).toEqual([
      { id: T, parentMessageId: P, title: 'Sujet', messageCount: 3, unreadCount: 1, archived: false, locked: true },
      { id: U, parentMessageId: null, title: 'Libre', messageCount: 1, unreadCount: 0, archived: false, locked: false },
    ])
    const map = threadsByParent(list)
    expect(map.get(P)?.id).toBe(T)
    expect(map.size).toBe(1)
  })
})

describe('createThreadBody (threads.rs::CreateThreadReq)', () => {
  it('titre vide omis (le serveur prend le début du message), message obligatoire', () => {
    expect(createThreadBody('  ', ' Bonjour ', P)).toEqual({ title: undefined, first_message: 'Bonjour', parent_message_id: P })
    expect(createThreadBody('Titre', 'x', null)).toEqual({ title: 'Titre', first_message: 'x', parent_message_id: undefined })
    expect(createThreadBody('Titre', '   ', P)).toBeNull()
  })
})

describe('pagination', () => {
  it('curseur = plus ancien message d’une page pleine', () => {
    expect(olderCursor([{ id: 'a' }, { id: 'b' }], 2)).toBe('a')
    expect(olderCursor([{ id: 'a' }], 2)).toBeUndefined()
  })
})

describe('fromThreadMessage', () => {
  it('message de fil avec réponse citée', () => {
    const m = fromThreadMessage({
      id: T,
      thread_id: P,
      user_id: U,
      content: 'yo',
      reply_to: P,
      reply_to_content: 'avant',
      reply_to_username: 'bob',
      edited_at: null,
      created_at: '2026-10-01T10:00:00Z',
      author: { id: U, username: 'alice', avatar: null, discriminator: '0001' },
      reactions: [{ emoji: '👍', count: 1, me: true, users: ['alice'] }],
      attachments: [],
    })
    expect(m).toMatchObject({ id: T, authorId: U, authorName: 'alice', content: 'yo', reply: { id: P, authorName: 'bob', content: 'avant' } })
    expect(m?.reactions[0]).toMatchObject({ emoji: '👍', count: 1, me: true })
  })

  it('réponse de forum (sans champs de réponse) et entrées invalides', () => {
    expect(fromThreadMessage({ id: T, user_id: U, content: 'ok', created_at: '2026-10-01T10:00:00Z', author: { username: 'carol' } })).toMatchObject({
      authorId: U,
      authorName: 'carol',
      reply: null,
      attachments: [],
    })
    expect(fromThreadMessage({ id: T })).toBeNull()
    expect(fromThreadMessage('x')).toBeNull()
  })
})
