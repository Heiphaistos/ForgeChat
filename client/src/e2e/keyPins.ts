// Registre des empreintes épinglées (TOFU), par compte, dans IndexedDB (`forgechat-pins`).
// Une clé qui change n'est plus utilisée pour chiffrer tant que l'utilisateur ne l'a pas
// acceptée dans la boîte de dialogue bloquante (KeyChangeDialog). Logique : keyPinsCore.ts.
import { create } from 'zustand'
import { useAuth } from '../store/auth'
import { useAccountKey } from './accountKey'
import { checkServerKey, fpOf, serverSubject, sortMembers, type Pin } from './keyPinsCore'

export { fpOf } from './keyPinsCore'

const DB = 'forgechat-pins'
const STORE = 'pins'
/** Ancien registre en localStorage (avant 2026-10-10), migré puis effacé. */
const LEGACY = 'fc_e2e_seen_fp'

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

const me = () => useAuth.getState().user?.id ?? null
const cache = new Map<string, Pin | null>()
const migrated = new Set<string>()

async function migrate(account: string) {
  if (migrated.has(account)) return
  migrated.add(account)
  let old: Record<string, string> = {}
  try { old = JSON.parse(localStorage.getItem(`${LEGACY}:${account}`) ?? '{}') } catch { return }
  for (const [subject, fp] of Object.entries(old)) {
    if (typeof fp !== 'string') continue
    if (!(await idb<Pin | undefined>('readonly', s => s.get(`${account}|${subject}`)).catch(() => undefined))) {
      await savePin(account, subject, { fp })
    }
  }
  try { localStorage.removeItem(`${LEGACY}:${account}`) } catch { /* stockage indisponible */ }
}

async function getPin(account: string, subject: string): Promise<Pin | undefined> {
  const k = `${account}|${subject}`
  if (cache.has(k)) return cache.get(k) ?? undefined
  await migrate(account)
  const pin = await idb<Pin | undefined>('readonly', s => s.get(k)).catch(() => undefined)
  cache.set(k, pin ?? null)
  return pin
}

async function savePin(account: string, subject: string, pin: Pin) {
  cache.set(`${account}|${subject}`, pin)
  // Échec d'écriture : l'épingle reste en mémoire pour la session (au pire, nouvelle 1re vue au prochain démarrage).
  await idb<unknown>('readwrite', s => s.put(pin, `${account}|${subject}`)).catch(() => {})
}

/** Pin courant d'un sujet (null sans compte). */
export async function pinOf(subject: string): Promise<Pin | undefined> {
  const a = me()
  return a ? getPin(a, subject) : undefined
}

// ─── Alertes « clé changée » (boîte de dialogue bloquante) ──────────────────
export interface KeyAlert {
  subject: string
  /** Pseudo, ou nom du serveur pour une clé de récupération. */
  name: string
  kind: 'user' | 'server'
  pub: string
  fp: string
  /** Le contact avait été marqué vérifié : alerte rouge. */
  verified: boolean
}
export const useKeyAlerts = create<{ alerts: KeyAlert[] }>(() => ({ alerts: [] }))
/** Refus de la session (« pas maintenant ») : pas de nouvelle alerte pour cette clé, toujours exclue. */
const refused = new Map<string, KeyAlert>()

function raise(a: KeyAlert) {
  if (refused.has(`${a.subject}|${a.fp}`)) return
  useKeyAlerts.setState(s => s.alerts.some(x => x.subject === a.subject && x.fp === a.fp) ? s : { alerts: [...s.alerts, a] })
}

/** Accepte la nouvelle clé (après comparaison du code de sécurité) : chiffrement de nouveau permis vers elle. */
export async function acceptKey(a: KeyAlert) {
  const account = me()
  if (!account) return
  await savePin(account, a.subject, { fp: a.fp })
  useKeyAlerts.setState(s => ({ alerts: s.alerts.filter(x => x.subject !== a.subject) }))
}

/** « Pas maintenant » : la clé reste exclue du chiffrement. */
export function refuseKey(a: KeyAlert) {
  refused.set(`${a.subject}|${a.fp}`, a)
  useKeyAlerts.setState(s => ({ alerts: s.alerts.filter(x => !(x.subject === a.subject && x.fp === a.fp)) }))
}

/**
 * Rouvre la boîte de dialogue pour ces contacts, même refusés « pas maintenant » (le serveur
 * refuse de les laisser de côté : WITHHELD_NOT_ALLOWED).
 */
export function reopenKeyAlerts(subjects: string[]) {
  for (const [k, a] of [...refused]) {
    if (!subjects.includes(a.subject)) continue
    refused.delete(k)
    raise(a)
  }
}

/** Marque vérifiée (codes de sécurité comparés) la clé `pub` d'un contact, si c'est bien celle épinglée. */
export async function markVerified(userId: string, pub: string): Promise<boolean> {
  const account = me()
  if (!account) return false
  const fp = await fpOf(pub)
  const pin = await getPin(account, userId)
  if (pin && pin.fp !== fp) return false
  await savePin(account, userId, { fp, verified: true })
  return true
}

// ─── Points d'entrée du chiffrement ─────────────────────────────────────────
interface MemberLike { user_id: string; username?: string; public: string | null }

/**
 * Membres vers lesquels on peut chiffrer : empreinte recalculée, nouvelle clé épinglée,
 * clé changée exclue (et signalée). Seul chemin vers wrapFor.
 */
export async function trustedMembers<T extends MemberLike>(list: T[]) {
  const account = me()
  if (!account) return []
  const { trusted, changed, fresh } = await sortMembers(list, account, useAccountKey.getState().pub, s => getPin(account, s))
  for (const f of fresh) await savePin(account, f.subject, { fp: f.fp })
  for (const m of changed) raise({ subject: m.user_id, name: m.username ?? m.user_id, kind: 'user', pub: m.public, fp: m.fingerprint, verified: m.verified })
  return trusted
}

/** Clé de récupération d'un serveur, avec l'empreinte recalculée ; null si elle a changé (enveloppe refusée). */
export async function trustedServerKey<T extends { server_id: string; public: string }>(sk: T, serverName?: string): Promise<(T & { fingerprint: string }) | null> {
  const account = me()
  if (!account) return null
  const r = await checkServerKey(sk, s => getPin(account, s))
  if (r.fresh) await savePin(account, serverSubject(sk.server_id), { fp: r.fp })
  if (r.ok) return { ...sk, fingerprint: r.fp }
  raise({ subject: serverSubject(sk.server_id), name: serverName ?? sk.server_id, kind: 'server', pub: sk.public, fp: r.fp, verified: r.verified })
  return null
}

/** Propriétaire qui vient de créer la clé de son serveur : épinglée d'office. */
export async function pinOwnServerKey(serverId: string, pub: string) {
  const account = me()
  if (account) await savePin(account, serverSubject(serverId), { fp: await fpOf(pub) })
}
