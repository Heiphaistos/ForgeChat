// Mode hors ligne (lot confort) : dernières conversations lisibles sans réseau et file
// d'envoi des messages écrits hors ligne.
// - Stockage : dossier privé de l'appli (documentDirectory/offline/<compte>/), chaque fichier
//   chiffré AES-256-GCM avec une clé propre au compte gardée dans le Keystore/Keychain
//   (expo-secure-store, appareil déverrouillé, jamais sauvegardée). Le contenu des messages
//   y est en plus toujours chiffré de bout en bout, comme reçu du serveur.
// - File d'envoi : seulement des messages texte DÉJÀ scellés (corps `enc`), sans pièce jointe.
import { gcm } from '@noble/ciphers/aes.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { requireOptionalNativeModule } from 'expo'
import { getRandomBytes } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { b64uDecode, b64uEncode } from '@/e2e/crypto'

export const useOffline = create<{ fromCache: boolean; pending: number }>(() => ({ fromCache: false, pending: 0 }))

type Query = Record<string, string | number | boolean | null | undefined>

const CACHEABLE = [
  /^\/users\/me$/, /^\/unread$/, /^\/friends$/, /^\/servers$/, /^\/servers\/[^/]+$/,
  /^\/servers\/[^/]+\/(channels|categories|members|roles)$/, /^\/servers\/[^/]+\/channels\/[^/]+\/messages$/,
  /^\/dms$/, /^\/dms\/[^/]+\/messages$/, /^\/dms\/groups\/[^/]+(\/messages)?$/,
  /^\/e2e\/conversations\/(dm|group|channel)\/[^/]+\/keys$/,
]
const QUEUEABLE = [/^\/servers\/[^/]+\/channels\/[^/]+\/messages$/, /^\/dms\/[^/]+\/messages$/, /^\/dms\/groups\/[^/]+\/messages$/]

/** Clé de cache d'une lecture (première page seulement), ou null si elle n'est pas gardée. */
export function cacheKey(method: string, p: string, query?: Query): string | null {
  if (method !== 'GET' || p.includes('?')) return null
  const keys = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null)
  if (keys.some(([k]) => k !== 'limit')) return null
  if (!CACHEABLE.some((r) => r.test(p))) return null
  return keys.length ? `${p}?limit=${String(keys[0]![1])}` : p
}

/** Envoi à mettre en file : message chiffré (`enc`), sans pièce jointe. */
export function isQueueable(method: string, p: string, body: unknown): boolean {
  const b = body as { enc?: unknown; has_attachments?: unknown } | null | undefined
  return method === 'POST' && !!b?.enc && !b.has_attachments && QUEUEABLE.some((r) => r.test(p))
}

/** Conversation visée par une URL d'envoi. */
export function convOf(p: string): ['dm' | 'group' | 'channel', string] | null {
  const g = p.match(/^\/dms\/groups\/([^/]+)\/messages$/)
  if (g) return ['group', decodeURIComponent(g[1]!)]
  const d = p.match(/^\/dms\/([^/]+)\/messages$/)
  if (d) return ['dm', decodeURIComponent(d[1]!)]
  const c = p.match(/^\/servers\/[^/]+\/channels\/([^/]+)\/messages$/)
  return c ? ['channel', decodeURIComponent(c[1]!)] : null
}

// ─── Stockage chiffré ─────────────────────────────────────────────────────────

interface NativeFile { readonly exists: boolean; create(o?: { overwrite?: boolean }): void; write(b: Uint8Array): void; bytesSync(): Uint8Array; delete(): void }
interface NativeDir { readonly exists: boolean; create(o?: { intermediates?: boolean; idempotent?: boolean }): void; delete(): void }
interface FsModule { FileSystemFile: new (uri: string) => NativeFile; FileSystemDirectory: new (uri: string) => NativeDir; documentDirectory: string }
const fs = requireOptionalNativeModule<FsModule>('FileSystem')

const KEY_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.offline',
}

let owner: string | null = null
let key: Uint8Array | null = null

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const dirOf = (id: string) => `${fs!.documentDirectory.replace(/\/?$/, '/')}offline/${id}/`

async function ownerKey(id: string): Promise<Uint8Array> {
  const name = `fc.offline_key.${id}`
  const saved = await SecureStore.getItemAsync(name, KEY_OPTS).catch(() => null)
  if (saved) return b64uDecode(saved)
  const k = getRandomBytes(32)
  await SecureStore.setItemAsync(name, b64uEncode(k), KEY_OPTS)
  return k
}

