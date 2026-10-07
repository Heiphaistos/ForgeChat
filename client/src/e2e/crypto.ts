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

async function ckWrapKey(priv: CryptoKey, otherPub: Uint8Array, conv: string, epoch: number, member: string) {
  return hkdf(await ecdh(priv, otherPub), new Uint8Array(0), ckInfo(conv, epoch, member))
}

/** Enveloppe la clé d'époque pour `member` (sa clé publique `memberPub`), IV neuf (fixé pour les vecteurs). */
export async function wrapConvKey(
  priv: CryptoKey, memberPub: Uint8Array, key: Uint8Array,
  conv: string, epoch: number, member: string, sender: string, iv: Uint8Array = randomBytes(IV_BYTES),
): Promise<ConvWrapped> {
  const k = await ckWrapKey(priv, memberPub, conv, epoch, member)
  return { v: 1, iv: b64uEncode(iv), ct: b64uEncode(await aesGcmEncrypt(k, iv, key, ckAad(conv, epoch, member, sender))) }
}

/** Ouvre une enveloppe reçue (clé publique de l'émetteur `senderPub`) ; lève une erreur si elle a été altérée. */
export async function unwrapConvKey(
  priv: CryptoKey, senderPub: Uint8Array, w: ConvWrapped,
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

// ─── Médias : vocal, appels, caméra, partage d'écran (§5) ────────────────────
/** Taille de l'anneau de clés de LiveKit : index de clé = époque modulo cette taille. */
export const MEDIA_KEYRING = 16
export const mediaInfo = (conv: string, epoch: number) => `forgechat media v1|${conv}|${epoch}`
export const mediaKeyIndex = (epoch: number) => epoch % MEDIA_KEYRING

/**
 * Clé de média d'une époque, en base64url : c'est cette chaîne qui est donnée à
 * LiveKit (web, mobile et bureau natif la dérivent ensuite tous par PBKDF2, le
 * seul chemin commun à tous les SDK LiveKit).
 */
export async function mediaKey(convKey: Uint8Array, conv: string, epoch: number): Promise<string> {
  return b64uEncode(await hkdf(convKey, new Uint8Array(0), mediaInfo(conv, epoch), AES_KEY_BYTES))
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
  priv: CryptoKey, otherPub: Uint8Array, serverPriv: Uint8Array, serverId: string, owner: string,
  iv: Uint8Array = randomBytes(IV_BYTES),
): Promise<ConvWrapped> {
  const k = await hkdf(await ecdh(priv, otherPub), new Uint8Array(0), skInfo(serverId, owner))
  return { v: 1, iv: b64uEncode(iv), ct: b64uEncode(await aesGcmEncrypt(k, iv, serverPriv, skAad(serverId, owner))) }
}

/** Ouvre l'enveloppe du propriétaire (sa clé de compte, clé publique du serveur). */
export async function unwrapServerKey(
  ownerPriv: CryptoKey, serverPub: Uint8Array, w: ConvWrapped, serverId: string, owner: string,
): Promise<Uint8Array> {
  if (w.v !== 1) throw new Error('version inconnue')
  const k = await hkdf(await ecdh(ownerPriv, serverPub), new Uint8Array(0), skInfo(serverId, owner))
  const key = await aesGcmDecrypt(k, b64uDecode(w.iv), b64uDecode(w.ct), skAad(serverId, owner))
  if (key.length !== 32) throw new Error('clé de serveur invalide')
  return key
}

// ─── Fichiers et pièces jointes (§12) ───────────────────────────────────────
/**
 * Un fichier = une clé aléatoire de 32 o (dans le message chiffré) ; découpé en
 * morceaux de 64 Kio chiffrés chacun en AES-256-GCM. IV = 4 octets nuls + numéro
 * du morceau sur 8 octets (gros-boutiste) : la clé ne sert qu'à ce fichier, l'IV
 * ne se répète donc jamais. AAD = id du fichier + numéro + drapeau « dernier » :
 * un morceau déplacé, retiré ou une fin tronquée ne se déchiffre pas.
 */
export const FILE_CHUNK = 64 * 1024
const FILE_TAG = 16
/** Taille d'un morceau chiffré complet. */
export const FILE_CT_CHUNK = FILE_CHUNK + FILE_TAG
export const fileChunkAad = (fileId: string, index: number, last: boolean) => `file v1|${fileId}|${index}|${last ? 1 : 0}`

export function fileChunkIv(index: number): Uint8Array {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('morceau invalide')
  const iv = new Uint8Array(IV_BYTES)
  const v = new DataView(iv.buffer)
  v.setUint32(4, Math.floor(index / 2 ** 32))
  v.setUint32(8, index >>> 0)
  return iv
}

/** Taille du fichier chiffré (un morceau au moins, même vide). */
export const encryptedFileSize = (size: number) => size + Math.max(1, Math.ceil(size / FILE_CHUNK)) * FILE_TAG

export interface FileCipher {
  encrypt(fileId: string, index: number, last: boolean, plain: Uint8Array): Promise<Uint8Array>
  decrypt(fileId: string, index: number, last: boolean, ct: Uint8Array): Promise<Uint8Array>
}

/** Clé de fichier importée une fois pour tous ses morceaux. */
export async function fileCipher(key: Uint8Array): Promise<FileCipher> {
  if (key.length !== AES_KEY_BYTES) throw new Error('clé AES invalide')
  const k = await subtle.importKey('raw', buf(key), 'AES-GCM', false, ['encrypt', 'decrypt'])
  const params = (fileId: string, i: number, last: boolean): AesGcmParams =>
    ({ name: 'AES-GCM', iv: buf(fileChunkIv(i)), additionalData: buf(utf8(fileChunkAad(fileId, i, last))) })
  return {
    encrypt: async (fileId, i, last, plain) => new Uint8Array(await subtle.encrypt(params(fileId, i, last), k, buf(plain))),
    decrypt: async (fileId, i, last, ct) => new Uint8Array(await subtle.decrypt(params(fileId, i, last), k, buf(ct))),
  }
}

/** Déchiffrement en flux : octets reçus au fil du réseau, morceaux en clair rendus dans l'ordre. */
export class FileDecryptor {
  private pending = new Uint8Array(0)
  private index = 0
  private total = 0
  private readonly c: FileCipher
  private readonly fileId: string
  private readonly size: number
  constructor(c: FileCipher, fileId: string, size: number) {
    this.c = c
    this.fileId = fileId
    this.size = size
  }

  /** Ajoute des octets chiffrés ; rend les morceaux en clair complets (jamais le dernier). */
  async push(data: Uint8Array): Promise<Uint8Array[]> {
    const merged = new Uint8Array(this.pending.length + data.length)
    merged.set(this.pending)
    merged.set(data, this.pending.length)
    const out: Uint8Array[] = []
    let off = 0
    // Strictement plus qu'un morceau en attente : celui-ci n'est pas le dernier.
    while (merged.length - off > FILE_CT_CHUNK) {
      out.push(await this.open(merged.subarray(off, off + FILE_CT_CHUNK), false))
      off += FILE_CT_CHUNK
    }
    this.pending = merged.slice(off)
    return out
  }

  /** Dernier morceau ; lève une erreur si le fichier est tronqué, altéré ou n'a pas la taille annoncée. */
  async end(): Promise<Uint8Array> {
    if (this.pending.length < FILE_TAG) throw new Error('fichier tronqué')
    const last = await this.open(this.pending, true)
    if (this.total !== this.size) throw new Error('taille du fichier invalide')
    return last
  }

  private async open(ct: Uint8Array, last: boolean) {
    const pt = await this.c.decrypt(this.fileId, this.index++, last, ct)
    this.total += pt.length
    if (this.total > this.size) throw new Error('taille du fichier invalide')
    return pt
  }
}

/** Chiffre un fichier tenu en mémoire (vecteurs, petits fichiers). */
export async function encryptFileBytes(key: Uint8Array, fileId: string, data: Uint8Array): Promise<Uint8Array> {
  const c = await fileCipher(key)
  const out = new Uint8Array(encryptedFileSize(data.length))
  let o = 0
  for (let i = 0, off = 0; ; i++, off += FILE_CHUNK) {
    const last = off + FILE_CHUNK >= data.length
    const ct = await c.encrypt(fileId, i, last, data.subarray(off, off + FILE_CHUNK))
    out.set(ct, o)
    o += ct.length
    if (last) return out
  }
}

/** Déchiffre un fichier tenu en mémoire ; lève une erreur s'il est altéré, tronqué ou d'une autre taille. */
export async function decryptFileBytes(key: Uint8Array, fileId: string, data: Uint8Array, size: number): Promise<Uint8Array> {
  const d = new FileDecryptor(await fileCipher(key), fileId, size)
  const parts = [...(await d.push(data)), await d.end()]
  const out = new Uint8Array(size)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/**
 * Description d'un fichier dans le contenu chiffré du message (`f: [...]`) :
 * id (blob `<id>.enc` sur le serveur), clé, nom, type MIME, taille, dimensions,
 * durée (s), miniature JPEG (base64url) ; `u` = adresse du blob quand elle est
 * connue avant l'envoi (publications de forum et de salon média).
 */
export interface FileEntry {
  id: string; k: string; n: string; m: string; s: number
  w?: number; h?: number; d?: number; th?: string; u?: string
}
export const MAX_FILES = 10
/** Miniature JPEG en base64url : 6 Kio au plus (elle voyage dans chaque message). */
export const MAX_THUMB_B64 = 8 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Liste `f` d'un contenu déchiffré, validée (entrées invalides ignorées). */
export function fileEntries(body: unknown): FileEntry[] {
  const list = (body as { f?: unknown } | null | undefined)?.f
  if (!Array.isArray(list)) return []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  const out: FileEntry[] = []
  for (const raw of list.slice(0, MAX_FILES)) {
    const e = raw as Record<string, unknown> | null
    if (!e || typeof e.id !== 'string' || !UUID_RE.test(e.id) || typeof e.k !== 'string' || typeof e.n !== 'string' || typeof e.m !== 'string') continue
    if (typeof e.s !== 'number' || !Number.isSafeInteger(e.s) || e.s < 0) continue
    try { if (b64uDecode(e.k).length !== AES_KEY_BYTES) continue } catch { continue }
    const entry: FileEntry = { id: e.id, k: e.k, n: e.n.replace(/[/\\\0]/g, '_').slice(0, 255) || 'fichier', m: e.m.slice(0, 127), s: e.s }
    const w = num(e.w), h = num(e.h), d = num(e.d)
    if (w !== undefined) entry.w = w
    if (h !== undefined) entry.h = h
    if (d !== undefined) entry.d = d
    if (typeof e.th === 'string' && e.th.length <= MAX_THUMB_B64 && /^[A-Za-z0-9_-]+$/.test(e.th)) entry.th = e.th
    if (typeof e.u === 'string' && /^\/uploads\/[0-9a-f-]{36}\.enc$/.test(e.u)) entry.u = e.u
    out.push(entry)
  }
  return out
}

/** Nom du blob chiffré d'une entrée sur le serveur. */
export const blobName = (fileId: string) => `${fileId}.enc`

/**
 * Type MIME sûr pour afficher un fichier déchiffré : le type annoncé vient de
 * l'expéditeur et une adresse blob: hérite de l'origine de l'appli ; tout ce qui
 * pourrait s'exécuter (HTML, SVG, XML…) devient un fichier opaque.
 */
export function safeMime(m: string): string {
  const t = m.toLowerCase().split(';')[0]!.trim()
  return /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|mp3|mp4|m4a|x-m4a|aac|flac|ogg|wav|x-wav|webm|opus)|application\/pdf|text\/plain)$/.test(t)
    ? t : 'application/octet-stream'
}
