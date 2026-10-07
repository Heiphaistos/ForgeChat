// Produit docs/e2e-vectors.json avec les primitives web : node scripts/e2e-vectors.gen.mjs
// Entrées fixes (clés, sels, IV, mot de passe) : la sortie est déterministe.
// À ne relancer que si une primitive change volontairement (les deux clients doivent suivre).
import { writeFileSync } from 'node:fs'
import * as c from '../src/e2e/crypto.ts'

const d = c.b64uDecode
const e = c.b64uEncode
const A = { priv: 'L24splOxTaDPUjoID3CwNoGNy24phnKElhs2cqVYqFY', pub: 'BOICWfpxS3xMFy1Hk9p-Od4Lx4J_0RTvujHlEL1uqLnjS1OXGYcw8PD4ah_Is1vmLjum1Xl-EcrukfhXNWmLIGE' }
const B = { priv: 'zslAYtkIncvKCfnl26J9l9DDHjTo46o2b0ZM7HmGPrw', pub: 'BCJDA2NGTYMJQ2WFCNGtsH7czk4ADlFGKe2SFGvecziTTeGblF3OakkgcKxfWVBsE3ajb2Rn8yiuVp3HJCuSP4s' }
const seq = (n, from) => Uint8Array.from({ length: n }, (_, i) => (from + i) & 255)
const ITER = 1000
const userId = '6f1c2b3a-9d4e-4c5b-8a7f-0e1d2c3b4a59'

const shared = await c.ecdh(await c.importPrivateKey(d(A.priv), d(A.pub)), d(B.pub))
const info = `forgechat ck v1|conv|0|${userId}`
const aes = { key: e(seq(32, 1)), iv: e(seq(12, 100)), aad: 'msg v1|conv|0|auteur|client-id', plaintext: '{"t":"Salut ! Ça chiffre ? 🔐"}' }
aes.ct = e(await c.aesGcmEncrypt(d(aes.key), d(aes.iv), c.utf8(aes.plaintext), aes.aad))
const pb = { password: 'Mot de passe très sûr 42!', salt: e(seq(16, 200)), iterations: ITER }
pb.key = e(await c.pbkdf2(pb.password, d(pb.salt), ITER))
const recovery = '7K3QZ-M9XW2-PB4TD-0VH1R'
const conv = c.convName('group', '0b8f6c1e-2d3a-4e5f-9a8b-7c6d5e4f3a21')
const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', msg: '33333333-3333-4333-8333-333333333333' }
const convKey = { conv, epoch: 2, sender: ids.a, member: ids.b, key: e(seq(32, 120)), iv: e(seq(12, 160)) }
convKey.wrapped = await c.wrapConvKey(await c.importPrivateKey(d(A.priv), d(A.pub)), d(B.pub), d(convKey.key), conv, 2, ids.b, ids.a, d(convKey.iv))
const message = { conv, epoch: 2, author: ids.a, clientMsgId: ids.msg, key: convKey.key, iv: e(seq(12, 180)), body: { t: 'Réponse chiffrée 🔐 **gras**' } }
message.enc = await c.encryptMessage(d(message.key), conv, 2, ids.a, ids.msg, message.body, d(message.iv))
// Clé de média (vocal, appels) de l'époque 2, dérivée de la clé de conversation ci-dessus.
const media = { conv, epoch: 2, convKey: convKey.key, info: c.mediaInfo(conv, 2), keyIndex: c.mediaKeyIndex(2) }
media.key = await c.mediaKey(d(convKey.key), conv, 2)
const wrapOpts = { salt: seq(16, 50), iv: seq(12, 70), iterations: ITER }
// Salons (§10) : même clé que le salon, portée du fil / de la publication / du sondage dans l'AAD.
const chan = '44444444-4444-4444-8444-444444444444'
const sub = '55555555-5555-4555-8555-555555555555'
const scoped = async (scope, body, from) => {
  const x = { scope, epoch: 3, author: ids.a, clientMsgId: ids.msg, key: convKey.key, iv: e(seq(12, from)), body }
  x.enc = await c.encryptMessage(d(x.key), scope, 3, ids.a, ids.msg, body, d(x.iv))
  return x
}
const threadMessage = await scoped(c.threadScope(chan, sub), { t: 'Dans le fil 🧵' }, 190)
const forumPost = await scoped(c.postScope(chan, sub), { t: 'Contenu de la publication', title: 'Titre chiffré' }, 200)
const poll = await scoped(c.pollScope(chan, sub), { t: 'Pizza ou raclette ?', o: ['Pizza', 'Raclette 🧀'] }, 210)
// Clé de récupération du serveur (§11) : B = clé du serveur, A = propriétaire.
const serverId = '66666666-6666-4666-8666-666666666666'
const aPriv = await c.importPrivateKey(d(A.priv), d(A.pub))
const serverKey = { serverId, owner: ids.a, ownerPriv: A.priv, ownerPub: A.pub, serverPriv: B.priv, serverPub: B.pub, iv: e(seq(12, 220)) }
serverKey.ownerWrapped = await c.wrapServerKey(aPriv, d(B.pub), d(B.priv), serverId, ids.a, d(serverKey.iv))
serverKey.recoveryCode = recovery
serverKey.recovery = await c.wrapKey(d(B.priv), c.normalizeRecoveryCode(recovery), c.serverRecoveryAad(serverId), wrapOpts)
serverKey.iterations = ITER
const serverEpoch = { conv: c.convName('channel', chan), epoch: 3, sender: ids.a, member: c.serverMember(serverId), key: convKey.key, iv: e(seq(12, 230)) }
serverEpoch.wrapped = await c.wrapConvKey(aPriv, d(B.pub), d(serverEpoch.key), serverEpoch.conv, 3, serverEpoch.member, ids.a, d(serverEpoch.iv))

