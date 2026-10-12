// Clé de compte E2E côté web (docs/CHIFFREMENT-E2E.md §3).
// La clé privée vit en CryptoKey NON extractible dans IndexedDB (`forgechat-e2e`) ;
// le serveur ne reçoit que la publique et des enveloppes chiffrées ici.
// Connexion v2 : le mot de passe ne part jamais au serveur, seulement `auth` (authKdf.ts).
import { create } from 'zustand'
import api from '../api/client'
import * as c from './crypto'
import {
  type AccountSecrets, type AnyWrapped, asKdf, deriveSecrets, newKdfSalt, passwordProblem, unwrapAny, wrapKeyV2,
} from './authKdf'
import { pwnedProblem } from './pwned'
import { guardArgon, guardKdf, guardPrelogin, markMigrated } from './authGuard'
import { useAuth } from '../store/auth'
import { t } from '../i18n'

interface KeysResponse { public: string; fingerprint: string; wrapped: AnyWrapped; backup: c.WrappedKey | null }
/** `sign` : clé de signature (absente des entrées enregistrées avant son ajout). */
interface StoredKey { priv: CryptoKey; pub: string; sign?: CryptoKey }

/** `setup` : aucune clé sur le serveur ; `unlock` : clé à ouvrir sur cet appareil. */
export type LockMode = 'setup' | 'unlock'

interface E2EState {
  status: 'idle' | 'ready' | 'locked'
  mode: LockMode
  priv: CryptoKey | null
  pub: string | null
  /** Clé de signature (même clé de compte, usage ECDSA) : signer la clé de récupération de mes serveurs. */
  sign: CryptoKey | null
  /** Code de récupération à afficher UNE fois, puis oublié. */
  recoveryToShow: string | null
}

