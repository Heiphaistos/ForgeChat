// Primitives du chiffrement de bout en bout (web, WebCrypto).
// Doit produire les mêmes octets que mobile/src/e2e/crypto.ts (noble) :
// vérifié par docs/e2e-vectors.json des deux côtés. Voir docs/CHIFFREMENT-E2E.md.
// Aucun import local : `node --test` charge ce fichier directement.

const subtle = globalThis.crypto.subtle

export const PBKDF2_ITERATIONS = 600_000
const AES_KEY_BYTES = 32
const IV_BYTES = 12
const SALT_BYTES = 16

/** Clé privée enveloppée (mot de passe ou code de récupération). */
export interface WrappedKey { v: 1; salt: string; iv: string; ct: string }

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
// WebCrypto exige un ArrayBuffer propre (pas un SharedArrayBuffer) dans ses types.
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

// ─── base64url sans remplissage ──────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function b64uEncode(b: Uint8Array): string {
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    if (i + 1 < b.length) out += B64[(n >> 6) & 63]!
    if (i + 2 < b.length) out += B64[n & 63]!
  }
  return out
}

/** Décodage strict : lève une erreur sur tout caractère ou longueur invalide. */
export function b64uDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('base64url invalide')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let o = 0
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map(k => (i + k < s.length ? B64.indexOf(s[i + k]!) : 0))
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!
    out[o++] = (n >> 16) & 255
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255
    if (i + 3 < s.length) out[o++] = n & 255
  }
  return out
}

// ─── Hachage et dérivations ──────────────────────────────────────────────────
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', buf(data)))
}

/** HKDF-SHA256 ; sel vide = zéros (RFC 5869). */
export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  const k = await subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(utf8(info)) }, k, length * 8)
  return new Uint8Array(bits)
}

/** PBKDF2-SHA256 → 32 octets (clé AES-256). */
export async function pbkdf2(secret: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  const k = await subtle.importKey('raw', buf(utf8(secret)), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, k, AES_KEY_BYTES * 8)
  return new Uint8Array(bits)
}

// ─── AES-256-GCM, AAD obligatoire ────────────────────────────────────────────
async function aesKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (key.length !== AES_KEY_BYTES) throw new Error('clé AES invalide')
  return subtle.importKey('raw', buf(key), 'AES-GCM', false, [usage])
}

export async function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad: string): Promise<Uint8Array> {
  if (iv.length !== IV_BYTES) throw new Error('IV invalide')
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8(aad)) }, await aesKey(key, 'encrypt'), buf(plaintext))
  return new Uint8Array(ct)
}

/** Lève une erreur si la clé, l'IV, l'AAD ou le texte chiffré ne correspondent pas. */
export async function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, aad: string): Promise<Uint8Array> {
  if (iv.length !== IV_BYTES) throw new Error('IV invalide')
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8(aad)) }, await aesKey(key, 'decrypt'), buf(ciphertext))
  return new Uint8Array(pt)
}

// ─── Paire ECDH P-256 ────────────────────────────────────────────────────────
/** Paire neuve : privée = scalaire 32 o, publique = point non compressé 65 o. */
export async function generateKeyPair(): Promise<{ priv: Uint8Array; pub: Uint8Array }> {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const jwk = await subtle.exportKey('jwk', kp.privateKey)
  const pub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey))
  return { priv: b64uDecode(jwk.d!), pub }
}

function checkPublic(pub: Uint8Array) {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('clé publique invalide')
}

/** Importe la clé privée en CryptoKey NON extractible (JWK avec d). */
export async function importPrivateKey(priv: Uint8Array, pub: Uint8Array): Promise<CryptoKey> {
  checkPublic(pub)
  if (priv.length !== 32) throw new Error('clé privée invalide')
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', ext: false, key_ops: ['deriveBits'],
    x: b64uEncode(pub.subarray(1, 33)), y: b64uEncode(pub.subarray(33)), d: b64uEncode(priv),
  }
  return subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
}

/** Secret ECDH = abscisse x du point partagé (32 o). */
export async function ecdh(priv: CryptoKey, pub: Uint8Array): Promise<Uint8Array> {
  checkPublic(pub)
  const pk = await subtle.importKey('raw', buf(pub), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pk }, priv, 256))
}

// ─── Empreinte et code de sécurité ───────────────────────────────────────────
export const fingerprint = (pub: Uint8Array) => sha256(pub)

/** 30 chiffres pour une clé : 6 blocs de 5 octets (gros-boutiste) modulo 100000. */
async function safetyHalf(pub: Uint8Array): Promise<string> {
  const h = await sha256(new Uint8Array([...utf8('forgechat safety v1|'), ...(await fingerprint(pub))]))
  let out = ''
  for (let i = 0; i < 30; i += 5) {
    let n = 0
    for (let k = 0; k < 5; k++) n = n * 256 + h[i + k]!
    out += String(n % 100000).padStart(5, '0')
  }
  return out
}

/** Code de sécurité de 60 chiffres (comme Signal) : identique vu des deux côtés. */
export async function safetyCode(pubA: Uint8Array, pubB: Uint8Array): Promise<string> {
  const halves = [await safetyHalf(pubA), await safetyHalf(pubB)].sort()
  return halves.join('')
}

// ─── Code de récupération (Crockford base32, 20 car. = 100 bits) ─────────────
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateRecoveryCode(): string {
  // 256 est multiple de 32 : `& 31` reste uniforme.
  return Array.from(randomBytes(20), b => CROCKFORD[b & 31]).join('')
}

/** Majuscules, sans tirets ni espaces, I/L→1, O→0 ; null si invalide. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(s) ? s : null
}

export const formatRecoveryCode = (code: string) => code.match(/.{1,5}/g)!.join('-')

// ─── Enveloppe de la clé privée ──────────────────────────────────────────────
export const keyAad = (userId: string) => `forgechat key v1|${userId}`
export const backupAad = (userId: string) => `forgechat backup v1|${userId}`

/** Chiffre le scalaire avec PBKDF2(secret) ; sel et IV neufs à chaque appel (fixés pour les vecteurs). */
export async function wrapKey(
  priv: Uint8Array, secret: string, aad: string,
  opts: { salt?: Uint8Array; iv?: Uint8Array; iterations?: number } = {},
): Promise<WrappedKey> {
  const salt = opts.salt ?? randomBytes(SALT_BYTES)
  const iv = opts.iv ?? randomBytes(IV_BYTES)
  const k = await pbkdf2(secret, salt, opts.iterations)
  return { v: 1, salt: b64uEncode(salt), iv: b64uEncode(iv), ct: b64uEncode(await aesGcmEncrypt(k, iv, priv, aad)) }
}

/** Rend le scalaire ; lève une erreur si le secret est faux. */
export async function unwrapKey(w: WrappedKey, secret: string, aad: string, iterations?: number): Promise<Uint8Array> {
  if (w.v !== 1) throw new Error('version inconnue')
  const k = await pbkdf2(secret, b64uDecode(w.salt), iterations)
  const priv = await aesGcmDecrypt(k, b64uDecode(w.iv), b64uDecode(w.ct), aad)
  if (priv.length !== 32) throw new Error('clé privée invalide')
  return priv
}
