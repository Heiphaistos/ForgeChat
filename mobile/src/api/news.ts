import { http, path } from '@/lib/http'

/** Site d'actualité public (flux RSS relayé par le bot RSSDI). */
export interface NewsSite { id: string; name: string; category: string; last_title: string | null; last_at: string | null; today: number }
export interface NewsArticle { id: string; title: string; link: string; summary: string | null; image: string | null; published_at: string }

export const newsApi = {
  sites: () => http.get<{ sites: NewsSite[] }>('/news').then((r) => r.sites),
  /** « À la une » : derniers articles de tous les sites publics, filtrables par rubrique et par texte. */
  latest: (o: { category?: string; q?: string; before?: string } = {}) => {
    const qs = Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&')
    return http.get<{ articles: (NewsArticle & { site: string; site_id: string; category: string })[] }>('/news/latest' + (qs ? `?${qs}` : '')).then((r) => r.articles)
  },
  articles: (siteId: string, before?: string) =>
    http.get<{ articles: NewsArticle[] }>(path`/news/sites/${siteId}/articles` + (before ? `?before=${encodeURIComponent(before)}` : '')).then((r) => r.articles),
}

/** Rubrique affichée : sans les décorations des noms de forum (⭒, emoji, lettres en gras Unicode). */
export const cleanCategory = (s: string) =>
  s.normalize('NFKC').replace(/[⭒•·]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/-/g, ' ').trim()

/** Ordre par défaut des rubriques, par familles (Tech, Société, Divertissement, YouTube, bons plans). */
const DEFAULT_ORDER = ['informatique', 'securite', 'ia', 'presse', 'actualite', 'sciences', 'sport', 'jeux', 'film', 'serie', 'manga', 'musique', 'youtube', 'bon plan']
export const newsCategoryKey = (s: string) => cleanCategory(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
/** Rubriques dans l'ordre choisi par l'utilisateur, puis les autres dans l'ordre par défaut (même règle que le web). */
export function orderCategories(cats: string[], saved: string[]): string[] {
  const rank = (c: string) => {
    const i = saved.indexOf(newsCategoryKey(c))
    if (i >= 0) return i
    const d = DEFAULT_ORDER.findIndex((p) => newsCategoryKey(c).startsWith(p))
    return 1000 + (d >= 0 ? d : DEFAULT_ORDER.length)
  }
  return [...cats].sort((a, b) => rank(a) - rank(b) || cleanCategory(a).localeCompare(cleanCategory(b)))
}
