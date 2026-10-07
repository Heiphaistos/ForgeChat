// Primitives du chiffrement de bout en bout (mobile, noble : pas de WebCrypto).
// Doit produire les mêmes octets que client/src/e2e/crypto.ts (WebCrypto) :
// vérifié par docs/e2e-vectors.json des deux côtés. Voir docs/CHIFFREMENT-E2E.md.
import { gcm } from '@noble/ciphers/aes.js'
import { p256 } from '@noble/curves/nist.js'
import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { getRandomBytes } from 'expo-crypto'

export const PBKDF2_ITERATIONS = 600_000
const AES_KEY_BYTES = 32
const IV_BYTES = 12
const SALT_BYTES = 16

/** Clé privée enveloppée (mot de passe ou code de récupération). */
export interface WrappedKey { v: 1; salt: string; iv: string; ct: string }

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

export function randomBytes(n: number): Uint8Array {
  return getRandomBytes(n)
}

// ─── base64url sans remplissage (même code que le web) ───────────────────────
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
    const c = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]!) : 0))
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!
    out[o++] = (n >> 16) & 255
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255
    if (i + 3 < s.length) out[o++] = n & 255
  }
  return out
}

// ─── Hachage et dérivations ──────────────────────────────────────────────────
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return nobleSha256(data)
}

/** HKDF-SHA256 ; sel vide = zéros (RFC 5869). */
export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  return nobleHkdf(nobleSha256, ikm, salt, utf8(info), length)
}

/** PBKDF2-SHA256 → 32 octets ; asynchrone par tranches pour ne pas geler l'interface. */
export async function pbkdf2(secret: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  return pbkdf2Async(nobleSha256, utf8(secret), salt, { c: iterations, dkLen: AES_KEY_BYTES, asyncTick: 16 })
}

// ─── AES-256-GCM, AAD obligatoire ────────────────────────────────────────────
function checkAes(key: Uint8Array, iv: Uint8Array) {
  if (key.length !== AES_KEY_BYTES) throw new Error('clé AES invalide')
  if (iv.length !== IV_BYTES) throw new Error('IV invalide')
}

export async function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad: string): Promise<Uint8Array> {
  checkAes(key, iv)
  return gcm(key, iv, utf8(aad)).encrypt(plaintext)
}

/** Lève une erreur si la clé, l'IV, l'AAD ou le texte chiffré ne correspondent pas. */
export async function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, aad: string): Promise<Uint8Array> {
  checkAes(key, iv)
  return gcm(key, iv, utf8(aad)).decrypt(ciphertext)
}

// ─── Paire ECDH P-256 ────────────────────────────────────────────────────────
/** Paire neuve : privée = scalaire 32 o, publique = point non compressé 65 o. */
export async function generateKeyPair(): Promise<{ priv: Uint8Array; pub: Uint8Array }> {
  const priv = p256.utils.randomSecretKey(randomBytes(48))
  return { priv, pub: p256.getPublicKey(priv, false) }
}

function checkPublic(pub: Uint8Array) {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('clé publique invalide')
}

/** Clé publique correspondant au scalaire (contrôle après déchiffrement). */
export const publicFromPrivate = (priv: Uint8Array) => p256.getPublicKey(priv, false)

/** Secret ECDH = abscisse x du point partagé (32 o), comme WebCrypto. */
export async function ecdh(priv: Uint8Array, pub: Uint8Array): Promise<Uint8Array> {
  checkPublic(pub)
  return p256.getSharedSecret(priv, pub, true).slice(1)
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
  return Array.from(randomBytes(20), (b) => CROCKFORD[b & 31]).join('')
}

/** Majuscules, sans tirets ni espaces, I/L→1, O→0 ; null si invalide. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(s) ? s : null
}

export const formatRecoveryCode = (code: string) => (code.match(/.{1,5}/g) ?? []).join('-')

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

// ─── Clés de conversation et messages (§4.1) ─────────────────────────────────
/** Clé de conversation enveloppée pour un membre. */
export interface ConvWrapped { v: 1; iv: string; ct: string }
/** Contenu chiffré d'un message. */
export interface EncPayload { v: 1; epoch: number; iv: string; ct: string }
/** Contenu en clair d'un message, avant chiffrement. */
export interface MsgBody { t: string; [k: string]: unknown }

/** Identifiant de conversation dans l'AAD : `dm:<id>`, `group:<id>` ou `channel:<id>`. */
export const convName = (kind: 'dm' | 'group' | 'channel', id: string) => `${kind}:${id}`
/**
 * Portée d'un contenu de salon dans l'AAD des messages (§10) : la clé reste celle
 * du salon, la portée lie le contenu à son fil, sa publication ou son sondage.
 */
export const threadScope = (channelId: string, threadClientId: string) => `channel:${channelId}/thread:${threadClientId}`
export const postScope = (channelId: string, postClientId: string) => `channel:${channelId}/post:${postClientId}`
export const pollScope = (channelId: string, pollClientId: string) => `channel:${channelId}/poll:${pollClientId}`
export const ckInfo = (conv: string, epoch: number, member: string) => `forgechat ck v1|${conv}|${epoch}|${member}`
export const ckAad = (conv: string, epoch: number, member: string, sender: string) => `ck v1|${conv}|${epoch}|${member}|${sender}`
export const msgAad = (conv: string, epoch: number, author: string, clientMsgId: string) =>
  `msg v1|${conv}|${epoch}|${author}|${clientMsgId}`

