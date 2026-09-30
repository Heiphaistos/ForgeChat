import { normalizeSearch, type SearchResults } from '@/features/search/search'
import { http } from '@/lib/http'

export const searchApi = {
  /** Recherche globale (messages des salons, utilisateurs, salons) : GET /search?q=… */
  global: async (q: string, signal?: AbortSignal): Promise<SearchResults> =>
    normalizeSearch(await http.get<unknown>('/search', { query: { q }, signal })),
}
