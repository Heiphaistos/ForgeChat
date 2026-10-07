// Vecteurs communs du chiffrement de bout en bout : node --test scripts/e2e.test.mjs
// Les mêmes vecteurs sont vérifiés par mobile/__tests__/e2e-crypto.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as c from '../src/e2e/crypto.ts'

const V = JSON.parse(readFileSync(new URL('../../docs/e2e-vectors.json', import.meta.url), 'utf8'))
const d = c.b64uDecode
const e = c.b64uEncode

test('salons : portée du fil, de la publication et du sondage dans l\'AAD', async () => {
  for (const x of [V.threadMessage, V.forumPost, V.poll]) {
    assert.deepEqual(await c.encryptMessage(d(x.key), x.scope, x.epoch, x.author, x.clientMsgId, x.body, d(x.iv)), x.enc)
    assert.deepEqual(await c.decryptMessage(d(x.key), x.scope, x.enc, x.author, x.clientMsgId), x.body)
  }
  // Un contenu déplacé dans un autre fil (ou vers le salon) ne s'ouvre pas.
  const x = V.threadMessage
  await assert.rejects(c.decryptMessage(d(x.key), x.scope.split('/')[0], x.enc, x.author, x.clientMsgId))
  assert.equal(V.poll.scope.endsWith('/poll:55555555-5555-4555-8555-555555555555'), true)
})

test('clé de récupération du serveur', async () => {
  const x = V.serverKey
  const owner = await c.importPrivateKey(d(x.ownerPriv), d(x.ownerPub))
  const server = await c.importPrivateKey(d(x.serverPriv), d(x.serverPub))
  assert.deepEqual(await c.wrapServerKey(owner, d(x.serverPub), d(x.serverPriv), x.serverId, x.owner, d(x.iv)), x.ownerWrapped)
  // Transfert : la clé du serveur + la clé publique du propriétaire donnent la même enveloppe.
  assert.deepEqual(await c.wrapServerKey(server, d(x.ownerPub), d(x.serverPriv), x.serverId, x.owner, d(x.iv)), x.ownerWrapped)
  assert.equal(e(await c.unwrapServerKey(owner, d(x.serverPub), x.ownerWrapped, x.serverId, x.owner)), x.serverPriv)
  await assert.rejects(c.unwrapServerKey(owner, d(x.serverPub), x.ownerWrapped, x.serverId, x.serverId))
  const code = c.normalizeRecoveryCode(x.recoveryCode)
  assert.equal(e(await c.unwrapKey(x.recovery, code, c.serverRecoveryAad(x.serverId), x.iterations)), x.serverPriv)
  const s = V.serverEpoch
  const key = await c.unwrapConvKey(server, d(x.ownerPub), s.wrapped, s.conv, s.epoch, s.member, s.sender)
  assert.equal(e(key), s.key)
})

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

test('clé de conversation : enveloppe A → B et refus si altérée', async () => {
  const x = V.convKey
  const a = await c.importPrivateKey(d(V.ecdh.privA), d(V.ecdh.pubA))
  const b = await c.importPrivateKey(d(V.ecdh.privB), d(V.ecdh.pubB))
  assert.deepEqual(await c.wrapConvKey(a, d(V.ecdh.pubB), d(x.key), x.conv, x.epoch, x.member, x.sender, d(x.iv)), x.wrapped)
  assert.equal(e(await c.unwrapConvKey(b, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch, x.member, x.sender)), x.key)
  // Autre époque, autre membre, autre émetteur, autre conversation : refusé.
  await assert.rejects(c.unwrapConvKey(b, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch + 1, x.member, x.sender))
  await assert.rejects(c.unwrapConvKey(b, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch, x.sender, x.sender))
  await assert.rejects(c.unwrapConvKey(b, d(V.ecdh.pubA), x.wrapped, x.conv, x.epoch, x.member, x.member))
  await assert.rejects(c.unwrapConvKey(b, d(V.ecdh.pubA), x.wrapped, 'dm:autre', x.epoch, x.member, x.sender))
})

