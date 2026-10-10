// Messages chiffrés des MP, groupes et salons côté web (docs/CHIFFREMENT-E2E.md §4.1, §6, §10).
// Clés d'époque gardées EN MÉMOIRE seulement (jamais stockées) : rechargées
// depuis les enveloppes du serveur et ouvertes avec la clé de compte.
import { create } from 'zustand'
import api from '../api/client'
import { t } from '../i18n'
import { useAuth } from '../store/auth'
import { useAccountKey } from './accountKey'
import * as c from './crypto'
import { becameReady, cacheUsable, emitKeysChanged, isLocked } from './keysRetry'
import { indexMessage } from './searchIndex'
import { reopenKeyAlerts, trustedMembers, trustedServerKey } from './keyPins'
import { firstUnreadable, withheldOf } from './keyPinsCore'

export { keysFor, onKeysChanged } from './keysRetry'

export type ConvKind = 'dm' | 'group' | 'channel'

interface Envelope { epoch: number; wrapped: c.ConvWrapped; wrapped_by: string | null; wrapped_by_pub: string }
/** Clé de récupération du serveur d'un salon (§11). */
export interface ServerKeyInfo { server_id: string; public: string }
interface KeysResponse {
  current_epoch: number | null; rotate_needed: boolean; all_keyed: boolean; envelopes: Envelope[]
  /** « Il faut chiffrer » : j'ai une clé de compte (chiffrement obligatoire partout). */
  encrypt?: boolean
  /** Membres munis d'une clé auxquels l'époque courante manque (arrivés, ou clé créée depuis). */
  missing?: string[]
  server_key?: ServerKeyInfo | null
  /** Salon : époques que je détiens, pas encore enveloppées pour la clé du serveur. */
  server_missing?: number[]
}
export interface ConvMember { user_id: string; username: string; public: string | null; fingerprint: string | null }

interface ConvState {
  keys: Map<number, Uint8Array>; current: number | null; rotate: boolean; encrypt: boolean
  missing: string[]; serverKey: ServerKeyInfo | null; serverMissing: number[]; at: number
  /** Clé de compte avec laquelle les enveloppes ont été ouvertes (null : aucune, tout est à rouvrir). */
  priv: CryptoKey | null
}

/** Enveloppes par requête (borne du serveur) : un grand salon se distribue par lots. */
const BATCH = 200

const cache = new Map<string, ConvState>()
const loading = new Map<string, Promise<ConvState>>()
const asked = new Map<string, number>()
const completed = new Map<string, number>()
/** Enveloppes illisibles déjà signalées (conversation|époque), pour la session. */
const unreadable = new Set<string>()

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

/**
 * Nouvelles clés (clé de compte prête, E2E_KEYS) : l'état mis en cache sans elles est
 * oublié, puis tout ce qui déchiffre se rouvre (`onKeysChanged`).
 */
export function keysChanged(kind?: ConvKind, id?: string) {
  forgetConv(kind, id)
  emitKeysChanged(kind, id)
}

// Clé de compte prête (déverrouillage au démarrage) ou remplacée.
useAccountKey.subscribe((s, prev) => { if (becameReady(s, prev)) keysChanged() })

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
      } catch {
        // Enveloppe pour une ancienne clé ou altérée : signalée (le serveur la supprime et relance
        // KEY_REQUEST, son auteur ne peut plus m'en redéposer), une fois par époque et par session.
        if (firstUnreadable(unreadable, conv, e.epoch)) {
          void api.post(`${base(kind, id)}/keys/unreadable`, { epoch: e.epoch }).catch(() => {})
        }
      }
    }
  }
  return {
    keys, current: data.current_epoch, rotate: data.rotate_needed, encrypt: data.encrypt ?? data.all_keyed,
    missing: data.missing ?? [], serverKey: data.server_key ?? null, serverMissing: data.server_missing ?? [], at: Date.now(),
    priv,
  }
}

