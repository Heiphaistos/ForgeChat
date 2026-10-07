// Recherche locale dans les messages déchiffrés : node --test scripts/searchQuery.test.mjs
// (mêmes règles que mobile/__tests__/local-search.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, isEmptyQuery, matches, parseQuery } from '../src/e2e/searchQuery.ts'

const msg = {
  id: 'm1', kind: 'channel', convId: 'c1', serverId: 's1', convName: 'Général', authorId: 'u1',
  authorName: 'Élodie', text: 'Rendez-vous à la Gare de Lyon demain', createdAt: '2026-10-07T10:00:00Z', hasFile: false,
}

test('filtres de:, dans:, a:fichier et leurs équivalents anglais', () => {
  assert.deepEqual(parseQuery('  gare  de:@elodie dans:#general a:fichier '), { terms: ['gare'], from: 'elodie', in: 'general', hasFile: true })
  assert.deepEqual(parseQuery('from:Bob in:Dev has:file'), { terms: [], from: 'bob', in: 'dev', hasFile: true })
  assert.deepEqual(parseQuery('has:image before:2026-01-01 mot'), { terms: ['mot'], from: null, in: null, hasFile: false })
  assert.equal(isEmptyQuery(parseQuery('   ')), true)
  assert.equal(fold('Été À ÇA'), 'ete a ca')
})

test('tous les mots, sans accents ni casse', () => {
  assert.equal(matches(msg, parseQuery('gare lyon')), true)
  assert.equal(matches(msg, parseQuery('GARE DEMAIN a')), true)
  assert.equal(matches(msg, parseQuery('gare paris')), false)
  assert.equal(matches(msg, parseQuery('de:elo')), true)
  assert.equal(matches(msg, parseQuery('de:bob gare')), false)
  assert.equal(matches(msg, parseQuery('dans:gener')), true)
  assert.equal(matches(msg, parseQuery('dans:random')), false)
  assert.equal(matches(msg, parseQuery('a:fichier')), false)
  assert.equal(matches({ ...msg, hasFile: true }, parseQuery('a:fichier')), true)
})

test('un message éphémère échu ne sort plus', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  assert.equal(matches({ ...msg, expiresAt: '2026-10-07T11:59:59Z' }, parseQuery('gare'), now), false)
  assert.equal(matches({ ...msg, expiresAt: '2026-10-07T12:00:01Z' }, parseQuery('gare'), now), true)
})
