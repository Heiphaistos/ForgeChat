import type { ChatMessage, ConversationRef, DmMessage, GroupMessage, ServerMessage } from '@/types/models'
import { firstUrl } from '@/e2e/channelText'
import { fileEntries } from '@/e2e/crypto'
import { normalizeOg } from './messageExtras'
import { parseSupport } from '@/lib/remoteSupport'

/**
 * Le serveur expose 3 formats de message (salon, DM 1:1, groupe). L'UI n'en
 * connaît qu'un : ChatMessage. Ces adaptateurs sont le seul endroit où les
 * formats serveur sont interprétés.
 */

export function fromServerMessage(m: ServerMessage): ChatMessage {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    authorId: m.author_id,
    authorName: m.author_username,
    authorAvatar: m.author_avatar,
    authorDecoration: m.author_avatar_decoration ?? null,
    authorIsBot: !!m.author_is_bot,
    reply: m.reply_to
      ? { id: m.reply_to, authorName: m.reply_to_username, content: m.reply_to_content }
      : null,
    forwardedFrom: m.forward_from_username ?? null,
    attachments: m.attachments ?? [],
    reactions: m.reactions ?? [],
    pinned: !!m.pinned,
    expiresAt: m.expires_at ?? null,
    pollId: m.poll_id ?? null,
    ...e2eFields(m),
    ...(m.unencrypted === true ? { unencrypted: true } : {}),
    ...(m.type === 'welcome' || m.type === 'starboard' ? { system: { kind: m.type, meta: m.system_meta ?? {} } } : {}),
    // Aperçu de lien du message chiffré : celui de l'expéditeur, sans appel à /og.
    ...(m.e2e === 'ok' ? { preview: normalizeOg(m.e2e_body?.p, firstUrl(m.content ?? '') ?? '') } : {}),
  }
}

export function fromDmMessage(m: DmMessage): ChatMessage {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.created_at,
    editedAt: m.edited_at ?? null,
    authorId: m.sender_id,
    authorName: m.sender_username,
    authorAvatar: m.sender_avatar,
    authorDecoration: m.sender_avatar_decoration ?? null,
    authorIsBot: false,
    reply: m.reply_to
      ? { id: m.reply_to.id, authorName: m.reply_to.sender_username, content: m.reply_to.content }
      : m.reply_to_id
        ? { id: m.reply_to_id, authorName: null, content: null }
        : null,
    forwardedFrom: null,
    attachments: m.attachments ?? [],
    reactions: m.reactions ?? [],
    pinned: false,
    expiresAt: m.expires_at ?? null,
    ...(m.expire_on_read ? { expireOnRead: true } : {}),
    ...e2eFields(m),
    ...supportField(m),
  }
}

/** MP : carte de support à distance du contenu déchiffré (`rs`), si elle est bien formée. */
function supportField(m: { e2e?: 'ok' | 'locked' }) {
  const support = m.e2e === 'ok' ? parseSupport((m as { e2e_body?: { rs?: unknown } }).e2e_body?.rs) : null
  return support ? { support } : {}
}

/** Champs du chiffrement de bout en bout (le texte est déjà déchiffré dans `content`, les clés des fichiers dans `files`). */
function e2eFields(m: { client_msg_id?: string | null; e2e?: 'ok' | 'locked' }) {
  const files = fileEntries((m as { e2e_body?: unknown }).e2e_body)
  return { clientMsgId: m.client_msg_id ?? null, ...(m.e2e ? { e2e: m.e2e } : {}), ...(files.length ? { files } : {}) }
}

export function fromGroupMessage(m: GroupMessage): ChatMessage {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.created_at,
    editedAt: m.edited_at ?? null,
    authorId: m.sender_id,
    authorName: m.sender_username,
    authorAvatar: m.sender_avatar,
    authorDecoration: m.sender_avatar_decoration ?? null,
    authorIsBot: false,
    reply: m.reply_to
      ? { id: m.reply_to, authorName: m.reply_to_username ?? null, content: m.reply_to_content ?? null }
      : null,
    forwardedFrom: null,
    attachments: m.attachments ?? [],
    reactions: m.reactions ?? [],
    pinned: false,
    expiresAt: m.expires_at ?? null,
    ...(m.expire_on_read ? { expireOnRead: true } : {}),
    ...e2eFields(m),
  }
}

/**
 * Message de fil (threads.rs::get_thread_messages) ou réponse de forum (forum.rs::get_post) :
 * { id, user_id, content, reply_to?, reply_to_content?, reply_to_username?, edited_at, created_at,
 *   author: { id, username, avatar }, reactions, attachments }. null si inexploitable.
 */
export function fromThreadMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const author = (m.author && typeof m.author === 'object' ? m.author : {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v : null)
  const id = s(m.id)
  const createdAt = s(m.created_at)
  if (!id || !createdAt) return null
  const replyId = s(m.reply_to)
  return {
    id,
    content: s(m.content),
    createdAt,
    editedAt: s(m.edited_at),
    authorId: s(author.id) ?? s(m.user_id) ?? '',
    authorName: s(author.username) ?? s(m.author_username) ?? 'Inconnu',
    authorAvatar: s(author.avatar),
    authorIsBot: false,
    reply: replyId ? { id: replyId, authorName: s(m.reply_to_username), content: s(m.reply_to_content) } : null,
    forwardedFrom: null,
    attachments: Array.isArray(m.attachments) ? (m.attachments as ChatMessage['attachments']) : [],
    reactions: Array.isArray(m.reactions) ? (m.reactions as ChatMessage['reactions']) : [],
    pinned: false,
    // Fil ou forum chiffré (déchiffré par e2e/conversations.openRaw avec la portée du fil ou de la publication).
    ...e2eFields({ client_msg_id: s(m.client_msg_id), ...(m.e2e === 'ok' || m.e2e === 'locked' ? { e2e: m.e2e } : {}), e2e_body: m.e2e_body } as Parameters<typeof e2eFields>[0]),
    ...(m.unencrypted === true ? { unencrypted: true } : {}),
  }
}

export function adaptMessage(ref: ConversationRef, raw: unknown): ChatMessage {
  switch (ref.kind) {
    case 'channel':
      return fromServerMessage(raw as ServerMessage)
    case 'dm':
      return fromDmMessage(raw as DmMessage)
    case 'group':
      return fromGroupMessage(raw as GroupMessage)
  }
}

/** Identifiant stable d'une conversation (clé de cache, unread, brouillons…). */
export function conversationId(ref: ConversationRef): string {
  switch (ref.kind) {
    case 'channel':
      return ref.channelId
    case 'dm':
      return ref.dmId
    case 'group':
      return ref.groupId
  }
}

export function conversationKey(ref: ConversationRef) {
  return ['messages', ref.kind, conversationId(ref)] as const
}
