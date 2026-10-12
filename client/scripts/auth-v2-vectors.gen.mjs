// Ajoute/réécrit `authV2` dans docs/e2e-vectors.json (connexion v2, authKdf.ts) sans toucher au reste :
// node scripts/auth-v2-vectors.gen.mjs — entrées fixes, sortie déterministe.
// Le mot de passe contient « Ｍ » (pleine chasse) et « ﬁ » (ligature) : la normalisation NFKC compte.
import { readFileSync, writeFileSync } from 'node:fs'
import * as c from '../src/e2e/crypto.ts'
import * as k from '../src/e2e/authKdf.ts'

const url = new URL('../../docs/e2e-vectors.json', import.meta.url)
const V = JSON.parse(readFileSync(url, 'utf8'))
const e = c.b64uEncode
const seq = (n, from) => Uint8Array.from({ length: n }, (_, i) => (from + i) & 255)
const ITER = 1000
const userId = V.wrap.userId
const password = 'Ｍot de passe ﬁable 42!'
const kdfSalt = e(seq(16, 30))
const master = await c.pbkdf2(password.normalize('NFKC'), seq(16, 30), ITER)
const s = await k.deriveSecrets(password, kdfSalt, ITER)
const iv = seq(12, 90)

V.authV2 = {
  password,
  passwordNfkc: password.normalize('NFKC'),
  kdfSalt,
  iterations: ITER,
  master: e(master),
  authInfo: k.AUTH_INFO,
  wrapInfo: k.WRAP_INFO,
  auth: s.auth,
  wrapKey: e(s.wrapKey),
  userId,
  priv: V.wrap.priv,
  aad: k.keyAadV2(userId),
  wrapped: await k.wrapKeyV2(c.b64uDecode(V.wrap.priv), s.wrapKey, userId, iv),
}
// Argon2id (audit 2026-10-12, M3) : mêmes entrées, paramètres de production (m = 19 Mio, t = 2, p = 1).
{
  const a = await k.deriveSecrets(password, kdfSalt, 'argon2id')
  V.authArgon2 = { password, kdfSalt, params: k.ARGON2, auth: a.auth, wrapKey: e(a.wrapKey) }
}
writeFileSync(url, JSON.stringify(V, null, 2) + '\n')
console.log(V.authV2)
