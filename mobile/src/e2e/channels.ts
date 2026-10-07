// Salons chiffrés côté mobile (docs/CHIFFREMENT-E2E.md §4.3, §10) : ce que le
// serveur faisait avec le texte, fait par l'appli avant de chiffrer (AutoMod,
// aperçu de lien), et ouverture des titres de fils, publications et sondages.
// Les fonctions pures sont testées par __tests__/e2e-channels.test.ts.
import * as Crypto from 'expo-crypto'
import { t } from '@/i18n'
import { http, path } from '@/lib/http'
import { automodBlock, firstUrl, type AutoModRules } from './channelText'
import { completeChannelKeys, lockedText, mustEncrypt, openBody, sealBody, withSeal } from './conversations'
import * as c from './crypto'

type Raw = Record<string, unknown>
export type SealedBody = { content: string | null; enc?: c.EncPayload; client_msg_id?: string }

const isEnc = (v: unknown): v is c.EncPayload => !!v && typeof v === 'object' && (v as c.EncPayload).v === 1
const s = (v: unknown) => (typeof v === 'string' && v ? v : null)

// ─── AutoMod appliqué par l'expéditeur ──────────────────────────────────────
/** Mes derniers textes envoyés sur un serveur (anti-spam), en mémoire. */
export interface SentText { text: string; at: number }
const RECENT_MAX = 10
const RULES_TTL = 5 * 60_000
const rulesCache = new Map<string, { at: number; rules: AutoModRules | null }>()
const recentByServer = new Map<string, SentText[]>()

/** Ajoute un envoi à l'historique anti-spam (les plus récents, 10 au plus). */
export function pushRecent(list: readonly SentText[], text: string, now = Date.now()): SentText[] {
  return [...list, { text, at: now }].slice(-RECENT_MAX)
}

async function automodRules(serverId: string): Promise<AutoModRules | null> {
  const hit = rulesCache.get(serverId)
  if (hit && Date.now() - hit.at < RULES_TTL) return hit.rules
  const rules = await http.get<AutoModRules>(path`/servers/${serverId}/automod/rules`).catch(() => null)
  rulesCache.set(serverId, { at: Date.now(), rules })
  return rules
}

/** Refuse (erreur traduite, le brouillon est gardé) un texte bloqué par l'AutoMod du serveur. */
export async function checkAutomod(serverId: string, text: string): Promise<void> {
  const reason = automodBlock(await automodRules(serverId), text, recentByServer.get(serverId) ?? [])
  if (reason) throw new Error(t(`e2e.automod.${reason}` as const))
}

// ─── Aperçu de lien ─────────────────────────────────────────────────────────
/** Aperçu du premier lien demandé par l'expéditeur, mis dans le contenu chiffré (`p`) ; {} sinon. */
async function linkPreviewExtra(text: string): Promise<Record<string, unknown>> {
  const url = firstUrl(text)
  if (!url) return {}
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3000)
  try {
    const p = await http.get<unknown>('/og', { query: { url }, signal: ctrl.signal })
    return p && typeof p === 'object' ? { p } : {}
  } catch {
    return {} // aperçu facultatif
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Envoi ou édition d'un texte de salon (message, message de fil, réponse de forum) :
 * chiffré dès que j'ai une clé, AutoMod appliqué avant (pas à l'édition), aperçu de lien
 * joint si `preview`. Rend aussi `encrypted` et le contenu ajouté (`extra.p`).
 */
export async function sendChannelText<T>(
  serverId: string, channelId: string, text: string,
  post: (body: SealedBody) => Promise<T>,
  opts: { scope?: string; clientMsgId?: string | null; preview?: boolean; edit?: boolean; extra?: Record<string, unknown> } = {},
): Promise<{ result: T; encrypted: boolean; extra: Record<string, unknown> }> {
  const encrypt = !!text && (await mustEncrypt('channel', channelId))
  if (encrypt && !opts.edit) await checkAutomod(serverId, text)
  // `opts.extra` : contenu chiffré additionnel (fichiers `f`, §12), seulement s'il est chiffré.
  const extra = { ...(encrypt && opts.preview ? await linkPreviewExtra(text) : {}), ...opts.extra }
  let encrypted = false
  const result = await withSeal('channel', channelId, text, (body) => {
    encrypted = !!body.enc
    return post(body)
  }, opts.clientMsgId, { scope: opts.scope, extra })
  if (encrypted) {
    if (!opts.edit) recentByServer.set(serverId, pushRecent(recentByServer.get(serverId) ?? [], text))
    void completeChannelKeys(channelId)
  }
  return { result, encrypted, extra }
}

/** Commande de bot connue (« /nom … ») : part en clair, le bot doit la lire. */
export function isBotCommand(text: string, commands: readonly string[]): boolean {
  const name = text.trim().match(/^\/([a-z0-9_-]{1,32})(?:\s|$)/i)?.[1]
  return !!name && commands.includes(name.toLowerCase())
}

