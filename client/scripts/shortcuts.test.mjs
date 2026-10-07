// Raccourcis clavier personnalisables : node --test scripts/shortcuts.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHORTCUTS, canonical, comboFromEvent, comboProblem, findConflicts, matches, parseCombo, prettyCombo, resolveBindings,
} from '../src/lib/shortcuts.ts'

const ev = (key, mods = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

test('lecture et forme canonique', () => {
  assert.deepEqual(parseCombo('Ctrl+Shift+K'), { ctrl: true, alt: false, shift: true, meta: false, key: 'k' })
  assert.equal(parseCombo('Ctrl++').key, '+')
  assert.equal(canonical('Shift+Ctrl+k'), canonical('Ctrl+Shift+K'))
  assert.equal(canonical('Ctrl+Space'), 'ctrl+space')
  assert.equal(canonical('Ctrl'), '')
})

test('saisie depuis le clavier', () => {
  assert.equal(comboFromEvent(ev('k', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+K')
  assert.equal(comboFromEvent(ev(' ', { ctrlKey: true })), 'Ctrl+Space')
  assert.equal(comboFromEvent(ev('Control', { ctrlKey: true })), '')
})

test('correspondance', () => {
  assert.ok(matches(ev('k', { ctrlKey: true }), 'Ctrl+K'))
  assert.ok(matches(ev('k', { metaKey: true }), 'Ctrl+K'), 'Cmd vaut Ctrl sur Mac')
  assert.ok(!matches(ev('K', { ctrlKey: true, shiftKey: true }), 'Ctrl+K'), 'Maj en trop sur une lettre')
  assert.ok(matches(ev('K', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+K'))
  assert.ok(!matches(ev('k'), 'Ctrl+K'))
  assert.ok(matches(ev('ArrowDown', { altKey: true }), 'Alt+ArrowDown'))
  assert.ok(!matches(ev('ArrowDown', { altKey: true, ctrlKey: true }), 'Alt+ArrowDown'))
  assert.ok(matches(ev(' ', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Space'))
})

test('raccourcis effectifs : défauts puis personnalisés, actions inconnues ignorées', () => {
  const b = resolveBindings([{ action: 'search', key_combo: 'Ctrl+P' }, { action: 'inconnue', key_combo: 'Ctrl+J' }])
  assert.equal(b.search, 'Ctrl+P')
  assert.equal(b.quick_switcher, 'Ctrl+Shift+K')
  assert.ok(!('inconnue' in b))
  assert.equal(Object.keys(resolveBindings(null)).length, SHORTCUTS.length)
})

test('défauts sans conflit, conflits détectés', () => {
  assert.deepEqual(findConflicts(resolveBindings([])), {})
  const c = findConflicts(resolveBindings([{ action: 'search', key_combo: 'ctrl+shift+k' }]))
  assert.deepEqual(c.search, ['quick_switcher'])
  assert.deepEqual(c.quick_switcher, ['search'])
})

test('raccourcis refusés', () => {
  assert.equal(comboProblem('search', 'Ctrl+W'), 'reserved')
  assert.equal(comboProblem('search', 'K'), 'needsModifier')
  assert.equal(comboProblem('search', 'F2'), null)
  assert.equal(comboProblem('push_to_talk', 'V'), null, 'touche seule permise pour parler')
  assert.equal(comboProblem('search', 'Ctrl'), 'empty')
  assert.equal(comboProblem('search', 'Ctrl+J'), null)
})

test('affichage', () => {
  assert.equal(prettyCombo('Ctrl+Shift+ArrowUp', 'fr'), 'Ctrl + Maj + ↑')
  assert.equal(prettyCombo('ctrl+shift+space', 'en'), 'Ctrl + Shift + Space')
})
