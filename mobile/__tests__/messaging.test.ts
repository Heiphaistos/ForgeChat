import {
  autoThreadTitle, DISAPPEAR_CHOICES, disappearChoice, disappearChoices, normalizeScheduledAll, normalizeVoters, parseDisappear,
} from '@/features/chat/messaging'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

describe('messages éphémères', () => {
  it('durées du serveur (disappearing.rs) ; « après lecture » hors salons', () => {
    expect(DISAPPEAR_CHOICES.map((c) => c.value)).toEqual([null, 3600, 86_400, 604_800, 0])
    expect(disappearChoices('channel').some((c) => c.value === 0)).toBe(false)
    expect(disappearChoices('dm').some((c) => c.value === 0)).toBe(true)
    expect(parseDisappear(86_400)).toBe(86_400)
    expect(parseDisappear(0)).toBe(0)
    expect(parseDisappear(42)).toBeNull()
    expect(parseDisappear('3600')).toBeNull()
    expect(disappearChoice(undefined).value).toBeNull()
  })
})

describe('messages programmés', () => {
  it('entrées valides seulement, triées par date, texte verrouillé signalé', () => {
    const list = normalizeScheduledAll([
      { id: A, channel_id: B, server_id: C, send_at: '2026-10-09T10:00:00Z', content: 'plus tard', channel_name: 'general', server_name: 'Forge', client_msg_id: A },
      { id: B, channel_id: B, server_id: C, send_at: '2026-10-08T10:00:00Z', content: '…', e2e: 'locked' },
      { id: 'pas-un-uuid', channel_id: B, server_id: C, send_at: '2026-10-08T10:00:00Z' },
      'texte',
    ])
    expect(list.map((s) => s.id)).toEqual([B, A])
    expect(list[0]!.locked).toBe(true)
    expect(list[1]).toMatchObject({ content: 'plus tard', channelName: 'general', serverName: 'Forge', clientMsgId: A, locked: false })
    expect(normalizeScheduledAll(null)).toEqual([])
  })
})

describe('sondages', () => {
  it('votants par option, entrées invalides ignorées', () => {
    expect(normalizeVoters({ [A]: [{ id: B, username: 'bob' }, { id: C }], nope: [{ username: 'x' }] })).toEqual({ [A]: ['bob'] })
    expect(normalizeVoters([])).toEqual({})
  })
})

describe('fils automatiques', () => {
  it('titre = début du message sur une ligne, sinon texte par défaut', () => {
    expect(autoThreadTitle('  Salut\n  tout   le monde ', 'Fil')).toBe('Salut tout le monde')
    expect(autoThreadTitle('x'.repeat(200), 'Fil')).toHaveLength(80)
    expect(autoThreadTitle('', 'Fil')).toBe('Fil')
    expect(autoThreadTitle(null, 'Fil')).toBe('Fil')
  })
})
