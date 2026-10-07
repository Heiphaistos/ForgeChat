// Messages chiffrés des MP et groupes côté web (docs/CHIFFREMENT-E2E.md §4.1, §6).
// Clés d'époque gardées EN MÉMOIRE seulement (jamais stockées) : rechargées
// depuis les enveloppes du serveur et ouvertes avec la clé de compte.
import api from '../api/client'
import { t } from '../i18n'
import { useAuth } from '../store/auth'
import { useAccountKey } from './accountKey'
import * as c from './crypto'

export type ConvKind = 'dm' | 'group'

interface Envelope { epoch: number; wrapped: c.ConvWrapped; wrapped_by: string | null; wrapped_by_pub: string }
interface KeysResponse { current_epoch: number | null; rotate_needed: boolean; all_keyed: boolean; envelopes: Envelope[] }
export interface ConvMember { user_id: string; username: string; public: string | null; fingerprint: string | null }

interface ConvState { keys: Map<number, Uint8Array>; current: number | null; rotate: boolean; allKeyed: boolean; at: number }

const cache = new Map<string, ConvState>()
const loading = new Map<string, Promise<ConvState>>()
const asked = new Map<string, number>()

const myId = () => useAuth.getState().user?.id ?? null
const base = (kind: ConvKind, id: string) => `/e2e/conversations/${kind}/${id}`
/** Code d'erreur du serveur (premier mot du message : « EPOCH_STALE », « PLAINTEXT_REFUSED »…). */
export const errorCode = (e: unknown): string | undefined =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error?.split(' ')[0]

/** Oublie les clés (déconnexion, nouvelles enveloppes reçues). */
export function forgetConv(kind?: ConvKind, id?: string) {
  if (kind && id) cache.delete(c.convName(kind, id))
  else cache.clear()
}

async function fetchState(kind: ConvKind, id: string): Promise<ConvState> {
  const { data } = await api.get<KeysResponse>(`${base(kind, id)}/keys`)
  const keys = new Map<number, Uint8Array>()
  const priv = useAccountKey.getState().priv
  const me = myId()
  const conv = c.convName(kind, id)
  if (priv && me) {
    for (const e of data.envelopes) {
      if (!e.wrapped_by) continue
      try {
        keys.set(e.epoch, await c.unwrapConvKey(priv, c.b64uDecode(e.wrapped_by_pub), e.wrapped, conv, e.epoch, me, e.wrapped_by))
      } catch { /* enveloppe pour une ancienne clé ou altérée : on la redemandera */ }
    }
  }
  return { keys, current: data.current_epoch, rotate: data.rotate_needed, allKeyed: data.all_keyed, at: Date.now() }
}

/** État de la conversation ; `force` recharge (au plus une fois par seconde). */
async function load(kind: ConvKind, id: string, force = false): Promise<ConvState> {
  const name = c.convName(kind, id)
  const hit = cache.get(name)
  if (hit && (!force || Date.now() - hit.at < 1000)) return hit
  let p = loading.get(name)
  if (!p) {
    p = fetchState(kind, id).finally(() => loading.delete(name))
    loading.set(name, p)
  }
  const st = await p
  cache.set(name, st)
  return st
}

/** Demande les clés manquantes aux autres membres (au plus une fois par minute). */
async function requestKeys(kind: ConvKind, id: string) {
  const name = c.convName(kind, id)
  if (Date.now() - (asked.get(name) ?? 0) < 60_000) return
  asked.set(name, Date.now())
  await api.post(`${base(kind, id)}/keys/request`).catch(() => {})
}

async function keyFor(kind: ConvKind, id: string, epoch: number): Promise<Uint8Array | null> {
  let st = await load(kind, id)
  if (!st.keys.has(epoch)) st = await load(kind, id, true)
  const key = st.keys.get(epoch) ?? null
  if (!key && useAccountKey.getState().status === 'ready') void requestKeys(kind, id)
  return key
}

export const getMembers = (kind: ConvKind, id: string) =>
  api.get<ConvMember[]>(`${base(kind, id)}/members`).then(r => r.data)

/** Nouvelle époque (0 à la première conversation chiffrée, n+1 après un départ). */
async function createEpoch(kind: ConvKind, id: string, st: ConvState): Promise<number> {
  const priv = useAccountKey.getState().priv
  const me = myId()
  if (!priv || !me) throw new Error('E2E_LOCKED')
  const members = await getMembers(kind, id)
  if (members.some(m => !m.public || !m.fingerprint)) throw new Error('E2E_MEMBERS')
  const epoch = st.current === null ? 0 : st.current + 1
  const key = c.generateConvKey()
  const conv = c.convName(kind, id)
  const envelopes = await Promise.all(members.map(async m => ({
    member_id: m.user_id,
    member_fp: m.fingerprint,
    wrapped: await c.wrapConvKey(priv, c.b64uDecode(m.public!), key, conv, epoch, m.user_id, me),
  })))
  await api.post(`${base(kind, id)}/keys`, { epoch, create: true, envelopes })
  st.keys.set(epoch, key)
  st.current = epoch
  st.rotate = false
  return epoch
}

