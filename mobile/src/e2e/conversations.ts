// Messages chiffrés des MP et groupes côté mobile (docs/CHIFFREMENT-E2E.md §4.1, §6).
// Même logique que client/src/e2e/conversations.ts. Clés d'époque EN MÉMOIRE
// seulement ; calculs noble asynchrones, entrecoupés pour ne pas geler l'interface.
import * as Crypto from 'expo-crypto'
import { t } from '@/i18n'
import { ApiError, http, path } from '@/lib/http'
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

/** Mon compte : celui de la clé chargée (pas d'import du store de session, plein d'effets de bord). */
const getMyId = () => useAccountKey.getState().userId
const base = (kind: ConvKind, id: string) => path`/e2e/conversations/${kind}/${id}`
/** Laisse respirer le fil JS entre deux calculs. */
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0))
/** Code d'erreur du serveur (premier mot du message : « EPOCH_STALE », « PLAINTEXT_REFUSED »…). */
export const errorCode = (e: unknown) => (e instanceof ApiError ? e.message.split(' ')[0] : undefined)

/** Oublie les clés (déconnexion, nouvelles enveloppes reçues). */
export function forgetConv(kind?: ConvKind, id?: string) {
  if (kind && id) cache.delete(c.convName(kind, id))
  else cache.clear()
}

