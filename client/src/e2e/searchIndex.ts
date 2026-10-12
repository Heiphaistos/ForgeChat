// Index local des messages déchiffrés (IndexedDB `forgechat-search`), pour chercher dans
// les conversations chiffrées sans jamais envoyer le texte au serveur. Alimenté au
// déchiffrement (e2e/conversations.ts), vidé à la déconnexion et au changement de compte,
// purgé des messages supprimés ou échus (messages éphémères). Le texte, l'auteur et le nom de
// la conversation sont chiffrés au repos (AES-GCM, clé NON extractible rangée dans la base,
// effacée avec elle). « Non extractible » vaut pour le JavaScript, pas pour le disque : le
// navigateur garde la clé dans son profil, avec la base. Cela évite le texte en clair dans les
// fichiers, sans protéger d'une copie du profil ni d'un script exécuté dans la page.
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
    const open = indexedDB.open(DB, 2)
    open.onupgradeneeded = e => {
      if (e.oldVersion < 1) {
        const s = open.result.createObjectStore(MSGS, { keyPath: 'id' })
        s.createIndex('createdAt', 'createdAt')
        open.result.createObjectStore(META)
      } else {
        // Version 1 : textes en clair, effacés (réindexés au prochain déchiffrement).
        open.transaction?.objectStore(MSGS).clear()
      }
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

// ─── Chiffrement au repos ────────────────────────────────────────────────────
/** Entrée rangée : métadonnées en clair (filtres, tri), contenu `{text, authorName, convName}` chiffré. */
type Stored = Omit<IndexedMsg, 'text' | 'authorName' | 'convName'> & { iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }
const enc = new TextEncoder()
const dec = new TextDecoder()

let keyp: Promise<CryptoKey> | null = null
/** Clé AES-GCM non extractible de cet index (créée au premier usage, effacée avec l'index). */
function restKey(d: IDBDatabase): Promise<CryptoKey> {
  keyp ??= (async () => {
    const got = await req(d.transaction(META).objectStore(META).get('key'))
    if (got instanceof CryptoKey) return got
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const tx = d.transaction(META, 'readwrite')
    tx.objectStore(META).put(k, 'key')
    await done(tx)
    return k
  })().catch(e => { keyp = null; throw e })
  return keyp
}

async function sealEntry(key: CryptoKey, m: IndexedMsg): Promise<Stored> {
  const { text, authorName, convName, ...meta } = m
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(m.id) }, key,
    enc.encode(JSON.stringify({ text, authorName, convName: convName ?? null })))
  return { ...meta, iv, ct }
}

async function openEntry(key: CryptoKey, s: Stored): Promise<IndexedMsg | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.iv, additionalData: enc.encode(s.id) }, key, s.ct)
    const { iv: _iv, ct: _ct, ...meta } = s
    return { ...meta, ...(JSON.parse(dec.decode(pt)) as Pick<IndexedMsg, 'text' | 'authorName' | 'convName'>) }
  } catch {
    return null // autre clé (index effacé entre-temps) ou entrée altérée
  }
}

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
    // Chiffré AVANT d'ouvrir la transaction d'écriture (un await la refermerait).
    const key = await restKey(d)
    const sealed = await Promise.all(puts.map(m => sealEntry(key, m)))
    const tx = d.transaction([MSGS, META], 'readwrite')
    const meta = tx.objectStore(META)
    const owner = await req(meta.get('owner'))
    // Index d'un autre compte (même navigateur) : jamais mélangé, effacé.
    if (owner !== me) {
      tx.objectStore(MSGS).clear()
      meta.put(me, 'owner')
    }
    const store = tx.objectStore(MSGS)
    for (const m of sealed) store.put(m)
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

/**
 * Recherche plein texte locale, du plus récent au plus ancien ; `convId` limite à une
 * conversation, `kinds` à certains types (MP et groupes, ou salons de serveur).
 */
export async function searchLocal(input: string, convId?: string, kinds?: readonly IndexedMsg['kind'][]): Promise<IndexedMsg[]> {
  const q = parseQuery(input)
  const me = useAuth.getState().user?.id
  if (isEmptyQuery(q) || !me) return []
  await flush()
  try {
    const d = await db()
    if ((await req(d.transaction(META).objectStore(META).get('owner'))) !== me) return []
    const key = await restKey(d)
    const out: IndexedMsg[] = []
    const expired: string[] = []
    const now = Date.now()
    // Tout est lu d'abord (le déchiffrement est asynchrone), du plus récent au plus ancien.
    // ponytail: déchiffre tout l'index à chaque recherche (50 000 entrées au plus) ; index chiffré si c'est trop lent.
    const all = (await req(d.transaction(MSGS).objectStore(MSGS).index('createdAt').getAll()) as Stored[]).reverse()
    for (let i = 0; i < all.length && out.length < MAX_RESULTS; i += 500) {
      const page = all.slice(i, i + 500).filter(s => {
        if (s.expiresAt && Date.parse(s.expiresAt) <= now) { expired.push(s.id); return false }
        return (!convId || s.convId === convId) && (!kinds || kinds.includes(s.kind))
      })
      for (const m of await Promise.all(page.map(s => openEntry(key, s)))) {
        if (!m || out.length >= MAX_RESULTS) continue
        // Nom connu depuis l'indexation (salon renommé, conversation ouverte plus tard).
        const named = m.convName ? m : { ...m, convName: convNames.get(m.convId)?.name ?? null }
        if (matches(named, q, now)) out.push(named)
      }
    }
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
  keyp = null // la clé est effacée avec l'index : une nouvelle sera créée
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