const vectors = {
  note: 'Vecteurs communs web/mobile (client/scripts/e2e-vectors.gen.mjs). Itérations PBKDF2 réduites pour les tests uniquement (production : 600000).',
  ecdh: {
    privA: A.priv, pubA: A.pub, privB: B.priv, pubB: B.pub, shared: e(shared),
    hkdf: { salt: '', info, length: 32, okm: e(await c.hkdf(shared, new Uint8Array(0), info, 32)) },
  },
  aesgcm: aes,
  pbkdf2: pb,
  wrap: {
    userId, priv: A.priv, password: pb.password, iterations: ITER,
    wrapped: await c.wrapKey(d(A.priv), pb.password, c.keyAad(userId), wrapOpts),
    recoveryCode: recovery,
    backup: await c.wrapKey(d(A.priv), c.normalizeRecoveryCode(recovery), c.backupAad(userId), wrapOpts),
  },
  fingerprint: { pub: A.pub, fp: e(await c.fingerprint(d(A.pub))) },
  safety: { pubA: A.pub, pubB: B.pub, code: await c.safetyCode(d(A.pub), d(B.pub)) },
  // Clé d'époque enveloppée par A pour B, puis message chiffré avec cette clé.
  convKey,
  message,
  media,
  // Salons : message de fil, publication de forum ({t, title}), sondage ({t, o}).
  threadMessage,
  forumPost,
  poll,
  // Clé du serveur enveloppée pour le propriétaire et par le code ; époque de salon pour la clé du serveur.
  serverKey,
  serverEpoch,
  recoveryNormalize: [
    ['7k3qz-m9xw2-pb4td-0vh1r', '7K3QZM9XW2PB4TD0VH1R'],
    [' 7K3QZ M9XW2 PB4TD OVHIR ', '7K3QZM9XW2PB4TD0VH1R'],
    ['7K3QZ-M9XW2-PB4TD-0VHLR', '7K3QZM9XW2PB4TD0VH1R'],
    ['7K3QZ-M9XW2-PB4TD-0VH1', null],
    ['7K3QZ-M9XW2-PB4TD-0VH1U', null],
  ],
}
writeFileSync(new URL('../../docs/e2e-vectors.json', import.meta.url), JSON.stringify(vectors, null, 2) + '\n')
console.log('docs/e2e-vectors.json écrit')
