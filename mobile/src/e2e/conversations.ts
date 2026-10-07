// Messages chiffrés des MP, groupes et salons côté mobile (docs/CHIFFREMENT-E2E.md §4.1, §6, §10).
// Même logique que client/src/e2e/conversations.ts. Clés d'époque EN MÉMOIRE
// seulement ; calculs noble asynchrones, entrecoupés pour ne pas geler l'interface.
import * as Crypto from 'expo-crypto'
import { t } from '@/i18n'
import { ApiError, http, path } from '@/lib/http'
import { useAccountKey } from './accountKey'
import * as c from './crypto'

export type ConvKind = 'dm' | 'group' | 'channel'

interface Envelope { epoch: number; wrapped: c.ConvWrapped; wrapped_by: string | null; wrapped_by_pub: string }
/** Clé de récupération du serveur d'un salon (§11). */
export interface ServerKeyInfo { server_id: string; public: string; fingerprint: string }
interface KeysResponse {
  current_epoch: number | null; rotate_needed: boolean; all_keyed: boolean; envelopes: Envelope[]
  /** « Il faut chiffrer » : j'ai une clé de compte (chiffrement obligatoire partout). */
  encrypt?: boolean
  /** Membres munis d'une clé auxquels l'époque courante manque (arrivés, ou clé créée depuis). */
  missing?: string[]
  server_key?: ServerKeyInfo | null
  server_missing?: number[]
}
export interface ConvMember { user_id: string; username: string; public: string | null; fingerprint: string | null }

interface ConvState {
  keys: Map<number, Uint8Array>; current: number | null; rotate: boolean; encrypt: boolean
  missing: string[]; serverKey: ServerKeyInfo | null; serverMissing: number[]; at: number
}

/** Enveloppes par requête (borne du serveur) : un grand salon se distribue par lots. */
const BATCH = 200
/** Premier lot d'une nouvelle époque de salon sur mobile (calculs plus lents), le reste en arrière-plan. */
const FIRST_BATCH = 50

const cache = new Map<string, ConvState>()
const loading = new Map<string, Promise<ConvState>>()
const asked = new Map<string, number>()
const completed = new Map<string, number>()

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
  return {
    keys, current: data.current_epoch, rotate: data.rotate_needed, encrypt: data.encrypt ?? data.all_keyed,
    missing: data.missing ?? [], serverKey: data.server_key ?? null, serverMissing: data.server_missing ?? [], at: Date.now(),
  }
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
  await http.post(`${base(kind, id)}/keys/request`).catch(() => undefined)
}

async function keyFor(kind: ConvKind, id: string, epoch: number): Promise<Uint8Array | null> {
  let st = await load(kind, id)
  if (!st.keys.has(epoch)) st = await load(kind, id, true)
  const key = st.keys.get(epoch) ?? null
  if (!key && useAccountKey.getState().status === 'ready') void requestKeys(kind, id)
  return key
}

/** Membres (salon : seulement ceux qui ont une clé), une page ; `member` : un seul. */
export const getMembers = (kind: ConvKind, id: string, query?: { after?: string; member?: string }) =>
  http.get<ConvMember[]>(`${base(kind, id)}/members`, { query })

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

type Keyed = ConvMember & { public: string; fingerprint: string }
const keyedOnly = (list: ConvMember[]) => list.filter((m): m is Keyed => !!m.public && !!m.fingerprint)

async function wrapFor(priv: Uint8Array, me: string, conv: string, epoch: number, key: Uint8Array, list: Keyed[]) {
  const out = []
  for (const m of list) {
    out.push({
      member_id: m.user_id,
      member_fp: m.fingerprint,
      wrapped: await c.wrapConvKey(priv, c.b64uDecode(m.public), key, conv, epoch, m.user_id, me),
    })
    await yieldUi()
  }
  return out
}

/** Enveloppe d'une époque de salon pour la clé de récupération du serveur. */
async function serverEnvelope(priv: Uint8Array, me: string, conv: string, epoch: number, key: Uint8Array, sk: ServerKeyInfo) {
  return {
    server_fp: sk.fingerprint,
    wrapped: await c.wrapConvKey(priv, c.b64uDecode(sk.public), key, conv, epoch, c.serverMember(sk.server_id), me),
  }
}

