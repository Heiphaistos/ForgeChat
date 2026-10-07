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
const wrapOpts = { salt: seq(16, 50), iv: seq(12, 70), iterations: ITER }

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
