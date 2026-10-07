// Mêmes règles que le web (client/scripts/searchQuery.test.mjs).
import { fold, isEmptyQuery, matches, parseQuery, type IndexedMsg } from '@/features/search/localQuery'
import { fromIndexed, mergeIndexed } from '@/features/search/search'

const msg: IndexedMsg = {
  id: 'm1', kind: 'channel', convId: 'c1', serverId: 's1', convName: 'Général', authorId: 'u1',
  authorName: 'Élodie', text: 'Rendez-vous à la Gare de Lyon demain', createdAt: '2026-10-07T10:00:00Z', hasFile: false,
}

describe('recherche locale', () => {
  it('filtres de:, dans:, a:fichier et leurs équivalents anglais', () => {
    expect(parseQuery('  gare  de:@elodie dans:#general a:fichier ')).toEqual({ terms: ['gare'], from: 'elodie', in: 'general', hasFile: true })
    expect(parseQuery('from:Bob in:Dev has:file')).toEqual({ terms: [], from: 'bob', in: 'dev', hasFile: true })
    expect(parseQuery('has:image before:2026-01-01 mot')).toEqual({ terms: ['mot'], from: null, in: null, hasFile: false })
    expect(isEmptyQuery(parseQuery('   '))).toBe(true)
    expect(fold('Été À ÇA')).toBe('ete a ca')
  })

  it('tous les mots, sans accents ni casse ; message échu exclu', () => {
    expect(matches(msg, parseQuery('gare lyon'))).toBe(true)
    expect(matches(msg, parseQuery('gare paris'))).toBe(false)
    expect(matches(msg, parseQuery('de:elo dans:gener'))).toBe(true)
    expect(matches(msg, parseQuery('a:fichier'))).toBe(false)
    expect(matches({ ...msg, hasFile: true }, parseQuery('a:fichier'))).toBe(true)
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(matches({ ...msg, expiresAt: '2026-10-07T11:59:59Z' }, parseQuery('gare'), now)).toBe(false)
  })

  it('résultats du serveur complétés par l’index (texte déchiffré, messages connus du seul index)', () => {
    const indexed = [fromIndexed(msg)!, fromIndexed({ ...msg, id: 'm2', createdAt: '2026-10-07T11:00:00Z' })!]
    expect(fromIndexed({ ...msg, serverId: null })).toBeNull()
    expect(indexed[0]!.conversation).toEqual({ kind: 'channel', serverId: 's1', channelId: 'c1' })
    const server = [{ ...indexed[0]!, content: null }]
    const merged = mergeIndexed(server, indexed)
    expect(merged.map((m) => m.id)).toEqual(['m2', 'm1'])
    expect(merged[1]!.content).toBe(msg.text)
  })
})
