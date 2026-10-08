// Clé de compte E2E côté web (docs/CHIFFREMENT-E2E.md §3).
// La clé privée vit en CryptoKey NON extractible dans IndexedDB (`forgechat-e2e`) ;
// le serveur ne reçoit que la publique et des enveloppes chiffrées ici.
import { create } from 'zustand'
import api from '../api/client'
import * as c from './crypto'

interface KeysResponse { public: string; fingerprint: string; wrapped: c.WrappedKey; backup: c.WrappedKey | null }
interface StoredKey { priv: CryptoKey; pub: string }

/** `setup` : aucune clé sur le serveur ; `unlock` : clé à ouvrir sur cet appareil. */
export type LockMode = 'setup' | 'unlock'

interface E2EState {
  status: 'idle' | 'ready' | 'locked'
  mode: LockMode
  priv: CryptoKey | null
  pub: string | null
  /** Code de récupération à afficher UNE fois, puis oublié. */
  recoveryToShow: string | null
}

export const useAccountKey = create<E2EState>()(() => ({
  status: 'idle', mode: 'unlock', priv: null, pub: null, recoveryToShow: null,
}))

// ─── IndexedDB ───────────────────────────────────────────────────────────────
const DB = 'forgechat-e2e'
const STORE = 'keys'

function idb<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = op(open.result.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => { resolve(req.result as T); open.result.close() }
      req.onerror = () => { reject(req.error); open.result.close() }
    }
  })
}

// ─── Mot de passe saisi à la connexion ───────────────────────────────────────
// Gardé en mémoire (jamais stocké) jusqu'à ce que la clé soit prête : il sert à
// ouvrir ou créer l'enveloppe sans le redemander.
let typedPassword: string | null = null
export const rememberPassword = (pw: string) => { typedPassword = pw }
export const hasTypedPassword = () => typedPassword !== null
function passwordOr(pw?: string): string {
  const v = pw || typedPassword
  if (!v) throw new Error('NEED_PASSWORD')
  return v
}

async function fetchKeys(): Promise<KeysResponse | null> {
  try {
    return (await api.get<KeysResponse>('/users/me/keys')).data
  } catch (e: any) {
    if (e?.response?.status === 404) return null
    throw e
  }
}

async function activate(userId: string, priv: Uint8Array, pub: Uint8Array) {
  const key = await c.importPrivateKey(priv, pub)
  priv.fill(0)
  const pubB64 = c.b64uEncode(pub)
  await idb<unknown>('readwrite', s => s.put({ priv: key, pub: pubB64 } satisfies StoredKey, userId))
  typedPassword = null
  useAccountKey.setState({ status: 'ready', priv: key, pub: pubB64 })
}

/** Nouvelle paire + enveloppes (mot de passe, code de récupération). */
async function newKeyMaterial(userId: string, password: string) {
  const { priv, pub } = await c.generateKeyPair()
  const code = c.generateRecoveryCode()
  const body = {
    public: c.b64uEncode(pub),
    wrapped: await c.wrapKey(priv, password, c.keyAad(userId)),
    backup: await c.wrapKey(priv, code, c.backupAad(userId)),
  }
  return { priv, pub, code, body }
}

// Une seule initialisation à la fois par compte : le mode strict de React (et deux fenêtres qui démarrent
// ensemble) la lançaient deux fois, la seconde création de clé échouait et verrouillait l'écran alors que
// la clé était déjà prête.
const initInFlight = new Map<string, Promise<void>>()

/** Au démarrage d'une session : clé locale, sinon ouverture/création avec le mot de passe saisi. */
export function initAccountKey(userId: string): Promise<void> {
  let p = initInFlight.get(userId)
  if (!p) {
    p = runInitAccountKey(userId).finally(() => { initInFlight.delete(userId) })
    initInFlight.set(userId, p)
  }
  return p
}