/** Distribue une époque existante à des membres, par lots (redistribution). */
async function postBatches(kind: ConvKind, id: string, epoch: number, key: Uint8Array, list: Keyed[]) {
  const priv = useAccountKey.getState().priv
  const me = getMyId()
  if (!priv || !me) return
  for (let i = 0; i < list.length; i += BATCH) {
    const envelopes = await wrapFor(priv, me, c.convName(kind, id), epoch, key, list.slice(i, i + BATCH))
    await http.post(`${base(kind, id)}/keys`, { epoch, envelopes }).catch(() => undefined)
  }
}

/** Nouvelle époque (0 à la première conversation chiffrée, n+1 après un départ ou une perte d'accès). */
async function createEpoch(kind: ConvKind, id: string, st: ConvState): Promise<number> {
  const priv = useAccountKey.getState().priv
  const me = getMyId()
  if (!priv || !me) throw new Error('E2E_LOCKED')
  // Les membres sans clé recevront l'époque après avoir créé la leur (`missing`).
  const keyed = keyedOnly(await getAllMembers(kind, id))
  const epoch = st.current === null ? 0 : st.current + 1
  const key = c.generateConvKey()
  const conv = c.convName(kind, id)
  if (kind !== 'channel') {
    await http.post(`${base(kind, id)}/keys`, { epoch, create: true, envelopes: await wrapFor(priv, me, conv, epoch, key, keyed) })
  } else {
    // Salon : moi + un premier lot (et la clé du serveur), le reste ensuite sans bloquer l'envoi.
    const self = keyed.find((m) => m.user_id === me)
    if (!self) throw new Error('E2E_LOCKED')
    const others = keyed.filter((m) => m.user_id !== me)
    const first = [self, ...others.slice(0, FIRST_BATCH - 1)]
    await http.post(`${base(kind, id)}/keys`, {
      epoch, create: true, envelopes: await wrapFor(priv, me, conv, epoch, key, first),
      server_envelope: st.serverKey ? await serverEnvelope(priv, me, conv, epoch, key, st.serverKey) : undefined,
    })
    void postBatches(kind, id, epoch, key, others.slice(FIRST_BATCH - 1))
  }
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
  const cmid = opts.clientMsgId ?? Crypto.randomUUID()
  const enc = await c.encryptMessage(key, opts.scope ?? c.convName(kind, id), epoch, opts.author ?? me, cmid, body)
  return { enc, client_msg_id: cmid }
}

/** Champs chiffrés d'un envoi ou d'une édition de texte seul. */
export const seal = (kind: ConvKind, id: string, text: string, clientMsgId?: string | null) =>
  sealBody(kind, id, { t: text }, { clientMsgId })

/**
 * Envoie `text` chiffré ; une seule nouvelle tentative après un refus d'état. `extra` complète le contenu chiffré (aperçu `p`…), `scope` : portée de salon.
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

/** Texte d'attente : clé de compte absente, ou clé de conversation pas encore reçue. */
export const lockedText = () => t(useAccountKey.getState().status === 'ready' ? 'e2e.msg.locked' : 'e2e.msg.needKey')

type Raw = Record<string, unknown>
const isEnc = (v: unknown): v is c.EncPayload => !!v && typeof v === 'object' && (v as c.EncPayload).v === 1
const s = (v: unknown) => (typeof v === 'string' ? v : null)

/**
 * Message brut du serveur (MP, groupe, salon, fil, forum) avec `content` remplacé
 * par le texte déchiffré, ou par un texte d'attente (`e2e: 'locked'`). Réponses
 * citées comprises. `e2e_body` : contenu complet (aperçu de lien `p`…).
 * Auteur : `sender_id` (MP/groupe), `author_id` (salon) ou `user_id` (fil, forum).
 */
