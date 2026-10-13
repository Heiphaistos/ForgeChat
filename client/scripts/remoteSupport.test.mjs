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
  // Bureau : arguments de ghd_launch (le lien n'est plus ouvert par le shell).
  assert.deepEqual(rs.ghdLaunchArgs(rs.shareLink('7K2MQ9XR4TVB')), { action: 'share', code: '7K2MQ9XR4TVB', id: null, ttl: 600 })
  assert.deepEqual(rs.ghdLaunchArgs(rs.connectLink('482 915 036', '7K2MQ9XR4TVB')), { action: 'connect', code: '7K2MQ9XR4TVB', id: '482915036', ttl: null })
  assert.equal(rs.ghdLaunchArgs('ghosthanddesk://evil?code=1'), null)
  assert.equal(rs.ghdLaunchArgs('https://example.com/share?code=1'), null)
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

test("partager son écran : agent GhostHandDesk sous Windows seulement ; téléchargement direct en https", () => {
  assert.equal(rs.canHostGhd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0'), true)
  assert.equal(rs.canHostGhd('ForgeChat/3.27.0 (Desktop) Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), true)
  for (const ua of ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15', 'Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Linux; Android 15)', ''])
    assert.equal(rs.canHostGhd(ua), false, ua)
  assert.match(rs.GHD_WINDOWS_DOWNLOAD, /^https:\/\/ghd\.heiphaistos\.org\/download\/v[\d.]+\/GhostHandDesk_[\d.]+_portable_x64\.exe$/)
})
