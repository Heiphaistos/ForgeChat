// Connexion v2 (docs/CHIFFREMENT-E2E.md §3) : le mot de passe ne quitte jamais l'appareil.
// master = PBKDF2-SHA256(NFKC(mot de passe), kdf_salt, 600 000) ;
// auth = HKDF(master, "forgechat auth v2") est envoyé au serveur (il en garde un bcrypt) ;
// wrapKey = HKDF(master, "forgechat wrap v2") reste ici et scelle la clé privée de compte.
// Mêmes octets sur mobile (mobile/src/e2e/authKdf.ts), vecteurs `authV2` de docs/e2e-vectors.json.
import * as c from './crypto.ts'

export const AUTH_INFO = 'forgechat auth v2'
export const WRAP_INFO = 'forgechat wrap v2'
/** Longueur minimale du mot de passe (vérifiée ici : le serveur ne voit plus le mot de passe). */
export const MIN_PASSWORD = 10
export const MAX_PASSWORD = 128

export const keyAadV2 = (userId: string) => `forgechat key v2|${userId}`

/** Clé privée scellée par la wrapKey (pas de sel propre : celui du compte, `kdf_salt`). */
export interface WrappedKeyV2 { v: 2; iv: string; ct: string }
export type AnyWrapped = c.WrappedKey | WrappedKeyV2

export interface AccountSecrets { auth: string; wrapKey: Uint8Array }

const EMPTY = new Uint8Array(0)

export async function deriveSecrets(password: string, kdfSalt: string, iterations?: number): Promise<AccountSecrets> {
  const master = await c.pbkdf2(password.normalize('NFKC'), c.b64uDecode(kdfSalt), iterations)
  try {
    const auth = c.b64uEncode(await c.hkdf(master, EMPTY, AUTH_INFO))
    const wrapKey = await c.hkdf(master, EMPTY, WRAP_INFO)
    return { auth, wrapKey }
  } finally {
    master.fill(0)
  }
}

export const newKdfSalt = () => c.b64uEncode(c.randomBytes(16))

/** Erreur lisible pour l'écran, ou null si le mot de passe convient. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères`
  if (pw.length > MAX_PASSWORD) return `Le mot de passe doit faire au plus ${MAX_PASSWORD} caractères`
  return null
}

export async function wrapKeyV2(priv: Uint8Array, wrapKey: Uint8Array, userId: string, iv = c.randomBytes(12)): Promise<WrappedKeyV2> {
  const ct = await c.aesGcmEncrypt(wrapKey, iv, priv, keyAadV2(userId))
  return { v: 2, iv: c.b64uEncode(iv), ct: c.b64uEncode(ct) }
}

export async function unwrapKeyV2(w: WrappedKeyV2, wrapKey: Uint8Array, userId: string): Promise<Uint8Array> {
  if (w.v !== 2) throw new Error('version inconnue')
  const priv = await c.aesGcmDecrypt(wrapKey, c.b64uDecode(w.iv), c.b64uDecode(w.ct), keyAadV2(userId))
  if (priv.length !== 32) throw new Error('clé privée invalide')
  return priv
}

/** Ouvre une enveloppe v2 (wrapKey) ou v1 (mot de passe, lisible pour la migration). */
export async function unwrapAny(w: AnyWrapped, password: string, secrets: AccountSecrets | null, userId: string): Promise<Uint8Array> {
  if (w.v === 2) {
    if (!secrets) throw new Error('NEED_V2')
    return unwrapKeyV2(w, secrets.wrapKey, userId)
  }
  return c.unwrapKey(w, password, c.keyAad(userId))
}