/** État de la conversation ; `force` recharge (au plus une fois par seconde). */
async function load(kind: ConvKind, id: string, force = false): Promise<ConvState> {
  const name = c.convName(kind, id)
  const priv = useAccountKey.getState().priv
  const hit = cache.get(name)
  // Un état ouvert sans la clé de compte actuelle (chargé avant son déverrouillage) ne sert jamais.
  if (hit && cacheUsable(hit, priv, force, Date.now())) return hit
  let p = loading.get(name)
  if (!p) {
    p = fetchState(kind, id).finally(() => loading.delete(name))
    loading.set(name, p)
  }
  const st = await p
  // Chargement lancé avant que la clé soit prête : on recommence avec elle.
  if (st.priv !== useAccountKey.getState().priv) return load(kind, id, force)
  cache.set(name, st)
  // MP et groupes : un membre a créé sa clé depuis, on lui donne les époques (salons : completeChannelKeys).
  if (kind !== 'channel' && st.missing.length && st.keys.size) void completeKeys(kind, id)
  return st
}

/** Faut-il chiffrer ici ? (dès que j'ai une clé de compte : sans elle, on ne peut pas écrire). */
export async function mustEncrypt(kind: ConvKind, id: string): Promise<boolean> {
  return (await load(kind, id)).encrypt
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

/** Membres (salon : seulement ceux qui ont une clé), une page ; `member` : un seul. */
export const getMembers = (kind: ConvKind, id: string, params?: { after?: string; member?: string }) =>
  api.get<ConvMember[]>(`${base(kind, id)}/members`, { params }).then(r => r.data)

/** Tous les membres, page après page (grands salons). */
export async function getAllMembers(kind: ConvKind, id: string): Promise<ConvMember[]> {
  const all: ConvMember[] = []
  for (let after: string | undefined; ;) {
    const page = await getMembers(kind, id, after ? { after } : undefined)
    all.push(...page)
    if (page.length < 1000) return all
    after = page[page.length - 1]?.user_id
  }
}

/** Membre vers qui chiffrer : clé épinglée (ou vue pour la 1re fois), empreinte recalculée ici (keyPins.ts). */
type Keyed = ConvMember & { public: string; fingerprint: string }

async function wrapFor(priv: CryptoKey, me: string, conv: string, epoch: number, key: Uint8Array, list: Keyed[]) {
  return Promise.all(list.map(async m => ({
    member_id: m.user_id,
    member_fp: m.fingerprint,
    wrapped: await c.wrapConvKey(priv, c.b64uDecode(m.public), key, conv, epoch, m.user_id, me),
  })))
}

/**
 * Enveloppe d'une époque de salon pour la clé de récupération du serveur ; null si cette clé
 * a changé depuis sa première vue (refus de chiffrer vers elle, alerte : keyPins.ts).
 */
async function serverEnvelope(priv: CryptoKey, me: string, conv: string, epoch: number, key: Uint8Array, served: ServerKeyInfo) {
  const sk = await trustedServerKey(served)
  if (!sk) return null
  return {
    server_fp: sk.fingerprint,
    wrapped: await c.wrapConvKey(priv, c.b64uDecode(sk.public), key, conv, epoch, c.serverMember(sk.server_id), me),
  }
}

/** Distribue une époque existante à des membres, par lots (redistribution). */
async function postBatches(kind: ConvKind, id: string, epoch: number, key: Uint8Array, list: Keyed[]) {
  const priv = useAccountKey.getState().priv
  const me = myId()
  if (!priv || !me) return
  for (let i = 0; i < list.length; i += BATCH) {
    const envelopes = await wrapFor(priv, me, c.convName(kind, id), epoch, key, list.slice(i, i + BATCH))
    await api.post(`${base(kind, id)}/keys`, { epoch, envelopes }).catch(() => {})
  }
}

/** Nouvelle époque (0 à la première conversation chiffrée, n+1 après un départ ou une perte d'accès). */
async function createEpoch(kind: ConvKind, id: string, st: ConvState): Promise<number> {
  const priv = useAccountKey.getState().priv
  const me = myId()
  if (!priv || !me) throw new Error('E2E_LOCKED')
  // Les membres sans clé recevront l'époque après avoir créé la leur (`missing`).
  const all = await getAllMembers(kind, id)
  const keyed = await trustedMembers(all)
  // Clé changée non acceptée (boîte de dialogue ouverte par trustedMembers) : membre retenu,
  // annoncé au serveur (`withheld`), qui ne l'admet que pour un changement de clé récent.
  const withheld = withheldOf(all, keyed, me)
  const postCreate = async (body: Record<string, unknown>) => {
    try {
      await api.post(`${base(kind, id)}/keys`, withheld.length ? { ...body, withheld } : body)
    } catch (e) {
      if (errorCode(e) !== 'WITHHELD_NOT_ALLOWED') throw e
      reopenKeyAlerts(withheld)
      throw new Error('E2E_WITHHELD')
    }
  }
  const epoch = st.current === null ? 0 : st.current + 1
  const key = c.generateConvKey()
  const conv = c.convName(kind, id)
  if (kind !== 'channel') {
    await postCreate({ epoch, create: true, envelopes: await wrapFor(priv, me, conv, epoch, key, keyed) })
  } else {
    // Salon : moi + un premier lot (et la clé du serveur), le reste ensuite sans bloquer l'envoi.
    const self = keyed.find(m => m.user_id === me)
    if (!self) throw new Error('E2E_LOCKED')
    const others = keyed.filter(m => m.user_id !== me)
    const first = [self, ...others.slice(0, BATCH - 1)]
    const server_envelope = st.serverKey ? await serverEnvelope(priv, me, conv, epoch, key, st.serverKey) : undefined
    if (server_envelope === null) throw new Error('E2E_SERVER_KEY_CHANGED')
    await postCreate({ epoch, create: true, envelopes: await wrapFor(priv, me, conv, epoch, key, first), server_envelope })
    void postBatches(kind, id, epoch, key, others.slice(BATCH - 1))
  }
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
      const code = errorCode(e)
      if (code === 'SERVER_KEY_REQUIRED') {
        // Clé de récupération créée entre-temps : on recharge pour l'inclure.
        epoch = await createEpoch(kind, id, await load(kind, id, true))
      } else if (code === 'EPOCH_STALE') {
        // Un autre membre a créé l'époque en même temps : on prend la sienne.
        epoch = (await load(kind, id, true)).current
      } else {
        throw e
      }
    }
  }
  const key = epoch === null ? null : await keyFor(kind, id, epoch)
  if (epoch === null || !key) throw new Error('E2E_WAITING')
  return { epoch, key, me }
}

