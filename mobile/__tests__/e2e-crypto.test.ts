// Vecteurs communs du chiffrement de bout en bout, produits par le web
// (client/scripts/e2e-vectors.gen.mjs) : le mobile doit retrouver les mêmes octets.
import { readFileSync } from 'fs'
import { join } from 'path'
import * as c from '@/e2e/crypto'

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}))

const V = JSON.parse(readFileSync(join(__dirname, '../../docs/e2e-vectors.json'), 'utf8'))
const d = c.b64uDecode
const e = c.b64uEncode

test('ECDH + HKDF', async () => {
  const x = V.ecdh
  expect(e(c.publicFromPrivate(d(x.privA)))).toBe(x.pubA)
  expect(e(c.publicFromPrivate(d(x.privB)))).toBe(x.pubB)
  expect(e(await c.ecdh(d(x.privA), d(x.pubB)))).toBe(x.shared)
  expect(e(await c.ecdh(d(x.privB), d(x.pubA)))).toBe(x.shared)
  expect(e(await c.hkdf(d(x.shared), d(x.hkdf.salt), x.hkdf.info, x.hkdf.length))).toBe(x.hkdf.okm)
})

test('AES-GCM + AAD', async () => {
  const x = V.aesgcm
  expect(e(await c.aesGcmEncrypt(d(x.key), d(x.iv), c.utf8(x.plaintext), x.aad))).toBe(x.ct)
  const pt = await c.aesGcmDecrypt(d(x.key), d(x.iv), d(x.ct), x.aad)
  expect(Buffer.from(pt).toString('utf8')).toBe(x.plaintext)
  await expect(c.aesGcmDecrypt(d(x.key), d(x.iv), d(x.ct), x.aad + 'x')).rejects.toThrow()
})

test('PBKDF2', async () => {
  const x = V.pbkdf2
  expect(e(await c.pbkdf2(x.password, d(x.salt), x.iterations))).toBe(x.key)
})

test('enveloppes : mêmes octets que le web, dans les deux sens', async () => {
  const x = V.wrap
  expect(e(await c.unwrapKey(x.wrapped, x.password, c.keyAad(x.userId), x.iterations))).toBe(x.priv)
  const code = c.normalizeRecoveryCode(x.recoveryCode)!
  expect(e(await c.unwrapKey(x.backup, code, c.backupAad(x.userId), x.iterations))).toBe(x.priv)
  const opts = { salt: d(x.wrapped.salt), iv: d(x.wrapped.iv), iterations: x.iterations }
  expect(await c.wrapKey(d(x.priv), x.password, c.keyAad(x.userId), opts)).toEqual(x.wrapped)
  await expect(c.unwrapKey(x.wrapped, 'faux', c.keyAad(x.userId), x.iterations)).rejects.toThrow()
})

test('empreinte et code de sécurité', async () => {
  expect(e(await c.fingerprint(d(V.fingerprint.pub)))).toBe(V.fingerprint.fp)
  const s = V.safety
  expect(await c.safetyCode(d(s.pubA), d(s.pubB))).toBe(s.code)
  expect(await c.safetyCode(d(s.pubB), d(s.pubA))).toBe(s.code)
})

test('code de récupération : génération et normalisation', () => {
  for (const [input, out] of V.recoveryNormalize) expect(c.normalizeRecoveryCode(input)).toBe(out)
  const g = c.generateRecoveryCode()
  expect(c.normalizeRecoveryCode(c.formatRecoveryCode(g))).toBe(g)
})

test('paire neuve et base64url', async () => {
  const { priv, pub } = await c.generateKeyPair()
  expect(priv.length).toBe(32)
  expect(e(c.publicFromPrivate(priv))).toBe(e(pub))
  expect(e(c.utf8('ab?'))).toBe('YWI_')
  expect(() => d('ab=c')).toThrow()
})
