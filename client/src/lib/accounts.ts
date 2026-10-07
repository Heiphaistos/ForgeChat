import axios from 'axios'
import api, { baseURL } from '../api/client'
import { TAURI_KEY } from './localSession'

/**
 * Plusieurs comptes dans la même appli, bascule rapide.
 * - Web : les jetons des comptes inactifs restent dans des cookies HttpOnly propres à chaque
 *   compte (server/src/handlers/accounts.rs) ; la page n'en voit aucun.
 * - Bureau (Tauri, sans cookies) : rangés à côté du jeton du compte actif, dans le stockage
 *   de l'appli. Aucun mot de passe n'est jamais retenu.
 * Les clés de chiffrement restent séparées par compte (IndexedDB, clé = id du compte).
 */

export interface SavedAccount { id: string; username: string; discriminator?: string; avatar: string | null }
interface TauriAccount extends SavedAccount { refresh_token: string }

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const MAX_OTHER_ACCOUNTS = 4

let known: SavedAccount[] = []

function tauriList(): TauriAccount[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TAURI_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((a): a is TauriAccount => typeof a?.id === 'string' && typeof a?.refresh_token === 'string') : []
  } catch { return [] }
}
const tauriSave = (list: TauriAccount[]) => localStorage.setItem(TAURI_KEY, JSON.stringify(list))
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
  if (!isTauri) { await api.post('/auth/accounts/stash'); return }
  const refresh = localStorage.getItem('refresh_token')
  if (!refresh) throw new Error('NO_SESSION')
  const list = tauriList().filter(a => a.id !== me.id)
  if (list.length >= MAX_OTHER_ACCOUNTS) throw new Error('TOO_MANY')
  tauriSave([...list, { ...strip(me), refresh_token: refresh }])
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
}

/** Bascule vers un compte mis de côté (le compte actif est mis de côté), puis recharge l'appli. */
export async function switchTo(id: string, me: SavedAccount | null): Promise<void> {
  if (!isTauri) {
    await api.post('/auth/accounts/switch', { user_id: id })
  } else {
    const target = tauriList().find(a => a.id === id)
    if (!target) throw new Error('UNKNOWN_ACCOUNT')
    const { data } = await axios.post(`${baseURL}/auth/refresh`, { refresh_token: target.refresh_token })
    const current = localStorage.getItem('refresh_token')
    const rest = tauriList().filter(a => a.id !== id && a.id !== me?.id)
    tauriSave(me && current ? [...rest, { ...strip(me), refresh_token: current }] : rest)
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
  }
  window.location.assign('/')
}

/** Retire un compte mis de côté. Web : sa session est fermée côté serveur. Bureau : son jeton
 *  est oublié (il expire seul, ou se révoque depuis Réglages > Sessions de ce compte). */
export async function forgetAccount(id: string): Promise<void> {
  if (!isTauri) await api.post('/auth/accounts/forget', { user_id: id })
  else tauriSave(tauriList().filter(a => a.id !== id))
  known = known.filter(a => a.id !== id)
}