async function runInitAccountKey(userId: string) {
  const stored = await idb<StoredKey | undefined>('readonly', s => s.get(userId)).catch(() => undefined)
  if (stored?.priv) {
    typedPassword = null
    useAccountKey.setState({ status: 'ready', priv: stored.priv, pub: stored.pub })
    return
  }
  const keys = await fetchKeys()
  const pw = typedPassword
  if (pw) {
    try {
      if (keys) await unlockWithPassword(userId, pw, keys)
      else await createAccountKey(userId, pw)
      return
    } catch { /* mot de passe changé par e-mail : écran de déverrouillage */ }
  }
  // Une autre exécution a pu terminer entre-temps : ne jamais verrouiller une clé déjà prête.
  if (useAccountKey.getState().status === 'ready') return
  useAccountKey.setState({ status: 'locked', mode: keys ? 'unlock' : 'setup' })
}

export async function createAccountKey(userId: string, password: string) {
  const m = await newKeyMaterial(userId, password)
  await api.put('/users/me/keys', m.body)
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
}

export async function unlockWithPassword(userId: string, password: string, keys?: KeysResponse | null) {
  const k = keys ?? await fetchKeys()
  if (!k) throw new Error('NO_KEY')
  const priv = await c.unwrapKey(k.wrapped, password, c.keyAad(userId))
  await activate(userId, priv, c.b64uDecode(k.public))
}

/** Code de récupération (après « mot de passe oublié ») : ré-enveloppe avec le mot de passe actuel. */
export async function unlockWithRecovery(userId: string, code: string, pw?: string) {
  const password = passwordOr(pw)
  const norm = c.normalizeRecoveryCode(code)
  const k = await fetchKeys()
  if (!norm || !k?.backup) throw new Error('BAD_CODE')
  const priv = await c.unwrapKey(k.backup, norm, c.backupAad(userId))
  const wrapped = await c.wrapKey(priv, password, c.keyAad(userId))
  await api.put('/users/me/keys/wrapped', { password, wrapped })
  await activate(userId, priv, c.b64uDecode(k.public))
}

/** Nouvelle clé : l'ancien historique chiffré devient illisible (confirmation côté écran). */
export async function resetAccountKey(userId: string, pw?: string) {
  const password = passwordOr(pw)
  const m = await newKeyMaterial(userId, password)
  await api.post('/users/me/keys/reset', { password, ...m.body })
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
}

/** Nouveau code de récupération (l'ancien cesse de fonctionner) ; rendu pour affichage unique. */
export async function regenerateRecoveryCode(userId: string, password: string): Promise<string> {
  const k = await fetchKeys()
  if (!k) throw new Error('NO_KEY')
  const priv = await c.unwrapKey(k.wrapped, password, c.keyAad(userId))
  const code = c.generateRecoveryCode()
  const backup = await c.wrapKey(priv, code, c.backupAad(userId))
  priv.fill(0)
  await api.put('/users/me/keys/backup', { password, backup })
  return code
}

/** Enveloppe pour /auth/change-password ; null sans clé (ou ancienne enveloppe illisible). */
export async function rewrapForNewPassword(userId: string, oldPw: string, newPw: string): Promise<c.WrappedKey | null> {
  const k = await fetchKeys()
  if (!k) return null
  try {
    const priv = await c.unwrapKey(k.wrapped, oldPw, c.keyAad(userId))
    const w = await c.wrapKey(priv, newPw, c.keyAad(userId))
    priv.fill(0)
    return w
  } catch {
    return null
  }
}

/** Déconnexion : plus de clé pour ce compte sur ce navigateur (les autres comptes gardent la leur). */
export async function clearAccountKey(userId?: string) {
  typedPassword = null
  useAccountKey.setState({ status: 'idle', mode: 'unlock', priv: null, pub: null, recoveryToShow: null })
  await idb<unknown>('readwrite', s => (userId ? s.delete(userId) : s.clear())).catch(() => {})
}

/** Code de sécurité entre ma clé et celle d'un autre utilisateur ; null si l'un n'en a pas. */
export async function safetyCodeWith(userId: string): Promise<string | null> {
  const mine = useAccountKey.getState().pub
  if (!mine) return null
  try {
    const { data } = await api.get<{ public: string }>(`/users/${userId}/keys/public`)
    return await c.safetyCode(c.b64uDecode(mine), c.b64uDecode(data.public))
  } catch {
    return null
  }
}
