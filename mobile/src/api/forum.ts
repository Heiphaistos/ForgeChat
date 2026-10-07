import { LIMITS } from '@/config/env'
import { fromThreadMessage } from '@/features/chat/adapters'
import { normalizePost, normalizePosts, type ForumPost } from '@/features/forum/forum'
import { http, path } from '@/lib/http'
import type { Attachment, ChatMessage } from '@/types/models'
import type { UploadFile } from './messages'
import { uploadForm } from './threads'

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
  create: (serverId: string, channelId: string, body: { title: string; content?: string; tags: string[]; media_url?: string }) => http.post(base(serverId, channelId), body),
  /** Image ou vidéo d'une publication de salon média (uploads.rs::forum_upload) ; renvoie son URL. */
  async uploadMedia(serverId: string, channelId: string, file: UploadFile): Promise<string | null> {
    const r = await http.upload<{ url?: unknown }>(path`/servers/${serverId}/channels/${channelId}/forum-uploads`, uploadForm([file]))
    return typeof r?.url === 'string' ? r.url : null
  },
  /** Renvoie l'id de la réponse créée (pour y joindre ensuite des fichiers). */
  async reply(serverId: string, channelId: string, postId: string, content: string, hasAttachments = false): Promise<string | null> {
    const r = await http.post<{ reply?: { id?: unknown } }>(base(serverId, channelId) + path`/${postId}/replies`, { content, has_attachments: hasAttachments })
    return typeof r?.reply?.id === 'string' ? r.reply.id : null
  },
  /** `content` : créateur seulement ; `pinned` / `locked` : MANAGE_MESSAGES. */
  updatePost: (serverId: string, channelId: string, postId: string, patch: { content?: string; pinned?: boolean; locked?: boolean }) =>
    http.patch(base(serverId, channelId) + path`/${postId}`, patch),
  /** Créateur ou MANAGE_MESSAGES. */
  deletePost: (serverId: string, channelId: string, postId: string) => http.delete(base(serverId, channelId) + path`/${postId}`),
  /** Auteur seulement. */
  editReply: (serverId: string, channelId: string, postId: string, replyId: string, content: string) =>
    http.patch(base(serverId, channelId) + path`/${postId}/replies/${replyId}`, { content }),
  /** Auteur ou MANAGE_MESSAGES. */
  deleteReply: (serverId: string, channelId: string, postId: string, replyId: string) =>
    http.delete(base(serverId, channelId) + path`/${postId}/replies/${replyId}`),
  uploadReply: (serverId: string, channelId: string, postId: string, replyId: string, files: UploadFile[]) =>
    http.upload<Attachment[]>(base(serverId, channelId) + path`/${postId}/replies/${replyId}/attachments`, uploadForm(files)),
  /** Bascule (ajout ou retrait) de ma réaction sur une réponse. */
  react: (serverId: string, channelId: string, postId: string, replyId: string, emoji: string) =>
    http.put(base(serverId, channelId) + path`/${postId}/replies/${replyId}/reactions/${emoji}`),
  /** Tags officiels du salon ; s'il y en a, ce sont les seuls acceptés. */
  async tags(channelId: string): Promise<string[]> {
    const raw = await http.get<unknown>(path`/channels/${channelId}/tags`)
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === 'string') : []
  },
}
