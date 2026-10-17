import type { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { create } from 'zustand'

/**
 * Mode hors ligne (web et bureau).
 * - Lecture : les dernières réponses des listes de conversations et de messages sont gardées
 *   telles que le serveur les envoie, dans l'IndexedDB de l'appli (propre à l'origine). Le
 *   contenu des messages y reste donc CHIFFRÉ de bout en bout ; il n'est déchiffré qu'en
 *   mémoire, à l'affichage. Sans réseau, ces réponses sont resservies.
 * - Écriture : un message texte envoyé sans réseau est mis en file DÉJÀ chiffré (corps
 *   scellé par l'appli) et part au retour du réseau.
 */

export const useOffline = create<{ fromCache: boolean; pending: number }>(() => ({ fromCache: false, pending: 0 }))

const DB = 'fc-offline'
const OWNER_KEY = 'fc_offline_owner'
const MAX_ENTRIES = 400

// Lectures resservies hors ligne (chemin sans paramètres : première page seulement).
const CACHEABLE = [
  /^\/users\/me$/, /^\/user\/(settings|keybindings)$/, /^\/unread$/, /^\/friends$/,
  /^\/servers$/, /^\/servers\/[\w-]+$/, /^\/servers\/[\w-]+\/(channels|categories|members|roles)$/,
  /^\/servers\/[\w-]+\/channels\/[\w-]+\/messages$/,
  /^\/dms$/, /^\/dms\/[\w-]+\/messages$/, /^\/dms\/groups(\/[\w-]+(\/messages)?)?$/,
  /^\/e2e\/conversations\/(dm|group|channel)\/[\w-]+\/keys$/,
]
// Envois mis en file hors ligne (texte chiffré, sans pièce jointe).
const QUEUEABLE = [/^\/servers\/[\w-]+\/channels\/[\w-]+\/messages$/, /^\/dms\/[\w-]+\/messages$/, /^\/dms\/groups\/[\w-]+\/messages$/]

/** Clé de cache d'une lecture, ou null si elle n'est pas gardée. */
export function cacheKey(method: string | undefined, url: string | undefined, params?: unknown): string | null {
  if ((method ?? 'get').toLowerCase() !== 'get' || !url || url.includes('?')) return null
  if (params && typeof params === 'object' && Object.keys(params).length > 0) return null
  return CACHEABLE.some(r => r.test(url)) ? url : null
}

/** Envoi à mettre en file : message chiffré (`enc`), sans pièce jointe, vers une conversation. */
export function isQueueable(method: string | undefined, url: string | undefined, body: unknown): boolean {
  if ((method ?? '').toLowerCase() !== 'post' || !url) return false
  const b = body as { enc?: unknown; has_attachments?: unknown } | null
  return !!b?.enc && !b.has_attachments && QUEUEABLE.some(r => r.test(url))
}

/** Conversation visée par une URL d'envoi de message. */
export function convOf(url: string): ['dm' | 'group' | 'channel', string] | null {
  const g = url.match(/^\/dms\/groups\/([\w-]+)\/messages$/)
  if (g) return ['group', g[1]]
  const d = url.match(/^\/dms\/([\w-]+)\/messages$/)
  if (d) return ['dm', d[1]]
  const c = url.match(/^\/servers\/[\w-]+\/channels\/([\w-]+)\/messages$/)
  return c ? ['channel', c[1]] : null
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('responses')
      open.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

async function tx<T>(store: 'responses' | 'outbox', mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode)
    const req = op(t.objectStore(store))
    t.oncomplete = () => { resolve((req ? req.result : undefined) as T); d.close() }
    t.onerror = () => { reject(t.error); d.close() }
  })
}

let owner: string | null = (() => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } })()

/** Compte dont on garde les données (compte connecté). */
export function setOfflineOwner(id: string | null) {
  owner = id
  try { if (id) localStorage.setItem(OWNER_KEY, id); else localStorage.removeItem(OWNER_KEY) } catch { /* stockage indisponible */ }
  if (id) void refreshPending()
}

/** Déconnexion : efface les données gardées pour ce compte. */
export async function forgetOfflineData(id: string) {
  const range = IDBKeyRange.bound(`${id}|`, `${id}|￿`)
  await tx('responses', 'readwrite', s => { s.delete(range) }).catch(() => {})
  const items = await tx<OutboxItem[]>('outbox', 'readonly', s => s.getAll()).catch(() => [])
  for (const it of items.filter(i => i.owner === id)) await tx('outbox', 'readwrite', s => { s.delete(it.id!) }).catch(() => {})
  if (owner === id) setOfflineOwner(null)
  useOffline.setState({ pending: 0, fromCache: false })
}

