// Connexion v2 (docs/CHIFFREMENT-E2E.md §3) : le mot de passe ne quitte jamais l'appareil.
// master = PBKDF2-SHA256(NFKC(mot de passe), kdf_salt, 600 000) ;
// auth = HKDF(master, "forgechat auth v2") est envoyé au serveur (il en garde un bcrypt) ;
// wrapKey = HKDF(master, "forgechat wrap v2") reste ici et scelle la clé privée de compte.
// Mêmes octets sur le web (client/src/e2e/authKdf.ts), vecteurs `authV2` de docs/e2e-vectors.json.
import { argon2idAsync } from '@noble/hashes/argon2.js'
import * as c from './crypto'

export const AUTH_INFO = 'forgechat auth v2'
export const WRAP_INFO = 'forgechat wrap v2'
/** Longueur minimale du mot de passe (vérifiée ici : le serveur ne voit plus le mot de passe). */
export const MIN_PASSWORD = 12
export const MAX_PASSWORD = 128

export const keyAadV2 = (userId: string) => `forgechat key v2|${userId}`

/** Clé privée scellée par la wrapKey (pas de sel propre : celui du compte, `kdf_salt`). */
export interface WrappedKeyV2 { v: 2; iv: string; ct: string }
export type AnyWrapped = c.WrappedKey | WrappedKeyV2

export interface AccountSecrets { auth: string; wrapKey: Uint8Array }

const EMPTY = new Uint8Array(0)

/**
 * Dérivation du mot de passe (audit 2026-10-12, M3) : `argon2id` pour tout mot de passe choisi
 * depuis (inscription, changement, réinitialisation, migration à la connexion) ; `pbkdf2`
 * (600 000 itérations) pour les comptes pas encore basculés. Argon2id coûte 19 Mio de mémoire
 * par essai : une attaque hors ligne sur carte graphique (serveur compromis) devient bien plus chère.
 * Paramètres « m = 19 Mio, t = 2, p = 1 » (minimum OWASP), tenables par une appli mobile en JS pur.
 */
export type Kdf = 'pbkdf2' | 'argon2id'
export const ARGON2 = { t: 2, m: 19456, p: 1 } as const
/** Dérivation annoncée par le serveur ; inconnue ou absente = `pbkdf2`. */
export const asKdf = (v: unknown): Kdf => (v === 'argon2id' ? 'argon2id' : 'pbkdf2')

/** `kdf` : dérivation, ou nombre d'itérations PBKDF2 (vecteurs de test). */
export async function deriveSecrets(password: string, kdfSalt: string, kdf: Kdf | number = 'pbkdf2'): Promise<AccountSecrets> {
  const pw = password.normalize('NFKC')
  const salt = c.b64uDecode(kdfSalt)
  const master = kdf === 'argon2id'
    ? await argon2idAsync(new TextEncoder().encode(pw), salt, { ...ARGON2, dkLen: 32 })
    : await c.pbkdf2(pw, salt, typeof kdf === 'number' ? kdf : undefined)
  try {
    const auth = c.b64uEncode(await c.hkdf(master, EMPTY, AUTH_INFO))
    const wrapKey = await c.hkdf(master, EMPTY, WRAP_INFO)
    return { auth, wrapKey }
  } finally {
    master.fill(0)
  }
}

export const newKdfSalt = () => c.b64uEncode(c.randomBytes(16))

/**
 * Erreur lisible pour l'écran, ou null si le mot de passe convient. Il protège aussi la clé de
 * chiffrement : son enveloppe est gardée par le serveur, qui (compromis) pourrait l'attaquer hors
 * ligne. Seul l'appareil voit le mot de passe : c'est donc ici que la règle s'applique.
 * `context` : pseudo, e-mail… qui ne doivent pas en être la base.
 */
export function passwordProblem(pw: string, context: readonly string[] = []): string | null {
  if (pw.length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères`
  if (pw.length > MAX_PASSWORD) return `Le mot de passe doit faire au plus ${MAX_PASSWORD} caractères`
  if (new Set(pw).size < 6) return 'Mot de passe trop répétitif : varie davantage les caractères'
  const low = pw.toLowerCase()
  const bases = [...COMMON_BASES, ...context.flatMap(v => v.toLowerCase().split('@')).filter(v => v.length >= 4)]
  if (bases.some(b => low.includes(b))) return 'Mot de passe trop facile à deviner (mot courant, suite de touches, pseudo ou e-mail)'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length
  if (pw.length < 16 && classes < 3) {
    return 'Mélange au moins 3 sortes de caractères (minuscules, majuscules, chiffres, symboles), ou choisis une phrase de 16 caractères ou plus'
  }
  return null
}

/** Bases des mots de passe les plus essayés (listes de fuites), en minuscules. */
const COMMON_BASES = [
  'password', 'motdepasse', 'azerty', 'qwerty', 'qwertz', '123456', '654321', '000000', '111111', 'abc123',
  'iloveyou', 'jetaime', 'soleil', 'bonjour', 'doudou', 'loulou', 'chouchou', 'marseille', 'forgechat',
  'admin', 'welcome', 'letmein', 'dragon', 'monkey', 'football', 'sunshine', 'princess', 'qazwsx', 'zxcvbn',
]

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
