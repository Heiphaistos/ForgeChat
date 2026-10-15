import { QueryClient } from '@tanstack/react-query'
import {
  activeTriggerQuery,
  encodeMentions,
  filterChannels,
  filterRoles,
  replaceQuery,
  specialMentions,
} from '@/features/chat/mentions'
import {
  messageLink,
  normalizeOg,
  normalizeReactionUsers,
  normalizeScheduled,
  scheduleDateError,
} from '@/features/chat/messageExtras'
import { pollBody } from '@/features/chat/polls'
import { cachedChannel, cachedRole, cachedUsername, roleColor } from '@/features/chat/tokens'
import { activeSlashQuery, normalizeBotCommands, runBuiltin, usableCommands } from '@/features/composer/commands'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('autocomplétion rôles, salons, @everyone', () => {
  it('détecte « # » en début de mot seulement', () => {
    expect(activeTriggerQuery('va dans #gen', 12, '#')).toEqual({ start: 8, query: 'gen' })
    expect(activeTriggerQuery('issue#12', 8, '#')).toBeNull()
    expect(activeTriggerQuery('@mod', 4, '#')).toBeNull()
  })
  it('rôles mentionnables hors @everyone, préfixe insensible à la casse', () => {
    const roles = [
      { id: A, name: 'Modo', color: 0, mentionable: true, is_everyone: false },
      { id: B, name: 'Modèle', color: 0, mentionable: false, is_everyone: false },
      { id: 'e', name: 'everyone', color: 0, mentionable: true, is_everyone: true },
    ]
    expect(filterRoles(roles, 'mo').map((r) => r.id)).toEqual([A])
    expect(specialMentions('e')).toEqual(['everyone'])
    expect(specialMentions('')).toEqual(['everyone', 'here'])
  })
  it('salons dont le nom contient la saisie', () => {
    expect(filterChannels([{ name: 'general' }, { name: 'off-topic' }, { name: 'aide-generale' }], 'gene').map((c) => c.name)).toEqual(['general', 'aide-generale'])
  })
  it('remplace la saisie et encode les rôles choisis à l’envoi', () => {
    expect(replaceQuery('salut @mo ça va', 6, 9, '@Modo Team')).toEqual({ text: 'salut @Modo Team ça va', cursor: 17 })
    const picked = new Map([
      ['Modo', `<@&${A}>`],
      ['Modo Team', `<@&${B}>`],
    ])
    expect(encodeMentions('@Modo Team et @Modo, pas mail@Modo ni @Modos', picked)).toBe(`<@&${B}> et <@&${A}>, pas mail@Modo ni @Modos`)
  })
})

describe('commandes « / »', () => {
  it('ne propose que pendant la saisie du nom', () => {
    expect(activeSlashQuery('/sh')).toBe('sh')
    expect(activeSlashQuery('/')).toBe('')
    expect(activeSlashQuery('/me danse')).toBeNull()
    expect(activeSlashQuery('a /sh')).toBeNull()
  })
  it('exécute les commandes intégrées comme le web', () => {
    expect(runBuiltin('/shrug')).toEqual({ send: '¯\\_(ツ)_/¯' })
    expect(runBuiltin('/me danse')).toEqual({ send: '*danse*' })
    expect(runBuiltin('/me')).toBeNull()
    expect(runBuiltin('/clap tu es top')).toEqual({ send: 'tu 👏 es 👏 top 👏' })
    expect(runBuiltin('/spoiler fin')).toEqual({ send: '||fin||' })
    expect(runBuiltin('/giphy chat')).toEqual({ gif: 'chat' })
    expect(runBuiltin('/meteo paris')).toBeNull()
    expect(runBuiltin('pas une /shrug')).toBeNull()
  })
  it('commandes du serveur : seules celles autorisées sont proposées (allowed calculé par le serveur)', () => {
    const list = normalizeBotCommands([
      { name: 'help', description: 'Aide', bot_name: 'ForgeBot', allowed: true, native: true },
      { name: 'ban', description: 'Bannir', bot_name: 'ForgeBot', allowed: false, native: true, dangerous: true },
      { name: 'ancien', description: 'Sans champ allowed', bot_name: 'Vieux' },
    ])
    expect(list.map((c) => c.name)).toEqual(['help', 'ban', 'ancien'])
    expect(usableCommands(list).map((c) => c.name)).toEqual(['help', 'ancien'])
    expect(list.find((c) => c.name === 'help')?.native).toBe(true)
  })
  it('commandes de bots : noms valides, sans doublon ni écrasement des intégrées', () => {
    expect(
      normalizeBotCommands([
        { name: 'Meteo', description: 'Météo', bot_name: 'Ciel' },
        { name: 'meteo', description: 'doublon', bot_name: 'X' },
        { name: 'shrug', description: 'pirate', bot_name: 'X' },
        { name: 'a b', description: 'invalide', bot_name: 'X' },
        null,
      ]),
    ).toEqual([{ name: 'meteo', description: 'Météo', bot: 'Ciel', allowed: true, native: false }])
    expect(normalizeBotCommands({})).toEqual([])
  })
})