/**
 * Options d'un contenu de salon : portée dans l'AAD (fil, publication, sondage), id client
 * imposé, et auteur d'origine (rechiffrement de l'ancien texte d'un autre membre).
 */
export interface SealOpts { clientMsgId?: string | null; scope?: string; author?: string }

/** Chiffre `body` (toujours : chiffrement obligatoire ; E2E_LOCKED sans clé de compte). */
export async function sealBody(kind: ConvKind, id: string, body: c.MsgBody, opts: SealOpts = {}):
  Promise<{ enc: c.EncPayload; client_msg_id: string }> {
  const { epoch, key, me } = await currentKey(kind, id)
  const cmid = opts.clientMsgId ?? crypto.randomUUID()
  const enc = await c.encryptMessage(key, opts.scope ?? c.convName(kind, id), epoch, opts.author ?? me, cmid, body)
  return { enc, client_msg_id: cmid }
}

/** Champs chiffrés d'un envoi ou d'une édition de texte seul. */
export const seal = (kind: ConvKind, id: string, text: string, clientMsgId?: string | null) =>
  sealBody(kind, id, { t: text }, { clientMsgId })

/**
 * Envoie `text` chiffré ; une seule nouvelle tentative après un refus lié à
 * l'état (époque périmée, clair refusé). `extra` complète le
 * contenu chiffré (aperçu de lien `p`, titre…) ; `scope` : portée de salon.
 */
