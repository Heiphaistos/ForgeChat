import {
  formatReminderInput,
  normalizeEdits,
  normalizeSaved,
  parseReminderInput,
  reminderPresets,
  savedBody,
  savedConversation,
  supportsMessageExtras,
} from '@/features/chat/messageExtras'
import type { ChatMessage } from '@/types/models'

const S = '3af17b11-1c9a-4daf-8895-a2d3eec03894'
const C = '5aa172f3-305c-4685-bd77-64faf6b911eb'
const M = '9b1f4c2e-0d3a-4e5b-8c6d-7e8f9a0b1c2d'

const msg = { id: M, content: 'salut', authorName: 'alice', authorAvatar: null } as ChatMessage

describe('savedBody', () => {
  it('salon : server_id et channel_id du salon', () => {
    expect(savedBody({ kind: 'channel', serverId: S, channelId: C }, msg)).toEqual({
      message_id: M,
      channel_id: C,
      server_id: S,
      content: 'salut',
      author_username: 'alice',
      author_avatar: null,
    })
  })

  it('DM : channel_id = id du DM, server_id null (jamais "")', () => {
    expect(savedBody({ kind: 'dm', dmId: C }, msg)).toMatchObject({ channel_id: C, server_id: null })
  })

  it('groupes non pris en charge par le serveur', () => {
    expect(supportsMessageExtras({ kind: 'group', groupId: C })).toBe(false)
    expect(supportsMessageExtras({ kind: 'dm', dmId: C })).toBe(true)
    expect(() => savedBody({ kind: 'group', groupId: C }, msg)).toThrow()
  })
})

describe('normalizeSaved', () => {
  it('lit saved.rs::SavedMessage et retrouve la conversation', () => {
    const [a, b] = normalizeSaved([
      { message_id: M, channel_id: C, server_id: S, content: 'x', author_username: 'bob', created_at: '2026-10-01T10:00:00Z', channel_name: 'général', server_name: 'Forge', attachments: [] },
      { message_id: M.toUpperCase(), channel_id: C, server_id: null, saved_at: '2026-10-02T10:00:00Z' },
    ])
    expect(a).toMatchObject({ messageId: M, serverId: S, channelName: 'général', authorName: 'bob' })
    expect(savedConversation(a!)).toEqual({ kind: 'channel', serverId: S, channelId: C })
    expect(b).toMatchObject({ messageId: M, serverId: null, authorName: 'Inconnu', createdAt: '2026-10-02T10:00:00Z' })
    expect(savedConversation(b!)).toEqual({ kind: 'dm', dmId: C })
  })

  it('ignore les entrées invalides', () => {
    expect(normalizeSaved([{ message_id: 'x', channel_id: C }, null, { message_id: M, channel_id: C, server_id: 'pas-un-uuid' }])).toEqual([])
    expect(normalizeSaved({})).toEqual([])
  })
})

describe('rappels', () => {
  const now = new Date(2026, 9, 7, 22, 30, 0) // 7 octobre 2026, 22 h 30 (heure locale)

  it('choix rapides : 20 min, 1 h, 3 h, demain 9 h', () => {
    const [m20, h1, h3, tomorrow] = reminderPresets(now).map((p) => p.date)
    expect(m20!.getTime() - now.getTime()).toBe(20 * 60_000)
    expect(h1!.getTime() - now.getTime()).toBe(3_600_000)
    expect(h3!.getTime() - now.getTime()).toBe(3 * 3_600_000)
    expect(formatReminderInput(tomorrow!)).toBe('08/10/2026 09:00')
  })

  it('demain 9 h en fin de mois et d’année', () => {
    const tomorrow = reminderPresets(new Date(2026, 11, 31, 23, 0))[3]!.date
    expect(formatReminderInput(tomorrow)).toBe('01/01/2027 09:00')
  })

  it('lit JJ/MM/AAAA HH:MM dans le futur', () => {
    expect(parseReminderInput('08/10/2026 09:15', now)?.getTime()).toBe(new Date(2026, 9, 8, 9, 15).getTime())
    expect(parseReminderInput(' 8/10/2026 9h05 ', now)?.getTime()).toBe(new Date(2026, 9, 8, 9, 5).getTime())
  })

  it('refuse le passé, les dates inexistantes et les formats faux', () => {
    expect(parseReminderInput('07/10/2026 22:30', now)).toBeNull()
    expect(parseReminderInput('31/02/2027 10:00', now)).toBeNull()
    expect(parseReminderInput('10/10/2026 24:00', now)).toBeNull()
    expect(parseReminderInput('2026-10-10 10:00', now)).toBeNull()
    expect(parseReminderInput('', now)).toBeNull()
  })

  it('aller-retour format → lecture', () => {
    const d = new Date(2027, 0, 2, 7, 4)
    expect(parseReminderInput(formatReminderInput(d), now)?.getTime()).toBe(d.getTime())
  })
})

describe('normalizeEdits', () => {
  it('garde content (peut être null) et edited_at', () => {
    expect(normalizeEdits([{ content: 'v1', edited_at: '2026-10-01T10:00:00Z' }, { content: null, edited_at: 'x' }, { content: 'sans date' }])).toEqual([
      { content: 'v1', editedAt: '2026-10-01T10:00:00Z' },
      { content: null, editedAt: 'x' },
    ])
  })
})
