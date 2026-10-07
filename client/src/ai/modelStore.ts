// Fichiers des modèles gardés sur l'appareil (IndexedDB, ni Cache Storage que le
// service worker et l'appli de bureau vident). Téléchargés depuis NOTRE serveur
// (/ai-models/), vérifiés par SHA-256 au téléchargement ET à chaque lecture.
import { PACKS, type AiFile, type PackId } from './manifest.ts'

const DB = 'forgechat-ai'
const STORE = 'files'

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Contenu conforme à l'empreinte attendue (taille comprise). */
export async function verifyFile(data: ArrayBuffer, f: Pick<AiFile, 'size' | 'sha256'>): Promise<boolean> {
  return data.byteLength === f.size && (await sha256Hex(data)) === f.sha256
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const d = await open()
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const req = op(t.objectStore(STORE))
    t.oncomplete = () => { resolve((req ? req.result : undefined) as T); d.close() }
    t.onerror = () => { reject(t.error); d.close() }
    t.onabort = () => { reject(t.error); d.close() }
  })
}

const storedKeys = () => tx<IDBValidKey[]>('readonly', s => s.getAllKeys()).then(k => new Set(k as string[]))

export async function installedPacks(): Promise<Set<PackId>> {
  const keys = await storedKeys().catch(() => new Set<string>())
  return new Set((Object.keys(PACKS) as PackId[]).filter(id => PACKS[id].files.every(f => keys.has(f.path))))
}

/** Octets occupés par les fichiers présents (d'après le manifeste : vérifiés à l'écriture). */
export async function usedBytes(): Promise<number> {
  const keys = await storedKeys().catch(() => new Set<string>())
  return Object.values(PACKS).flatMap(p => p.files).filter(f => keys.has(f.path)).reduce((n, f) => n + f.size, 0)
}

export class AiFileError extends Error {
  code: 'missing' | 'corrupt' | 'http'
  constructor(code: AiFileError['code'], msg: string) { super(msg); this.code = code }
}

/** Fichier présent ET intact, sinon erreur (un fichier altéré est effacé). */
export async function readVerified(f: AiFile): Promise<ArrayBuffer> {
  const blob = await tx<Blob | undefined>('readonly', s => s.get(f.path))
  if (!blob) throw new AiFileError('missing', f.path)
  const data = await blob.arrayBuffer()
  if (!(await verifyFile(data, f))) {
    await tx('readwrite', s => { s.delete(f.path) }).catch(() => {})
    throw new AiFileError('corrupt', f.path)
  }
  return data
}

/**
 * Télécharge les fichiers manquants des packs depuis `base` (`<serveur>/ai-models/`).
 * Rien n'est gardé si l'empreinte ne correspond pas. `onProgress(reçu, total)`.
 */
export async function downloadPacks(ids: PackId[], base: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  const keys = await storedKeys().catch(() => new Set<string>())
  const files = [...new Set(ids)].flatMap(id => PACKS[id].files).filter(f => !keys.has(f.path))
  const total = files.reduce((n, f) => n + f.size, 0)
  let done = 0
  // Demande que le navigateur ne purge pas ces données quand l'espace manque.
  await navigator.storage?.persist?.().catch(() => false)
  for (const f of files) {
    const res = await fetch(base + f.path, { credentials: 'omit', signal })
    if (!res.ok || !res.body) throw new AiFileError('http', `${res.status} ${f.path}`)
    const reader = res.body.getReader()
    const buf = new Uint8Array(f.size)
    let off = 0
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      if (off + value.length > f.size) { await reader.cancel(); throw new AiFileError('corrupt', f.path) }
      buf.set(value, off)
      off += value.length
      onProgress?.(done + off, total)
    }
    if (!(await verifyFile(buf.buffer.slice(0, off), f))) throw new AiFileError('corrupt', f.path)
    await tx('readwrite', s => { s.put(new Blob([buf]), f.path) })
    done += f.size
  }
}

export async function removePacks(ids: PackId[]) {
  const paths = ids.flatMap(id => PACKS[id].files.map(f => f.path))
  await tx('readwrite', s => { for (const p of paths) s.delete(p) })
}
