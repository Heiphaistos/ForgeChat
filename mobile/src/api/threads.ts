import { LIMITS } from '@/config/env'
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

/** Fils de discussion d'un salon (handlers/threads.rs). */
export const threadsApi = {
  async list(serverId: string, channelId: string, query: { parent_message_id?: string; thread_id?: string; limit?: number } = {}): Promise<ThreadSummary[]> {
    return normalizeThreads(await http.get<unknown>(base(serverId, channelId), { query }))
  },
  /** Page la plus récente (ou antérieure à `before`), en ordre chronologique. */
  async messages(serverId: string, channelId: string, threadId: string, before?: string): Promise<ChatMessage[]> {
    const raw = await http.get<unknown>(base(serverId, channelId) + path`/${threadId}/messages`, { query: { limit: LIMITS.pageSize, before } })
    return (Array.isArray(raw) ? raw : []).flatMap((m) => fromThreadMessage(m) ?? [])
  },
  create: (serverId: string, channelId: string, body: { title?: string; first_message: string; parent_message_id?: string }) =>
    http.post<{ thread: { id: string } }>(base(serverId, channelId), body),
  /** Renvoie l'id du message créé (pour y joindre ensuite des fichiers). */
  async send(serverId: string, channelId: string, threadId: string, content: string, hasAttachments = false): Promise<string | null> {
    const r = await http.post<{ message?: { id?: unknown } }>(base(serverId, channelId) + path`/${threadId}/messages`, { content, has_attachments: hasAttachments })
    return typeof r?.message?.id === 'string' ? r.message.id : null
  },
  /** Auteur seulement. */
  edit: (serverId: string, channelId: string, threadId: string, messageId: string, content: string) =>
    http.patch(base(serverId, channelId) + path`/${threadId}/messages/${messageId}`, { content }),
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
