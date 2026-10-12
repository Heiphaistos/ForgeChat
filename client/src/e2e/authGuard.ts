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

/** Même principe par identifiant de compte (actions sensibles, connecté : pas d'e-mail sous la main). */
export const userTag = (userId: string) => accountTag(`user|${userId}`)

/** Lève `AUTH_DOWNGRADE` si `GET /users/me/kdf` répond `legacy` pour un compte connu migré. */
export async function checkKdf(store: TagStore, userId: string, info: { legacy: boolean }) {
  if (!info.legacy) return store.add(await userTag(userId))
  if (await store.has(await userTag(userId))) throw new Error('AUTH_DOWNGRADE')
}

export const markUserIn = async (store: TagStore, userId: string) => store.add(await userTag(userId))

/**
 * Même principe pour la dérivation (audit 2026-10-12, M3) : un compte vu en Argon2id sur cet
 * appareil n'accepte plus qu'on lui annonce PBKDF2 (plus faible). `subject` : e-mail, ou `user|<id>`.
 */
export async function checkArgon(store: TagStore, subject: string, kdf: string | undefined) {
  const tag = await accountTag(`argon2id|${subject}`)
  if (kdf === 'argon2id') return store.add(tag)
  if (await store.has(tag)) throw new Error('AUTH_DOWNGRADE')
}

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
export const markUserMigrated = (userId: string) => markUserIn(idbStore, userId)
/** Avant d'envoyer une preuve de mot de passe : mémorise l'état migré, refuse le retour arrière. */
export const guardKdf = (userId: string, info: { legacy: boolean }) => checkKdf(idbStore, userId, info)
/** Refuse un retour à PBKDF2 pour un compte vu en Argon2id ; mémorise Argon2id. */
export const guardArgon = (subject: string, kdf: string | undefined) => checkArgon(idbStore, subject, kdf)
