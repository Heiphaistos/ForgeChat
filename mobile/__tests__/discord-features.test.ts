import { canSetVoiceStatus, cleanVoiceStatus, parseUnreadEvent, platformIcon, publicAccounts, unreadCounts, withDefaultReaction } from '@/features/servers/discordFeatures'
import { useUnread } from '@/stores/unread'

describe('non-lu (POST …/unread, READ_STATE_UPDATE)', () => {
  it('lit les compteurs de la réponse, refuse une forme fausse', () => {
    expect(unreadCounts({ ok: true, read_at: 'x', count: 3, mention_count: 1 })).toEqual({ count: 3, mentionCount: 1 })
    expect(unreadCounts({ count: -1, mention_count: 0 })).toBeNull()
    expect(unreadCounts({ count: 2 })).toBeNull()
    expect(unreadCounts(null)).toBeNull()
  })

  it('événement : seulement avec unread: true et un salon', () => {
    expect(parseUnreadEvent({ channel_id: 'c', server_id: 's', unread: true, count: 4, mention_count: 2 })).toEqual({ channelId: 'c', serverId: 's', count: 4, mentionCount: 2 })
    expect(parseUnreadEvent({ channel_id: 'd', server_id: null, unread: true, count: 1, mention_count: 1 })?.serverId).toBeNull()
    expect(parseUnreadEvent({ channel_id: 'c', count: 4, mention_count: 2 })).toBeNull()
    expect(parseUnreadEvent({ unread: true, count: 4, mention_count: 2 })).toBeNull()
    expect(parseUnreadEvent({ channel_id: 'c', unread: true, count: 1.5, mention_count: 0 })).toBeNull()
  })

  it('store : compteurs posés tels quels, même pour la conversation ouverte ; mentions des salons seulement', () => {
    const s = useUnread.getState()
    s.reset()
    s.setActive('c')
    s.setUnread('c', 5, 2, 'srv')
    s.setUnread('dm', 3, 3, null)
    let st = useUnread.getState()
    expect(st.counts).toEqual({ c: 5, dm: 3 })
    expect(st.mentions).toEqual({ c: 2 })
    expect(st.serverOf).toEqual({ c: 'srv' })
    s.setUnread('c', 0, 0)
    st = useUnread.getState()
    expect(st.counts).toEqual({ dm: 3 })
    expect(st.mentions).toEqual({})
    s.reset()
  })
})

describe('statut des salons vocaux', () => {
  it('une ligne, espaces resserrés, 500 caractères au plus', () => {
    expect(cleanVoiceStatus('  soirée\n\tjeux  ')).toBe('soirée jeux')
    expect(cleanVoiceStatus('   ')).toBe('')
    expect([...cleanVoiceStatus('é'.repeat(600))]).toHaveLength(500)
  })

  it('vocal ou scène ; connecté à CE salon ou droit de modifier', () => {
    expect(canSetVoiceStatus('voice', 'a', 'a', false)).toBe(true)
    expect(canSetVoiceStatus('stage', 'a', null, true)).toBe(true)
    expect(canSetVoiceStatus('voice', 'a', 'b', false)).toBe(false)
    expect(canSetVoiceStatus('text', 'a', 'a', true)).toBe(false)
  })
})

describe('forum : réaction par défaut', () => {
  const base = ['👍', '❤️', '😂'] as const
  it('en tête, sans doublon, même longueur', () => {
    expect(withDefaultReaction(base, '🔥')).toEqual(['🔥', '👍', '❤️'])
    expect(withDefaultReaction(base, '😂')).toEqual(['😂', '👍', '❤️'])
    expect(withDefaultReaction(base, ' ')).toBe(base)
    expect(withDefaultReaction(base, null)).toBe(base)
  })
})

describe('comptes connectés visibles', () => {
  it('forme vérifiée, lien https seulement', () => {
    expect(
      publicAccounts([
        { platform: 'github', platform_username: 'momo', platform_url: 'https://github.com/momo', verified: true },
        { platform: 'steam', platform_username: 'x', platform_url: 'javascript:alert(1)', verified: false },
        { platform: 'twitch', platform_username: '' },
        'nope',
      ]),
    ).toEqual([
      { platform: 'github', username: 'momo', url: 'https://github.com/momo', verified: true },
      { platform: 'steam', username: 'x', url: null, verified: false },
    ])
    expect(publicAccounts(undefined)).toEqual([])
  })

  it('icône de la plateforme, lien générique sinon', () => {
    expect(platformIcon('GitHub')).toBe('logo-github')
    expect(platformIcon('inconnu')).toBe('link-outline')
  })
})