/** Session terminée par le serveur (refus définitif du rafraîchissement) : plus rien du compte ne reste lisible hors ligne. */
export async function forgetOfflineOwner() {
  if (owner) await forgetOfflineData(owner)
}

async function put(url: string, data: unknown) {
  if (!owner) return
  await tx('responses', 'readwrite', s => { s.put({ data, at: Date.now() }, `${owner}|${url}`) })
  // Taille bornée : on oublie les plus anciennes lectures.
  if (Math.random() < 0.05) {
    const keys = await tx<IDBValidKey[]>('responses', 'readonly', s => s.getAllKeys())
    if (keys.length > MAX_ENTRIES) {
      const all = await tx<{ at: number }[]>('responses', 'readonly', s => s.getAll())
      const old = keys.map((k, i) => [k, all[i].at] as const).sort((a, b) => a[1] - b[1]).slice(0, keys.length - MAX_ENTRIES)
      for (const [k] of old) await tx('responses', 'readwrite', s => { s.delete(k) })
    }
  }
}

const get = (url: string) =>
  owner ? tx<{ data: unknown } | undefined>('responses', 'readonly', s => s.get(`${owner}|${url}`)) : Promise.resolve(undefined)

// ─── File d'envoi ─────────────────────────────────────────────────────────────

export interface OutboxItem { id?: number; owner: string; url: string; body: Record<string, unknown>; at: number; tries: number }

async function refreshPending() {
  const items = await tx<OutboxItem[]>('outbox', 'readonly', s => s.getAll()).catch(() => [])
  useOffline.setState({ pending: items.filter(i => i.owner === owner).length })
}

/** Erreur d'un envoi mis en file (l'interface dit « partira au retour du réseau »). */
export const isQueued = (e: unknown) => !!(e as { fcQueued?: boolean } | null)?.fcQueued

export type SendResult = 'ok' | 'retry' | 'drop'
let flushing = false

/** Envoie la file dans l'ordre ; s'arrête au premier échec réseau. Renvoie le nombre de messages abandonnés. */
export async function flushOutbox(send: (item: OutboxItem) => Promise<SendResult>): Promise<{ sent: number; dropped: number }> {
  const res = { sent: 0, dropped: 0 }
  if (flushing || !owner) return res
  flushing = true
  try {
    const items = (await tx<OutboxItem[]>('outbox', 'readonly', s => s.getAll())).filter(i => i.owner === owner)
    for (const it of items) {
      const r = await send(it)
      if (r === 'retry' && it.tries < 5) {
        await tx('outbox', 'readwrite', s => { s.put({ ...it, tries: it.tries + 1 }) })
        break
      }
      await tx('outbox', 'readwrite', s => { s.delete(it.id!) })
      if (r === 'ok') res.sent++
      else res.dropped++
    }
  } finally {
    flushing = false
    await refreshPending()
  }
  return res
}

type Config = InternalAxiosRequestConfig & { fcNoQueue?: boolean }

/** Branche le cache et la file sur le client HTTP de l'appli. */
export function installOffline(api: AxiosInstance) {
  api.interceptors.response.use(
    (r: AxiosResponse) => {
      const key = cacheKey(r.config.method, r.config.url, r.config.params)
      if (key) {
        void put(key, r.data).catch(() => {})
        if (useOffline.getState().fromCache) useOffline.setState({ fromCache: false })
      }
      return r
    },
    async (err: AxiosError & { fcQueued?: boolean }) => {
      const cfg = err.config as Config | undefined
      if (err.response || !cfg) throw err
      const key = cacheKey(cfg.method, cfg.url, cfg.params)
      if (key) {
        const hit = await get(key).catch(() => undefined)
        if (hit) {
          useOffline.setState({ fromCache: true })
          return { data: hit.data, status: 200, statusText: 'OK', headers: {}, config: cfg } satisfies AxiosResponse
        }
      }
      const body = typeof cfg.data === 'string' ? (() => { try { return JSON.parse(cfg.data) } catch { return null } })() : cfg.data
      const who = owner
      const url = cfg.url
      if (who && url && !cfg.fcNoQueue && isQueueable(cfg.method, url, body)) {
        const item: OutboxItem = { owner: who, url, body, at: Date.now(), tries: 0 }
        await tx('outbox', 'readwrite', s => { s.add(item) })
        await refreshPending()
        err.fcQueued = true
      }
      throw err
    },
  )
}
