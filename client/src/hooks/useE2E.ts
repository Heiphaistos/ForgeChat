/**
 * E2E Encryption Hook — ECDH P-256 + AES-GCM
 *
 * Key flow:
 * 1. generateAndStoreKeyPair() → génère une paire ECDH, stocke la clé privée en
 *    IndexedDB (ne quitte jamais le device) et upload la clé publique sur le serveur.
 * 2. getSharedKey(otherUserId) → récupère la clé publique de l'autre personne,
 *    dérive le secret partagé ECDH, dérive une clé AES-GCM avec HKDF.
 * 3. encrypt(text, key) → AES-GCM avec IV aléatoire, retourne base64url(iv+ciphertext).
 * 4. decrypt(b64, key) → déchiffre et retourne le texte en clair.
 */

import { useCallback, useRef } from 'react'
import api from '../api/client'

const DB_NAME = 'forgechat_e2e'
const DB_STORE = 'keys'
const KEY_RECORD = 'my_keypair'

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).get(key)
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    const req = tx.objectStore(DB_STORE).put(value, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function b64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + (4 - s.length % 4) % 4, '=')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  )
  // HKDF pour dériver une clé AES-GCM à partir des bits partagés
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('ForgeChat-E2E-AES-GCM'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useE2E() {
  // Cache des clés AES dérivées (évite un ECDH par message)
  const aesKeyCache = useRef<Map<string, CryptoKey>>(new Map())

  const getMyKeyPair = useCallback(async (): Promise<CryptoKeyPair | null> => {
    const kp = await idbGet<CryptoKeyPair>(KEY_RECORD)
    return kp ?? null
  }, [])

  const generateAndStoreKeyPair = useCallback(async (): Promise<void> => {
    const existing = await idbGet<CryptoKeyPair>(KEY_RECORD)
    if (existing) return // déjà généré

    const kp = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits'],
    ) as CryptoKeyPair

    // Stocker la paire de clés en IndexedDB (clé privée ne quitte jamais le browser)
    await idbSet(KEY_RECORD, kp)

    // Uploader la clé publique sur le serveur
    const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
    await api.post('/users/me/pubkey', { pub_key: JSON.stringify(pubJwk) })
  }, [])

  const getSharedKey = useCallback(async (otherUserId: string): Promise<CryptoKey | null> => {
    const cached = aesKeyCache.current.get(otherUserId)
    if (cached) return cached

    const kp = await getMyKeyPair()
    if (!kp) return null

    let otherPubJwk: JsonWebKey
    try {
      const { data } = await api.get(`/users/${otherUserId}/pubkey`)
      otherPubJwk = JSON.parse(data.pub_key)
    } catch {
      return null // L'autre personne n'a pas activé E2E
    }

    const otherPubKey = await crypto.subtle.importKey(
      'jwk',
      otherPubJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )

    const aesKey = await deriveAesKey(kp.privateKey, otherPubKey)
    aesKeyCache.current.set(otherUserId, aesKey)
    return aesKey
  }, [getMyKeyPair])

  const encrypt = useCallback(async (plaintext: string, key: CryptoKey): Promise<string> => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = new TextEncoder().encode(plaintext)
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
    // Concaténer IV (12 octets) + ciphertext, encoder en base64url
    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(ciphertext), iv.length)
    return b64urlEncode(combined.buffer)
  }, [])

  const decrypt = useCallback(async (b64: string, key: CryptoKey): Promise<string> => {
    const combined = b64urlDecode(b64)
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
    return new TextDecoder().decode(plaintext)
  }, [])

  const isE2EEnabled = useCallback(async (): Promise<boolean> => {
    const kp = await getMyKeyPair()
    return kp !== null && kp !== undefined
  }, [getMyKeyPair])

  return {
    generateAndStoreKeyPair,
    getSharedKey,
    encrypt,
    decrypt,
    isE2EEnabled,
  }
}
