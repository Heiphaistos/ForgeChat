// Registre des empreintes épinglées (TOFU), une entrée SecureStore par compte et par contact
// (SecureStore borne la taille d'une valeur). Une clé qui change n'est plus utilisée pour
// chiffrer tant que l'utilisateur ne l'a pas acceptée (KeyChangeDialog). Logique : keyPinsCore.ts.
import { create } from 'zustand'
import { secureStateStorage } from '@/lib/secureStorage'
import { useAccountKey } from './accountKey'
import { http, path } from '@/lib/http'
import { contactKeyLogged, type KtEntry, type MonitorState } from './keyTransparency'
import { checkServerKey, envelopeSender, fpOf, ownerVouches, serverSubject, sortMembers, type Pin, type SignedServerKey } from './keyPinsCore'

export { fpOf } from './keyPinsCore'

// Même clé que l'ancien registre « déjà vu » (valeur = empreinte seule) : migration implicite.
// Compte de la clé ouverte (comme conversations.ts : pas de dépendance au magasin de session).
const getMyId = () => useAccountKey.getState().userId

const pinKey = (account: string, subject: string) => `fc_e2e_fp_${account}_${subject}`
const cache = new Map<string, Pin | null>()
/** Épingles gardées en mémoire seulement (écriture SecureStore échouée). */
export const persistFailures = new Set<string>()

/** Ancienne valeur (empreinte seule) ou nouvelle (JSON {fp, verified}). */
export function parsePin(v: string | null | undefined): Pin | undefined {
  if (!v) return undefined
  if (!v.startsWith('{')) return { fp: v }
  try {
    const p = JSON.parse(v) as Pin
    return typeof p.fp === 'string' ? { fp: p.fp, verified: !!p.verified } : undefined
  } catch {
    return undefined
  }
}

async function getPin(account: string, subject: string): Promise<Pin | undefined> {
  const k = pinKey(account, subject)
  if (cache.has(k)) return cache.get(k) ?? undefined
  const pin = parsePin(await secureStateStorage.getItem(k) as string | null)
  cache.set(k, pin ?? null)
  return pin
}

async function savePin(account: string, subject: string, pin: Pin) {
  const k = pinKey(account, subject)
  cache.set(k, pin)
  try {
    await secureStateStorage.setItem(k, JSON.stringify(pin))
  } catch {
    // Épingle non persistée (déjà journalisé) : valable pour cette session seulement, à re-épingler au prochain démarrage.
    persistFailures.add(k)
  }
}

export async function pinOf(subject: string): Promise<Pin | undefined> {
  const a = getMyId()
  return a ? getPin(a, subject) : undefined
}

// ─── Alertes « clé changée » (boîte de dialogue bloquante) ──────────────────
export interface KeyAlert {
  subject: string
  name: string
  kind: 'user' | 'server'
  pub: string
  fp: string
  verified: boolean
  /** Clé de récupération de serveur jamais vue : rien ne lui est enveloppé avant acceptation explicite. */
  fresh?: boolean
}
export const useKeyAlerts = create<{ alerts: KeyAlert[] }>(() => ({ alerts: [] }))
const refused = new Map<string, KeyAlert>()

function raise(a: KeyAlert) {
  if (refused.has(`${a.subject}|${a.fp}`)) return
  useKeyAlerts.setState((s) => (s.alerts.some((x) => x.subject === a.subject && x.fp === a.fp) ? s : { alerts: [...s.alerts, a] }))
}

export async function acceptKey(a: KeyAlert) {
  const account = getMyId()
  if (!account) return
  await savePin(account, a.subject, { fp: a.fp })
  useKeyAlerts.setState((s) => ({ alerts: s.alerts.filter((x) => x.subject !== a.subject) }))
}

export function refuseKey(a: KeyAlert) {
  refused.set(`${a.subject}|${a.fp}`, a)
  useKeyAlerts.setState((s) => ({ alerts: s.alerts.filter((x) => !(x.subject === a.subject && x.fp === a.fp)) }))
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

export async function markVerified(userId: string, pub: string): Promise<boolean> {
  const account = getMyId()
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
    const data = await http.get<{ kt_seq?: number | null }>(path`/users/${userId}/keys/public`)
    if (typeof data.kt_seq !== 'number') return false
    const entry = await http.get<KtEntry>(path`/keys/log/${data.kt_seq}`)
    const account = getMyId()
    const saved = account ? await secureStateStorage.getItem(`fc_kt_${account}`) as string | null : null
    let head: MonitorState['head'] = null
    try { head = (JSON.parse(saved ?? 'null') as MonitorState | null)?.head ?? null } catch { /* état illisible : sans rattachement */ }
    return await contactKeyLogged(userId, pub, entry, head)
  } catch {
    return null
  }
}

/** Membres vers lesquels on peut chiffrer (empreinte recalculée, clé changée exclue et signalée). */
export async function trustedMembers<T extends MemberLike>(list: T[]) {
  const account = getMyId()
  if (!account) return []
  const { trusted, changed, fresh } = await sortMembers(list, account, useAccountKey.getState().pub, (s) => getPin(account, s))
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

/** Clé de récupération d'un serveur, empreinte recalculée ; null si elle a changé (enveloppe refusée). */
/** L'émetteur d'une enveloppe est-il moi, ou un contact à la clé épinglée ? (1re vue : épinglée, acceptée). */
export async function trustEnvelopeSender(by: string, byPub: string): Promise<boolean> {
  const account = getMyId()
  if (!account) return false
  const r = await envelopeSender(by, byPub, account, useAccountKey.getState().pub, (s) => getPin(account, s))
  // 1re vue : l'émetteur doit figurer au journal de transparence, sinon enveloppe refusée.
  if (r.fresh && (await keyLogged(by, byPub)) === false) return false
  if (r.fresh) await savePin(account, by, { fp: r.fresh })
  return r.ok
}

/** Clé de compte publique servie pour un utilisateur (comparée ensuite à son épingle). */
const signerPublic = (userId: string) =>
  http.get<{ public: string | null }>(path`/users/${userId}/keys/public`).then((r) => r.public ?? null)

export async function trustedServerKey<T extends SignedServerKey>(sk: T, serverName?: string): Promise<(T & { fingerprint: string }) | null> {
  const account = getMyId()
  if (!account) return null
  const r = await checkServerKey(sk, (s) => getPin(account, s))
  // Jamais vue mais signée par son propriétaire, que je connais déjà : acceptée sans question.
  if (r.fresh && (await ownerVouches(sk, account, useAccountKey.getState().pub, (s) => getPin(account, s), signerPublic))) {
    await savePin(account, serverSubject(sk.server_id), { fp: r.fp })
    return { ...sk, fingerprint: r.fp }
  }
  // Jamais vue : pas d'épinglage silencieux (un serveur compromis recevrait sinon les clés de
  // tous les salons, historique compris). L'utilisateur doit l'accepter.
  if (r.ok && !r.fresh) return { ...sk, fingerprint: r.fp }
  raise({ subject: serverSubject(sk.server_id), name: serverName ?? sk.server_id, kind: 'server', pub: sk.public, fp: r.fp, verified: r.verified, fresh: r.fresh })
  return null
}

export async function pinOwnServerKey(serverId: string, pub: string) {
  const account = getMyId()
  if (account) await savePin(account, serverSubject(serverId), { fp: await fpOf(pub) })
}
