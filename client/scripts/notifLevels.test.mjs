// Hiérarchie des notifications (salon > catégorie > serveur > défaut) : node --test scripts/notifLevels.test.mjs
// Le serveur vérifie la même règle (server/src/notify.rs, tests category_sits_between_channel_and_server).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLevel, forumPostAlerts } from '../src/store/notifLevels.ts'

test('défaut du serveur, mentions seulement si inconnu', () => {
  assert.equal(resolveLevel(), 'mentions')
  assert.equal(resolveLevel(undefined, undefined, undefined, 'all'), 'all')
  assert.equal(resolveLevel(undefined, undefined, 'inherit', 'nothing'), 'nothing')
  assert.equal(resolveLevel(undefined, undefined, undefined, 'bizarre'), 'mentions')
})

test('salon > catégorie > serveur', () => {
  assert.equal(resolveLevel(undefined, undefined, 'all', 'mentions'), 'all')
  assert.equal(resolveLevel(undefined, 'nothing', 'all', 'all'), 'nothing')
  assert.equal(resolveLevel('inherit', 'nothing', 'all'), 'nothing')
  assert.equal(resolveLevel('all', 'nothing', 'mentions'), 'all')
  assert.equal(resolveLevel('mentions', 'all', 'nothing', 'all'), 'mentions')
})

test('nouveau post de forum', () => {
  assert.equal(forumPostAlerts('all', false), true)
  assert.equal(forumPostAlerts('mentions', false), false)
  assert.equal(forumPostAlerts('mentions', true), true)
  assert.equal(forumPostAlerts('nothing', true), false)
})