test('message chiffré : AAD conversation|époque|auteur|id client', async () => {
  const x = V.message
  assert.deepEqual(await c.encryptMessage(d(x.key), x.conv, x.epoch, x.author, x.clientMsgId, x.body, d(x.iv)), x.enc)
  assert.deepEqual(await c.decryptMessage(d(x.key), x.conv, x.enc, x.author, x.clientMsgId), x.body)
  await assert.rejects(c.decryptMessage(d(x.key), x.conv, x.enc, 'usurpateur', x.clientMsgId))
  await assert.rejects(c.decryptMessage(d(x.key), x.conv, x.enc, x.author, 'autre-id'))
  await assert.rejects(c.decryptMessage(d(x.key), x.conv, { ...x.enc, epoch: x.epoch + 1 }, x.author, x.clientMsgId))
  // Deux chiffrements du même texte : IV différents.
  const k = d(x.key)
  const m1 = await c.encryptMessage(k, x.conv, 0, x.author, x.clientMsgId, x.body)
  const m2 = await c.encryptMessage(k, x.conv, 0, x.author, x.clientMsgId, x.body)
  assert.notEqual(m1.iv, m2.iv)
  assert.equal(c.generateConvKey().length, 32)
})

test('clé de média (vocal, appels) : HKDF de la clé d\'époque, index = époque modulo l\'anneau', async () => {
  const x = V.media
  assert.equal(c.mediaInfo(x.conv, x.epoch), x.info)
  assert.equal(await c.mediaKey(d(x.convKey), x.conv, x.epoch), x.key)
  assert.equal(c.mediaKeyIndex(x.epoch), x.keyIndex)
  assert.equal(c.mediaKeyIndex(c.MEDIA_KEYRING + 3), 3)
  // Autre époque ou autre conversation : autre clé.
  assert.notEqual(await c.mediaKey(d(x.convKey), x.conv, x.epoch + 1), x.key)
  assert.notEqual(await c.mediaKey(d(x.convKey), 'channel:autre', x.epoch), x.key)
  assert.equal(d(x.key).length, 32)
})

const pattern = n => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255)

test('fichiers : morceaux de 64 Kio, IV = numéro, AAD id|numéro|dernier', async () => {
  const s = V.fileSmall
  assert.equal(s.chunk, c.FILE_CHUNK)
  assert.equal(e(await c.encryptFileBytes(d(s.key), s.fileId, c.utf8(s.plaintext))), s.ct)
  const n = c.utf8(s.plaintext).length
  assert.equal(new TextDecoder().decode(await c.decryptFileBytes(d(s.key), s.fileId, d(s.ct), n)), s.plaintext)
  const L = V.fileLarge
  const ct = await c.encryptFileBytes(d(L.key), L.fileId, pattern(L.length))
  assert.equal(ct.length, L.ctLength)
  assert.equal(c.encryptedFileSize(L.length), L.ctLength)
  assert.equal(e(await c.sha256(ct)), L.ctSha256)
  assert.equal(e(ct.subarray(c.FILE_CT_CHUNK)), L.lastChunk)
  assert.equal(e(c.fileChunkIv(1)), L.iv1)
  assert.equal(c.fileChunkAad(L.fileId, 1, true), L.aadLast)
  assert.deepEqual(await c.decryptFileBytes(d(L.key), L.fileId, ct, L.length), pattern(L.length))
})

