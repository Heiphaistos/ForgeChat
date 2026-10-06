import type { ConversationSummary } from '@/types/models'

export const conversationName = (c: ConversationSummary) => (c.is_group ? c.name : c.username)

/**
 * Conversations affichées : recherche sur le nom ; les archivées sont masquées, sauf dans la
 * vue « archivées ». `archivedCount` compte les archivées correspondant à la recherche.
 */
export function filterConversations(
  list: readonly ConversationSummary[],
  search: string,
  showArchived: boolean,
): { items: ConversationSummary[]; archivedCount: number } {
  const needle = search.trim().toLocaleLowerCase()
  const matching = needle ? list.filter((c) => conversationName(c).toLocaleLowerCase().includes(needle)) : [...list]
  const archived = matching.filter((c) => c.is_archived)
  return { items: showArchived ? archived : matching.filter((c) => !c.is_archived), archivedCount: archived.length }
}

/** Applique localement un réglage (mise à jour optimiste de la liste). */
export function applyConversationSettings(
  list: readonly ConversationSummary[],
  id: string,
  patch: { muted?: boolean; archived?: boolean },
): ConversationSummary[] {
  return list.map((c) =>
    c.id !== id
      ? c
      : { ...c, ...(patch.muted !== undefined && { is_muted: patch.muted }), ...(patch.archived !== undefined && { is_archived: patch.archived }) },
  )
}
