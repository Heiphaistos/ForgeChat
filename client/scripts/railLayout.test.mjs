// Entrées fixes de la barre des serveurs : ordre, masquage, rétro-compatibilité.
// node --test scripts/railLayout.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIXED_IDS, fixedOrder, visibleFixed, setFixedHidden, moveFixed, resetFixed } from '../src/components/layout/railFixed.ts'

const L = { order: ['a'], folders: {} }

test('ordre par défaut : Tutoriel juste avant Actualités', () => {
  const o = fixedOrder(undefined)
  assert.deepEqual(o, [...FIXED_IDS])
  assert.equal(o.indexOf('tutorials') + 1, o.indexOf('news'))
})

test('ordre enregistré : inconnus et doublons écartés, manquants remis à leur place', () => {
  const o = fixedOrder(['news', 'dms'])
  assert.equal(o.length, 5)
  assert.ok(o.indexOf('tutorials') < o.indexOf('news'))
  assert.ok(!o.includes('x'))
})

test('masquer / réafficher / réinitialiser', () => {
  const h = setFixedHidden(L, 'news', true)
  assert.ok(!visibleFixed(h).includes('news'))
  assert.equal(visibleFixed(h).length, 4)
  assert.deepEqual(h.hidden, ['news'])
  assert.deepEqual(setFixedHidden(setFixedHidden(h, 'news', true), 'news', false).hidden, [])
  assert.deepEqual(resetFixed(moveFixed(h, 'news', 'dms', 'before')), L)
})

test('déplacer une entrée fixe', () => {
  assert.deepEqual(moveFixed(L, 'news', 'dms', 'before').fixed, ['news', 'dms', 'saved', 'tutorials', 'notifications'])
  assert.deepEqual(moveFixed(L, 'dms', 'news', 'after').fixed, ['saved', 'tutorials', 'news', 'dms', 'notifications'])
  assert.equal(moveFixed(L, 'x', 'dms', 'before'), L)
})
