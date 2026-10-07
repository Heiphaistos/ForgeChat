// Fils, publications de forum et sondages des salons chiffrés (docs/CHIFFREMENT-E2E.md §10) :
// clé du salon, contenus liés à leur fil, publication ou sondage par une portée
// dans l'AAD (crypto.ts : threadScope, postScope, pollScope).
import { lockedText, openBody, openMessages, sealBody, type RawMsg } from './conversations'
import { pollScope, postScope, threadScope, type EncPayload } from './crypto'
import { sendChannel } from './channels'

/** Corps d'un envoi dans un fil ou sous une publication (ces routes veulent un texte, jamais null). */
export interface ScopedBody { content: string; enc?: EncPayload; client_msg_id?: string }

/**
 * Envoi (ou édition, avec l'id client du message) dans une portée de salon :
 * chiffré dès que j'ai une clé, AutoMod et aperçu de lien faits ici.
 */
export const sendScoped = <T>(
  serverId: string, channelId: string, scope: string, text: string,
  post: (body: ScopedBody) => Promise<T>, edit?: { clientMsgId: string | null | undefined },
) => sendChannel(channelId, text, body => post({ ...body, content: body.content ?? '' }), {
  serverId, scope, preview: true,
  ...(edit ? { edit: true, clientMsgId: edit.clientMsgId ?? crypto.randomUUID() } : {}),
})

// ─── Fils ───────────────────────────────────────────────────────────────────
interface ThreadLike { title: string; title_enc?: EncPayload | null; client_id?: string | null; creator_id: string }

export const threadScopeOf = (channelId: string, th: { client_id?: string | null } | null | undefined) =>
  th?.client_id ? threadScope(channelId, th.client_id) : null

/** Titre d'un fil chiffré déchiffré ici (auteur = créateur), sinon texte d'attente. */
export async function openThread<T extends ThreadLike>(channelId: string, th: T): Promise<T> {
  if (!th.title_enc || !th.client_id) return th
  const body = await openBody('channel', channelId, th.title_enc, th.creator_id, th.client_id, threadScope(channelId, th.client_id))
  return { ...th, title: body?.t ?? lockedText() }
}

export const openThreads = <T extends ThreadLike>(channelId: string, list: T[]) =>
  Promise.all(list.map(th => openThread(channelId, th)))

/** Messages d'un fil (auteur `user_id`) : portée du fil. */
export const openThreadMessages = <T extends RawMsg>(channelId: string, th: { client_id?: string | null } | null | undefined, list: T[]) => {
  const scope = threadScopeOf(channelId, th)
  return scope ? openMessages('channel', channelId, list, scope) : Promise.resolve(list)
}

/** Création d'un fil : titre ET premier message chiffrés (portée du fil), ou les deux en clair. */
export function createThread<T>(
  serverId: string, channelId: string, title: string, text: string, parentMessageId: string | undefined,
  post: (body: Record<string, unknown>) => Promise<T>,
): Promise<T> {
  const clientId = crypto.randomUUID()
  const scope = threadScope(channelId, clientId)
  return sendChannel(channelId, text, async body => {
    if (!body.enc) return post({ title: title || undefined, first_message: text, parent_message_id: parentMessageId })
    // Le serveur ne lit plus le texte : titre par défaut = début du premier message, comme avant.
    const sealed = await sealBody('channel', channelId, { t: title || text.slice(0, 50) }, { scope, clientMsgId: clientId })
    if (!sealed) throw new Error('E2E_WAITING')
    return post({
      client_id: clientId, title_enc: sealed.enc, first_message: '', enc: body.enc, client_msg_id: body.client_msg_id,
      parent_message_id: parentMessageId,
    })
  }, { serverId, scope })
}

// ─── Forums et salons médias ────────────────────────────────────────────────
interface PostLike extends RawMsg { title: string; client_msg_id?: string | null; creator_id: string }

/** Publication chiffrée ({t: contenu, title}) déchiffrée ici (auteur = créateur). */
export async function openPost<T extends PostLike>(channelId: string, p: T): Promise<T & { e2e?: 'ok' | 'locked' }> {
  if (!p.enc || !p.client_msg_id) return p
  const body = await openBody('channel', channelId, p.enc, p.creator_id, p.client_msg_id, postScope(channelId, p.client_msg_id))
  if (!body) return { ...p, title: lockedText(), content: lockedText(), e2e: 'locked' }
  return { ...p, title: typeof body.title === 'string' ? body.title : '', content: body.t, e2e: 'ok' }
}

export const openPosts = <T extends PostLike>(channelId: string, list: T[]) =>
  Promise.all(list.map(p => openPost(channelId, p)))

/** Réponses d'une publication (auteur `user_id`) : portée de la publication. */
export const openReplies = <T extends RawMsg>(channelId: string, postClientMsgId: string | null | undefined, list: T[]) =>
  postClientMsgId ? openMessages('channel', channelId, list, postScope(channelId, postClientMsgId)) : Promise.resolve(list)

/**
 * Création (ou modification du contenu, avec l'id client de la publication)
 * d'une publication : titre et contenu chiffrés ensemble, sinon en clair.
 */
export function sealPost<T>(
  serverId: string, channelId: string, title: string, content: string,
  post: (body: { title: string; content: string | null; enc?: EncPayload; client_msg_id?: string }) => Promise<T>,
  edit?: { clientMsgId: string },
): Promise<T> {
  const cmid = edit?.clientMsgId ?? crypto.randomUUID()
  return sendChannel(channelId, content, body => body.enc
    ? post({ title: '', content: null, enc: body.enc, client_msg_id: body.client_msg_id })
    : post({ title, content: content || null }),
  { serverId, scope: postScope(channelId, cmid), clientMsgId: cmid, extra: { title }, edit: !!edit })
}

// ─── Sondages ───────────────────────────────────────────────────────────────
interface PollLike { question: string; enc?: EncPayload | null; client_msg_id?: string | null; creator_id: string; options: { text: string; position?: number }[] }

/** Sondage chiffré ({t: question, o: [options]}) : options dans l'ordre de `position`. */
export async function openPoll<T extends PollLike>(channelId: string, p: T): Promise<T> {
  if (!p.enc || !p.client_msg_id) return p
  const body = await openBody('channel', channelId, p.enc, p.creator_id, p.client_msg_id, pollScope(channelId, p.client_msg_id))
  const texts = Array.isArray(body?.o) ? body.o : []
  const order = [...p.options].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return {
    ...p,
    question: body?.t ?? lockedText(),
    options: p.options.map(o => ({ ...o, text: typeof texts[order.indexOf(o)] === 'string' ? texts[order.indexOf(o)] as string : '🔒' })),
  }
}

/** Création d'un sondage : question et options chiffrées, textes vides envoyés au serveur. */
export function sealPoll<T>(
  serverId: string, channelId: string, question: string, options: string[],
  post: (body: { question: string; options: string[]; enc?: EncPayload; client_msg_id?: string }) => Promise<T>,
): Promise<T> {
  const cmid = crypto.randomUUID()
  return sendChannel(channelId, question, body => body.enc
    ? post({ question: '', options: options.map(() => ''), enc: body.enc, client_msg_id: body.client_msg_id })
    : post({ question, options }),
  { serverId, scope: pollScope(channelId, cmid), clientMsgId: cmid, extra: { o: options } })
}
