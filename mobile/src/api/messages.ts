import { http, path } from '@/lib/http'
import { LIMITS } from '@/config/env'
import { adaptMessage } from '@/features/chat/adapters'
import {
  normalizeEdits,
  normalizeOg,
  normalizeReactionUsers,
  normalizeSaved,
  normalizeScheduled,
  savedBody,
  type EditEntry,
  type LinkPreviewData,
  type ReactionUser,
  type SavedItem,
  type ScheduledItem,
} from '@/features/chat/messageExtras'
import { normalizeBotCommands, type SlashCommand } from '@/features/composer/commands'
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

  /** Messages autour d'un message ancien (?around=, moitié avant, moitié après), ordre chronologique. */
  async around(ref: ConversationRef, messageId: string): Promise<ChatMessage[]> {
    const raw = await http.get<unknown[]>(base(ref), { query: { around: messageId, limit: LIMITS.pageSize } })
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

  /** Réaction : ajout/retrait explicite pour les salons, bascule pour les DM/groupes.
   *  Super réaction : salons seulement, 10 par 24 h (429 au-delà). */
  react(ref: ConversationRef, messageId: string, emoji: string, currentlyMine: boolean, isSuper = false) {
    const p = base(ref) + (isSuper ? path`/${messageId}/super-reactions/${emoji}` : path`/${messageId}/reactions/${emoji}`)
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

  /** Copie le message (salon ou DM) dans un salon textuel ; le serveur applique les règles d'envoi du salon cible. */
  forward(messageId: string, channelId: string) {
    return http.post(path`/messages/${messageId}/forward`, { channel_id: channelId })
  },

  /** Rappel livré par l'événement temps réel REMINDER à l'échéance (reminders.rs). */
  remind(messageId: string, at: Date) {
    return http.post(path`/messages/${messageId}/remind`, { remind_at: at.toISOString() })
  },

  async edits(messageId: string): Promise<EditEntry[]> {
    return normalizeEdits(await http.get<unknown>(path`/messages/${messageId}/edits`))
  },

  async saved(): Promise<SavedItem[]> {
    return normalizeSaved(await http.get<unknown>('/saved'))
  },

  save(ref: ConversationRef, m: ChatMessage) {
    return http.post('/saved', savedBody(ref, m))
  },

  unsave(messageId: string) {
    return http.delete(path`/saved/${messageId}`)
  },

  /** Traduction en `lang` (salons et DM 1:1 seulement côté serveur). */
  async translate(messageId: string, lang = 'fr'): Promise<string> {
    const r = await http.post<{ translated?: unknown }>(path`/messages/${messageId}/translate`, { target_lang: lang })
    if (typeof r?.translated !== 'string') throw new Error('Traduction indisponible')
    return r.translated
  },

  /** Qui a réagi avec `emoji` (salons et DM 1:1 ; 100 personnes au plus). */
  async reactionUsers(messageId: string, emoji: string, isSuper = false): Promise<ReactionUser[]> {
    const query = isSuper ? { message_id: messageId, emoji, is_super: 'true' } : { message_id: messageId, emoji }
    return normalizeReactionUsers(await http.get<unknown>('/reactions', { query }))
  },

  /** Aperçu d'un lien (titre, description) ; le serveur filtre les adresses privées et les domaines. */
  async linkPreview(url: string, signal?: AbortSignal): Promise<LinkPreviewData | null> {
    return normalizeOg(await http.get<unknown>('/og', { query: { url }, signal }), url)
  },

  /** Emoji d'un serveur quelconque, par identifiant (« <:nom:id> »). */
  emoji: (id: string) => http.get<{ url?: unknown; name?: unknown }>(path`/emojis/${id}`),

  /** Commandes déclarées par les bots du serveur. */
  async commands(serverId: string): Promise<SlashCommand[]> {
    return normalizeBotCommands(await http.get<unknown>(path`/servers/${serverId}/commands`))
  },

  /** Mes messages programmés non encore envoyés dans ce salon. */
  async scheduled(serverId: string, channelId: string): Promise<ScheduledItem[]> {
    return normalizeScheduled(await http.get<unknown>(path`/servers/${serverId}/channels/${channelId}/scheduled`))
  },
  schedule: (serverId: string, channelId: string, content: string, sendAt: Date) =>
    http.post(path`/servers/${serverId}/channels/${channelId}/scheduled`, { content, send_at: sendAt.toISOString() }),
  cancelScheduled: (id: string) => http.delete(path`/scheduled/${id}`),

  /** Signalement (messages de salon uniquement côté serveur). */
  report(messageId: string, reason: ReportReason, comment?: string) {
    return http.post(path`/messages/${messageId}/report`, { reason, comment })
  },
}
