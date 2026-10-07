// Support à distance (GhostHandDesk) : node --test scripts/remoteSupport.test.mjs
// Mêmes cas que mobile/__tests__/remoteSupport.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as rs from '../src/lib/remoteSupport.ts'

const REF = '0b6f0c1e-6a3b-4c1d-9e2f-1234567890ab'

test('code à usage unique : 12 symboles Crockford, 60 bits sans biais', () => {
  for (let i = 0; i < 200; i++) assert.match(rs.newCode(), /^[0-9A-HJKMNP-TV-Z]{12}$/)
  assert.equal(rs.newCode(n => new Uint8Array(n).fill(255)), 'ZZZZZZZZZZZZ')
  assert.equal(rs.newCode(n => new Uint8Array(n).fill(32)), '000000000000')
  assert.equal(rs.formatCode('7K2MQ9XR4TVB'), '7K2M-Q9XR-4TVB')
})

test('invitation valide, liens et expiration', () => {
  const p = rs.invite('482 915 036', '7K2MQ9XR4TVB', 1_000)
  assert.deepEqual(rs.parseSupport(p), { v: 1, k: 'invite', id: '482915036', code: '7K2MQ9XR4TVB', exp: 1_000 + 600_000 })
  assert.equal(rs.expired(p, 600_999), false)
  assert.equal(rs.expired(p, 601_000), true)
  assert.equal(rs.shareLink('7K2MQ9XR4TVB'), 'ghosthanddesk://share?code=7K2MQ9XR4TVB&ttl=600')
  assert.equal(rs.connectLink('482 915 036', '7K2MQ9XR4TVB'), 'ghosthanddesk://connect?id=482915036&code=7K2MQ9XR4TVB')
  assert.equal(rs.webViewerLink('482915036', '7K2MQ9XR4TVB'), 'https://ghd.heiphaistos.org/app/#id=482915036&code=7K2MQ9XR4TVB')
  assert.equal(rs.formatId('482915036'), '482 915 036')
})

test('réponses et offre', () => {
  assert.deepEqual(rs.parseSupport({ v: 1, k: 'offer' }), { v: 1, k: 'offer' })
  assert.deepEqual(rs.parseSupport({ v: 1, k: 'accept', ref: REF, extra: '<b>' }), { v: 1, k: 'accept', ref: REF })
  assert.deepEqual(rs.parseSupport({ v: 1, k: 'invite', id: '482915036', code: '7K2MQ9XR4TVB', exp: 5, ref: REF })?.ref, REF)
})

test('contenus refusés (jamais d\'affichage partiel)', () => {
  for (const bad of [
    null, 'x', { v: 2, k: 'offer' }, { v: 1, k: 'pwn' },
    { v: 1, k: 'accept' }, { v: 1, k: 'decline', ref: 'pas-un-uuid' },
    { v: 1, k: 'invite', id: '012345678', code: '7K2MQ9XR4TVB', exp: 1 },
    { v: 1, k: 'invite', id: '482915036', code: '7K2MQ9XR4TVI', exp: 1 },
    { v: 1, k: 'invite', id: '482915036', code: 'javascript:x', exp: 1 },
    { v: 1, k: 'invite', id: '482915036', code: '7K2MQ9XR4TVB' },
    { v: 1, k: 'invite', id: '482915036&x=1', code: '7K2MQ9XR4TVB', exp: 1 },
  ]) assert.equal(rs.parseSupport(bad), null, JSON.stringify(bad))
})