export async function openRaw(kind: ConvKind, id: string, m: Raw, scope?: string): Promise<Raw> {
  let out: Raw = m
  if (m.purged === true && !m.enc) out = { ...out, content: t('e2e.msg.purged') }
  if (isEnc(m.enc)) {
    const author = s(m.sender_id) ?? s(m.author_id) ?? s(m.user_id) ?? ''
    const body = await openBody(kind, id, m.enc, author, s(m.client_msg_id), scope)
    out = body === null
      ? { ...out, content: lockedText(), e2e: 'locked' }
      : { ...out, content: body.t, e2e: 'ok', e2e_body: body }
  }
  const r = m.reply_to
  if (kind === 'dm' && r && typeof r === 'object' && isEnc((r as Raw).enc)) {
    const rr = r as Raw
    const text = await openText(kind, id, rr.enc as c.EncPayload, s(rr.sender_id) ?? '', s(rr.client_msg_id))
    out = { ...out, reply_to: { ...rr, content: text ?? lockedText() } }
  }
  if (isEnc(m.reply_to_enc)) {
    const author = s(m.reply_to_author_id) ?? s(m.reply_to_sender_id) ?? ''
    const text = await openText(kind, id, m.reply_to_enc, author, s(m.reply_to_client_msg_id), scope)
    out = { ...out, reply_to_content: text ?? lockedText() }
  }
  return out
}

export async function openRawList(kind: ConvKind, id: string, list: unknown[], scope?: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (const m of list) {
    out.push(m && typeof m === 'object' ? await openRaw(kind, id, m as Raw, scope) : m)
    await yieldUi()
  }
  return out
}

