import { isUuid } from '@/lib/params'

/** Fil de discussion d'un salon (threads.rs::list_threads). */
export interface ThreadSummary {
  id: string
  parentMessageId: string | null
  title: string
  messageCount: number
  unreadCount: number
  archived: boolean
  locked: boolean
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

export function normalizeThreads(raw: unknown): ThreadSummary[] {
  if (!Array.isArray(raw)) return []
  return raw.map(obj).flatMap((r) =>
    isUuid(r.id)
      ? [
          {
            id: r.id.toLowerCase(),
            parentMessageId: isUuid(r.parent_message_id) ? r.parent_message_id.toLowerCase() : null,
            title: typeof r.title === 'string' ? r.title : 'Fil',
            messageCount: num(r.message_count),
            unreadCount: num(r.unread_count),
            archived: r.archived === true,
            locked: r.locked === true,
          },
        ]
      : [],
  )
}

/** Fils indexés par message d'origine (badge sous le message du salon). */
export function threadsByParent(threads: ThreadSummary[]): Map<string, ThreadSummary> {
  const map = new Map<string, ThreadSummary>()
  for (const t of threads) if (t.parentMessageId && !map.has(t.parentMessageId)) map.set(t.parentMessageId, t)
  return map
}

/**
 * Corps de POST …/threads (threads.rs::CreateThreadReq). Titre vide = le serveur prend les
 * 50 premiers caractères du premier message. null si le premier message est vide.
 */
export function createThreadBody(title: string, firstMessage: string, parentMessageId: string | null) {
  const first = firstMessage.trim()
  if (!first) return null
  return { title: title.trim() || undefined, first_message: first, parent_message_id: parentMessageId ?? undefined }
}

/** Curseur de la page suivante (plus ancienne) : id du plus ancien message reçu, si la page était pleine. */
export function olderCursor<T extends { id: string }>(page: T[], pageSize: number): string | undefined {
  return page.length === pageSize ? page[0]?.id : undefined
}
