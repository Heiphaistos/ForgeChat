// Clé de compte E2E côté mobile (docs/CHIFFREMENT-E2E.md §3).
// Le scalaire privé vit dans expo-secure-store (Keychain/Keystore, appareil
// déverrouillé, jamais sauvegardé ailleurs) ; le serveur ne reçoit que la
// publique et des enveloppes chiffrées ici.
import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'
import { ApiError, http } from '@/lib/http'
import * as c from './crypto'

interface KeysResponse { public: string; fingerprint: string; wrapped: c.WrappedKey; backup: c.WrappedKey | null }

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
  /** Écran de déverrouillage ouvert (reste ouvert pendant le calcul, fermé par « Plus tard »). */
  prompt: boolean
}

export const useAccountKey = create<E2EState>()(() => ({
  status: 'idle', mode: 'unlock', priv: null, pub: null, recoveryToShow: null, prompt: false,
}))

const STORE_KEY = 'fc_e2e_account_key'
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.e2e',
}

// Mot de passe saisi à la connexion : en mémoire seulement, jusqu'à ce que la clé soit prête.
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
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify({ userId, priv: c.b64uEncode(priv), pub: pubB64 }), OPTS)
  typedPassword = null
  useAccountKey.setState({ status: 'ready', priv, pub: pubB64 })
}

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

async function loadStored(userId: string): Promise<{ priv: string; pub: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY, OPTS)
    const v = raw ? (JSON.parse(raw) as { userId: string; priv: string; pub: string }) : null
    return v?.userId === userId ? v : null
  } catch {
    return null
  }
}

/** Au démarrage d'une session : clé locale, sinon ouverture/création avec le mot de passe saisi. */
export async function initAccountKey(userId: string) {
  const stored = await loadStored(userId)
  if (stored) {
    typedPassword = null
    useAccountKey.setState({ status: 'ready', priv: c.b64uDecode(stored.priv), pub: stored.pub })
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
  useAccountKey.setState({ status: 'locked', mode: keys ? 'unlock' : 'setup', prompt: true })
}

export const createAccountKey = (userId: string, password: string) => working(async () => {
  const m = await newKeyMaterial(userId, password)
  await http.put('/users/me/keys', m.body)
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
})

export const unlockWithPassword = (userId: string, password: string, keys?: KeysResponse | null) => working(async () => {
  const k = keys ?? await fetchKeys()
  if (!k) throw new Error('NO_KEY')
  const priv = await c.unwrapKey(k.wrapped, password, c.keyAad(userId))
  await activate(userId, priv, c.b64uDecode(k.public))
})

/** Code de récupération (après « mot de passe oublié ») : ré-enveloppe avec le mot de passe actuel. */
export const unlockWithRecovery = (userId: string, code: string, pw?: string) => working(async () => {
  const password = passwordOr(pw)
  const norm = c.normalizeRecoveryCode(code)
  const k = await fetchKeys()
  if (!norm || !k?.backup) throw new Error('BAD_CODE')
  const priv = await c.unwrapKey(k.backup, norm, c.backupAad(userId))
  const wrapped = await c.wrapKey(priv, password, c.keyAad(userId))
  await http.put('/users/me/keys/wrapped', { password, wrapped })
  await activate(userId, priv, c.b64uDecode(k.public))
})

/** Nouvelle clé : l'ancien historique chiffré devient illisible (confirmation côté écran). */
export const resetAccountKey = (userId: string, pw?: string) => working(async () => {
  const password = passwordOr(pw)
  const m = await newKeyMaterial(userId, password)
  await http.post('/users/me/keys/reset', { password, ...m.body })
  await activate(userId, m.priv, m.pub)
  useAccountKey.setState({ recoveryToShow: m.code })
})

/** Nouveau code de récupération (l'ancien cesse de fonctionner) ; rendu pour affichage unique. */
export const regenerateRecoveryCode = (userId: string, password: string) => working(async () => {
  const priv = useAccountKey.getState().priv
  if (!priv) throw new Error('NO_KEY')
  const code = c.generateRecoveryCode()
  const backup = await c.wrapKey(priv, code, c.backupAad(userId))
  await http.put('/users/me/keys/backup', { password, backup })
  return code
})

/** Enveloppe pour /auth/change-password ; null sans clé sur cet appareil. */
export async function rewrapForNewPassword(userId: string, newPw: string): Promise<c.WrappedKey | null> {
  const priv = useAccountKey.getState().priv
  return priv ? working(() => c.wrapKey(priv, newPw, c.keyAad(userId))) : null
}

/** Déconnexion : plus aucune clé sur cet appareil. */
export async function clearAccountKey() {
  typedPassword = null
  useAccountKey.setState({ status: 'idle', mode: 'unlock', priv: null, pub: null, recoveryToShow: null, prompt: false })
  await SecureStore.deleteItemAsync(STORE_KEY, OPTS).catch(() => {})
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
