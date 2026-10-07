import { inQuietHours, keepConnectedEnabled, noticeFor, type NotifyContext } from '@/features/notifications/backgroundRules'

/** Mode « Notifications sans Google » : mêmes règles que le push serveur (notify.rs, mobile_push.rs). */
const ME = '11111111-1111-1111-1111-111111111111'
const BOB = '22222222-2222-2222-2222-222222222222'
const DM = '33333333-3333-3333-3333-333333333333'
const GROUP = '44444444-4444-4444-4444-444444444444'
const SERVER = '55555555-5555-5555-5555-555555555555'
const CHANNEL = '66666666-6666-6666-6666-666666666666'

const ctx = (patch: Partial<NotifyContext> = {}): NotifyContext => ({
  myId: ME,
  dnd: false,
  focus: false,
  quiet: false,
  preview: false,
  isMuted: () => false,
  groupName: () => 'Les potes',
  ...patch,
})
const dm = (sender = BOB, content: string | null = 'le code est 1234') => ({
  type: 'DM_MESSAGE',
  dm_id: DM,
  message: { id: 'm1', sender_id: sender, sender_username: 'bob', content },
})
const group = { type: 'GROUP_DM_MESSAGE', group_id: GROUP, message: { id: 'm2', sender_id: BOB, sender_username: 'bob', content: 'salut' } }
const mention = (notify: boolean) => ({
  type: 'MENTION_CREATE',
  notify,
  mention: { server_id: SERVER, server_name: 'Forge', channel_id: CHANNEL, channel_name: 'general', author_id: BOB, author_username: 'bob', content: `<@${ME}> regarde` },
})

describe('noticeFor', () => {
  it('message privé : sans aperçu par défaut, ouvre la conversation', () => {
    expect(noticeFor(dm(), ctx())).toEqual({ id: `msg:${DM}`, title: 'bob', body: 'Nouveau message privé', data: { kind: 'dm', dm_id: DM } })
    expect(noticeFor(dm(), ctx({ preview: true }))?.body).toBe('le code est 1234')
    expect(noticeFor(dm(BOB, null), ctx({ preview: true }))?.body).toBe('Pièce jointe')
  })

  it('jamais mes propres messages, ni sourdine, Ne pas déranger, mode focus ou heures calmes', () => {
    expect(noticeFor(dm(ME), ctx())).toBeNull()
    expect(noticeFor(dm(), ctx({ isMuted: (id) => id === DM }))).toBeNull()
    expect(noticeFor(dm(), ctx({ dnd: true }))).toBeNull()
    expect(noticeFor(dm(), ctx({ focus: true }))).toBeNull()
    expect(noticeFor(dm(), ctx({ quiet: true }))).toBeNull()
    expect(noticeFor(mention(true), ctx({ quiet: true }))).toBeNull()
  })

  it('groupe : nom du groupe en titre, regroupé par conversation', () => {
    expect(noticeFor(group, ctx())).toEqual({ id: `msg:${GROUP}`, title: 'Les potes', body: 'Nouveau message de bob', data: { kind: 'group', group_id: GROUP } })
    expect(noticeFor(group, ctx({ preview: true, groupName: () => null }))).toMatchObject({ title: 'Groupe', body: 'bob : salut' })
    expect(noticeFor(group, ctx({ isMuted: () => true }))).toBeNull()
  })

  it('salon : seulement les mentions que le serveur juge à notifier', () => {
    expect(noticeFor(mention(true), ctx())).toEqual({
      id: `msg:${CHANNEL}`,
      title: 'Forge · #general',
      body: "bob t'a mentionné",
      data: { kind: 'channel', server_id: SERVER, channel_id: CHANNEL },
    })
    expect(noticeFor(mention(true), ctx({ preview: true }))?.body).toBe('bob : @… regarde')
    expect(noticeFor(mention(false), ctx())).toBeNull()
    expect(noticeFor({ type: 'MESSAGE_CREATE', message: { channel_id: CHANNEL } }, ctx())).toBeNull()
  })

  it('données malformées ignorées, aperçu tronqué', () => {
    expect(noticeFor({ type: 'DM_MESSAGE', dm_id: DM, message: 'x' }, ctx())).toBeNull()
    expect(noticeFor({ type: 'DM_MESSAGE', message: dm().message }, ctx())).toBeNull()
    const long = noticeFor(dm(BOB, 'x'.repeat(300)), ctx({ preview: true }))
    expect(long?.body).toHaveLength(141)
  })
})

describe('inQuietHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m)
  it('plage simple et plage traversant minuit', () => {
    expect(inQuietHours('09:00:00', '17:00:00', at(12))).toBe(true)
    expect(inQuietHours('09:00', '17:00', at(17))).toBe(false)
    expect(inQuietHours('22:00', '08:00', at(23, 30))).toBe(true)
    expect(inQuietHours('22:00', '08:00', at(7, 59))).toBe(true)
    expect(inQuietHours('22:00', '08:00', at(12))).toBe(false)
    expect(inQuietHours(null, '08:00', at(3))).toBe(false)
  })
})

describe('keepConnectedEnabled (mode par défaut)', () => {
  it('actif sans jeton push, inactif avec ; le choix explicite prime', () => {
    expect(keepConnectedEnabled(null, false)).toBe(true)
    expect(keepConnectedEnabled(null, true)).toBe(false)
    expect(keepConnectedEnabled(undefined, false)).toBe(true)
    expect(keepConnectedEnabled(false, false)).toBe(false)
    expect(keepConnectedEnabled(true, true)).toBe(true)
  })
})