async function fetchState(kind: ConvKind, id: string): Promise<ConvState> {
  const data = await http.get<KeysResponse>(`${base(kind, id)}/keys`)
  const keys = new Map<number, Uint8Array>()
  const priv = useAccountKey.getState().priv
  const me = getMyId()
  const conv = c.convName(kind, id)
  if (priv && me) {
    for (const e of data.envelopes) {
      if (!e.wrapped_by) continue
      try {
        keys.set(e.epoch, await c.unwrapConvKey(priv, c.b64uDecode(e.wrapped_by_pub), e.wrapped, conv, e.epoch, me, e.wrapped_by))
      } catch { /* enveloppe pour une ancienne clé ou altérée : on la redemandera */ }
      await yieldUi()
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
  await http.post(`${base(kind, id)}/keys/request`).catch(() => undefined)
}

async function keyFor(kind: ConvKind, id: string, epoch: number): Promise<Uint8Array | null> {
  let st = await load(kind, id)
  if (!st.keys.has(epoch)) st = await load(kind, id, true)
  const key = st.keys.get(epoch) ?? null
  if (!key && useAccountKey.getState().status === 'ready') void requestKeys(kind, id)
  return key
}

export const getMembers = (kind: ConvKind, id: string) => http.get<ConvMember[]>(`${base(kind, id)}/members`)

/** Nouvelle époque (0 à la première conversation chiffrée, n+1 après un départ). */
async function createEpoch(kind: ConvKind, id: string, st: ConvState): Promise<number> {
  const priv = useAccountKey.getState().priv
  const me = getMyId()
  if (!priv || !me) throw new Error('E2E_LOCKED')
  const members = await getMembers(kind, id)
  if (members.some((m) => !m.public || !m.fingerprint)) throw new Error('E2E_MEMBERS')
  const epoch = st.current === null ? 0 : st.current + 1
  const key = c.generateConvKey()
  const conv = c.convName(kind, id)
  const envelopes = []
  for (const m of members) {
    envelopes.push({
      member_id: m.user_id,
      member_fp: m.fingerprint,
      wrapped: await c.wrapConvKey(priv, c.b64uDecode(m.public!), key, conv, epoch, m.user_id, me),
    })
    await yieldUi()
  }
  await http.post(`${base(kind, id)}/keys`, { epoch, create: true, envelopes })
  st.keys.set(epoch, key)
  st.current = epoch
  st.rotate = false
  return epoch
}

/**
 * Clé de l'époque courante, créée au besoin (première utilisation, rotation après un départ).
 * Sert aux messages et aux médias (vocal, appels : e2e/media.ts).
 */
export async function currentKey(kind: ConvKind, id: string): Promise<{ epoch: number; key: Uint8Array; me: string }> {
  const st = await load(kind, id)
  const me = getMyId()
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
  const cmid = clientMsgId ?? Crypto.randomUUID()
  return { enc: await c.encryptMessage(key, c.convName(kind, id), epoch, me, cmid, { t: text }), client_msg_id: cmid }
}

/** Envoie `text` chiffré si la conversation l'exige ; une seule nouvelle tentative après un refus d'état. */
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

type Raw = Record<string, unknown>
const isEnc = (v: unknown): v is c.EncPayload => !!v && typeof v === 'object' && (v as c.EncPayload).v === 1
const s = (v: unknown) => (typeof v === 'string' ? v : null)

/**
 * Message brut du serveur (MP ou groupe) avec `content` remplacé par le texte
 * déchiffré, ou par un texte d'attente (`e2e: 'locked'`). Réponses citées comprises.
 */
export async function openRaw(kind: ConvKind, id: string, m: Raw): Promise<Raw> {
  let out: Raw = m
  if (m.purged === true && !m.enc) out = { ...out, content: t('e2e.msg.purged') }
  if (isEnc(m.enc)) {
    const text = await openText(kind, id, m.enc, s(m.sender_id) ?? '', s(m.client_msg_id))
    out = { ...out, content: text ?? t('e2e.msg.locked'), e2e: text === null ? 'locked' : 'ok' }
  }
  const r = m.reply_to
  if (kind === 'dm' && r && typeof r === 'object' && isEnc((r as Raw).enc)) {
    const rr = r as Raw
    const text = await openText(kind, id, rr.enc as c.EncPayload, s(rr.sender_id) ?? '', s(rr.client_msg_id))
    out = { ...out, reply_to: { ...rr, content: text ?? t('e2e.msg.locked') } }
  }
  if (kind === 'group' && isEnc(m.reply_to_enc)) {
    const text = await openText(kind, id, m.reply_to_enc, s(m.reply_to_sender_id) ?? '', s(m.reply_to_client_msg_id))
    out = { ...out, reply_to_content: text ?? t('e2e.msg.locked') }
  }
  return out
}

export async function openRawList(kind: ConvKind, id: string, list: unknown[]): Promise<unknown[]> {
  const out: unknown[] = []
  for (const m of list) {
    out.push(m && typeof m === 'object' ? await openRaw(kind, id, m as Raw) : m)
    await yieldUi()
  }
  return out
}

/** Réponse à KEY_REQUEST : enveloppe toutes nos époques pour le demandeur. */
export async function answerKeyRequest(d: Record<string, unknown>) {
  const kind = d.conv_kind === 'dm' || d.conv_kind === 'group' ? d.conv_kind : null
  const convId = s(d.conv_id)
  const member = s(d.member_id)
  const me = getMyId()
  const priv = useAccountKey.getState().priv
  if (!kind || !convId || !member || !me || !priv || member === me) return
  // Plusieurs membres en ligne : petit délai aléatoire, le serveur garde la première enveloppe.
  await new Promise((r) => setTimeout(r, Math.random() * 1500))
  const st = await load(kind, convId).catch(() => null)
  if (!st || st.keys.size === 0) return
  const target = (await getMembers(kind, convId).catch(() => [] as ConvMember[])).find((m) => m.user_id === member)
  if (!target?.public || !target.fingerprint) return
  const conv = c.convName(kind, convId)
  for (const [epoch, key] of st.keys) {
    const wrapped = await c.wrapConvKey(priv, c.b64uDecode(target.public), key, conv, epoch, target.user_id, me)
    await http.post(`${base(kind, convId)}/keys`, {
      epoch, envelopes: [{ member_id: target.user_id, member_fp: target.fingerprint, wrapped }],
    }).catch(() => undefined)
    await yieldUi()
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
      const list = await http.get<Legacy[]>('/e2e/legacy', { query: { limit: 50 } })
      let done = 0
      for (const m of list) {
        try {
          const sealed = await seal(m.conv_kind, m.conv_id, m.content)
          if (!sealed) continue
          const p = m.conv_kind === 'dm' ? path`/dms/${m.conv_id}/messages/${m.id}/encrypt` : path`/dms/groups/${m.conv_id}/messages/${m.id}/encrypt`
          await http.put(p, sealed)
          done++
        } catch { /* clé en attente, message supprimé : au prochain passage */ }
        await yieldUi()
      }
      if (done === 0) break
      await new Promise((r) => setTimeout(r, 1000))
    }
  } catch { /* hors ligne : reprise au prochain démarrage */ } finally {
    reencrypting = false
  }
}

/** Texte déchiffré d'un MP à transférer (mémoire seulement, posé par l'écran de conversation). */
export const forwardText = new Map<string, string>()

/** Message d'erreur d'envoi lisible (chiffrement en attente, clé verrouillée…) ; null sinon. */
export function e2eErrorText(e: unknown): string | null {
  const m = e instanceof Error ? e.message : ''
  if (m === 'E2E_WAITING') return t('e2e.send.waiting')
  if (m === 'E2E_LOCKED') return t('e2e.send.locked')
  if (errorCode(e) === 'PLAINTEXT_REFUSED') return t('e2e.send.update')
  return null
}

/** Membres dont l'empreinte a changé depuis la dernière fois (`seen` : mémoire de l'appareil). */
export function keyChanges(members: ConvMember[], seen: Record<string, string>, me: string | null): ConvMember[] {
  return members.filter((m) => m.user_id !== me && m.fingerprint && seen[m.user_id] && seen[m.user_id] !== m.fingerprint)
}
