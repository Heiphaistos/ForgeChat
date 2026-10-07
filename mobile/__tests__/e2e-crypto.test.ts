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

test('clé de conversation : mêmes octets que le web, refus si altérée', async () => {
  const x = V.convKey
  const privA = d(V.ecdh.privA)
  const privB = d(V.ecdh.privB)
  expect(await c.wrapConvKey(privA, d(V.ecdh.pubB), d(x.key), x.conv, x.epoch, x.member, x.sender, d(x.iv))).toEqual(x.wrapped)
  expect(e(await c.unwrapConvKey(privB, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch, x.member, x.sender))).toBe(x.key)
  await expect(c.unwrapConvKey(privB, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch + 1, x.member, x.sender)).rejects.toThrow()
  await expect(c.unwrapConvKey(privB, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch, x.member, x.member)).rejects.toThrow()
})

test('message chiffré : mêmes octets que le web, AAD vérifiée', async () => {
  const x = V.message
  expect(await c.encryptMessage(d(x.key), x.conv, x.epoch, x.author, x.clientMsgId, x.body, d(x.iv))).toEqual(x.enc)
  expect(await c.decryptMessage(d(x.key), x.conv, x.enc, x.author, x.clientMsgId)).toEqual(x.body)
  await expect(c.decryptMessage(d(x.key), x.conv, x.enc, 'usurpateur', x.clientMsgId)).rejects.toThrow()
  await expect(c.decryptMessage(d(x.key), x.conv, x.enc, x.author, 'autre-id')).rejects.toThrow()
})

test('clé de média : mêmes octets que le web, index = époque modulo l’anneau', async () => {
  const x = V.media
  expect(c.mediaInfo(x.conv, x.epoch)).toBe(x.info)
  expect(await c.mediaKey(d(x.convKey), x.conv, x.epoch)).toBe(x.key)
  expect(c.mediaKeyIndex(x.epoch)).toBe(x.keyIndex)
  expect(c.mediaKeyIndex(c.MEDIA_KEYRING + 3)).toBe(3)
  expect(await c.mediaKey(d(x.convKey), x.conv, x.epoch + 1)).not.toBe(x.key)
})
