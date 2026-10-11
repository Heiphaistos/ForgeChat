import { noticeFor, type NotifyContext } from '@/features/notifications/backgroundRules'
import { forumPostAlerts, resolveLevel, stillMuted } from '@/features/notifications/notifLevels'

/** Même hiérarchie que server/src/notify.rs (tests category_sits_between_channel_and_server). */
describe('resolveLevel', () => {
  it('salon > catégorie > serveur > défaut, « inherit » ignoré', () => {
    expect(resolveLevel()).toBe('mentions')
    expect(resolveLevel(undefined, undefined, undefined, 'all')).toBe('all')
    expect(resolveLevel(undefined, undefined, 'all')).toBe('all')
    expect(resolveLevel(undefined, 'nothing', 'all')).toBe('nothing')
    expect(resolveLevel('inherit', 'nothing', 'all')).toBe('nothing')
    expect(resolveLevel('all', 'nothing', 'mentions')).toBe('all')
    expect(resolveLevel('inherit', 'inherit', 'inherit', 'bizarre')).toBe('mentions')
  })

  it('posts de forum : forum en « tous », ou serveur qui les demande (sauf « rien »)', () => {
    expect(forumPostAlerts('all', false)).toBe(true)
    expect(forumPostAlerts('mentions', false)).toBe(false)
    expect(forumPostAlerts('mentions', true)).toBe(true)
    expect(forumPostAlerts('nothing', true)).toBe(false)
  })

  it('sourdine temporaire échue = plus muet', () => {
    expect(stillMuted(true, null)).toBe(true)
    expect(stillMuted(true, new Date(Date.now() + 60_000).toISOString())).toBe(true)
    expect(stillMuted(true, new Date(Date.now() - 60_000).toISOString())).toBe(false)
    expect(stillMuted(false, null)).toBe(false)
  })
})

describe('noticeFor : personne ignorée', () => {
  const ctx: NotifyContext = { myId: 'me', dnd: false, focus: false, quiet: false, preview: false, isMuted: () => false, groupName: () => null, isIgnored: (id) => id === 'bob' }
  it('ni MP ni mention de sa part', () => {
    expect(noticeFor({ type: 'DM_MESSAGE', dm_id: 'd1', message: { id: 'm', sender_id: 'bob', sender_username: 'bob', content: 'x' } }, ctx)).toBeNull()
    expect(noticeFor({ type: 'DM_MESSAGE', dm_id: 'd1', message: { id: 'm', sender_id: 'eve', sender_username: 'eve', content: 'x' } }, ctx)).not.toBeNull()
    expect(noticeFor({ type: 'MENTION_CREATE', notify: true, mention: { server_id: 's', channel_id: 'c', author_id: 'bob', content: 'x' } }, ctx)).toBeNull()
  })
})

describe('noticeFor FORUM_POST_CREATE', () => {
  const ME = '11111111-1111-1111-1111-111111111111'
  const ctx = (patch: Partial<NotifyContext> = {}): NotifyContext => ({
    myId: ME, dnd: false, focus: false, quiet: false, preview: false,
    isMuted: () => false, groupName: () => null,
    forumAlert: () => true, channelName: () => 'idees', ...patch,
  })
  const ev = (creator = 'bob') => ({ type: 'FORUM_POST_CREATE', server_id: 's1', channel_id: 'c1', post: { id: 'p1', title: 'Mon post', creator_id: creator } })

  it('alerte selon le centre de notifications, ouvre le post', () => {
    expect(noticeFor(ev(), ctx())).toEqual({ id: 'forum:p1', title: 'Nouveau post dans #idees', body: '', data: { kind: 'forum', server_id: 's1', channel_id: 'c1', post_id: 'p1' } })
    expect(noticeFor(ev(), ctx({ preview: true }))?.body).toBe('Mon post')
    expect(noticeFor(ev(), ctx({ forumAlert: () => false }))).toBeNull()
    expect(noticeFor(ev(ME), ctx())).toBeNull()
    expect(noticeFor(ev(), ctx({ dnd: true }))).toBeNull()
    expect(noticeFor(ev(), ctx({ quiet: true }))).toBeNull()
    expect(noticeFor(ev(), ctx({ isIgnored: (id) => id === 'bob' }))).toBeNull()
  })
})
