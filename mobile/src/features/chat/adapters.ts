import type { ChatMessage, ConversationRef, DmMessage, GroupMessage, ServerMessage } from '@/types/models'

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
  }
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
