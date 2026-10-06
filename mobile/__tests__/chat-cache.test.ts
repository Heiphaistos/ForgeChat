import { fromDmMessage, fromGroupMessage, fromServerMessage } from '@/features/chat/adapters'
import {
  appendMessage,
  applyReactionDelta,
  applyReactionToggle,
  confirmMessage,
  flattenNewestFirst,
  mergeAttachments,
  messagesKey,
  removeMessage,
  type MessagesData,
} from '@/features/chat/cache'
import { queryClient } from '@/lib/queryClient'
import type { ChatMessage } from '@/types/models'

const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  content: id,
  createdAt: '2026-01-01T00:00:00Z',
  editedAt: null,
  authorId: 'a',
  authorName: 'A',
  authorAvatar: null,
  authorIsBot: false,
  reply: null,
  forwardedFrom: null,
  attachments: [],
  reactions: [],
  pinned: false,
  ...extra,
})

const seed = (pages: ChatMessage[][]) =>
  queryClient.setQueryData<MessagesData>(messagesKey('dm', 'c1'), { pages, pageParams: pages.map(() => undefined) })
const get = () => queryClient.getQueryData<MessagesData>(messagesKey('dm', 'c1'))!

describe('cache des messages', () => {
  beforeEach(() => queryClient.clear())
  // beforeEach() nettoie avant CHAQUE test mais pas après le dernier : le timer
  // de garbage-collection (~5 min, gcTime par défaut) de la dernière query créée
  // restait actif et empêchait Jest de sortir sans --forceExit.
  afterAll(() => queryClient.clear())

  it('ajoute sans doublon et aplatit du plus récent au plus ancien', () => {
    seed([[msg('3'), msg('4')], [msg('1'), msg('2')]])
    appendMessage('dm', 'c1', msg('5'))
    appendMessage('dm', 'c1', msg('5'))
    expect(flattenNewestFirst(get()).map((m) => m.id)).toEqual(['5', '4', '3', '2', '1'])
  })

  it('confirme un message optimiste, même si l’écho WS est arrivé avant', () => {
    seed([[msg('1'), msg('tmp-x', { pending: true })]])
    appendMessage('dm', 'c1', msg('real'))
    confirmMessage('dm', 'c1', 'tmp-x', msg('real'))
    expect(flattenNewestFirst(get()).map((m) => m.id)).toEqual(['real', '1'])
  })

  it('remplace le temporaire quand la réponse HTTP arrive en premier', () => {
    seed([[msg('tmp-y', { pending: true })]])
    confirmMessage('dm', 'c1', 'tmp-y', msg('real2'))
    expect(get().pages[0]!.map((m) => m.id)).toEqual(['real2'])
  })

  it('gère réactions (delta et toggle), pièces jointes et suppression', () => {
    seed([[msg('1')]])
    applyReactionDelta('dm', 'c1', '1', '👍', 1, true)
    applyReactionDelta('dm', 'c1', '1', '👍', 1, false)
    expect(get().pages[0]![0]!.reactions).toEqual([{ emoji: '👍', count: 2, me: true }])
    applyReactionToggle('dm', 'c1', '1', '👍', false, 1, true)
    expect(get().pages[0]![0]!.reactions).toEqual([{ emoji: '👍', count: 1, me: false }])
    applyReactionToggle('dm', 'c1', '1', '👍', false, 0, false)
    expect(get().pages[0]![0]!.reactions).toEqual([])
    mergeAttachments('dm', 'c1', '1', [{ id: 'f', url: '/uploads/f.png', filename: 'f.png', content_type: 'image/png', size: 1 }])
    mergeAttachments('dm', 'c1', '1', [{ id: 'f', url: '/uploads/f.png', filename: 'f.png', content_type: 'image/png', size: 1 }])
    expect(get().pages[0]![0]!.attachments).toHaveLength(1)
    removeMessage('dm', 'c1', '1')
    expect(flattenNewestFirst(get())).toEqual([])
  })
})

describe('adaptateurs de formats serveur', () => {
  it('normalise les 3 formats', () => {
    const s = fromServerMessage({
      id: '1', channel_id: 'c', content: 'hi', type: 'default', reply_to: 'r', reply_to_content: 'x', reply_to_username: 'bob',
      pinned: true, edited_at: null, created_at: 't', author_id: 'a', author_username: 'al', author_discriminator: '0001',
      author_avatar: null, author_is_bot: true, attachments: [], reactions: [],
    })
    expect(s).toMatchObject({ authorName: 'al', authorIsBot: true, pinned: true, reply: { id: 'r', authorName: 'bob' } })

    const d = fromDmMessage({
      id: '2', content: null, created_at: 't', sender_id: 's', sender_username: 'sam', sender_avatar: null,
      reply_to: { id: 'r2', content: 'yo', sender_id: 'x', sender_username: 'zed' },
    })
    expect(d).toMatchObject({ authorName: 'sam', reply: { id: 'r2', authorName: 'zed', content: 'yo' }, attachments: [], reactions: [] })

    const g = fromGroupMessage({ id: '3', content: 'g', created_at: 't', sender_id: 's', sender_username: 'sue', sender_avatar: null, reply_to: 'r3', reply_to_username: 'kim' })
    expect(g.reply).toEqual({ id: 'r3', authorName: 'kim', content: null })
  })
})
