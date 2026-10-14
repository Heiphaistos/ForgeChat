// Piège de focus des modales : node --test scripts/focusTrap.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trapTarget } from '../src/lib/focusTrap.ts'

test('Tab sur le dernier revient au premier, Maj+Tab sur le premier va au dernier', () => {
  const items = ['a', 'b', 'c']
  assert.equal(trapTarget(items, 'c', false), 'a')
  assert.equal(trapTarget(items, 'a', true), 'c')
})
test('au milieu : le navigateur décide', () => {
  assert.equal(trapTarget(['a', 'b', 'c'], 'b', false), null)
  assert.equal(trapTarget(['a', 'b', 'c'], 'b', true), null)
})
test('focus hors de la modale : on le ramène dedans', () => {
  assert.equal(trapTarget(['a', 'b'], 'zzz', false), 'a')
  assert.equal(trapTarget(['a', 'b'], null, true), 'b')
})
test('aucun élément focalisable : le conteneur garde le focus', () => {
  assert.equal(trapTarget([], null, false), 'container')
})
