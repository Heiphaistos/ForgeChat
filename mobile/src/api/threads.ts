import { LIMITS } from '@/config/env'
import { fromThreadMessage } from '@/features/chat/adapters'
import { normalizeThreads, type ThreadSummary } from '@/features/chat/threads'
import { http, path } from '@/lib/http'
import type { ChatMessage } from '@/types/models'

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
  send: (serverId: string, channelId: string, threadId: string, content: string) =>
    http.post(base(serverId, channelId) + path`/${threadId}/messages`, { content }),
  /** Marque le fil lu jusqu'à son dernier message. */
  ack: (serverId: string, channelId: string, threadId: string) => http.post(base(serverId, channelId) + path`/${threadId}/ack`),
  /** Bascule (ajout ou retrait) de ma réaction. */
  react: (serverId: string, channelId: string, threadId: string, messageId: string, emoji: string) =>
    http.put(base(serverId, channelId) + path`/${threadId}/messages/${messageId}/reactions/${emoji}`),
}