/**
 * Clé de l'époque courante, créée au besoin (première utilisation, rotation après
 * un départ). Sert aux messages et aux médias (vocal, appels : e2e/media.ts).
 */
export async function currentKey(kind: ConvKind, id: string): Promise<{ epoch: number; key: Uint8Array; me: string }> {
  const st = await load(kind, id)
  const me = myId()
  if (useAccountKey.getState().status !== 'ready' || !me) throw new Error('E2E_LOCKED')
  let epoch = st.current
  if (epoch === null || st.rotate) {
    try {
      epoch = await createEpoch(kind, id, st)
    } catch (e) {
      // Un autre membre a créé l'époque en même temps : on prend la sienne.
      if (errorCode(e) !== 'EPOCH_STALE') throw e
      epoch = (await load(kind, id, true)).current
    }
  }
  const key = epoch === null ? null : await keyFor(kind, id, epoch)
  if (epoch === null || !key) throw new Error('E2E_WAITING')
  return { epoch, key, me }
}

/** Champs chiffrés d'un envoi ou d'une édition ; null = texte en clair permis (membre sans clé). */
export async function seal(kind: ConvKind, id: string, text: string, clientMsgId?: string | null):
  Promise<{ enc: c.EncPayload; client_msg_id: string } | null> {
  const st = await load(kind, id)
  if (!st.allKeyed) return null
  const { epoch, key, me } = await currentKey(kind, id)
  const cmid = clientMsgId ?? crypto.randomUUID()
  return { enc: await c.encryptMessage(key, c.convName(kind, id), epoch, me, cmid, { t: text }), client_msg_id: cmid }
}

/**
 * Envoie `text` chiffré si la conversation l'exige ; une seule nouvelle tentative
 * après un refus lié à l'état (époque périmée, clair refusé).
 */
export async function withSeal<T>(
  kind: ConvKind, id: string, text: string,
  post: (body: { content: string | null; enc?: c.EncPayload; client_msg_id?: string }) => Promise<T>,
  clientMsgId?: string | null,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const sealed = text ? await seal(kind, id, text, clientMsgId) : null
    try {
      return await post(sealed ? { content: null, ...sealed } : { content: text || null })
    } catch (e) {
      const code = errorCode(e)
      if (attempt > 0 || (code !== 'EPOCH_STALE' && code !== 'PLAINTEXT_REFUSED')) throw e
      await load(kind, id, true)
    }
  }
}

/** Texte lisible d'un contenu chiffré ; null si la clé manque ou si le contenu a été altéré. */
export async function openText(
  kind: ConvKind, id: string, enc: c.EncPayload, author: string, clientMsgId: string | null | undefined,
): Promise<string | null> {
  if (!clientMsgId) return null
  try {
    const key = await keyFor(kind, id, enc.epoch)
    return key ? (await c.decryptMessage(key, c.convName(kind, id), enc, author, clientMsgId)).t : null
  } catch {
    return null
  }
}

/** Message reçu du serveur (MP ou groupe). */
export interface RawMsg {
  id: string
  content?: string | null
  enc?: c.EncPayload | null
  client_msg_id?: string | null
  purged?: boolean
  sender_id: string
}
export type E2EState = 'ok' | 'locked'
export type Opened<T> = T & { e2e?: E2EState }

/**
 * Remplace `content` par le texte déchiffré. Un message illisible garde `enc`
 * (pour le rouvrir quand la clé arrive) et affiche un texte d'attente.
 */
export async function openMessage<T extends RawMsg>(kind: ConvKind, id: string, m: T): Promise<Opened<T>> {
  if (m.purged && !m.enc) return { ...m, content: t('e2e.msg.purged') }
  if (!m.enc) return m
  const text = await openText(kind, id, m.enc, m.sender_id, m.client_msg_id)
  return text === null ? { ...m, content: t('e2e.msg.locked'), e2e: 'locked' } : { ...m, content: text, e2e: 'ok' }
}

export const openMessages = <T extends RawMsg>(kind: ConvKind, id: string, list: T[]) =>
  Promise.all(list.map(m => openMessage(kind, id, m)))