export const useAccountKey = create<E2EState>()(() => ({
  status: 'idle', mode: 'unlock', priv: null, pub: null, sign: null, recoveryToShow: null,
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
// Gardé en mémoire (jamais stocké ni envoyé) jusqu'à ce que la clé soit prête : il sert à
// ouvrir, migrer (v1 → v2) ou créer l'enveloppe sans le redemander. `secrets` = auth et
// wrapKey déjà dérivés à la connexion (compte migré).
let typed: { password: string; secrets: AccountSecrets | null } | null = null
export const rememberLogin = (password: string, secrets: AccountSecrets | null) => { forgetTyped(); typed = { password, secrets } }
export const hasTypedPassword = () => typed !== null
export function forgetTyped() {
  typed?.secrets?.wrapKey.fill(0)
  typed = null
}
function passwordOr(pw?: string): string {
  const v = pw || typed?.password
  if (!v) throw new Error('NEED_PASSWORD')
  return v
}

// ─── Connexion v2 : sel du compte et preuve du mot de passe ─────────────────
export interface KdfInfo { kdf_salt: string | null; legacy: boolean; kdf?: string }

/**
 * Sel avant connexion ; e-mail inconnu = sel factice et `legacy` (le serveur ne révèle rien).
 * `legacy` pour un compte vu migré sur cet appareil : AUTH_DOWNGRADE, le mot de passe ne part pas.
 */
export async function prelogin(email: string): Promise<KdfInfo> {
  const data = (await api.post<KdfInfo>('/auth/prelogin', { email: email.trim() })).data
  await guardPrelogin(email, data)
  if (!data.legacy) await guardArgon(email.trim().toLowerCase(), data.kdf)
  if (!data.legacy) await markMigrated(email)
  return data
}

/**
 * auth + wrapKey du compte connecté pour ce mot de passe ; null = compte pas encore migré.
 * `legacy` pour un compte vu migré sur cet appareil : AUTH_DOWNGRADE, le mot de passe ne part pas.
 */
async function secretsFor(password: string): Promise<AccountSecrets | null> {
  if (typed?.password === password && typed.secrets) return typed.secrets
  const { data } = await api.get<KdfInfo>('/users/me/kdf')
  // Erreur au format axios : les écrans affichent `response.data.error`.
  const refuse = () => Object.assign(new Error('AUTH_DOWNGRADE'), { response: { data: { error: t('auth.proof.downgrade') } } })
  const userId = useAuth.getState().user?.id
  // Sans compte chargé : aucun état migré connu, rien à comparer.
  if (userId) await guardKdf(userId, data).catch(() => { throw refuse() })
  if (data.legacy || !data.kdf_salt) return null
  if (userId) await guardArgon(`user|${userId}`, data.kdf).catch(() => { throw refuse() })
  return deriveSecrets(password, data.kdf_salt, asKdf(data.kdf))
}

const proofOf = (password: string, s: AccountSecrets | null) => (s ? { auth: s.auth } : { password })

/** Champ à joindre aux routes sensibles (suppression de compte, transfert…) : `auth`, ou `password`
 * pour un compte pas encore migré (il le sera à la prochaine connexion). */
export async function passwordProof(password: string): Promise<{ auth: string } | { password: string }> {
  const s = await secretsFor(password)
  const proof = proofOf(password, s)
  if (s && s !== typed?.secrets) s.wrapKey.fill(0)
  return proof
}

/** Enveloppe du mot de passe : v2 (wrapKey) pour un compte migré, v1 sinon. */
const sealFor = (priv: Uint8Array, password: string, s: AccountSecrets | null, userId: string): Promise<AnyWrapped> =>
  s ? wrapKeyV2(priv, s.wrapKey, userId) : c.wrapKey(priv, password, c.keyAad(userId))

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
  const sign = await c.importSigningKey(priv, pub)
  priv.fill(0)
  const pubB64 = c.b64uEncode(pub)
  await idb<unknown>('readwrite', s => s.put({ priv: key, pub: pubB64, sign } satisfies StoredKey, userId))
  forgetTyped()
  useAccountKey.setState({ status: 'ready', priv: key, pub: pubB64, sign })
}

/** Nouvelle paire + enveloppes (mot de passe, code de récupération). */
async function newKeyMaterial(userId: string, password: string, s: AccountSecrets | null) {
  const { priv, pub } = await c.generateKeyPair()
  const code = c.generateRecoveryCode()
  const body = {
    public: c.b64uEncode(pub),
    wrapped: await sealFor(priv, password, s, userId),
    backup: await c.wrapKey(priv, code, c.backupAad(userId)),
  }
  return { priv, pub, code, body }
}

/**
 * Enveloppe encore en v1 (scellée par PBKDF2 du mot de passe) sur un compte migré : ouverte ici avec
 * le mot de passe saisi et rescellée en v2. Idempotent ; un échec est rejoué à la connexion suivante.
 * Rend la clé privée ouverte (à effacer par l'appelant), ou null.
 */
async function migrateWrapped(userId: string, keys: KeysResponse, password: string, s: AccountSecrets): Promise<Uint8Array | null> {
  if (keys.wrapped.v === 2) return null
  const priv = await c.unwrapKey(keys.wrapped, password, c.keyAad(userId))
  const wrapped = await wrapKeyV2(priv, s.wrapKey, userId)
  await api.put('/users/me/keys/wrapped', { auth: s.auth, wrapped })
  keys.wrapped = wrapped
  return priv
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
  const t = typed
  if (stored?.priv) {
    // Juste après une connexion : l'enveloppe du serveur passe en v2 même si la clé est déjà là.
    if (t?.secrets) {
      try {
        const keys = await fetchKeys()
        if (keys) (await migrateWrapped(userId, keys, t.password, t.secrets))?.fill(0)
      } catch { /* rejoué à la prochaine connexion */ }
    }
    forgetTyped()
    useAccountKey.setState({ status: 'ready', priv: stored.priv, pub: stored.pub, sign: stored.sign ?? null })
    return
  }
  const keys = await fetchKeys()
  if (t) {
    try {
      if (keys) await unlockWithPassword(userId, t.password, keys)
      else await createAccountKey(userId, t.password)
      return
    } catch { /* mot de passe changé par e-mail : écran de déverrouillage */ }
  }
  // Une autre exécution a pu terminer entre-temps : ne jamais verrouiller une clé déjà prête.
  if (useAccountKey.getState().status === 'ready') return
  useAccountKey.setState({ status: 'locked', mode: keys ? 'unlock' : 'setup' })
}

export async function createAccountKey(userId: string, password: string) {
  const m = await newKeyMaterial(userId, password, await secretsFor(password))
  await api.put('/users/me/keys', m.body)
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
}

export async function unlockWithPassword(userId: string, password: string, keys?: KeysResponse | null) {
  const k = keys ?? await fetchKeys()
  if (!k) throw new Error('NO_KEY')
  const s = await secretsFor(password)
  const priv = (s && await migrateWrapped(userId, k, password, s)) || await unwrapAny(k.wrapped, password, s, userId)
  await activate(userId, priv, c.b64uDecode(k.public))
}

/** Code de récupération (après « mot de passe oublié ») : ré-enveloppe avec le mot de passe actuel. */
export async function unlockWithRecovery(userId: string, code: string, pw?: string) {
  const password = passwordOr(pw)
  const norm = c.normalizeRecoveryCode(code)
  const k = await fetchKeys()
  if (!norm || !k?.backup) throw new Error('BAD_CODE')
  const priv = await c.unwrapKey(k.backup, norm, c.backupAad(userId))
  const s = await secretsFor(password)
  const wrapped = await sealFor(priv, password, s, userId)
  await api.put('/users/me/keys/wrapped', { ...proofOf(password, s), wrapped })
  await activate(userId, priv, c.b64uDecode(k.public))
}

/** Nouvelle clé : l'ancien historique chiffré devient illisible (confirmation côté écran). */
export async function resetAccountKey(userId: string, pw?: string) {
  const password = passwordOr(pw)
  const s = await secretsFor(password)
  const m = await newKeyMaterial(userId, password, s)
  await api.post('/users/me/keys/reset', { ...proofOf(password, s), ...m.body })
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
}

/** Nouveau code de récupération (l'ancien cesse de fonctionner) ; rendu pour affichage unique. */
export async function regenerateRecoveryCode(userId: string, password: string): Promise<string> {
  const k = await fetchKeys()
  if (!k) throw new Error('NO_KEY')
  const s = await secretsFor(password)
  const priv = await unwrapAny(k.wrapped, password, s, userId)
  const code = c.generateRecoveryCode()
  const backup = await c.wrapKey(priv, code, c.backupAad(userId))
  priv.fill(0)
  await api.put('/users/me/keys/backup', { ...proofOf(password, s), backup })
  return code
}

/**
 * Changement de mot de passe (atomique côté serveur) : nouvelle preuve, nouveau sel et clé privée
 * rescellée en v2 par la nouvelle wrapKey. Sans clé lisible, l'enveloppe n'est pas envoyée.
 */
export async function changePassword(userId: string, oldPw: string, newPw: string) {
  const problem = passwordProblem(newPw) ?? await pwnedProblem(newPw)
  if (problem) throw new Error(problem)
  const old = await secretsFor(oldPw)
  const newSalt = newKdfSalt()
  const next = await deriveSecrets(newPw, newSalt, 'argon2id')
  try {
    let wrapped: AnyWrapped | null = null
    const k = await fetchKeys()
    if (k) {
      try {
        const priv = await unwrapAny(k.wrapped, oldPw, old, userId)
        wrapped = await wrapKeyV2(priv, next.wrapKey, userId)
        priv.fill(0)
      } catch { /* ancienne enveloppe illisible : la clé reste à rouvrir par le code de récupération */ }
    }
    await api.post('/auth/change-password', {
      ...(old ? { old_auth: old.auth } : { old_password: oldPw }),
      new_auth: next.auth, new_kdf_salt: newSalt, new_kdf: 'argon2id', wrapped,
    })
    await guardArgon(`user|${userId}`, 'argon2id')
  } finally {
    next.wrapKey.fill(0)
    if (old !== typed?.secrets) old?.wrapKey.fill(0)
  }
}

/**
 * Juste après une connexion PBKDF2 réussie : le compte passe à Argon2id (même mot de passe,
 * nouveau sel, clé E2E re-scellée), en une requête atomique. Rend les nouveaux secrets, ou null
 * si la bascule n'a pas pu se faire (on réessaiera à la prochaine connexion).
 */
export async function upgradeKdf(userId: string, password: string, old: AccountSecrets, email?: string): Promise<AccountSecrets | null> {
  const salt = newKdfSalt()
  const next = await deriveSecrets(password, salt, 'argon2id')
  try {
    let wrapped: AnyWrapped | null = null
    const k = await fetchKeys()
    if (k) {
      const priv = await unwrapAny(k.wrapped, password, old, userId)
      wrapped = await wrapKeyV2(priv, next.wrapKey, userId)
      priv.fill(0)
    }
    await api.post('/auth/upgrade-kdf', { old_auth: old.auth, new_auth: next.auth, new_kdf_salt: salt, kdf: 'argon2id', wrapped })
    await guardArgon(`user|${userId}`, 'argon2id')
    if (email) await guardArgon(email.trim().toLowerCase(), 'argon2id')
    return next
  } catch {
    next.wrapKey.fill(0)
    return null
  }
}

/** Déconnexion : plus de clé pour ce compte sur ce navigateur (les autres comptes gardent la leur). */
export async function clearAccountKey(userId?: string) {
  forgetTyped()
  useAccountKey.setState({ status: 'idle', mode: 'unlock', priv: null, pub: null, sign: null, recoveryToShow: null })
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