/** Réponse à KEY_REQUEST : enveloppe toutes nos époques pour le demandeur. */
export async function answerKeyRequest(d: Record<string, unknown>) {
  const kind = d.conv_kind === 'dm' || d.conv_kind === 'group' || d.conv_kind === 'channel' ? d.conv_kind : null
  const convId = s(d.conv_id)
  const member = s(d.member_id)
  const me = getMyId()
  const priv = useAccountKey.getState().priv
  if (!kind || !convId || !member || !me || !priv || member === me) return
  // Plusieurs membres en ligne : petit délai aléatoire, le serveur garde la première enveloppe.
  await new Promise((r) => setTimeout(r, Math.random() * 1500))
  const st = await load(kind, convId).catch(() => null)
  if (!st || st.keys.size === 0) return
  const target = keyedOnly(await getMembers(kind, convId, { member }).catch(() => [] as ConvMember[]))
    .find((m) => m.user_id === member)
  if (!target) return
  for (const [epoch, key] of st.keys) await postBatches(kind, convId, epoch, key, [target])
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
  const me = getMyId()
  if (!priv || !me) return
  try {
    const st = await load(kind, id, true)
    if (st.missing.length && st.keys.size) {
      const wanted = new Set(st.missing)
      const targets = keyedOnly(await getAllMembers(kind, id)).filter((m) => wanted.has(m.user_id))
      for (const [epoch, key] of st.keys) await postBatches(kind, id, epoch, key, targets)
    }
    const sk = kind === 'channel' ? st.serverKey : null
    if (sk) {
      const channelId = id
      const conv = c.convName('channel', channelId)
      for (const epoch of st.serverMissing) {
        const key = st.keys.get(epoch)
        if (!key) continue
        await http.post(`${base('channel', channelId)}/keys`, {
          epoch, envelopes: [], server_envelope: await serverEnvelope(priv, me, conv, epoch, key, sk),
        }).catch(() => undefined)
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
  if (first) void reencryptPages(path`/e2e/legacy/channels/${channelId}`)
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
      const cmid = Crypto.randomUUID()
      return sealBody('channel', ch, { t: m.content, o: m.options ?? [] }, { scope: c.pollScope(ch, cmid), clientMsgId: cmid, author })
    }
  }
}

async function putChannelLegacy(m: ChannelLegacy): Promise<boolean> {
  const sealed = await sealLegacyItem(m)
  if (!sealed) return false
  await http.put(path`/e2e/legacy/channel/${m.item}/${m.id}`, sealed)
  return true
}

const runningPages = new Set<string>()
const serversStarted = new Set<string>()

/** Parcourt une liste d'anciens textes page par page (curseur) ; un échec est sauté, repris au prochain passage. */
async function reencryptPages(url: string) {
  if (runningPages.has(url) || useAccountKey.getState().status !== 'ready') return
  runningPages.add(url)
  try {
    for (let after: string | undefined; ;) {
      const list = await http.get<ChannelLegacy[]>(url, { query: after ? { limit: PAGE, after } : { limit: PAGE } })
      for (const m of list) {
        try {
          await putChannelLegacy(m)
        } catch { /* clé en attente, déjà rechiffré : au prochain passage */ }
        await yieldUi()
      }
      if (list.length < PAGE) return
      after = list[list.length - 1]?.id
      await new Promise((r) => setTimeout(r, 300))
    }
  } catch { /* hors ligne : reprise à la prochaine ouverture */ } finally {
    runningPages.delete(url)
  }
}

/** Propriétaire : rechiffre en arrière-plan tout l'ancien contenu du serveur, une fois par session. */
export async function reencryptServer(serverId: string) {
  if (serversStarted.has(serverId)) return
  serversStarted.add(serverId)
  await reencryptPages(path`/e2e/legacy/servers/${serverId}`)
}

async function reencryptRounds<T extends Legacy>(url: string, put: (m: T) => Promise<boolean>) {
  for (let round = 0; round < 40; round++) {
    const list = await http.get<T[]>(url, { query: { limit: 50 } })
    let done = 0
    for (const m of list) {
      try {
        if (await put(m)) done++
      } catch { /* clé en attente, message supprimé : au prochain passage */ }
      await yieldUi()
    }
    if (done === 0) return
    await new Promise((r) => setTimeout(r, 1000))
  }
}

/** Rechiffre en arrière-plan, par lots, mes anciens messages encore en clair (MP, groupes, salons). */
export async function reencryptLegacy() {
  if (reencrypting || useAccountKey.getState().status !== 'ready') return
  reencrypting = true
  try {
    await reencryptRounds<Legacy>('/e2e/legacy', async (m) => {
      const sealed = await seal(m.conv_kind, m.conv_id, m.content)
      if (!sealed) return false
      const p = m.conv_kind === 'dm' ? path`/dms/${m.conv_id}/messages/${m.id}/encrypt` : path`/dms/groups/${m.conv_id}/messages/${m.id}/encrypt`
      await http.put(p, sealed)
      return true
    })
    await reencryptRounds<ChannelLegacy>('/e2e/legacy/channels', putChannelLegacy)
  } catch { /* hors ligne : reprise au prochain démarrage */ } finally {
    reencrypting = false
  }
}

/**
 * Texte d'un message à transférer (mémoire seulement, posé par l'écran de conversation) :
 * rechiffré pour un salon cible chiffré, ou joint en clair si la source était chiffrée.
 */
export const forwardText = new Map<string, { text: string; encrypted: boolean }>()

/** Message d'erreur d'envoi lisible (chiffrement en attente, clé verrouillée…) ; null sinon. */
export function e2eErrorText(e: unknown): string | null {
  const m = e instanceof Error ? e.message : ''
  if (m === 'E2E_WAITING') return t('e2e.send.waiting')
  if (m === 'E2E_LOCKED') return t('e2e.send.locked')
  if (m === 'AUTOMOD') return t('e2e.send.automod')
  // Fichiers chiffrés (e2e/files.ts) : limite mobile, chiffrement indisponible.
  if (m === 'E2E_FILE_TOO_BIG') return t('e2e.file.tooBig')
  if (m === 'E2E_FILES_UNAVAILABLE') return t('e2e.file.unavailable')
  if (errorCode(e) === 'PLAINTEXT_REFUSED') return t('e2e.send.update')
  return null
}

/** Membres dont l'empreinte a changé depuis la dernière fois (`seen` : mémoire de l'appareil). */
export function keyChanges(members: ConvMember[], seen: Record<string, string>, me: string | null): ConvMember[] {
  return members.filter((m) => m.user_id !== me && m.fingerprint && seen[m.user_id] && seen[m.user_id] !== m.fingerprint)
}