export async function withSeal<T>(
  kind: ConvKind, id: string, text: string,
  post: (body: { content: string | null; enc?: c.EncPayload; client_msg_id?: string }) => Promise<T>,
  clientMsgId?: string | null,
  opts: { scope?: string; extra?: Record<string, unknown> } = {},
): Promise<T> {
  const hasExtra = !!opts.extra && Object.keys(opts.extra).length > 0
  for (let attempt = 0; ; attempt++) {
    const sealed = text || hasExtra
      ? await sealBody(kind, id, { ...opts.extra, t: text }, { clientMsgId, scope: opts.scope })
      : null
    try {
      return await post(sealed ? { content: null, ...sealed } : { content: text || null })
    } catch (e) {
      const code = errorCode(e)
      if (attempt > 0 || (code !== 'EPOCH_STALE' && code !== 'PLAINTEXT_REFUSED')) throw e
      await load(kind, id, true)
    }
  }
}

/** Contenu déchiffré complet ({t, p?, title?, o?…}) ; null si la clé manque ou s'il a été altéré. */
export async function openBody(
  kind: ConvKind, id: string, enc: c.EncPayload, author: string, clientMsgId: string | null | undefined, scope?: string,
): Promise<c.MsgBody | null> {
  if (!clientMsgId) return null
  try {
    const key = await keyFor(kind, id, enc.epoch)
    return key ? await c.decryptMessage(key, scope ?? c.convName(kind, id), enc, author, clientMsgId) : null
  } catch {
    return null
  }
}

/** Texte lisible d'un contenu chiffré ; null si la clé manque ou si le contenu a été altéré. */
export async function openText(
  kind: ConvKind, id: string, enc: c.EncPayload, author: string, clientMsgId: string | null | undefined, scope?: string,
): Promise<string | null> {
  return (await openBody(kind, id, enc, author, clientMsgId, scope))?.t ?? null
}

/** Texte d'attente d'un contenu illisible : clé de compte absente, ou clé de conversation pas encore reçue. */
export const lockedText = () => t(useAccountKey.getState().status === 'ready' ? 'e2e.msg.locked' : 'e2e.msg.needKey')

/** Message reçu du serveur (MP, groupe, salon, fil, forum). */
export interface RawMsg {
  id: string
  content?: string | null
  enc?: c.EncPayload | null
  client_msg_id?: string | null
  purged?: boolean
  /** Auteur : `sender_id` (MP/groupe), `author_id` (salon) ou `user_id` (fil, forum). */
  sender_id?: string
  author_id?: string
  user_id?: string
  reply_to_enc?: c.EncPayload | null
  reply_to_client_msg_id?: string | null
  reply_to_sender_id?: string | null
  reply_to_author_id?: string | null
  reply_to_content?: string | null
}
export type E2EState = 'ok' | 'locked'
/** `e2e_body` : contenu déchiffré complet (aperçu de lien `p`, etc.). */
export type Opened<T> = T & { e2e?: E2EState; e2e_body?: c.MsgBody; e2e_reply?: 'locked' }

const authorOf = (m: RawMsg) => m.sender_id ?? m.author_id ?? m.user_id ?? ''

function indexOpened(kind: ConvKind, id: string, m: RawMsg, body: c.MsgBody) {
  const x = m as RawMsg & { created_at?: string; expires_at?: string | null; sender_username?: string; author_username?: string; username?: string }
  if (!x.created_at || x.id.startsWith('temp')) return
  indexMessage({
    id: x.id, kind, convId: id, authorId: authorOf(m),
    authorName: x.sender_username ?? x.author_username ?? x.username ?? '',
    text: body.t, createdAt: x.created_at, expiresAt: x.expires_at ?? null,
    hasFile: Array.isArray(body.f) && body.f.length > 0,
  })
}