// ─── Fils : titre chiffré, portée threadScope ───────────────────────────────
/** Fil brut (threads.rs) avec `title_enc` déchiffré dans `title` (`title_encrypted` posé). */
export async function openThreadTitle(channelId: string, r: Raw): Promise<Raw> {
  const cid = s(r.client_id)
  if (!isEnc(r.title_enc) || !cid) return r
  const body = await openBody('channel', channelId, r.title_enc, s(r.creator_id) ?? '', cid, c.threadScope(channelId, cid))
  return { ...r, title: body?.t ?? lockedText(), title_encrypted: true }
}

/** Corps de création d'un fil (POST …/threads) : titre et premier message chiffrés, ou ancien format. */
export async function threadCreateBody(channelId: string, title: string, first: string, parent: string | null) {
  const clientId = Crypto.randomUUID()
  const scope = c.threadScope(channelId, clientId)
  // Sans titre, le serveur prenait les 50 premiers caractères du message : on le fait ici.
  const name = title.trim() || [...first].slice(0, 50).join('')
  const titleEnc = await sealBody('channel', channelId, { t: name }, { scope, clientMsgId: clientId })
  const msg = titleEnc && (await sealBody('channel', channelId, { t: first }, { scope }))
  if (!titleEnc || !msg) return { title: title.trim() || undefined, first_message: first, parent_message_id: parent ?? undefined }
  void completeChannelKeys(channelId)
  return {
    client_id: clientId, title_enc: titleEnc.enc, enc: msg.enc, client_msg_id: msg.client_msg_id,
    first_message: '', parent_message_id: parent ?? undefined,
  }
}

// ─── Forums : {t: contenu, title: titre}, portée postScope ──────────────────
/** Publication brute (forum.rs) avec titre et contenu déchiffrés. */
export async function openPost(channelId: string, p: Raw): Promise<Raw> {
  const cmid = s(p.client_msg_id)
  if (!isEnc(p.enc) || !cmid) return p
  const body = await openBody('channel', channelId, p.enc, s(p.creator_id) ?? '', cmid, c.postScope(channelId, cmid))
  return body
    ? { ...p, title: typeof body.title === 'string' ? body.title : '', content: body.t || null, e2e: 'ok', e2e_body: body }
    : { ...p, title: lockedText(), content: null, e2e: 'locked' }
}

/** Chiffre une publication (création : `cmid` neuf ; modification : celui de la publication) ; null = clair permis. */
export function sealPost(channelId: string, title: string, content: string, cmid: string, files?: c.FileEntry[]) {
  // `f` : média chiffré de la publication (clé, adresse `u`, §12).
  return sealBody('channel', channelId, { t: content, title, ...(files?.length ? { f: files } : {}) }, { scope: c.postScope(channelId, cmid), clientMsgId: cmid })
}

// ─── Sondages : {t: question, o: [options]}, portée pollScope ───────────────
export interface PollInput { question: string; options: string[]; multiple_choice: boolean; ends_at?: string }

/** Corps chiffré d'un sondage : textes vides, seul leur nombre compte (ordre = position). */
export function encryptedPollBody(body: PollInput, sealed: { enc: c.EncPayload; client_msg_id: string }) {
  return { ...body, question: '', options: body.options.map(() => ''), enc: sealed.enc, client_msg_id: sealed.client_msg_id }
}

/** Sondage brut avec question et options remplacées par le contenu déchiffré (null = verrouillé). */
export function applyPollBody(raw: Raw, body: c.MsgBody | null): Raw {
  const opts = Array.isArray(raw.options) ? (raw.options as Raw[]) : []
  if (!body) return { ...raw, question: lockedText(), options: opts.map((o) => ({ ...o, text: '…' })) }
  const texts = Array.isArray(body.o) ? (body.o as unknown[]) : []
  // Options dans l'ordre de `position` ↔ o[i].
  const order = [...opts].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
  return { ...raw, question: body.t, options: order.map((o, i) => ({ ...o, text: typeof texts[i] === 'string' ? texts[i] : '…' })) }
}

/** Sondage chiffré à la création (id client neuf), ou corps en clair si le chiffrement n'est pas requis. */
export async function sealPoll(channelId: string, body: PollInput) {
  const cmid = Crypto.randomUUID()
  const sealed = await sealBody('channel', channelId, { t: body.question, o: body.options }, { scope: c.pollScope(channelId, cmid), clientMsgId: cmid })
  if (!sealed) return body
  void completeChannelKeys(channelId)
  return encryptedPollBody(body, sealed)
}

export async function openPoll(channelId: string, raw: Raw): Promise<Raw> {
  const cmid = s(raw.client_msg_id)
  if (!isEnc(raw.enc) || !cmid) return raw
  return applyPollBody(raw, await openBody('channel', channelId, raw.enc, s(raw.creator_id) ?? '', cmid, c.pollScope(channelId, cmid)))
}
