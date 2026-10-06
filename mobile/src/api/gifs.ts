import { http } from '@/lib/http'

/**
 * GIF par le serveur (routes /api/gifs/*, patch serveur « GIF via KLIPY ») : la clé API reste sur
 * le serveur, l'app ne contacte jamais l'API KLIPY directement. Réponses brutes, validées par
 * features/composer/gifs.ts.
 */
export const gifsApi = {
  status: () => http.get<unknown>('/gifs/status'),
  search: (q: string, pos?: string, signal?: AbortSignal) => http.get<unknown>('/gifs/search', { query: { q, pos }, signal }),
  trending: (pos?: string, signal?: AbortSignal) => http.get<unknown>('/gifs/trending', { query: { pos }, signal }),
}