/**
 * Remplace `content` (et l'aperçu de la réponse citée) par le texte déchiffré.
 * Un message illisible garde `enc` (pour le rouvrir quand la clé arrive) et
 * affiche un texte d'attente.
 */
export async function openMessage<T extends RawMsg>(kind: ConvKind, id: string, m: T, scope?: string): Promise<Opened<T>> {
  if (m.purged && !m.enc) return { ...m, content: t('e2e.msg.purged') }
  let out: Opened<T> = m
  if (m.enc) {
    const body = await openBody(kind, id, m.enc, authorOf(m), m.client_msg_id, scope)
    out = body === null ? { ...m, content: lockedText(), e2e: 'locked' } : { ...m, content: body.t, e2e: 'ok', e2e_body: body }
    // Index local de recherche (messages de la conversation elle-même, pas des fils ni forums).
    if (body && !scope) indexOpened(kind, id, m, body)
  }
  const replyAuthor = m.reply_to_author_id ?? m.reply_to_sender_id
  if (m.reply_to_enc && replyAuthor) {
    const text = await openText(kind, id, m.reply_to_enc, replyAuthor, m.reply_to_client_msg_id, scope)
    out = { ...out, reply_to_content: text ?? lockedText(), ...(text === null ? { e2e_reply: 'locked' as const } : {}) }
  }
  return out
}

export const openMessages = <T extends RawMsg>(kind: ConvKind, id: string, list: T[], scope?: string) =>
  Promise.all(list.map(m => openMessage(kind, id, m, scope)))

/**
 * Messages verrouillés qui s'ouvrent maintenant (clé de compte prête, E2E_KEYS) ; chaque
 * entrée rendue est le message complet (texte, `e2e_body` des fichiers, aperçu de réponse).
 */
export async function reopenLocked(kind: ConvKind, id: string, list: readonly unknown[], scope?: string): Promise<Map<string, Opened<RawMsg>>> {
  const out = new Map<string, Opened<RawMsg>>()
  for (const m of list as Opened<RawMsg>[]) {
    if (!isLocked(m)) continue
    // Sans `reply_to_enc` (aperçu déjà aplati), l'aperçu reste en attente jusqu'au rechargement.
    const o = await openMessage(kind, id, m.reply_to_enc ? { ...m, e2e_reply: undefined } : m, scope)
    if (!isLocked(o) || (m.e2e === 'locked' && o.e2e === 'ok')) out.set(m.id, o)
  }
  return out
}

/** Réponse à KEY_REQUEST : enveloppe toutes nos époques pour le demandeur. */
export async function answerKeyRequest(d: { conv_kind?: string; conv_id?: string; member_id?: string }) {
  const kind = d.conv_kind === 'dm' || d.conv_kind === 'group' || d.conv_kind === 'channel' ? d.conv_kind : null
  const me = myId()
  const priv = useAccountKey.getState().priv
  if (!kind || !d.conv_id || !d.member_id || !me || !priv || d.member_id === me) return
  // Plusieurs membres en ligne : petit délai aléatoire, le serveur garde la première enveloppe.
  await new Promise(r => setTimeout(r, Math.random() * 1500))
  const st = await load(kind, d.conv_id).catch(() => null)
  if (!st || st.keys.size === 0) return
  const target = (await trustedMembers(await getMembers(kind, d.conv_id, { member: d.member_id }).catch(() => [])))
    .find(m => m.user_id === d.member_id)
  if (!target) return
  for (const [epoch, key] of st.keys) await postBatches(kind, d.conv_id, epoch, key, [target])
}

/**
 * Complète les clés qui manquent (au plus une fois par minute) — membres arrivés,
 * ayant gagné l'accès ou créé leur clé depuis l'époque courante, et (salon)
 * époques pas encore enveloppées pour la clé de récupération du serveur.
 */