describe('sondages', () => {
  it('valide comme polls.rs et calcule ends_at', () => {
    expect(pollBody('  ', ['a', 'b'], false, null)).toBe('La question est obligatoire.')
    expect(pollBody('Q', ['a', ' '], false, null)).toBe('Entre 2 et 10 options.')
    expect(pollBody('Q', ['a', 'A'], false, null)).toBe('Deux options sont identiques.')
    expect(pollBody('Q ?', [' oui ', 'non', ''], true, 2, 0)).toEqual({
      question: 'Q ?',
      options: ['oui', 'non'],
      multiple_choice: true,
      ends_at: new Date(2 * 3_600_000).toISOString(),
    })
    expect(pollBody('Q', ['a', 'b'], false, null)).not.toHaveProperty('ends_at')
  })
})

describe('extras de message', () => {
  it('lien au format du web', () => {
    expect(messageLink('https://chat.ex', { kind: 'channel', serverId: A, channelId: B }, 'm')).toBe(`https://chat.ex/servers/${A}/channels/${B}?highlight=m`)
    expect(messageLink('https://chat.ex', { kind: 'dm', dmId: A }, 'm')).toBe(`https://chat.ex/dms/${A}?highlight=m`)
    expect(messageLink('https://chat.ex', { kind: 'group', groupId: A }, 'm')).toBe(`https://chat.ex/dms/groups/${A}?highlight=m`)
  })
  it('qui a réagi : entrées invalides ignorées', () => {
    expect(normalizeReactionUsers({ users: [{ user_id: A.toUpperCase(), username: 'bob', avatar: null }, { user_id: 'x', username: 'y' }] })).toEqual([
      { id: A, username: 'bob', avatar: null },
    ])
    expect(normalizeReactionUsers(null)).toEqual([])
  })
  it('messages programmés : bornes du serveur', () => {
    const now = new Date(2026, 0, 1, 12, 0)
    expect(scheduleDateError(null, now)).toMatch(/Format/)
    expect(scheduleDateError(new Date(2026, 0, 1, 11, 0), now)).toMatch(/futur/)
    expect(scheduleDateError(new Date(2026, 1, 15), now)).toMatch(/30 jours/)
    expect(scheduleDateError(new Date(2026, 0, 2), now)).toBeNull()
    expect(normalizeScheduled([{ id: A, content: 'hey', send_at: '2026-01-02T00:00:00Z', sent: false }, { id: B, send_at: 'x', sent: true }])).toEqual([
      { id: A, content: 'hey', sendAt: '2026-01-02T00:00:00Z' },
    ])
  })
  it('aperçu de lien : rien sans titre ni description', () => {
    expect(normalizeOg({ title: ' ', description: null, url: 'https://a' }, 'https://a')).toBeNull()
    expect(normalizeOg({ title: 'T', site_name: 'S' }, 'https://a')).toEqual({ title: 'T', description: null, siteName: 'S', image: null, url: 'https://a' })
  })
})

describe('jetons résolus depuis le cache', () => {
  it('rôle, salon et pseudo', () => {
    const qc = new QueryClient()
    qc.setQueryData(['server', 's1'], {
      roles: [{ id: A, name: 'Modo', color: 0xff0000 }],
      channels: [{ id: B, name: 'general', type: 'text', server_id: 's1' }],
    })
    qc.setQueryData(['members', 's1'], [{ user_id: A, username: 'bob', nickname: 'Bobby' }])
    expect(cachedRole(qc, A)?.name).toBe('Modo')
    expect(cachedChannel(qc, B)?.name).toBe('general')
    expect(cachedUsername(qc, A)).toBe('Bobby')
    expect(cachedRole(qc, B)).toBeUndefined()
    expect(roleColor(0xff0000)).toBe('#ff0000')
    expect(roleColor(0)).toBeNull()
    qc.clear()
  })
})
