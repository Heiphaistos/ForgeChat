import { LIMITS } from '@/config/env'
import { fromThreadMessage } from '@/features/chat/adapters'
import { normalizePost, normalizePosts, type ForumPost } from '@/features/forum/forum'
import { http, path } from '@/lib/http'
import type { ChatMessage } from '@/types/models'

const base = (serverId: string, channelId: string) => path`/servers/${serverId}/channels/${channelId}/posts`

/** Salons forum (handlers/forum.rs, tags : channels.rs::get_channel_tags). */
export const forumApi = {
  async posts(serverId: string, channelId: string, before?: string): Promise<ForumPost[]> {
    return normalizePosts(await http.get<unknown>(base(serverId, channelId), { query: { limit: LIMITS.pageSize, before } }))
  },
  /** Publication + page de réponses la plus récente (ou antérieure à `before`), en ordre chronologique. */
  async post(serverId: string, channelId: string, postId: string, before?: string): Promise<{ post: ForumPost | null; replies: ChatMessage[] }> {
    const raw = await http.get<{ post?: unknown; replies?: unknown }>(base(serverId, channelId) + path`/${postId}`, { query: { limit: LIMITS.pageSize, before } })
    const replies = Array.isArray(raw?.replies) ? raw.replies.flatMap((r) => fromThreadMessage(r) ?? []) : []
    return { post: normalizePost(raw?.post), replies }
  },
  create: (serverId: string, channelId: string, body: { title: string; content?: string; tags: string[] }) => http.post(base(serverId, channelId), body),
  reply: (serverId: string, channelId: string, postId: string, content: string) => http.post(base(serverId, channelId) + path`/${postId}/replies`, { content }),
  /** Bascule (ajout ou retrait) de ma réaction sur une réponse. */
  react: (serverId: string, channelId: string, postId: string, replyId: string, emoji: string) =>
    http.put(base(serverId, channelId) + path`/${postId}/replies/${replyId}/reactions/${emoji}`),
  /** Tags officiels du salon ; s'il y en a, ce sont les seuls acceptés. */
  async tags(channelId: string): Promise<string[]> {
    const raw = await http.get<unknown>(path`/channels/${channelId}/tags`)
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : []
  },
}
