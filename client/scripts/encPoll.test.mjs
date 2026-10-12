// Sondages chiffrés (amélioration n° 35) : node --test scripts/encPoll.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KEYCAPS, buildPoll, pollOf, tally, voteToggles } from '../src/lib/encPoll.ts'

test('validation, décompte, vote unique ou multiple', () => {
  const p = buildPoll(' Pizza ? ', 'Oui\n\nNon\nPeut-être', false)
  assert.deepEqual(p, { q: 'Pizza ?', o: ['Oui', 'Non', 'Peut-être'], m: false })
  assert.equal(buildPoll('Q', 'seule', false), null)
  assert.equal(pollOf({ poll: { q: 'Q', o: Array(11).fill('x'), m: false } }), null)
  assert.equal(pollOf({ poll: { q: 'Q', o: ['a', 3] } }), null)
  const t = tally(p, [{ emoji: KEYCAPS[0], count: 2, me: true }, { emoji: '👍', count: 5 }])
  assert.deepEqual(t, { counts: [2, 0, 0], mine: [true, false, false], total: 2 })
  assert.deepEqual(voteToggles(p, t.mine, 1), [KEYCAPS[0], KEYCAPS[1]], 'choix unique : ancien vote retiré')
  assert.deepEqual(voteToggles(p, t.mine, 0), [KEYCAPS[0]], 'même option : retrait')
  assert.deepEqual(voteToggles({ ...p, m: true }, t.mine, 1), [KEYCAPS[1]])
})