test('fichiers : troncature, réordonnancement, autre fichier ou autre taille refusés', async () => {
  const L = V.fileLarge
  const ct = await c.encryptFileBytes(d(L.key), L.fileId, pattern(L.length))
  // Coupé après le premier morceau (frontière exacte) : le dernier drapeau ne correspond pas.
  await assert.rejects(c.decryptFileBytes(d(L.key), L.fileId, ct.subarray(0, c.FILE_CT_CHUNK), c.FILE_CHUNK))
  // Morceaux échangés.
  const swapped = new Uint8Array(ct.length)
  swapped.set(ct.subarray(c.FILE_CT_CHUNK))
  swapped.set(ct.subarray(0, c.FILE_CT_CHUNK), ct.length - c.FILE_CT_CHUNK)
  await assert.rejects(c.decryptFileBytes(d(L.key), L.fileId, swapped, L.length))
  await assert.rejects(c.decryptFileBytes(d(L.key), '88888888-8888-4888-8888-888888888888', ct, L.length))
  await assert.rejects(c.decryptFileBytes(d(L.key), L.fileId, ct, L.length + 1))
  const bad = ct.slice(); bad[10] ^= 1
  await assert.rejects(c.decryptFileBytes(d(L.key), L.fileId, bad, L.length))
  // Vide : un morceau de 16 octets ; frontière exacte : pas de morceau vide en plus.
  assert.equal((await c.encryptFileBytes(d(L.key), L.fileId, new Uint8Array(0))).length, 16)
  assert.equal(c.encryptedFileSize(c.FILE_CHUNK), c.FILE_CT_CHUNK)
  const exact = await c.encryptFileBytes(d(L.key), L.fileId, pattern(c.FILE_CHUNK * 2))
  assert.deepEqual(await c.decryptFileBytes(d(L.key), L.fileId, exact, c.FILE_CHUNK * 2), pattern(c.FILE_CHUNK * 2))
  // Flux découpé n'importe comment : mêmes octets.
  const dec = new c.FileDecryptor(await c.fileCipher(d(L.key)), L.fileId, L.length)
  const parts = []
  for (let i = 0; i < ct.length; i += 777) parts.push(...(await dec.push(ct.subarray(i, i + 777))))
  parts.push(await dec.end())
  assert.equal(parts.reduce((a, p) => a + p.length, 0), L.length)
})

test('fichiers : message {t, f}, entrées validées, types MIME sûrs', async () => {
  const x = V.fileMessage
  assert.deepEqual(await c.encryptMessage(d(x.key), x.conv, x.epoch, x.author, x.clientMsgId, x.body, d(x.iv)), x.enc)
  const body = await c.decryptMessage(d(x.key), x.conv, x.enc, x.author, x.clientMsgId)
  assert.deepEqual(c.fileEntries(body), x.body.f)
  const ok = x.body.f[0]
  assert.deepEqual(c.fileEntries({ f: [{ ...ok, id: 'pas-un-uuid' }, { ...ok, k: 'court' }, { ...ok, s: -1 }, null] }), [])
  assert.equal(c.fileEntries({ f: [{ ...ok, n: '../../etc/passwd', u: 'https://ailleurs/x' }] })[0].n, '.._.._etc_passwd')
  assert.equal(c.fileEntries({ f: [{ ...ok, u: 'https://ailleurs/x' }] })[0].u, undefined)
  assert.equal(c.fileEntries({ f: Array(20).fill(ok) }).length, c.MAX_FILES)
  assert.equal(c.blobName(ok.id), `${ok.id}.enc`)
  assert.equal(c.safeMime('image/png'), 'image/png')
  for (const m of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/javascript'])
    assert.equal(c.safeMime(m), 'application/octet-stream')
})

test('note privée scellée pour soi : mêmes octets que le mobile', async () => {
  const x = V.privateNote
  const priv = await c.importPrivateKey(d(x.priv), d(x.pub))
  assert.deepEqual(await c.sealNote(priv, d(x.pub), x.owner, x.target, x.text, d(x.iv)), x.sealed)
  assert.equal(await c.openNote(priv, d(x.pub), x.sealed, x.owner, x.target), x.text)
  // Déplacée sur la fiche de quelqu'un d'autre : illisible.
  await assert.rejects(c.openNote(priv, d(x.pub), x.sealed, x.owner, x.owner))
})
