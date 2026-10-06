import { isUuid } from '@/lib/params'

/** Publication d'un salon forum (forum.rs::list_posts / get_post). */
export interface ForumPost {
  id: string
  title: string
  content: string | null
  creatorName: string
  creatorAvatar: string | null
  tags: string[]
  pinned: boolean
  locked: boolean
  replyCount: number
  lastActivity: string
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export function normalizePost(raw: unknown): ForumPost | null {
  const r = obj(raw)
  const createdAt = str(r.created_at)
  if (!isUuid(r.id) || typeof r.title !== 'string' || !createdAt) return null
  return {
    id: r.id.toLowerCase(),
    title: r.title,
    content: str(r.content),
    creatorName: str(r.creator_username) ?? 'Inconnu',
    creatorAvatar: str(r.creator_avatar),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    pinned: r.pinned === true,
    locked: r.locked === true,
    replyCount: typeof r.reply_count === 'number' && r.reply_count > 0 ? r.reply_count : 0,
    lastActivity: str(r.last_reply_at) ?? createdAt,
  }
}

export const normalizePosts = (raw: unknown): ForumPost[] => (Array.isArray(raw) ? raw.flatMap((p) => normalizePost(p) ?? []) : [])

export const MAX_TAGS = 5

/** Tag saisi librement, mis en forme comme le web (CreatePostModal) : minuscules, espaces → tirets. */
export const normalizeTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, '-')

/** Ajoute ou retire un tag (5 au plus, sans doublon). */
export function toggleTag(tags: string[], tag: string): string[] {
  const t = normalizeTag(tag)
  if (!t) return tags
  if (tags.includes(t)) return tags.filter((x) => x !== t)
  return tags.length < MAX_TAGS ? [...tags, t] : tags
}

/**
 * Corps de POST …/posts (forum.rs::CreatePostReq) ; null si le titre est vide ou dépasse 200
 * caractères. Contenu vide omis (titre seul accepté). Les tags officiels du salon sont imposés par le
 * serveur quand il en existe.
 */
export function createPostBody(title: string, content: string, tags: string[]) {
  const t = title.trim()
  if (!t || [...t].length > 200) return null
  return { title: t, content: content.trim() || undefined, tags }
}

/** Curseur de la page suivante de publications : dernier reçu, si la page était pleine. */
export const nextPostsCursor = (page: ForumPost[], pageSize: number) => (page.length === pageSize ? page[page.length - 1]?.id : undefined)
