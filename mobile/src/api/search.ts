import { normalizeSearch, searchScope, type SearchResults } from '@/features/search/search'
import { http } from '@/lib/http'
import type { ConversationRef } from '@/types/models'

export const searchApi = {
  /**
   * GET /search?q=… : partout (messages des salons, DM et groupes, personnes, salons), ou seulement
   * les messages d'une conversation quand `scope` est donné.
   */
  /** `where` (sans conversation) : tous les MP et groupes, ou tous les salons de serveur (search.rs). */
  global: async (q: string, signal?: AbortSignal, scope: ConversationRef | null = null, where: 'all' | 'dms' | 'servers' = 'all'): Promise<SearchResults> =>
    normalizeSearch(await http.get<unknown>('/search', { query: { q, ...searchScope(scope), ...(scope ? { limit: 50 } : where !== 'all' ? { scope: where } : {}) }, signal })),
}
