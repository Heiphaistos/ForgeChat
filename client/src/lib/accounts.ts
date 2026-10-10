import api from '../api/client'
import { TAURI_KEY, invokeSession, setAccessToken } from './localSession'
import { setOfflineOwner } from './offline'

/**
 * Plusieurs comptes dans la même appli, bascule rapide.
 * - Web : les jetons des comptes inactifs restent dans des cookies HttpOnly propres à chaque
 *   compte (server/src/handlers/accounts.rs) ; la page n'en voit aucun.
 * - Bureau (Tauri, sans cookies) : jeton de rafraîchissement de chaque compte dans le trousseau
 *   de l'OS, côté Rust (session.rs) ; ici seulement les profils. Aucun mot de passe retenu.
 * Les clés de chiffrement restent séparées par compte (IndexedDB, clé = id du compte).
 */

export interface SavedAccount { id: string; username: string; discriminator?: string; avatar: string | null }

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const MAX_OTHER_ACCOUNTS = 4

let known: SavedAccount[] = []

function tauriList(): SavedAccount[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TAURI_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((a): a is SavedAccount => typeof a?.id === 'string' && typeof a?.username === 'string') : []
  } catch { return [] }
}
const tauriSave = (list: SavedAccount[]) => localStorage.setItem(TAURI_KEY, JSON.stringify(list))
const strip = ({ id, username, discriminator, avatar }: SavedAccount): SavedAccount => ({ id, username, discriminator, avatar })

/** Comptes mis de côté (hors compte actif). */
export async function listAccounts(): Promise<SavedAccount[]> {
  known = isTauri
    ? tauriList().map(strip)
    : await api.get<SavedAccount[]>('/auth/accounts').then(r => (Array.isArray(r.data) ? r.data : [])).catch(() => known)
  return known
}

/** Ids des autres comptes connus (abonnement push partagé). */
export const otherAccountIds = () => known.map(a => a.id)

/** Met le compte actif de côté ; la page de connexion permet ensuite d'en ajouter un. */
export async function stashCurrent(me: SavedAccount): Promise<void> {
  setOfflineOwner(null)
  if (!isTauri) { await api.post('/auth/accounts/stash'); return }
  const list = tauriList().filter(a => a.id !== me.id)
  if (list.length >= MAX_OTHER_ACCOUNTS) throw new Error('TOO_MANY')
  await invokeSession('session_stash', { id: me.id })
  setAccessToken(null)
  tauriSave([...list, strip(me)])
}

/** Bascule vers un compte mis de côté (le compte actif est mis de côté), puis recharge l'appli. */
export async function switchTo(id: string, me: SavedAccount | null): Promise<void> {
  if (!isTauri) {
    await api.post('/auth/accounts/switch', { user_id: id })
  } else {
    if (!tauriList().some(a => a.id === id)) throw new Error('UNKNOWN_ACCOUNT')
    // Rust rafraîchit le compte choisi et range le compte actif sous `current`.
    setAccessToken(await invokeSession<string>('session_switch', { id, current: me?.id ?? null }))
    const rest = tauriList().filter(a => a.id !== id && a.id !== me?.id)
    tauriSave(me ? [...rest, strip(me)] : rest)
  }
  // Données hors ligne : celles du compte choisi dès le rechargement.
  setOfflineOwner(id)
  window.location.assign('/')
}

/** Retire un compte mis de côté. Web : sa session est fermée côté serveur. Bureau : son jeton
 *  est effacé du trousseau (il expire seul, ou se révoque depuis Réglages > Sessions de ce compte). */
export async function forgetAccount(id: string): Promise<void> {
  if (!isTauri) await api.post('/auth/accounts/forget', { user_id: id })
  else {
    await invokeSession('session_forget', { id })
    tauriSave(tauriList().filter(a => a.id !== id))
  }
  known = known.filter(a => a.id !== id)
}

