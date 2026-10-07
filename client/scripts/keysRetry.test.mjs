// Ré-essai du déchiffrement quand les clés arrivent : node --test scripts/keysRetry.test.mjs
// Non-régression : un MP ouvert avant le déverrouillage de la clé de compte restait « en attente ».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { becameReady, cacheUsable, emitKeysChanged, isLocked, keysFor, mergeUnlocked, onKeysChanged } from '../src/e2e/keysRetry.ts'

test('clé de compte prête ou remplacée : ré-essai ; rien d\'autre', () => {
  const k1 = {}, k2 = {}
  assert.equal(becameReady({ status: 'ready', priv: k1 }, { status: 'locked', priv: null }), true)
  assert.equal(becameReady({ status: 'ready', priv: k1 }, { status: 'idle', priv: null }), true)
  assert.equal(becameReady({ status: 'ready', priv: k2 }, { status: 'ready', priv: k1 }), true)
  assert.equal(becameReady({ status: 'ready', priv: k1 }, { status: 'ready', priv: k1 }), false)
  assert.equal(becameReady({ status: 'locked', priv: null }, { status: 'idle', priv: null }), false)
})

test('état de conversation chargé sans la clé de compte : jamais réutilisé', () => {
  const k = {}
  const sansCle = { priv: null, at: 1000 }
  assert.equal(cacheUsable(sansCle, k, false, 1000), false)
  assert.equal(cacheUsable(sansCle, null, false, 1000), true)
  const avecCle = { priv: k, at: 1000 }
  assert.equal(cacheUsable(avecCle, k, false, 99_999), true)
  assert.equal(cacheUsable(avecCle, k, true, 1500), true)
  assert.equal(cacheUsable(avecCle, k, true, 2500), false)
  assert.equal(cacheUsable(avecCle, {}, false, 1000), false)
  assert.equal(cacheUsable(undefined, k, false, 0), false)
})

test('événements : toutes les conversations ou une seule, désabonnement', () => {
  const seen = []
  const off = onKeysChanged((k, i) => { if (keysFor('dm', 'A', k, i)) seen.push(i ?? '*') })
  const offBroken = onKeysChanged(() => { throw new Error('écran démonté') })
  emitKeysChanged()
  emitKeysChanged('dm', 'A')
  emitKeysChanged('dm', 'B')
  emitKeysChanged('group', 'A')
  off(); offBroken()
  emitKeysChanged()
  assert.deepEqual(seen, ['*', 'A'])
  assert.equal(keysFor('dm', undefined), false)
})

test('messages en attente remplacés par leur version lisible, les autres intacts', () => {
  const prev = [
    { id: '1', e2e: 'locked', content: 'attente' },
    { id: '2', e2e: 'ok', content: 'lu', reactions: ['local'] },
    { id: '3', e2e: 'ok', e2e_reply: 'locked', content: 'réponse' },
    { id: '4', e2e: 'locked', content: 'attente' },
  ]
  const fresh = [
    { id: '1', e2e: 'ok', content: 'bonjour', e2e_body: { t: 'bonjour', f: [] } },
    { id: '2', e2e: 'ok', content: 'lu' },
    { id: '3', e2e: 'ok', content: 'réponse', reply_to_content: 'cité' },
    { id: '4', e2e: 'locked', content: 'attente' },
  ]
  const out = mergeUnlocked(prev, fresh)
  assert.equal(out[0], fresh[0])
  assert.equal(out[1], prev[1])
  assert.equal(out[2], fresh[2])
  assert.equal(out[3], prev[3])
  assert.equal(isLocked(out[2]), false)
  assert.equal(isLocked(out[3]), true)
  assert.equal(isLocked(null), false)
})