async function completeKeys(kind: ConvKind, id: string) {
  const name = c.convName(kind, id)
  if (Date.now() - (completed.get(name) ?? 0) < 60_000) return
  completed.set(name, Date.now())
  const priv = useAccountKey.getState().priv
  const me = myId()
  if (!priv || !me) return
  try {
    const st = await load(kind, id, true)
    if (st.missing.length && st.keys.size) {
      const wanted = new Set(st.missing)
      const targets = (await trustedMembers(await getAllMembers(kind, id))).filter(m => wanted.has(m.user_id))
      for (const [epoch, key] of st.keys) await postBatches(kind, id, epoch, key, targets)
    }
    const sk = kind === 'channel' ? st.serverKey : null
    if (sk) {
      const channelId = id
      const conv = c.convName('channel', channelId)
      for (const epoch of st.serverMissing) {
        const key = st.keys.get(epoch)
        if (!key) continue
        const server_envelope = await serverEnvelope(priv, me, conv, epoch, key, sk)
        if (!server_envelope) break
        await api.post(`${base('channel', channelId)}/keys`, { epoch, envelopes: [], server_envelope }).catch(() => {})
      }
    }
  } catch { /* hors ligne : au prochain passage */ }
}

/**
 * Salon ouvert : complète ses clés et rechiffre en arrière-plan l'ancien texte en
 * clair que j'ai le droit de rechiffrer (le mien, ou tout si je modère).
 */
export async function completeChannelKeys(channelId: string) {
  const name = c.convName('channel', channelId)
  const first = Date.now() - (completed.get(name) ?? 0) >= 60_000
  await completeKeys('channel', channelId)
  if (first) void reencryptPages(`/e2e/legacy/channels/${channelId}`)
}

// ─── Rechiffrement de l'historique (§6) ─────────────────────────────────────
interface Legacy { conv_kind: ConvKind; conv_id: string; id: string; content: string }
/** Ancien texte d'un salon (jamais purgé) : l'AAD garde son auteur d'origine. */
interface ChannelLegacy extends Legacy {
  item: 'message' | 'thread_message' | 'forum_reply' | 'forum_post' | 'thread_title' | 'poll'
  author_id: string
  title: string | null
  scope_id: string | null
  options: string[] | null
}
let reencrypting = false
const PAGE = 50

/** Contenu chiffré d'un ancien texte de salon, avec la portée de son fil, de sa publication ou de son sondage. */
async function sealLegacyItem(m: ChannelLegacy) {
  const ch = m.conv_id
  const author = m.author_id
  switch (m.item) {
    case 'message': return sealBody('channel', ch, { t: m.content }, { author })
    case 'thread_message': return m.scope_id ? sealBody('channel', ch, { t: m.content }, { scope: c.threadScope(ch, m.scope_id), author }) : null
    case 'forum_reply': return m.scope_id ? sealBody('channel', ch, { t: m.content }, { scope: c.postScope(ch, m.scope_id), author }) : null
    case 'forum_post':
      // La publication garde son id client : ses réponses y sont liées.
      return m.scope_id
        ? sealBody('channel', ch, { t: m.content, title: m.title ?? '' }, { scope: c.postScope(ch, m.scope_id), clientMsgId: m.scope_id, author })
        : null
    case 'thread_title':
      return m.scope_id ? sealBody('channel', ch, { t: m.content }, { scope: c.threadScope(ch, m.scope_id), clientMsgId: m.scope_id, author }) : null
    case 'poll': {
      const cmid = crypto.randomUUID()
      return sealBody('channel', ch, { t: m.content, o: m.options ?? [] }, { scope: c.pollScope(ch, cmid), clientMsgId: cmid, author })
    }
  }
}

async function putChannelLegacy(m: ChannelLegacy): Promise<boolean> {
  const sealed = await sealLegacyItem(m)
  if (!sealed) return false
  await api.put(`/e2e/legacy/channel/${m.item}/${m.id}`, sealed)
  return true
}

