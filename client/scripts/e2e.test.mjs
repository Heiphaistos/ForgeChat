// Vecteurs communs du chiffrement de bout en bout : node --test scripts/e2e.test.mjs
// Les mêmes vecteurs sont vérifiés par mobile/__tests__/e2e-crypto.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as c from '../src/e2e/crypto.ts'

const V = JSON.parse(readFileSync(new URL('../../docs/e2e-vectors.json', import.meta.url), 'utf8'))
const d = c.b64uDecode
const e = c.b64uEncode

test('base64url aller-retour et rejet strict', () => {
  for (let n = 0; n < 8; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => i * 37 + 250)
    assert.deepEqual(d(e(b)), b)
  }
  assert.equal(e(c.utf8('ab?')), 'YWI_')
  assert.throws(() => d('ab=c'))
  assert.throws(() => d('abcde'))
})

test('ECDH + HKDF', async () => {
  const x = V.ecdh
  const a = await c.importPrivateKey(d(x.privA), d(x.pubA))
  const b = await c.importPrivateKey(d(x.privB), d(x.pubB))
  assert.equal(e(await c.ecdh(a, d(x.pubB))), x.shared)
  assert.equal(e(await c.ecdh(b, d(x.pubA))), x.shared)
  assert.equal(e(await c.hkdf(d(x.shared), d(x.hkdf.salt), x.hkdf.info, x.hkdf.length)), x.hkdf.okm)
})

test('AES-GCM + AAD', async () => {
  const x = V.aesgcm
  assert.equal(e(await c.aesGcmEncrypt(d(x.key), d(x.iv), c.utf8(x.plaintext), x.aad)), x.ct)
  const pt = await c.aesGcmDecrypt(d(x.key), d(x.iv), d(x.ct), x.aad)
  assert.equal(new TextDecoder().decode(pt), x.plaintext)
  await assert.rejects(c.aesGcmDecrypt(d(x.key), d(x.iv), d(x.ct), x.aad + 'x'))
})

test('PBKDF2', async () => {
  const x = V.pbkdf2
  assert.equal(e(await c.pbkdf2(x.password, d(x.salt), x.iterations)), x.key)
})

test('enveloppe mot de passe et code de récupération', async () => {
  const x = V.wrap
  assert.equal(e(await c.unwrapKey(x.wrapped, x.password, c.keyAad(x.userId), x.iterations)), x.priv)
  const code = c.normalizeRecoveryCode(x.recoveryCode)
  assert.equal(e(await c.unwrapKey(x.backup, code, c.backupAad(x.userId), x.iterations)), x.priv)
  await assert.rejects(c.unwrapKey(x.wrapped, 'faux', c.keyAad(x.userId), x.iterations))
  // Même clé, mauvais compte : l'AAD lie l'enveloppe à l'utilisateur.
  await assert.rejects(c.unwrapKey(x.wrapped, x.password, c.keyAad('autre'), x.iterations))
})

test('empreinte et code de sécurité', async () => {
  assert.equal(e(await c.fingerprint(d(V.fingerprint.pub))), V.fingerprint.fp)
  const s = V.safety
  assert.match(s.code, /^\d{60}$/)
  assert.equal(await c.safetyCode(d(s.pubA), d(s.pubB)), s.code)
  assert.equal(await c.safetyCode(d(s.pubB), d(s.pubA)), s.code)
})

test('code de récupération : génération et normalisation', () => {
  for (const [input, out] of V.recoveryNormalize) assert.equal(c.normalizeRecoveryCode(input), out)
  const g = c.generateRecoveryCode()
  assert.equal(c.normalizeRecoveryCode(g), g)
  assert.equal(c.normalizeRecoveryCode(c.formatRecoveryCode(g)), g)
})

test('paire neuve utilisable', async () => {
  const { priv, pub } = await c.generateKeyPair()
  assert.equal(priv.length, 32)
  assert.equal(pub.length, 65)
  const k = await c.importPrivateKey(priv, pub)
  assert.equal(k.extractable, false)
  assert.equal((await c.ecdh(k, d(V.ecdh.pubB))).length, 32)
})
