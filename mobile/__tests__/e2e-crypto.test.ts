// Vecteurs communs du chiffrement de bout en bout, produits par le web
// (client/scripts/e2e-vectors.gen.mjs) : le mobile doit retrouver les mêmes octets.
import { readFileSync } from 'fs'
import { join } from 'path'
import * as c from '@/e2e/crypto'
import * as k from '@/e2e/authKdf'

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

test('salons : portée du fil, de la publication et du sondage', async () => {
  for (const x of [V.threadMessage, V.forumPost, V.poll]) {
    expect(await c.encryptMessage(d(x.key), x.scope, x.epoch, x.author, x.clientMsgId, x.body, d(x.iv))).toEqual(x.enc)
    expect(await c.decryptMessage(d(x.key), x.scope, x.enc, x.author, x.clientMsgId)).toEqual(x.body)
  }
  const x = V.threadMessage
  await expect(c.decryptMessage(d(x.key), x.scope.split('/')[0], x.enc, x.author, x.clientMsgId)).rejects.toThrow()
  expect(c.threadScope('a', 'b')).toBe('channel:a/thread:b')
})

test('clé de récupération du serveur : mêmes octets que le web', async () => {
  const x = V.serverKey
  expect(await c.wrapServerKey(d(x.ownerPriv), d(x.serverPub), d(x.serverPriv), x.serverId, x.owner, d(x.iv))).toEqual(x.ownerWrapped)
  expect(await c.wrapServerKey(d(x.serverPriv), d(x.ownerPub), d(x.serverPriv), x.serverId, x.owner, d(x.iv))).toEqual(x.ownerWrapped)
  expect(e(await c.unwrapServerKey(d(x.ownerPriv), d(x.serverPub), x.ownerWrapped, x.serverId, x.owner))).toBe(x.serverPriv)
  const code = c.normalizeRecoveryCode(x.recoveryCode)!
  expect(e(await c.unwrapKey(x.recovery, code, c.serverRecoveryAad(x.serverId), x.iterations))).toBe(x.serverPriv)
  const s = V.serverEpoch
  expect(e(await c.unwrapConvKey(d(x.serverPriv), d(x.ownerPub), s.wrapped, s.conv, s.epoch, s.member, s.sender))).toBe(s.key)
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

const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255)

test('fichiers : mêmes octets que le web, troncature et réordonnancement refusés', async () => {
  const s = V.fileSmall
  expect(s.chunk).toBe(c.FILE_CHUNK)
  expect(e(await c.encryptFileBytes(d(s.key), s.fileId, c.utf8(s.plaintext)))).toBe(s.ct)
  const n = c.utf8(s.plaintext).length
  expect(new TextDecoder().decode(await c.decryptFileBytes(d(s.key), s.fileId, d(s.ct), n))).toBe(s.plaintext)
  const L = V.fileLarge
  const ct = await c.encryptFileBytes(d(L.key), L.fileId, pattern(L.length))
  expect(ct.length).toBe(L.ctLength)
  expect(e(await c.sha256(ct))).toBe(L.ctSha256)
  expect(e(ct.subarray(c.FILE_CT_CHUNK))).toBe(L.lastChunk)
  expect(e(c.fileChunkIv(1))).toBe(L.iv1)
  expect(c.fileChunkAad(L.fileId, 1, true)).toBe(L.aadLast)
  expect(await c.decryptFileBytes(d(L.key), L.fileId, ct, L.length)).toEqual(pattern(L.length))
  await expect(c.decryptFileBytes(d(L.key), L.fileId, ct.subarray(0, c.FILE_CT_CHUNK), c.FILE_CHUNK)).rejects.toThrow()
  const swapped = new Uint8Array(ct.length)
  swapped.set(ct.subarray(c.FILE_CT_CHUNK))
  swapped.set(ct.subarray(0, c.FILE_CT_CHUNK), ct.length - c.FILE_CT_CHUNK)
  await expect(c.decryptFileBytes(d(L.key), L.fileId, swapped, L.length)).rejects.toThrow()
  await expect(c.decryptFileBytes(d(L.key), L.fileId, ct, L.length + 1)).rejects.toThrow()
})

test('fichiers : message {t, f} du web relu, entrées validées', async () => {
  const x = V.fileMessage
  expect(await c.encryptMessage(d(x.key), x.conv, x.epoch, x.author, x.clientMsgId, x.body, d(x.iv))).toEqual(x.enc)
  const body = await c.decryptMessage(d(x.key), x.conv, x.enc, x.author, x.clientMsgId)
  expect(c.fileEntries(body)).toEqual(x.body.f)
  expect(c.fileEntries({ f: [{ ...x.body.f[0], id: 'x' }] })).toEqual([])
  expect(c.safeMime('text/html')).toBe('application/octet-stream')
})

test('note privée scellée pour soi : mêmes octets que le web', async () => {
  const x = V.privateNote
  expect(await c.sealNote(d(x.priv), d(x.pub), x.owner, x.target, x.text, d(x.iv))).toEqual(x.sealed)
  expect(await c.openNote(d(x.priv), d(x.pub), x.sealed, x.owner, x.target)).toBe(x.text)
  await expect(c.openNote(d(x.priv), d(x.pub), x.sealed, x.owner, x.owner)).rejects.toThrow()
})

test('brouillon chiffré par la clé de compte', async () => {
  const x = V.draft
  expect(e(await c.draftKey(d(x.priv), d(x.pub), x.userId))).toBe(x.key)
  expect(await c.sealDraft(d(x.key), x.userId, x.convId, x.text, d(x.iv))).toEqual(x.blob)
  expect(await c.openDraft(d(x.key), x.userId, x.convId, x.blob)).toBe(x.text)
  await expect(c.openDraft(d(x.key), x.userId, x.userId, x.blob)).rejects.toThrow()
})

test('connexion v2 : master, auth, wrapKey et enveloppe v2 (NFKC), mêmes octets que le web', async () => {
  const x = V.authV2
  expect(e(await c.pbkdf2(x.passwordNfkc, d(x.kdfSalt), x.iterations))).toBe(x.master)
  const s = await k.deriveSecrets(x.password, x.kdfSalt, x.iterations)
  expect(s.auth).toBe(x.auth)
  expect(e(s.wrapKey)).toBe(x.wrapKey)
  expect((await k.deriveSecrets(x.passwordNfkc, x.kdfSalt, x.iterations)).auth).toBe(x.auth)
  expect(k.keyAadV2(x.userId)).toBe(x.aad)
  expect(await k.wrapKeyV2(d(x.priv), s.wrapKey, x.userId, d(x.wrapped.iv))).toEqual(x.wrapped)
  expect(e(await k.unwrapKeyV2(x.wrapped, s.wrapKey, x.userId))).toBe(x.priv)
  expect(e(await k.unwrapAny(x.wrapped, 'ignoré', s, x.userId))).toBe(x.priv)
  await expect(k.unwrapKeyV2(x.wrapped, s.wrapKey, '00000000-0000-4000-8000-000000000000')).rejects.toThrow()
  const other = await k.deriveSecrets('autre mot de passe', x.kdfSalt, x.iterations)
  await expect(k.unwrapKeyV2(x.wrapped, other.wrapKey, x.userId)).rejects.toThrow()
  expect(k.passwordProblem('123456789')).not.toBeNull()
  expect(k.passwordProblem('Mot de passe de test 42!')).toBeNull()
  // Trop court, répétitif, courant, basé sur le pseudo, une seule sorte de caractères.
  for (const pw of ['Abcdef12!', 'aaaaaaaaaaaaaaaa', 'Azerty123456!', 'Momo2885652!x', 'abcdefghijkl']) {
    expect(k.passwordProblem(pw, ['momo2885652', 'momo@gmail.com'])).not.toBeNull()
  }
  // Une phrase longue passe sans symbole.
  expect(k.passwordProblem('le chat dort sur la radio')).toBeNull()
})

test('Argon2id (audit M3) : mêmes octets que le web et que l’implémentation de référence', async () => {
  const x = V.authArgon2
  expect({ ...k.ARGON2 }).toEqual(x.params)
  const s = await k.deriveSecrets(x.password, x.kdfSalt, 'argon2id')
  expect(s.auth).toBe(x.auth)
  expect(c.b64uEncode(s.wrapKey)).toBe(x.wrapKey)
  expect(k.asKdf('argon2id')).toBe('argon2id')
  expect(k.asKdf(undefined)).toBe('pbkdf2')
  expect(k.asKdf('md5')).toBe('pbkdf2')
}, 60_000)
