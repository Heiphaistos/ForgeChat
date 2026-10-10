// Anti-retour arrière de la connexion v2 (audit 2026-10-10, docs/CHIFFREMENT-E2E.md §3.1).
// Un serveur modifié peut répondre `legacy: true` au prelogin d'un compte déjà migré pour
// recevoir le mot de passe en clair. L'appareil retient les comptes vus migrés (SHA-256 de
// l'e-mail normalisé, jamais l'e-mail lui-même) et refuse alors d'envoyer le mot de passe.
// IndexedDB (`forgechat-v2`) : survit au `localStorage.clear()` de la déconnexion bureau.
// Testé par `node --test scripts/authGuard.test.mjs`.

export interface TagStore { has(tag: string): Promise<boolean>; add(tag: string): Promise<void> }

export async function accountTag(email: string): Promise<string> {
  const data = new TextEncoder().encode(`forgechat v2 account|${email.trim().toLowerCase()}`)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('')
}

/** Lève `AUTH_DOWNGRADE` si le serveur demande le mot de passe en clair pour un compte connu migré. */
export async function checkPrelogin(store: TagStore, email: string, info: { legacy: boolean }) {
  if (info.legacy && await store.has(await accountTag(email))) throw new Error('AUTH_DOWNGRADE')
}

export const markIn = async (store: TagStore, email: string) => store.add(await accountTag(email))

function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('forgechat-v2', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('accounts')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = op(open.result.transaction('accounts', mode).objectStore('accounts'))
      req.onsuccess = () => { resolve(req.result as T); open.result.close() }
      req.onerror = () => { reject(req.error); open.result.close() }
    }
  })
}

const idbStore: TagStore = {
  has: async tag => (await idb<number | undefined>('readonly', s => s.get(tag)).catch(() => undefined)) !== undefined,
  // Échec d'écriture : pas de protection pour ce compte sur cet appareil, la connexion n'en dépend pas.
  add: tag => idb<unknown>('readwrite', s => s.put(1, tag)).then(() => undefined, () => undefined),
}

export const guardPrelogin = (email: string, info: { legacy: boolean }) => checkPrelogin(idbStore, email, info)
/** Après une connexion v2 réussie (ou la migration du compte). */
export const markMigrated = (email: string) => markIn(idbStore, email)
