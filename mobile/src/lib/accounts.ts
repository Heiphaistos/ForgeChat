import * as SecureStore from 'expo-secure-store'

/**
 * Autres comptes de l'appli (bascule rapide). Leur jeton de rafraîchissement reste dans le
 * Keystore/Keychain (expo-secure-store, appareil déverrouillé, jamais sauvegardé), comme celui
 * du compte actif ; aucun mot de passe n'est retenu. Clés E2E et données hors ligne : séparées
 * par compte (e2e/accountKey, lib/offline).
 */

export interface SavedAccount { id: string; username: string; avatar: string | null }

export const MAX_OTHER_ACCOUNTS = 4
const LIST_KEY = 'fc.alt_accounts.v1'
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.auth',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const tokenKey = (id: string) => `fc.alt_rt.${id}`

let known: SavedAccount[] = []

export async function listAccounts(): Promise<SavedAccount[]> {
  try {
    const v: unknown = JSON.parse((await SecureStore.getItemAsync(LIST_KEY, OPTS)) ?? '[]')
    known = Array.isArray(v)
      ? v.filter((a): a is SavedAccount => typeof a?.id === 'string' && UUID.test(a.id) && typeof a?.username === 'string')
      : []
  } catch {
    known = []
  }
  return known
}

/** Ids des autres comptes (notifications partagées par ce téléphone). */
export const otherAccountIds = () => known.map((a) => a.id)

async function saveList(list: SavedAccount[]) {
  known = list
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(list), OPTS)
}

/** Range un compte et son jeton de rafraîchissement. */
export async function putAccount(account: SavedAccount, refreshToken: string): Promise<void> {
  if (!UUID.test(account.id)) throw new Error('BAD_ACCOUNT')
  const rest = (await listAccounts()).filter((a) => a.id !== account.id)
  if (rest.length >= MAX_OTHER_ACCOUNTS) throw new Error('TOO_MANY')
  await SecureStore.setItemAsync(tokenKey(account.id), refreshToken, OPTS)
  await saveList([...rest, { id: account.id, username: account.username, avatar: account.avatar }])
}

/** Sort un compte de la liste et rend son jeton (null s'il est perdu). */
export async function takeAccount(id: string): Promise<string | null> {
  if (!UUID.test(id)) return null
  const token = await SecureStore.getItemAsync(tokenKey(id), OPTS).catch(() => null)
  await forgetAccount(id)
  return token
}

/** Oublie un compte rangé (son jeton expire seul, ou se révoque depuis les sessions du compte). */
export async function forgetAccount(id: string): Promise<void> {
  if (!UUID.test(id)) return
  await SecureStore.deleteItemAsync(tokenKey(id), OPTS).catch(() => undefined)
  await saveList((await listAccounts()).filter((a) => a.id !== id))
}
