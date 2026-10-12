// Clé de compte E2E côté mobile (docs/CHIFFREMENT-E2E.md §3).
// Le scalaire privé vit dans expo-secure-store (Keychain/Keystore, appareil
// déverrouillé, jamais sauvegardé ailleurs) ; le serveur ne reçoit que la
// publique et des enveloppes chiffrées ici.
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { ApiError, http } from '@/lib/http'
import * as c from './crypto'
import { type AccountSecrets, type AnyWrapped, asKdf, deriveSecrets, newKdfSalt, passwordProblem, unwrapAny, wrapKeyV2 } from './authKdf'
import { pwnedProblem } from './pwned'
import { guardArgon, guardKdf, guardPrelogin, markMigrated } from './authGuard'
import { tokens } from '@/lib/tokens'
import { t } from '@/i18n'

interface KeysResponse { public: string; fingerprint: string; wrapped: AnyWrapped; backup: c.WrappedKey | null }

/** `setup` : aucune clé sur le serveur ; `unlock` : clé à ouvrir sur cet appareil. */
export type LockMode = 'setup' | 'unlock'

interface E2EState {
  status: 'idle' | 'working' | 'ready' | 'locked'
  mode: LockMode
  /** Scalaire privé en mémoire (le stockage durable est SecureStore). */
  priv: Uint8Array | null
  pub: string | null
  /** Code de récupération à afficher UNE fois, puis oublié. */
  recoveryToShow: string | null
  /** Écran de clé ouvert : bloquant jusqu'à ce que la clé soit prête (reste ouvert pendant le calcul). */
  prompt: boolean
  /** Compte auquel appartient la clé (lu par les conversations chiffrées). */
  userId: string | null
}

export const useAccountKey = create<E2EState>()(() => ({
  status: 'idle', mode: 'unlock', priv: null, pub: null, recoveryToShow: null, prompt: false, userId: null,
}))

// Une clé par compte (plusieurs comptes dans l'appli) ; l'ancienne entrée unique est relue une fois.
const LEGACY_KEY = 'fc_e2e_account_key'
const storeKey = (userId: string) => `fc_e2e_account_key.${userId}`
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.e2e',
}

// Mot de passe saisi à la connexion : en mémoire seulement (jamais envoyé), jusqu'à ce que la clé
// soit prête. `secrets` = auth et wrapKey déjà dérivés à la connexion (connexion v2, authKdf.ts).
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
  const k = await http.post<KdfInfo>('/auth/prelogin', { email: email.trim().toLowerCase() }, { auth: false })
  await guardPrelogin(email, k)
  if (!k.legacy) await guardArgon(email.trim().toLowerCase(), k.kdf)
  if (!k.legacy) await markMigrated(email)
  return k
}

/**
 * auth + wrapKey du compte connecté pour ce mot de passe ; null = compte pas encore migré.
 * `legacy` pour un compte vu migré sur cet appareil : AUTH_DOWNGRADE, le mot de passe ne part pas.
 */
async function secretsFor(password: string): Promise<AccountSecrets | null> {
  if (typed?.password === password && typed.secrets) return typed.secrets
  const k = await http.get<KdfInfo>('/users/me/kdf')
  // Message affiché tel quel par les écrans (errorMessage) ; `code` pour qui veut le reconnaître.
  const refuse = () => Object.assign(new Error(t('auth.proofDowngrade')), { code: 'AUTH_DOWNGRADE' })
  const userId = await tokens.getUserId()
  // Sans identifiant (session très ancienne) : aucun état migré connu, rien à comparer.
  if (userId) await guardKdf(userId, k).catch(() => { throw refuse() })
  if (k.legacy || !k.kdf_salt) return null
  if (userId) await guardArgon(`user|${userId}`, k.kdf).catch(() => { throw refuse() })
  return deriveSecrets(password, k.kdf_salt, asKdf(k.kdf))
}

const proofOf = (password: string, s: AccountSecrets | null) => (s ? { auth: s.auth } : { password })

/** Champ à joindre aux routes sensibles : `auth`, ou `password` pour un compte pas encore migré. */
export async function passwordProof(password: string): Promise<{ auth: string } | { password: string }> {
  const s = await working(() => secretsFor(password))
  const proof = proofOf(password, s)
  if (s && s !== typed?.secrets) s.wrapKey.fill(0)
  return proof
}

