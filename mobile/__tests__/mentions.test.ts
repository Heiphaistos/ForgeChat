import { activeMentionQuery, applyMention, filterMentionCandidates, mentionToken, type MentionCandidate } from '@/features/chat/mentions'

const U = (id: string, username: string, nickname?: string): MentionCandidate => ({ id, username, nickname, avatar: null })
const ID = '3af17b11-1c9a-4daf-8895-a2d3eec03894'

describe('activeMentionQuery', () => {
  it('détecte « @ » en début de texte ou après un espace', () => {
    expect(activeMentionQuery('@al', 3)).toEqual({ start: 0, query: 'al' })
    expect(activeMentionQuery('salut @Al', 9)).toEqual({ start: 6, query: 'Al' })
    expect(activeMentionQuery('salut @', 7)).toEqual({ start: 6, query: '' })
    expect(activeMentionQuery('ligne\n@zo', 9)).toEqual({ start: 6, query: 'zo' })
  })

  it('tient compte du curseur, pas de la fin du texte', () => {
    expect(activeMentionQuery('@ali et la suite', 4)).toEqual({ start: 0, query: 'ali' })
    expect(activeMentionQuery('@ali et la suite', 10)).toBeNull()
  })

  it('ignore les adresses e-mail et les « @ » déjà suivis d’un espace', () => {
    expect(activeMentionQuery('moi@exemple', 11)).toBeNull()
    expect(activeMentionQuery('@ali ', 5)).toBeNull()
    expect(activeMentionQuery('', 0)).toBeNull()
  })

  it('accepte les lettres accentuées dans la saisie', () => {
    expect(activeMentionQuery('@élo', 4)).toEqual({ start: 0, query: 'élo' })
  })
})

describe('filterMentionCandidates', () => {
  const list = [U('1', 'bob'), U('2', 'alice'), U('3', 'Albert'), U('me', 'alfred'), U('4', 'zoe', 'Alma'), U('5', 'malo'), U('2', 'alice')]

  it('met les préfixes avant les contenus, exclut moi et les doublons', () => {
    expect(filterMentionCandidates(list, 'al', 'me').map((c) => c.username)).toEqual(['Albert', 'alice', 'zoe', 'malo'])
  })

  it('saisie vide : tout le monde sauf moi, borné', () => {
    expect(filterMentionCandidates(list, '', 'me', 3)).toHaveLength(3)
    expect(filterMentionCandidates(list, '', 'me').some((c) => c.id === 'me')).toBe(false)
  })
})

describe('insertion', () => {
  it('insère @pseudo quand le serveur le reconnaît, sinon <@id>', () => {
    expect(mentionToken({ id: ID, username: 'alice_42' })).toBe('@alice_42')
    expect(mentionToken({ id: ID, username: 'Élodie' })).toBe(`<@${ID}>`)
    expect(mentionToken({ id: ID, username: 'a' })).toBe(`<@${ID}>`)
    expect(mentionToken({ id: ID, username: 'jean.dupont' })).toBe(`<@${ID}>`)
  })

  it('remplace la saisie et place le curseur après l’espace', () => {
    expect(applyMention('salut @al', 6, 9, { id: ID, username: 'alice' })).toEqual({ text: 'salut @alice ', cursor: 13 })
    expect(applyMention('@al ça va', 0, 3, { id: ID, username: 'alice' })).toEqual({ text: '@alice ça va', cursor: 7 })
  })
})
