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
