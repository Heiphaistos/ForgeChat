import { http, path } from '@/lib/http'

/** Site d'actualité public (flux RSS relayé par le bot RSSDI). */
export interface NewsSite { id: string; name: string; category: string; last_title: string | null; last_at: string | null; today: number }
export interface NewsArticle { id: string; title: string; link: string; summary: string | null; image: string | null; published_at: string }

export const newsApi = {
  sites: () => http.get<{ sites: NewsSite[] }>('/news').then((r) => r.sites),
  articles: (siteId: string, before?: string) =>
    http.get<{ articles: NewsArticle[] }>(path`/news/sites/${siteId}/articles` + (before ? `?before=${encodeURIComponent(before)}` : '')).then((r) => r.articles),
}

/** Rubrique affichée : sans les décorations des noms de forum (⭒, emoji, lettres en gras Unicode). */
export const cleanCategory = (s: string) =>
  s.normalize('NFKC').replace(/[⭒•·]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/-/g, ' ').trim()
