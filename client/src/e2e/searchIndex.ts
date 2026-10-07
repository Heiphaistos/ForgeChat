// Index local des messages déchiffrés (IndexedDB `forgechat-search`), pour chercher dans
// les conversations chiffrées sans jamais envoyer le texte au serveur. Alimenté au
// déchiffrement (e2e/conversations.ts), vidé à la déconnexion et au changement de compte,
// purgé des messages supprimés ou échus (messages éphémères).
import { useAuth } from '../store/auth'
import { isEmptyQuery, matches, parseQuery, type IndexedMsg } from './searchQuery'

const DB = 'forgechat-search'
const MSGS = 'msgs'
const META = 'meta'
/** Messages gardés au plus (les plus anciens sont oubliés au-delà). */
const MAX_ENTRIES = 50_000
/** Résultats rendus au plus par recherche. */
const MAX_RESULTS = 200
const FLUSH_MS = 1000

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      const s = open.result.createObjectStore(MSGS, { keyPath: 'id' })
      s.createIndex('createdAt', 'createdAt')
      open.result.createObjectStore(META)
    }
    open.onerror = () => { dbp = null; reject(open.error) }
    open.onsuccess = () => resolve(open.result)
  })
  return dbp
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = tx.onabort = () => reject(tx.error)
})
const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})

// ─── Noms des conversations (filtre dans:) ───────────────────────────────────
const convNames = new Map<string, { name: string; serverId?: string | null }>()
/** Les pages ouvertes donnent le nom de leur conversation (salon, pseudo, groupe). */
export function rememberConvName(convId: string, name: string | null | undefined, serverId?: string | null) {
  if (convId && name) convNames.set(convId, { name, serverId })
}

// ─── Écriture groupée ────────────────────────────────────────────────────────
const pending = new Map<string, IndexedMsg>()
const removed = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function schedule() {
  timer ??= setTimeout(() => { timer = null; void flush() }, FLUSH_MS)
}

async function flush() {
  const me = useAuth.getState().user?.id
  if (!me || (!pending.size && !removed.size)) return
  const puts = [...pending.values()]
  const dels = [...removed]
  pending.clear()
  removed.clear()
  try {
    const d = await db()
    const tx = d.transaction([MSGS, META], 'readwrite')
    const meta = tx.objectStore(META)
    const owner = await req(meta.get('owner'))
    // Index d'un autre compte (même navigateur) : jamais mélangé, effacé.
    if (owner !== me) {
      tx.objectStore(MSGS).clear()
      meta.put(me, 'owner')
    }
    const store = tx.objectStore(MSGS)
    for (const m of puts) store.put(m)
    for (const id of dels) store.delete(id)
    await done(tx)
    await trim(d)
  } catch { /* stockage indisponible (navigation privée…) : la recherche retombe sur les messages chargés */ }
}

async function trim(d: IDBDatabase) {
  const tx = d.transaction(MSGS, 'readwrite')
  const store = tx.objectStore(MSGS)
  const extra = (await req(store.count())) - MAX_ENTRIES
  if (extra > 0) {
    let left = extra
    const cur = store.index('createdAt').openCursor()
    cur.onsuccess = () => {
      const c = cur.result
      if (!c || left-- <= 0) return
      c.delete()
      c.continue()
    }
  }
  await done(tx)
}

/** Ajoute (ou remplace, à l'édition) un message déchiffré. */
export function indexMessage(m: Omit<IndexedMsg, 'convName' | 'serverId'> & { serverId?: string | null }) {
  if (!m.id || !m.text.trim()) return
  const conv = convNames.get(m.convId)
  pending.set(m.id, { ...m, convName: conv?.name ?? null, serverId: m.serverId ?? conv?.serverId ?? null })
  removed.delete(m.id)
  schedule()
}

/** Message supprimé (ou échu) : retiré de l'index. */
export function unindexMessage(id: string) {
  if (!id) return
  pending.delete(id)
  removed.add(id)
  schedule()
}

/** Recherche plein texte locale, du plus récent au plus ancien ; `convId` limite à une conversation. */
export async function searchLocal(input: string, convId?: string): Promise<IndexedMsg[]> {
  const q = parseQuery(input)
  const me = useAuth.getState().user?.id
  if (isEmptyQuery(q) || !me) return []
  await flush()
  try {
    const d = await db()
    if ((await req(d.transaction(META).objectStore(META).get('owner'))) !== me) return []
    const out: IndexedMsg[] = []
    const expired: string[] = []
    const now = Date.now()
    await new Promise<void>((resolve, reject) => {
      const cur = d.transaction(MSGS).objectStore(MSGS).index('createdAt').openCursor(null, 'prev')
      cur.onerror = () => reject(cur.error)
      cur.onsuccess = () => {
        const c = cur.result
        if (!c || out.length >= MAX_RESULTS) return resolve()
        const m = c.value as IndexedMsg
        if (m.expiresAt && Date.parse(m.expiresAt) <= now) expired.push(m.id)
        else if (!convId || m.convId === convId) {
          // Nom connu depuis l'indexation (salon renommé, conversation ouverte plus tard).
          const named = m.convName ? m : { ...m, convName: convNames.get(m.convId)?.name ?? null }
          if (matches(named, q, now)) out.push(named)
        }
        c.continue()
      }
    })
    expired.forEach(unindexMessage)
    return out
  } catch {
    return []
  }
}

/** Nombre de messages indexés sur cet appareil. */
export async function countIndexed(): Promise<number> {
  try {
    return await req((await db()).transaction(MSGS).objectStore(MSGS).count())
  } catch {
    return 0
  }
}

/** Déconnexion, ou demande de l'utilisateur : plus aucun texte déchiffré sur l'appareil. */
export async function clearSearchIndex() {
  pending.clear()
  removed.clear()
  convNames.clear()
  try {
    const d = await db()
    const tx = d.transaction([MSGS, META], 'readwrite')
    tx.objectStore(MSGS).clear()
    tx.objectStore(META).clear()
    await done(tx)
  } catch { /* rien à effacer */ }
}

/** Suit les suppressions (dont l'échéance des messages éphémères) ; renvoie la fonction d'arrêt. */
export function startSearchIndex(on: (type: string, h: (d: unknown) => void) => () => void): () => void {
  const drop = (d: unknown) => unindexMessage(String((d as { message_id?: unknown })?.message_id ?? ''))
  const offs = ['MESSAGE_DELETE', 'DM_MESSAGE_DELETE', 'GROUP_DM_MESSAGE_DELETE'].map(t => on(t, drop))
  return () => offs.forEach(off => off())
}
