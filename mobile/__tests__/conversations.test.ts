import { applyConversationSettings, filterConversations } from '@/features/dms/conversations'
import type { ConversationSummary } from '@/types/models'

const dm = (id: string, username: string, archived = false, muted = false): ConversationSummary => ({
  id, is_group: false, other_user_id: 'u' + id, username, discriminator: '0001', avatar: null, status: 'online',
  last_message_at: null, last_message_content: null, is_muted: muted, is_archived: archived,
})
const group = (id: string, name: string, archived = false): ConversationSummary => ({
  id, is_group: true, name, member_count: 3, last_message_at: null, last_message_content: null, is_muted: false, is_archived: archived,
})
const list = [dm('1', 'alice'), dm('2', 'bob', true), group('3', 'Potes'), group('4', 'Anciens', true)]

describe('filterConversations', () => {
  it('masque les archivées et les compte', () => {
    const r = filterConversations(list, '', false)
    expect(r.items.map((c) => c.id)).toEqual(['1', '3'])
    expect(r.archivedCount).toBe(2)
  })
  it('vue archivées : seulement les archivées', () => {
    expect(filterConversations(list, '', true).items.map((c) => c.id)).toEqual(['2', '4'])
  })
  it('la recherche s’applique aux deux vues', () => {
    expect(filterConversations(list, 'BO', false)).toEqual({ items: [], archivedCount: 1 })
    expect(filterConversations(list, 'anc', true).items.map((c) => c.id)).toEqual(['4'])
  })
})

describe('applyConversationSettings', () => {
  it('ne modifie que la conversation visée et les champs fournis', () => {
    const out = applyConversationSettings(list, '1', { muted: true })
    expect(out[0]).toMatchObject({ is_muted: true, is_archived: false })
    expect(out[1]).toBe(list[1])
    expect(applyConversationSettings(list, '2', { archived: false })[1]).toMatchObject({ is_archived: false, is_muted: false })
  })
})
