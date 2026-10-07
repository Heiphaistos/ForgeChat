import { isUuid } from '@/lib/params'

/** Fil de discussion d'un salon (threads.rs::list_threads). */
export interface ThreadSummary {
  id: string
  parentMessageId: string | null
  title: string
  /** Créateur : peut archiver son fil (verrouiller demande MANAGE_MESSAGES). */
  creatorId: string | null
  messageCount: number
  unreadCount: number
  archived: boolean
  locked: boolean
  /** Id tiré par l'appli à la création : portée AAD du titre et des messages (threadScope). */
  clientId: string | null
  /** Titre chiffré (déchiffré par e2e/channels.openThreadTitle) : pas de renommage en clair. */
  titleEncrypted: boolean
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
            creatorId: isUuid(r.creator_id) ? r.creator_id.toLowerCase() : null,
            messageCount: num(r.message_count),
            unreadCount: num(r.unread_count),
            archived: r.archived === true,
            locked: r.locked === true,
            clientId: isUuid(r.client_id) ? r.client_id.toLowerCase() : null,
            titleEncrypted: r.title_encrypted === true,
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

/**
 * Réponse avec pièces jointes (fil ou forum) : le message est créé, puis les fichiers y sont joints.
 * Échec de l'envoi des fichiers d'un message sans texte : le message vide est supprimé.
 */
export async function sendWithAttachments<F>(
  text: string,
  files: F[],
  create: (hasAttachments: boolean) => Promise<string | null>,
  upload: (messageId: string, files: F[]) => Promise<unknown>,
  remove: (messageId: string) => Promise<unknown>,
): Promise<void> {
  const id = await create(files.length > 0)
  if (!id || !files.length) return
  try {
    await upload(id, files)
  } catch (e) {
    if (!text.trim()) await remove(id).catch(() => undefined)
    throw e
  }
}