/** Clé symétrique neuve d'une époque. */
export const generateConvKey = () => randomBytes(AES_KEY_BYTES)

async function ckWrapKey(priv: Uint8Array, otherPub: Uint8Array, conv: string, epoch: number, member: string) {
  return hkdf(await ecdh(priv, otherPub), new Uint8Array(0), ckInfo(conv, epoch, member))
}

/** Enveloppe la clé d'époque pour `member` (sa clé publique `memberPub`), IV neuf (fixé pour les vecteurs). */
export async function wrapConvKey(
  priv: Uint8Array, memberPub: Uint8Array, key: Uint8Array,
  conv: string, epoch: number, member: string, sender: string, iv: Uint8Array = randomBytes(IV_BYTES),
): Promise<ConvWrapped> {
  const k = await ckWrapKey(priv, memberPub, conv, epoch, member)
  return { v: 1, iv: b64uEncode(iv), ct: b64uEncode(await aesGcmEncrypt(k, iv, key, ckAad(conv, epoch, member, sender))) }
}

/** Ouvre une enveloppe reçue (clé publique de l'émetteur `senderPub`) ; lève une erreur si elle a été altérée. */
export async function unwrapConvKey(
  priv: Uint8Array, senderPub: Uint8Array, w: ConvWrapped,
  conv: string, epoch: number, member: string, sender: string,
): Promise<Uint8Array> {
  if (w.v !== 1) throw new Error('version inconnue')
  const k = await ckWrapKey(priv, senderPub, conv, epoch, member)
  const key = await aesGcmDecrypt(k, b64uDecode(w.iv), b64uDecode(w.ct), ckAad(conv, epoch, member, sender))
  if (key.length !== AES_KEY_BYTES) throw new Error('clé de conversation invalide')
  return key
}

/** Chiffre `body` ({t: texte, ...}) ; IV aléatoire à chaque message (fixé pour les vecteurs). */
export async function encryptMessage(
  key: Uint8Array, conv: string, epoch: number, author: string, clientMsgId: string, body: MsgBody,
  iv: Uint8Array = randomBytes(IV_BYTES),
): Promise<EncPayload> {
  const ct = await aesGcmEncrypt(key, iv, utf8(JSON.stringify(body)), msgAad(conv, epoch, author, clientMsgId))
  return { v: 1, epoch, iv: b64uEncode(iv), ct: b64uEncode(ct) }
}

/** Déchiffre et vérifie l'AAD (conversation, époque, auteur, id client) ; lève une erreur sinon. */
export async function decryptMessage(
  key: Uint8Array, conv: string, enc: EncPayload, author: string, clientMsgId: string,
): Promise<MsgBody> {
  if (enc.v !== 1) throw new Error('version inconnue')
  const pt = await aesGcmDecrypt(key, b64uDecode(enc.iv), b64uDecode(enc.ct), msgAad(conv, enc.epoch, author, clientMsgId))
  const body = JSON.parse(new TextDecoder().decode(pt)) as MsgBody
  if (!body || typeof body.t !== 'string') throw new Error('contenu invalide')
  return body
}

// ─── Clé de récupération d'un serveur (§11) ─────────────────────────────────
/** Membre virtuel « clé du serveur » des enveloppes d'époque d'un salon. */
export const serverMember = (serverId: string) => `server:${serverId}`
/** AAD de la clé privée du serveur chiffrée par son code de récupération (format de `wrapKey`). */
export const serverRecoveryAad = (serverId: string) => `forgechat server-recovery v1|${serverId}`
const skInfo = (serverId: string, owner: string) => `forgechat sk v1|${serverId}|${owner}`
const skAad = (serverId: string, owner: string) => `sk v1|${serverId}|${owner}`

/**
 * Enveloppe le scalaire de la clé du serveur pour le propriétaire `owner` :
 * AES-GCM(HKDF(ECDH(priv, otherPub))). Côté propriétaire `priv` = sa clé de compte
 * et `otherPub` = clé publique du serveur ; à un transfert, l'ancien propriétaire
 * passe la clé du serveur et la clé publique du nouveau (même secret ECDH).
 */
export async function wrapServerKey(
  priv: Uint8Array, otherPub: Uint8Array, serverPriv: Uint8Array, serverId: string, owner: string,
  iv: Uint8Array = randomBytes(IV_BYTES),
): Promise<ConvWrapped> {
  const k = await hkdf(await ecdh(priv, otherPub), new Uint8Array(0), skInfo(serverId, owner))
  return { v: 1, iv: b64uEncode(iv), ct: b64uEncode(await aesGcmEncrypt(k, iv, serverPriv, skAad(serverId, owner))) }
}

/** Ouvre l'enveloppe du propriétaire (sa clé de compte, clé publique du serveur). */
export async function unwrapServerKey(
  ownerPriv: Uint8Array, serverPub: Uint8Array, w: ConvWrapped, serverId: string, owner: string,
): Promise<Uint8Array> {
  if (w.v !== 1) throw new Error('version inconnue')
  const k = await hkdf(await ecdh(ownerPriv, serverPub), new Uint8Array(0), skInfo(serverId, owner))
  const key = await aesGcmDecrypt(k, b64uDecode(w.iv), b64uDecode(w.ct), skAad(serverId, owner))
  if (key.length !== 32) throw new Error('clé de serveur invalide')
  return key
}