/** Chiffre (iv 12 octets ‖ texte chiffré) ; exporté pour les tests. */
export function seal(k: Uint8Array, value: unknown, iv = getRandomBytes(12)): Uint8Array {
  const ct = gcm(k, iv).encrypt(new TextEncoder().encode(JSON.stringify(value)))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}
export function unseal<T>(k: Uint8Array, data: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(gcm(k, data.slice(0, 12)).decrypt(data.slice(12)))) as T
}

function file(name: string): NativeFile | null {
  if (!fs || !owner) return null
  const dir = new fs.FileSystemDirectory(dirOf(owner))
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return new fs.FileSystemFile(dirOf(owner) + name)
}

function writeFile(name: string, value: unknown) {
  const f = file(name)
  if (!f || !key) return
  f.create({ overwrite: true })
  f.write(seal(key, value))
}

function readFile<T>(name: string): T | null {
  const f = file(name)
  if (!f?.exists || !key) return null
  try {
    return unseal<T>(key, f.bytesSync())
  } catch {
    return null // altéré ou clé perdue : ignoré
  }
}

const entryName = (k: string) => `${hex(sha256(new TextEncoder().encode(k))).slice(0, 40)}.bin`

/** Compte connecté : ses données gardées deviennent lisibles. */
export async function setOfflineOwner(id: string | null) {
  if (id === owner) return
  owner = null
  key = null
  if (id && fs) {
    key = await ownerKey(id).catch(() => null)
    owner = key ? id : null
  }
  useOffline.setState({ pending: owner ? outbox().length : 0, fromCache: false })
}

/** Déconnexion : efface les données gardées du compte et sa clé. */
export async function forgetOfflineData(id: string) {
  try {
    if (fs) {
      const dir = new fs.FileSystemDirectory(dirOf(id))
      if (dir.exists) dir.delete()
    }
  } catch { /* déjà absent */ }
  await SecureStore.deleteItemAsync(`fc.offline_key.${id}`, KEY_OPTS).catch(() => undefined)
  if (owner === id) await setOfflineOwner(null)
}

export function remember(k: string, data: unknown) {
  try {
    writeFile(entryName(k), { k, d: data })
  } catch { /* disque plein : sans conséquence */ }
  if (useOffline.getState().fromCache) useOffline.setState({ fromCache: false })
}

export function recall<T>(k: string): T | undefined {
  const v = readFile<{ k: string; d: T }>(entryName(k))
  if (!v || v.k !== k) return undefined
  useOffline.setState({ fromCache: true })
  return v.d
}

// ─── File d'envoi ─────────────────────────────────────────────────────────────

export interface OutboxItem { path: string; body: Record<string, unknown>; at: number; tries: number }
const OUTBOX = 'outbox.bin'
const outbox = () => readFile<OutboxItem[]>(OUTBOX) ?? []

export function enqueue(path: string, body: Record<string, unknown>): boolean {
  if (!owner) return false
  const list = [...outbox(), { path, body, at: Date.now(), tries: 0 }].slice(-100)
  writeFile(OUTBOX, list)
  useOffline.setState({ pending: list.length })
  return true
}

export type SendResult = 'ok' | 'retry' | 'drop'
let flushing = false

/** Envoie la file dans l'ordre ; s'arrête au premier échec réseau. */
export async function flushOutbox(send: (it: OutboxItem) => Promise<SendResult>): Promise<{ sent: number; dropped: number }> {
  const res = { sent: 0, dropped: 0 }
  if (flushing || !owner) return res
  flushing = true
  try {
    // Les nouveaux messages s'ajoutent en fin de file pendant l'envoi : on ne retire que la tête traitée.
    let done = 0
    let retried: OutboxItem | null = null
    for (const it of outbox()) {
      const r = await send(it)
      if (r === 'retry' && it.tries < 5) {
        retried = { ...it, tries: it.tries + 1 }
        break
      }
      done++
      if (r === 'ok') res.sent++
      else res.dropped++
    }
    const rest = outbox().slice(done)
    const list = retried ? [retried, ...rest.slice(1)] : rest
    writeFile(OUTBOX, list)
    useOffline.setState({ pending: list.length })
  } finally {
    flushing = false
  }
  return res
}
