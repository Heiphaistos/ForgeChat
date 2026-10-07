import type { InfiniteData } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import type { Attachment, ChatMessage } from '@/types/models'

/**
 * Manipulation du cache TanStack des messages.
 *
 * Forme : InfiniteData<ChatMessage[]>, pages[0] = page la plus récente,
 * chaque page en ordre chronologique croissant.
 */

export type MessagesData = InfiniteData<ChatMessage[], string | undefined>
export type ConvKind = 'channel' | 'dm' | 'group'

export const messagesKey = (kind: ConvKind, id: string) => ['messages', kind, id] as const

function mutate(kind: ConvKind, id: string, fn: (data: MessagesData) => MessagesData | undefined) {
  queryClient.setQueryData<MessagesData>(messagesKey(kind, id), (data) => (data ? (fn(data) ?? data) : data))
}

function hasMessage(data: MessagesData, messageId: string) {
  return data.pages.some((p) => p.some((m) => m.id === messageId))
}

/** Ajoute un message en tête (plus récent). Ignoré si déjà présent. */
export function appendMessage(kind: ConvKind, id: string, msg: ChatMessage) {
  mutate(kind, id, (data) => {
    if (hasMessage(data, msg.id)) return undefined
    const [first = [], ...rest] = data.pages
    return { ...data, pages: [[...first, msg], ...rest] }
  })
}

/** Remplace un message optimiste (id temporaire) par la version serveur. */
export function confirmMessage(kind: ConvKind, id: string, tempId: string, real: ChatMessage) {
  mutate(kind, id, (data) => {
    const realExists = hasMessage(data, real.id)
    return {
      ...data,
      pages: data.pages.map((page) =>
        realExists
          ? page.filter((m) => m.id !== tempId)
          : page.map((m) => (m.id === tempId ? { ...real, attachments: m.attachments.length ? m.attachments : real.attachments } : m)),
      ),
    }
  })
}

export function patchMessage(kind: ConvKind, id: string, messageId: string, patch: (m: ChatMessage) => ChatMessage) {
  mutate(kind, id, (data) => {
    if (!hasMessage(data, messageId)) return undefined
    return { ...data, pages: data.pages.map((page) => page.map((m) => (m.id === messageId ? patch(m) : m))) }
  })
}

export function removeMessage(kind: ConvKind, id: string, messageId: string) {
  mutate(kind, id, (data) => {
    if (!hasMessage(data, messageId)) return undefined
    return { ...data, pages: data.pages.map((page) => page.filter((m) => m.id !== messageId)) }
  })
}

export function mergeAttachments(kind: ConvKind, id: string, messageId: string, atts: Attachment[]) {
  patchMessage(kind, id, messageId, (m) => {
    const known = new Set(m.attachments.map((a) => a.id))
    return { ...m, awaitingAttachments: false, attachments: [...m.attachments, ...atts.filter((a) => !known.has(a.id))] }
  })
}

/** Réaction explicite (salons : REACTION_ADD / REACTION_REMOVE, `isSuper` pour les super réactions). */
export function applyReactionDelta(
  kind: ConvKind,
  id: string,
  messageId: string,
  emoji: string,
  delta: 1 | -1,
  byMe: boolean,
  isSuper = false,
) {
  patchMessage(kind, id, messageId, (m) => {
    const existing = m.reactions.find((r) => r.emoji === emoji && !!r.is_super === isSuper)
    let reactions = m.reactions
    if (existing) {
      const count = existing.count + delta
      reactions =
        count <= 0
          ? m.reactions.filter((r) => r !== existing)
          : m.reactions.map((r) => (r === existing ? { ...r, count, me: byMe ? delta > 0 : r.me } : r))
    } else if (delta > 0) {
      reactions = [...m.reactions, { emoji, count: 1, me: byMe, ...(isSuper ? { is_super: true } : {}) }]
    }
    return { ...m, reactions }
  })
}

/** Réaction « toggle » (DM/groupes) : le serveur renvoie le compte absolu. */
export function applyReactionToggle(
  kind: ConvKind,
  id: string,
  messageId: string,
  emoji: string,
  added: boolean,
  count: number,
  byMe: boolean,
) {
  patchMessage(kind, id, messageId, (m) => {
    const exists = m.reactions.some((r) => r.emoji === emoji)
    let reactions = m.reactions
    if (count <= 0) reactions = m.reactions.filter((r) => r.emoji !== emoji)
    else if (exists)
      reactions = m.reactions.map((r) => (r.emoji === emoji ? { ...r, count, me: byMe ? added : r.me } : r))
    else reactions = [...m.reactions, { emoji, count, me: byMe && added }]
    return { ...m, reactions }
  })
}

export function flattenNewestFirst(data: MessagesData | undefined): ChatMessage[] {
  if (!data) return []
  const out: ChatMessage[] = []
  for (const page of data.pages) for (let i = page.length - 1; i >= 0; i--) out.push(page[i]!)
  return out
}