/** Messages verrouillés qui s'ouvrent maintenant (après E2E_KEYS). */
export async function reopenLocked(kind: ConvKind, id: string, list: readonly unknown[]): Promise<Map<string, Opened<RawMsg>>> {
  forgetConv(kind, id)
  const out = new Map<string, Opened<RawMsg>>()
  for (const m of list as Opened<RawMsg>[]) {
    if (m.e2e !== 'locked') continue
    const o = await openMessage(kind, id, m)
    if (o.e2e === 'ok') out.set(m.id, o)
  }
  return out
}

/** Réponse à KEY_REQUEST : enveloppe toutes nos époques pour le demandeur. */
export async function answerKeyRequest(d: { conv_kind?: string; conv_id?: string; member_id?: string }) {
  const kind = d.conv_kind === 'dm' || d.conv_kind === 'group' ? d.conv_kind : null
  const me = myId()
  const priv = useAccountKey.getState().priv
  if (!kind || !d.conv_id || !d.member_id || !me || !priv || d.member_id === me) return
  // Plusieurs membres en ligne : petit délai aléatoire, le serveur garde la première enveloppe.
  await new Promise(r => setTimeout(r, Math.random() * 1500))
  const st = await load(kind, d.conv_id).catch(() => null)
  if (!st || st.keys.size === 0) return
  const target = (await getMembers(kind, d.conv_id).catch(() => [])).find(m => m.user_id === d.member_id)
  if (!target?.public || !target.fingerprint) return
  const conv = c.convName(kind, d.conv_id)
  for (const [epoch, key] of st.keys) {
    const wrapped = await c.wrapConvKey(priv, c.b64uDecode(target.public), key, conv, epoch, target.user_id, me)
    await api.post(`${base(kind, d.conv_id)}/keys`, {
      epoch, envelopes: [{ member_id: target.user_id, member_fp: target.fingerprint, wrapped }],
    }).catch(() => {})
  }
}

// ─── Rechiffrement de l'historique (§6) ─────────────────────────────────────
interface Legacy { conv_kind: ConvKind; conv_id: string; id: string; content: string }
let reencrypting = false

/** Rechiffre en arrière-plan, par lots, mes anciens messages encore en clair. */
export async function reencryptLegacy() {
  if (reencrypting || useAccountKey.getState().status !== 'ready') return
  reencrypting = true
  try {
    for (let round = 0; round < 40; round++) {
      const { data } = await api.get<Legacy[]>('/e2e/legacy', { params: { limit: 50 } })
      let done = 0
      for (const m of data) {
        try {
          const sealed = await seal(m.conv_kind, m.conv_id, m.content)
          if (!sealed) continue
          const path = m.conv_kind === 'dm' ? `/dms/${m.conv_id}` : `/dms/groups/${m.conv_id}`
          await api.put(`${path}/messages/${m.id}/encrypt`, sealed)
          done++
        } catch { /* clé en attente, message supprimé : au prochain passage */ }
      }
      if (done === 0) break
      await new Promise(r => setTimeout(r, 1000))
    }
  } catch { /* hors ligne : reprise au prochain démarrage */ } finally {
    reencrypting = false
  }
}

// ─── Alerte « la clé de X a changé » ────────────────────────────────────────
const SEEN = 'fc_e2e_seen_fp'

/** Membres dont l'empreinte a changé depuis la dernière fois (mémoire locale, par compte). */
export function keyChanges(members: ConvMember[]): ConvMember[] {
  const me = myId()
  if (!me) return []
  let seen: Record<string, string> = {}
  try { seen = JSON.parse(localStorage.getItem(`${SEEN}:${me}`) ?? '{}') } catch { /* stockage indisponible */ }
  const changed = members.filter(m => m.user_id !== me && m.fingerprint && seen[m.user_id] && seen[m.user_id] !== m.fingerprint)
  return changed
}

/** « J'ai vu » : retient les empreintes actuelles. */
export function acceptKeys(members: ConvMember[]) {
  const me = myId()
  if (!me) return
  try {
    const key = `${SEEN}:${me}`
    const seen: Record<string, string> = JSON.parse(localStorage.getItem(key) ?? '{}')
    for (const m of members) if (m.fingerprint) seen[m.user_id] = m.fingerprint
    localStorage.setItem(key, JSON.stringify(seen))
  } catch { /* stockage indisponible : l'alerte reviendra */ }
}

/** Message d'erreur d'envoi lisible (chiffrement en attente, clé verrouillée…). */
export function sendErrorText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  if (m === 'E2E_WAITING') return t('e2e.send.waiting')
  if (m === 'E2E_LOCKED') return t('e2e.send.locked')
  if (errorCode(e) === 'PLAINTEXT_REFUSED') return t('e2e.send.update')
  return fallback
}
