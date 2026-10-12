// Registre des empreintes épinglées (TOFU), une entrée SecureStore par compte et par contact
// (SecureStore borne la taille d'une valeur). Une clé qui change n'est plus utilisée pour
// chiffrer tant que l'utilisateur ne l'a pas acceptée (KeyChangeDialog). Logique : keyPinsCore.ts.
import { create } from 'zustand'
import { secureStateStorage } from '@/lib/secureStorage'
import { useAccountKey } from './accountKey'
import { http, path } from '@/lib/http'
import { checkServerKey, fpOf, ownerVouches, serverSubject, sortMembers, type Pin, type SignedServerKey } from './keyPinsCore'

export { fpOf } from './keyPinsCore'

// Même clé que l'ancien registre « déjà vu » (valeur = empreinte seule) : migration implicite.
// Compte de la clé ouverte (comme conversations.ts : pas de dépendance au magasin de session).
const getMyId = () => useAccountKey.getState().userId

const pinKey = (account: string, subject: string) => `fc_e2e_fp_${account}_${subject}`
const cache = new Map<string, Pin | null>()

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
  await secureStateStorage.setItem(k, JSON.stringify(pin))
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

/** Membres vers lesquels on peut chiffrer (empreinte recalculée, clé changée exclue et signalée). */
export async function trustedMembers<T extends MemberLike>(list: T[]) {
  const account = getMyId()
  if (!account) return []
  const { trusted, changed, fresh } = await sortMembers(list, account, useAccountKey.getState().pub, (s) => getPin(account, s))
  for (const f of fresh) await savePin(account, f.subject, { fp: f.fp })
  for (const m of changed) raise({ subject: m.user_id, name: m.username ?? m.user_id, kind: 'user', pub: m.public, fp: m.fingerprint, verified: m.verified })
  return trusted
}

/** Clé de récupération d'un serveur, empreinte recalculée ; null si elle a changé (enveloppe refusée). */
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
