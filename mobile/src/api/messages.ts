import { http, path } from '@/lib/http'
import { LIMITS } from '@/config/env'
import { adaptMessage } from '@/features/chat/adapters'
import { normalizePins, type PinnedItem } from '@/features/chat/pins'
import type { Attachment, ChatMessage, ConversationRef } from '@/types/models'

/**
 * API de messagerie unifiée : un seul contrat quel que soit le type de
 * conversation (salon, DM, groupe). Le routage vers les bons endpoints Rust
 * est centralisé ici.
 */

function base(ref: ConversationRef): string {
  switch (ref.kind) {
    case 'channel':
      return path`/servers/${ref.serverId}/channels/${ref.channelId}/messages`
    case 'dm':
      return path`/dms/${ref.dmId}/messages`
    case 'group':
      return path`/dms/groups/${ref.groupId}/messages`
  }
}

export type ReportReason = 'spam' | 'harassment' | 'nsfw' | 'other'

export interface UploadFile {
  uri: string
  name: string
  type: string
  size?: number | null
}

export const messagesApi = {
  /** Page de messages, ordre chronologique croissant. */
  async list(ref: ConversationRef, before?: string, signal?: AbortSignal): Promise<ChatMessage[]> {
    const raw = await http.get<unknown[]>(base(ref), {
      query: { limit: LIMITS.pageSize, before },
      signal,
    })
    return (Array.isArray(raw) ? raw : []).map((m) => adaptMessage(ref, m))
  },

  async send(
    ref: ConversationRef,
    input: { content: string | null; replyTo?: string | null; hasAttachments?: boolean; expiresInSeconds?: number | null },
  ): Promise<ChatMessage> {
    const raw = await http.post<unknown>(base(ref), {
      content: input.content,
      reply_to: input.replyTo ?? undefined,
      has_attachments: input.hasAttachments ?? false,
      // Messages éphémères : seuls les salons les gèrent côté serveur (comme le web).
      ...(ref.kind === 'channel' && input.expiresInSeconds ? { expires_at_seconds: input.expiresInSeconds } : {}),
    })
    return adaptMessage(ref, raw)
  },

  edit(ref: ConversationRef, messageId: string, content: string) {
    return http.patch(base(ref) + path`/${messageId}`, { content })
  },

  remove(ref: ConversationRef, messageId: string) {
    return http.delete(base(ref) + path`/${messageId}`)
  },

  /** Réaction : ajout/retrait explicite pour les salons, bascule pour les DM/groupes. */
  react(ref: ConversationRef, messageId: string, emoji: string, currentlyMine: boolean) {
    const p = base(ref) + path`/${messageId}/reactions/${emoji}`
    if (ref.kind === 'channel') return currentlyMine ? http.delete(p) : http.put(p)
    return http.put(p)
  },

  async upload(ref: ConversationRef, messageId: string, files: UploadFile[]): Promise<Attachment[]> {
    const fd = new FormData()
    for (const f of files) fd.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob)
    return http.upload<Attachment[]>(base(ref) + path`/${messageId}/attachments`, fd)
  },

  markRead(ref: ConversationRef) {
    switch (ref.kind) {
      case 'channel':
        return http.post(path`/channels/${ref.channelId}/read`)
      case 'dm':
        return http.post(path`/dms/${ref.dmId}/read`)
      case 'group':
        return http.post(path`/dms/groups/${ref.groupId}/read`)
    }
  },

  /**
   * Épingle (pinned=true) ou désépingle. Le groupe n'a qu'une bascule côté serveur :
   * l'appelant doit connaître l'état actuel (liste des épinglés).
   */
  pin(ref: ConversationRef, messageId: string, pinned: boolean) {
    switch (ref.kind) {
      case 'channel': {
        const p = path`/servers/${ref.serverId}/channels/${ref.channelId}/messages/${messageId}/pin`
        return pinned ? http.post(p) : http.delete(p)
      }
      case 'dm': {
        const p = path`/dms/${ref.dmId}/pins/${messageId}`
        return pinned ? http.post(p) : http.delete(p)
      }
      case 'group':
        return http.put(path`/dms/groups/${ref.groupId}/messages/${messageId}/pin`)
    }
  },

  /** Messages épinglés, du plus récemment épinglé au plus ancien. */
  async pins(ref: ConversationRef): Promise<PinnedItem[]> {
    const p =
      ref.kind === 'channel'
        ? path`/servers/${ref.serverId}/channels/${ref.channelId}/pins`
        : ref.kind === 'dm'
          ? path`/dms/${ref.dmId}/pins`
          : path`/dms/groups/${ref.groupId}/pins`
    return normalizePins(ref.kind, await http.get<unknown>(p))
  },

  /** Signalement (messages de salon uniquement côté serveur). */
  report(messageId: string, reason: ReportReason, comment?: string) {
    return http.post(path`/messages/${messageId}/report`, { reason, comment })
  },
}
