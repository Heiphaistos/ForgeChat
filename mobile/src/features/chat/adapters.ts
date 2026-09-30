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
    authorIsBot: !!m.author_is_bot,
    reply: m.reply_to
      ? { id: m.reply_to, authorName: m.reply_to_username, content: m.reply_to_content }
      : null,
    forwardedFrom: m.forward_from_username ?? null,
    attachments: m.attachments ?? [],
    reactions: m.reactions ?? [],
    pinned: !!m.pinned,
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
