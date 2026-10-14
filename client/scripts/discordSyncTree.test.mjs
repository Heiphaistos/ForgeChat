// Arbre de la synchro Discord : node --test scripts/discordSyncTree.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  initialSelection, categoryState, toggleCategory, toggleChannel, selectAll, selectNone,
  invertSelection, counts, filterTree, toPayload,
} from '../src/lib/discordSyncTree.ts'
import * as dict from '../src/i18n/parts/discordSync.ts'

const ch = (id, name, selected = true, kind = 'text') => ({ id, name, kind, selected })
const tree = {
  categories: [
    { id: 'c1', name: '📢 Annonces', selected: true, channels: [ch('a', 'général'), ch('b', 'règles', false), ch('f', 'forum', true, 'forum')] },
    { id: 'c2', name: 'Vocal', selected: false, channels: [ch('v', 'salon vocal', false, 'voice')] },
    { id: 'c3', name: 'Vide', selected: true, channels: [] },
  ],
  uncategorized: [ch('u', 'libre')],
}

test('sélection initiale et états', () => {
  const sel = initialSelection(tree)
  assert.deepEqual([...sel].sort(), ['a', 'c1', 'c3', 'f', 'u'])
  assert.equal(categoryState(tree.categories[0], sel), 'some')
  assert.equal(categoryState(tree.categories[1], sel), 'none')
  assert.equal(categoryState(tree.categories[2], sel), 'all')
})

test('catégorie coche / décoche ses salons ; salon met la catégorie à jour', () => {
  const on = toggleCategory(tree.categories[1], new Set(), true)
  assert.deepEqual([...on].sort(), ['c2', 'v'])
  assert.equal(toggleCategory(tree.categories[1], on, false).size, 0)
  const one = toggleChannel(tree.categories[1], 'v', new Set(), true)
  assert.ok(one.has('c2'))
  assert.ok(!toggleChannel(tree.categories[1], 'v', one, false).has('c2'))
  assert.ok(toggleChannel(null, 'u', new Set(), true).has('u'))
})

test('tout / rien / inverser / compteur', () => {
  assert.equal(selectAll(tree).size, 8)
  assert.equal(selectNone().size, 0)
  assert.deepEqual(counts(tree, selectAll(tree)), { selected: 8, total: 8 })
  const inv = invertSelection(tree, initialSelection(tree))
  assert.deepEqual([...inv].sort(), ['b', 'c1', 'c2', 'v'])
})

test('filtre : nom de catégorie garde tous ses salons, sinon salons trouvés ; sans accents', () => {
  assert.equal(filterTree(tree, '').categories.length, 3)
  const r = filterTree(tree, 'annonce')
  assert.equal(r.categories.length, 1)
  assert.equal(r.categories[0].channels.length, 3)
  const g = filterTree(tree, 'REGLES')
  assert.deepEqual(g.categories[0].channels.map(c => c.id), ['b'])
  assert.equal(g.uncategorized.length, 0)
  assert.equal(filterTree(tree, 'libre').uncategorized.length, 1)
})

test('charge utile : tout élément est coché ou décoché', () => {
  const p = toPayload(tree, initialSelection(tree))
  assert.equal(p.included_ids.length + p.excluded_ids.length, 8)
  assert.ok(p.excluded_ids.includes('b') && p.included_ids.includes('a'))
})

test('i18n fr/en : mêmes clés', () => {
  const miss = Object.keys(dict.fr).filter(k => !(k in dict.en))
  assert.deepEqual(miss, [])
})