/** Avancement du rechiffrement d'un serveur par son propriétaire (affichage discret). */
export const useReencryptProgress = create<{ serverId: string | null; done: number }>(() => ({ serverId: null, done: 0 }))
const runningPages = new Set<string>()
const serversStarted = new Set<string>()

/** Parcourt une liste d'anciens textes page par page (curseur) ; un échec est sauté, repris au prochain passage. */
async function reencryptPages(url: string, onDone?: () => void) {
  if (runningPages.has(url) || useAccountKey.getState().status !== 'ready') return
  runningPages.add(url)
  try {
    for (let after: string | undefined; ;) {
      const { data } = await api.get<ChannelLegacy[]>(url, { params: { limit: PAGE, after } })
      for (const m of data) {
        try {
          if (await putChannelLegacy(m)) onDone?.()
        } catch { /* clé en attente, déjà rechiffré : au prochain passage */ }
      }
      if (data.length < PAGE) return
      after = data[data.length - 1]?.id
      await new Promise(r => setTimeout(r, 300))
    }
  } catch { /* hors ligne : reprise à la prochaine ouverture */ } finally {
    runningPages.delete(url)
  }
}

/** Propriétaire : rechiffre en arrière-plan tout l'ancien contenu du serveur (salons, fils, forums, sondages). */
export async function reencryptServer(serverId: string) {
  if (serversStarted.has(serverId)) return // une fois par session ; reprise à la suivante
  serversStarted.add(serverId)
  useReencryptProgress.setState({ serverId, done: 0 })
  await reencryptPages(`/e2e/legacy/servers/${serverId}`,
    () => useReencryptProgress.setState(s => ({ done: s.done + 1 })))
  useReencryptProgress.setState({ serverId: null, done: 0 })
}

async function reencryptRounds<T extends Legacy>(url: string, put: (m: T) => Promise<boolean>) {
  for (let round = 0; round < 40; round++) {
    const { data } = await api.get<T[]>(url, { params: { limit: 50 } })
    let done = 0
    for (const m of data) {
      try {
        if (await put(m)) done++
      } catch { /* clé en attente, message supprimé : au prochain passage */ }
    }
    if (done === 0) return
    await new Promise(r => setTimeout(r, 1000))
  }
}

/** Rechiffre en arrière-plan, par lots, mes anciens messages encore en clair (MP, groupes, salons). */
export async function reencryptLegacy() {
  if (reencrypting || useAccountKey.getState().status !== 'ready') return
  reencrypting = true
  try {
    await reencryptRounds<Legacy>('/e2e/legacy', async m => {
      const sealed = await seal(m.conv_kind, m.conv_id, m.content)
      if (!sealed) return false
      const path = m.conv_kind === 'dm' ? `/dms/${m.conv_id}` : `/dms/groups/${m.conv_id}`
      await api.put(`${path}/messages/${m.id}/encrypt`, sealed)
      return true
    })
    await reencryptRounds<ChannelLegacy>('/e2e/legacy/channels', putChannelLegacy)
  } catch { /* hors ligne : reprise au prochain démarrage */ } finally {
    reencrypting = false
  }
}

/** Message d'erreur d'envoi lisible (chiffrement en attente, clé verrouillée…). */
export function sendErrorText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : ''
  if (m === 'E2E_WAITING') return t('e2e.send.waiting')
  if (m === 'E2E_LOCKED') return t('e2e.send.locked')
  if (m === 'AUTOMOD') return t('e2e.send.automod')
  if (m === 'E2E_WITHHELD') return t('e2e.send.withheld')
  if (m === 'E2E_SERVER_KEY_CHANGED') return t('e2e.send.serverKeyChanged')
  if (errorCode(e) === 'PLAINTEXT_REFUSED') return t('e2e.send.update')
  return fallback
}
