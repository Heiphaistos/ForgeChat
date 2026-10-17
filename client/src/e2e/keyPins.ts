// Registre des empreintes épinglées (TOFU), par compte, dans IndexedDB (`forgechat-pins`).
// Une clé qui change n'est plus utilisée pour chiffrer tant que l'utilisateur ne l'a pas
// acceptée dans la boîte de dialogue bloquante (KeyChangeDialog). Logique : keyPinsCore.ts.
import { create } from 'zustand'
import { useAuth } from '../store/auth'
import { useAccountKey } from './accountKey'
import api from '../api/client'
import { contactKeyLogged, loadMonitorState, type KtEntry } from './keyTransparency'
import { checkServerKey, envelopeSender, fpOf, ownerVouches, serverSubject, sortMembers, type Pin, type SignedServerKey } from './keyPinsCore'

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
  /**
   * Clé de récupération de serveur JAMAIS vue : rien n'est enveloppé pour elle (ni la nouvelle
   * époque, ni l'historique) avant acceptation explicite. Un serveur compromis ne peut donc plus
   * s'inventer une « clé du serveur » et recevoir en silence les clés de tous les salons.
   */
  fresh?: boolean
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
 * Clé jamais vue d'un contact : inscrite au journal de transparence ? `false` = le journal contredit la
 * clé servie, ou n'en a aucune trace (`kt_seq` absent) ; `null` = indéterminé (erreur réseau : l'envoi n'est pas bloqué).
 */
export async function keyLogged(userId: string, pub: string): Promise<boolean | null> {
  try {
    const { data } = await api.get<{ kt_seq?: number | null }>(`/users/${userId}/keys/public`)
    if (typeof data.kt_seq !== 'number') return false
    const entry = (await api.get<KtEntry>(`/keys/log/${data.kt_seq}`)).data
    return await contactKeyLogged(userId, pub, entry, loadMonitorState(me() ?? '')?.head ?? null)
  } catch {
    return null
  }
}

/**
 * Membres vers lesquels on peut chiffrer : empreinte recalculée, nouvelle clé épinglée,
 * clé changée exclue (et signalée). Seul chemin vers wrapFor.
 */
export async function trustedMembers<T extends MemberLike>(list: T[]) {
  const account = me()
  if (!account) return []
  const { trusted, changed, fresh } = await sortMembers(list, account, useAccountKey.getState().pub, s => getPin(account, s))
  const unlogged = new Set<string>()
  for (const f of fresh) {
    const m = trusted.find(x => x.user_id === f.subject)
    if (m && (await keyLogged(m.user_id, m.public)) === false) {
      // Le journal de transparence contredit la clé servie : traitée comme une clé changée (non épinglée, exclue).
      unlogged.add(m.user_id)
      raise({ subject: m.user_id, name: m.username ?? m.user_id, kind: 'user', pub: m.public, fp: m.fingerprint, verified: false })
    } else await savePin(account, f.subject, { fp: f.fp })
  }
  for (const m of changed) raise({ subject: m.user_id, name: m.username ?? m.user_id, kind: 'user', pub: m.public, fp: m.fingerprint, verified: m.verified })
  return trusted.filter(m => !unlogged.has(m.user_id))
}

/** L'émetteur d'une enveloppe est-il moi, ou un contact à la clé épinglée ? (1re vue : épinglée, acceptée). */
export async function trustEnvelopeSender(by: string, byPub: string): Promise<boolean> {
  const account = me()
  if (!account) return false
  const r = await envelopeSender(by, byPub, account, useAccountKey.getState().pub, s => getPin(account, s))
  // 1re vue : l'émetteur doit figurer au journal de transparence, sinon enveloppe refusée (« unreadable »).
  if (r.fresh && (await keyLogged(by, byPub)) === false) return false
  if (r.fresh) await savePin(account, by, { fp: r.fresh })
  return r.ok
}

/**
 * Clé de récupération d'un serveur, avec l'empreinte recalculée ; null si elle a changé ou si elle
 * n'a jamais été acceptée sur cet appareil (enveloppe refusée, boîte de dialogue ouverte).
 */
export async function trustedServerKey<T extends SignedServerKey>(sk: T, serverName?: string): Promise<(T & { fingerprint: string }) | null> {
  const account = me()
  if (!account) return null
  const r = await checkServerKey(sk, s => getPin(account, s))
  if (r.ok && !r.fresh) return { ...sk, fingerprint: r.fp }
  // Jamais vue mais signée par son propriétaire, que je connais déjà : acceptée sans question.
  if (r.fresh && await ownerVouches(sk, account, useAccountKey.getState().pub, s => getPin(account, s), signerPublic)) {
    await savePin(account, serverSubject(sk.server_id), { fp: r.fp })
    return { ...sk, fingerprint: r.fp }
  }
  raise({ subject: serverSubject(sk.server_id), name: serverName ?? sk.server_id, kind: 'server', pub: sk.public, fp: r.fp, verified: r.verified, fresh: r.fresh })
  return null
}

/** Clé de compte publique servie pour un utilisateur (comparée ensuite à son épingle). */
const signerPublic = (userId: string) =>
  api.get<{ public: string | null }>(`/users/${userId}/keys/public`).then(r => r.data.public ?? null)

/** Propriétaire qui vient de créer la clé de son serveur : épinglée d'office. */
export async function pinOwnServerKey(serverId: string, pub: string) {
  const account = me()
  if (account) await savePin(account, serverSubject(serverId), { fp: await fpOf(pub) })
}