/** Enveloppe du mot de passe : v2 (wrapKey) pour un compte migré, v1 sinon. */
const sealFor = (priv: Uint8Array, password: string, s: AccountSecrets | null, userId: string): Promise<AnyWrapped> =>
  s ? wrapKeyV2(priv, s.wrapKey, userId) : c.wrapKey(priv, password, c.keyAad(userId))

/**
 * Enveloppe du serveur encore en v1 sur un compte migré : rescellée en v2 avec la clé privée déjà
 * ouverte. Idempotent ; un échec est rejoué à la connexion suivante.
 */
async function migrateWrapped(userId: string, keys: KeysResponse, priv: Uint8Array, s: AccountSecrets) {
  if (keys.wrapped.v === 2) return
  const wrapped = await wrapKeyV2(priv, s.wrapKey, userId)
  await http.put('/users/me/keys/wrapped', { auth: s.auth, wrapped })
  keys.wrapped = wrapped
}

async function fetchKeys(): Promise<KeysResponse | null> {
  try {
    return await http.get<KeysResponse>('/users/me/keys')
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

/** Exécute une opération lente (PBKDF2 600 000 en JS) avec l'indicateur « Préparation… ». */
async function working<T>(fn: () => Promise<T>): Promise<T> {
  const prev = useAccountKey.getState().status
  useAccountKey.setState({ status: 'working' })
  try {
    return await fn()
  } finally {
    if (useAccountKey.getState().status === 'working') useAccountKey.setState({ status: prev })
  }
}

async function activate(userId: string, priv: Uint8Array, pub: Uint8Array) {
  // Le scalaire déchiffré doit correspondre à la publique annoncée par le serveur.
  if (c.b64uEncode(c.publicFromPrivate(priv)) !== c.b64uEncode(pub)) throw new Error('KEY_MISMATCH')
  const pubB64 = c.b64uEncode(pub)
  await SecureStore.setItemAsync(storeKey(userId), JSON.stringify({ userId, priv: c.b64uEncode(priv), pub: pubB64 }), OPTS)
  forgetTyped()
  useAccountKey.setState({ status: 'ready', priv, pub: pubB64, userId })
}

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

async function loadStored(userId: string): Promise<{ priv: string; pub: string } | null> {
  try {
    const raw = (await SecureStore.getItemAsync(storeKey(userId), OPTS)) ?? (await SecureStore.getItemAsync(LEGACY_KEY, OPTS))
    const v = raw ? (JSON.parse(raw) as { userId: string; priv: string; pub: string }) : null
    if (v?.userId !== userId) return null
    // Ancienne entrée unique : déplacée sous le nom propre au compte.
    if (!(await SecureStore.getItemAsync(storeKey(userId), OPTS))) {
      await SecureStore.setItemAsync(storeKey(userId), JSON.stringify(v), OPTS)
      await SecureStore.deleteItemAsync(LEGACY_KEY, OPTS).catch(() => {})
    }
    return v
  } catch {
    return null
  }
}

/** Au démarrage d'une session : clé locale, sinon ouverture/création avec le mot de passe saisi. */
export async function initAccountKey(userId: string) {
  const stored = await loadStored(userId)
  const t = typed
  if (stored) {
    const priv = c.b64uDecode(stored.priv)
    // Juste après une connexion : l'enveloppe du serveur passe en v2 même si la clé est déjà là.
    if (t?.secrets) {
      try {
        const keys = await fetchKeys()
        if (keys) await migrateWrapped(userId, keys, priv, t.secrets)
      } catch { /* rejoué à la prochaine connexion */ }
    }
    forgetTyped()
    useAccountKey.setState({ status: 'ready', priv, pub: stored.pub, userId })
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
  useAccountKey.setState({ status: 'locked', mode: keys ? 'unlock' : 'setup', prompt: true })
}

export const createAccountKey = (userId: string, password: string) => working(async () => {
  const m = await newKeyMaterial(userId, password, await secretsFor(password))
  await http.put('/users/me/keys', m.body)
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
})

export const unlockWithPassword = (userId: string, password: string, keys?: KeysResponse | null) => working(async () => {
  const k = keys ?? await fetchKeys()
  if (!k) throw new Error('NO_KEY')
  const s = await secretsFor(password)
  const priv = await unwrapAny(k.wrapped, password, s, userId)
  if (s) await migrateWrapped(userId, k, priv, s).catch(() => { /* rejoué à la prochaine connexion */ })
  await activate(userId, priv, c.b64uDecode(k.public))
})

/** Code de récupération (après « mot de passe oublié ») : ré-enveloppe avec le mot de passe actuel. */
export const unlockWithRecovery = (userId: string, code: string, pw?: string) => working(async () => {
  const password = passwordOr(pw)
  const norm = c.normalizeRecoveryCode(code)
  const k = await fetchKeys()
  if (!norm || !k?.backup) throw new Error('BAD_CODE')
  const priv = await c.unwrapKey(k.backup, norm, c.backupAad(userId))
  const s = await secretsFor(password)
  const wrapped = await sealFor(priv, password, s, userId)
  await http.put('/users/me/keys/wrapped', { ...proofOf(password, s), wrapped })
  await activate(userId, priv, c.b64uDecode(k.public))
})

/** Nouvelle clé : l'ancien historique chiffré devient illisible (confirmation côté écran). */
export const resetAccountKey = (userId: string, pw?: string) => working(async () => {
  const password = passwordOr(pw)
  const s = await secretsFor(password)
  const m = await newKeyMaterial(userId, password, s)
  await http.post('/users/me/keys/reset', { ...proofOf(password, s), ...m.body })
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
})

/** Nouveau code de récupération (l'ancien cesse de fonctionner) ; rendu pour affichage unique. */
export const regenerateRecoveryCode = (userId: string, password: string) => working(async () => {
  const priv = useAccountKey.getState().priv
  if (!priv) throw new Error('NO_KEY')
  const code = c.generateRecoveryCode()
  const backup = await c.wrapKey(priv, code, c.backupAad(userId))
  await http.put('/users/me/keys/backup', { ...proofOf(password, await secretsFor(password)), backup })
  return code
})

/**
 * Changement de mot de passe (atomique côté serveur) : nouvelle preuve, nouveau sel et clé privée
 * rescellée en v2 par la nouvelle wrapKey. Sans clé sur cet appareil, l'enveloppe n'est pas envoyée.
 */
export const changePassword = (userId: string, oldPw: string, newPw: string) => working(async () => {
  const problem = passwordProblem(newPw) ?? await pwnedProblem(newPw)
  if (problem) throw new Error(problem)
  const old = await secretsFor(oldPw)
  const newSalt = newKdfSalt()
  const next = await deriveSecrets(newPw, newSalt, 'argon2id')
  try {
    const priv = useAccountKey.getState().priv
    const wrapped = priv ? await wrapKeyV2(priv, next.wrapKey, userId) : null
    await http.post('/auth/change-password', {
      ...(old ? { old_auth: old.auth } : { old_password: oldPw }),
      new_auth: next.auth, new_kdf_salt: newSalt, new_kdf: 'argon2id', wrapped,
    })
    await guardArgon(`user|${userId}`, 'argon2id')
  } finally {
    next.wrapKey.fill(0)
    if (old !== typed?.secrets) old?.wrapKey.fill(0)
  }
})

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
    await http.post('/auth/upgrade-kdf', { old_auth: old.auth, new_auth: next.auth, new_kdf_salt: salt, kdf: 'argon2id', wrapped })
    await guardArgon(`user|${userId}`, 'argon2id')
    if (email) await guardArgon(email.trim().toLowerCase(), 'argon2id')
    return next
  } catch {
    next.wrapKey.fill(0)
    return null
  }
}

/** Déconnexion : plus de clé pour ce compte sur cet appareil. `keep` (changement de compte) :
 *  la clé reste rangée, seule la mémoire est vidée. */
export async function clearAccountKey(userId?: string | null, keep = false) {
  forgetTyped()
  useAccountKey.setState({ status: 'idle', mode: 'unlock', priv: null, pub: null, recoveryToShow: null, prompt: false, userId: null })
  if (keep) return
  if (userId) await SecureStore.deleteItemAsync(storeKey(userId), OPTS).catch(() => {})
  await SecureStore.deleteItemAsync(LEGACY_KEY, OPTS).catch(() => {})
}

/** Code de sécurité entre ma clé et celle d'un autre utilisateur ; null si l'un n'en a pas. */
export async function safetyCodeWith(userId: string): Promise<string | null> {
  const mine = useAccountKey.getState().pub
  if (!mine) return null
  try {
    const r = await http.get<{ public: string }>(`/users/${encodeURIComponent(userId)}/keys/public`)
    return await c.safetyCode(c.b64uDecode(mine), c.b64uDecode(r.public))
  } catch {
    return null
  }
}
