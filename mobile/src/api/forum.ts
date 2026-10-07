import * as Crypto from 'expo-crypto'
import { LIMITS } from '@/config/env'
import { checkAutomod, openPost, sealPost, sendChannelText } from '@/e2e/channels'
import { completeChannelKeys, mustEncrypt, openRawList } from '@/e2e/conversations'
import { postScope, type FileEntry } from '@/e2e/crypto'
import { withPreparedUploads } from '@/e2e/files'
import { fromThreadMessage } from '@/features/chat/adapters'
import { normalizePost, normalizePosts, type ForumPost } from '@/features/forum/forum'
import { http, path } from '@/lib/http'
import type { Attachment, ChatMessage } from '@/types/models'
import type { UploadFile } from './messages'
import { uploadForm } from './threads'

const base = (serverId: string, channelId: string) => path`/servers/${serverId}/channels/${channelId}/posts`
/** Portée AAD des réponses d'une publication (clé du salon). */
const replyScope = (channelId: string, post: ForumPost) => (post.clientMsgId ? postScope(channelId, post.clientMsgId) : undefined)

/** Médias chiffrés envoyés pendant cette session (adresse → clé), repris à la création de la publication. */
const sealedMedia = new Map<string, FileEntry>()

/** Salons forum (handlers/forum.rs, tags : channels.rs::get_channel_tags). */
export const forumApi = {
  /** Publications chiffrées : titre et contenu déchiffrés sur l'appareil. */
  async posts(serverId: string, channelId: string, before?: string): Promise<ForumPost[]> {
    const raw = await http.get<unknown>(base(serverId, channelId), { query: { limit: LIMITS.pageSize, before } })
    const opened: unknown[] = []
    for (const p of Array.isArray(raw) ? raw : []) opened.push(p && typeof p === 'object' ? await openPost(channelId, p as Record<string, unknown>) : p)
    return normalizePosts(opened)
  },
  /** Publication + page de réponses la plus récente (ou antérieure à `before`), en ordre chronologique. */
  async post(serverId: string, channelId: string, postId: string, before?: string): Promise<{ post: ForumPost | null; replies: ChatMessage[] }> {
    const raw = await http.get<{ post?: unknown; replies?: unknown }>(base(serverId, channelId) + path`/${postId}`, { query: { limit: LIMITS.pageSize, before } })
    const rawPost = raw?.post && typeof raw.post === 'object' ? await openPost(channelId, raw.post as Record<string, unknown>) : null
    const post = normalizePost(rawPost)
    // Réponses : clé du salon, portée de la publication.
    const scope = post?.clientMsgId ? postScope(channelId, post.clientMsgId) : undefined
    const replies = Array.isArray(raw?.replies) ? (await openRawList('channel', channelId, raw.replies, scope)).flatMap((r) => fromThreadMessage(r) ?? []) : []
    return { post, replies }
  },
  /** Titre et contenu chiffrés ensemble dès que j'ai une clé (AutoMod appliqué avant). */
  async create(serverId: string, channelId: string, body: { title: string; content?: string; tags: string[]; media_url?: string }) {
    const text = `${body.title}\n${body.content ?? ''}`.trim()
    if (await mustEncrypt('channel', channelId)) await checkAutomod(serverId, text)
    const cmid = Crypto.randomUUID()
    const media = body.media_url ? sealedMedia.get(body.media_url) : undefined
    const sealed = await sealPost(channelId, body.title, body.content ?? '', cmid, media ? [media] : undefined)
    if (!sealed) return http.post(base(serverId, channelId), body)
    void completeChannelKeys(channelId)
    return http.post(base(serverId, channelId), { ...body, title: '', content: null, enc: sealed.enc, client_msg_id: cmid })
  },
  /** Nouveau texte d'une publication (créateur) : chiffré avec son id client (titre compris) dès que j'ai une clé. */
  async editPost(serverId: string, channelId: string, post: ForumPost, content: string) {
    // Le média chiffré garde sa clé dans la publication modifiée.
    const sealed = post.clientMsgId ? await sealPost(channelId, post.title, content, post.clientMsgId, post.files?.filter((f) => f.u === post.mediaUrl)) : null
    return http.patch(base(serverId, channelId) + path`/${post.id}`, sealed ? { enc: sealed.enc } : { content })
  },
  /** Image ou vidéo d'une publication de salon média (uploads.rs::forum_upload) ; renvoie son URL. */
  async uploadMedia(serverId: string, channelId: string, file: UploadFile): Promise<string | null> {
    // Auteur muni d'une clé : média chiffré ici, sa clé ira dans la publication chiffrée (§12).
    return withPreparedUploads('channel', channelId, [file], async (p) => {
      const r = await http.upload<{ url?: unknown }>(path`/servers/${serverId}/channels/${channelId}/forum-uploads`, uploadForm(p.uploads))
      const url = typeof r?.url === 'string' ? r.url : null
      if (url && p.entries?.[0]) sealedMedia.set(url, { ...p.entries[0], u: url })
      return url
    })
  },
  /** Renvoie l'id de la réponse créée (pour y joindre ensuite des fichiers). */
  async reply(serverId: string, channelId: string, post: ForumPost, content: string, hasAttachments = false, files?: FileEntry[]): Promise<string | null> {
    const { result: r } = await sendChannelText(serverId, channelId, content, (body) =>
      http.post<{ reply?: { id?: unknown } }>(base(serverId, channelId) + path`/${post.id}/replies`, { ...body, content: body.content ?? '', has_attachments: hasAttachments }),
    { scope: replyScope(channelId, post), extra: files?.length ? { f: files } : undefined })
    return typeof r?.reply?.id === 'string' ? r.reply.id : null
  },
  /** `pinned` / `locked` : MANAGE_MESSAGES (le texte passe par `editPost`). */
  updatePost: (serverId: string, channelId: string, postId: string, patch: { pinned?: boolean; locked?: boolean }) =>
    http.patch(base(serverId, channelId) + path`/${postId}`, patch),
  /** Créateur ou MANAGE_MESSAGES. */
  deletePost: (serverId: string, channelId: string, postId: string) => http.delete(base(serverId, channelId) + path`/${postId}`),
  /** Auteur seulement ; même id client que la réponse, ou un nouveau pour une ancienne réponse en clair. */
  editReply: (serverId: string, channelId: string, post: ForumPost, m: ChatMessage, content: string) =>
    sendChannelText(serverId, channelId, content, (body) =>
      http.patch(base(serverId, channelId) + path`/${post.id}/replies/${m.id}`, { ...body, content: body.content ?? '' }),
    { scope: replyScope(channelId, post), clientMsgId: m.clientMsgId ?? Crypto.randomUUID(), edit: true }),
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
