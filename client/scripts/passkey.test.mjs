// Clés d'accès (amélioration n° 3) : conversions base64url et options WebAuthn.
// node --test scripts/passkey.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { b64uToBytes, bytesToB64u, creationOptions, requestOptions } from '../src/lib/passkey.ts'

test('base64url aller-retour, sans remplissage', () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 64]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 250) & 255)
    const s = bytesToB64u(bytes)
    assert.ok(!/[+/=]/.test(s), s)
    assert.deepEqual([...b64uToBytes(s)], [...bytes])
  }
})

test('options du serveur converties en octets', () => {
  const c = creationOptions({
    challenge: 'AQID', rp: { id: 'forgechat.example', name: 'ForgeChat' },
    user: { id: 'BAUG', name: 'a', displayName: 'a' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    excludeCredentials: [{ type: 'public-key', id: 'BwgJ' }], timeout: 1000,
  })
  assert.deepEqual([...c.challenge], [1, 2, 3])
  assert.deepEqual([...c.user.id], [4, 5, 6])
  assert.deepEqual([...c.excludeCredentials[0].id], [7, 8, 9])
  assert.equal(c.attestation, 'none')
  const r = requestOptions({ challenge: 'AQID', rpId: 'forgechat.example', allowCredentials: [{ type: 'public-key', id: 'BwgJ' }] })
  assert.equal(r.rpId, 'forgechat.example')
  assert.deepEqual([...r.allowCredentials[0].id], [7, 8, 9])
  assert.equal(r.userVerification, 'preferred')
})
