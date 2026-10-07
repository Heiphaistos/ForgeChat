import * as Crypto from 'expo-crypto'
import { LIMITS } from '@/config/env'
import { checkAutomod, openThreadTitle, sendChannelText, threadCreateBody } from '@/e2e/channels'
import { mustEncrypt, openRawList } from '@/e2e/conversations'
import { threadScope } from '@/e2e/crypto'
import { fromThreadMessage } from '@/features/chat/adapters'
import { normalizeThreads, type ThreadSummary } from '@/features/chat/threads'
import { http, path } from '@/lib/http'
import type { Attachment, ChatMessage } from '@/types/models'
import type { UploadFile } from './messages'

/** Fichiers en multipart (champ « file »), comme messagesApi.upload. */
export function uploadForm(files: UploadFile[]): FormData {
  const fd = new FormData()
  for (const f of files) fd.append('file', { uri: f.uri, name: f.name, type: f.type } as unknown as Blob)
  return fd
}

const base = (serverId: string, channelId: string) => path`/servers/${serverId}/channels/${channelId}/threads`

/** Portée AAD des messages d'un fil (clé du salon parent). */
const scopeOf = (channelId: string, thread: ThreadSummary) => (thread.clientId ? threadScope(channelId, thread.clientId) : undefined)

/** Fils de discussion d'un salon (handlers/threads.rs) ; titres et messages chiffrés avec la clé du salon. */
export const threadsApi = {
  async list(serverId: string, channelId: string, query: { parent_message_id?: string; thread_id?: string; limit?: number } = {}): Promise<ThreadSummary[]> {
    const raw = await http.get<unknown>(base(serverId, channelId), { query })
    const opened: unknown[] = []
    for (const r of Array.isArray(raw) ? raw : []) opened.push(r && typeof r === 'object' ? await openThreadTitle(channelId, r as Record<string, unknown>) : r)
    return normalizeThreads(opened)
  },
  /** Page la plus récente (ou antérieure à `before`), en ordre chronologique. */
  async messages(serverId: string, channelId: string, thread: ThreadSummary, before?: string): Promise<ChatMessage[]> {
    const raw = await http.get<unknown>(base(serverId, channelId) + path`/${thread.id}/messages`, { query: { limit: LIMITS.pageSize, before } })
    const list = await openRawList('channel', channelId, Array.isArray(raw) ? raw : [], scopeOf(channelId, thread))
    return list.flatMap((m) => fromThreadMessage(m) ?? [])
  },
  /** Titre et premier message chiffrés dès que j'ai une clé (AutoMod appliqué avant). */
  async create(serverId: string, channelId: string, title: string, first: string, parentMessageId: string | null) {
    if (await mustEncrypt('channel', channelId)) await checkAutomod(serverId, first)
    return http.post<{ thread: { id: string } }>(base(serverId, channelId), await threadCreateBody(channelId, title, first, parentMessageId))
  },
  /** Renvoie l'id du message créé (pour y joindre ensuite des fichiers). */
  async send(serverId: string, channelId: string, thread: ThreadSummary, content: string, hasAttachments = false): Promise<string | null> {
    const { result: r } = await sendChannelText(serverId, channelId, content, (body) =>
      http.post<{ message?: { id?: unknown } }>(base(serverId, channelId) + path`/${thread.id}/messages`, { ...body, content: body.content ?? '', has_attachments: hasAttachments }),
    { scope: scopeOf(channelId, thread) })
    return typeof r?.message?.id === 'string' ? r.message.id : null
  },
  /** Auteur seulement ; même id client que le message (lié à l'AAD), ou un nouveau pour un ancien message. */
  edit: (serverId: string, channelId: string, thread: ThreadSummary, m: ChatMessage, content: string) =>
    sendChannelText(serverId, channelId, content, (body) =>
      http.patch(base(serverId, channelId) + path`/${thread.id}/messages/${m.id}`, { ...body, content: body.content ?? '' }),
    { scope: scopeOf(channelId, thread), clientMsgId: m.clientMsgId ?? Crypto.randomUUID(), edit: true }),
  /** Auteur ou MANAGE_MESSAGES. */
  remove: (serverId: string, channelId: string, threadId: string, messageId: string) =>
    http.delete(base(serverId, channelId) + path`/${threadId}/messages/${messageId}`),
  /** Auteur du message seulement. */
  upload: (serverId: string, channelId: string, threadId: string, messageId: string, files: UploadFile[]) =>
    http.upload<Attachment[]>(base(serverId, channelId) + path`/${threadId}/messages/${messageId}/attachments`, uploadForm(files)),
  /**
   * Archiver : créateur du fil ou MANAGE_MESSAGES. Verrouiller (champ `locked`) : MANAGE_MESSAGES
   * seulement. Champs absents = inchangés ; `title` renomme (1 à 100 caractères).
   */
  update: (serverId: string, channelId: string, threadId: string, body: { archived?: boolean; locked?: boolean; title?: string }) =>
    http.patch(base(serverId, channelId) + path`/${threadId}`, body),
  /** Marque le fil lu jusqu'à son dernier message. */
  ack: (serverId: string, channelId: string, threadId: string) => http.post(base(serverId, channelId) + path`/${threadId}/ack`),
  /** Bascule (ajout ou retrait) de ma réaction. */
  react: (serverId: string, channelId: string, threadId: string, messageId: string, emoji: string) =>
    http.put(base(serverId, channelId) + path`/${threadId}/messages/${messageId}/reactions/${emoji}`),
}
