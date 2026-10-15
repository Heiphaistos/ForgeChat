import { http, path } from '@/lib/http'

// Contrat serveur : server/src/handlers/tutorials.rs (même que le web).
export interface CategoryRef { slug: string; name: string; icon?: string }
export interface Group { key: string; label: string; count: number }
export interface Category extends CategoryRef { count: number; groups: Group[] }
export interface Tutorial {
  slug: string
  title: string
  description: string
  category: CategoryRef
  group: string | null
  tags: string[]
  video_url: string
  thumbnail_url?: string | null
  created_at: string
  content_html?: string
}
export interface TutorialPage { items: Tutorial[]; total: number; page: number; per_page: number }

export const PER_PAGE = 24

const qs = (o: Record<string, string | number>) =>
  Object.entries(o).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

export const tutorialsApi = {
  catalog: () => http.get<{ categories: Category[] }>('/tutorials/catalog').then((r) => r.categories),
  list: (o: { category: string; group: string; q: string; page: number }) =>
    http.get<TutorialPage>(`/tutorials?${qs({ ...o, per_page: PER_PAGE })}`),
  one: (slug: string) => http.get<Tutorial>(path`/tutorials/${slug}`),
}

/** Page suivante d'une liste paginée, ou undefined à la fin. */
export const nextPage = (l: Pick<TutorialPage, 'page' | 'per_page' | 'total'>) => (l.page * l.per_page < l.total ? l.page + 1 : undefined)

/** Teinte stable d'une catégorie (même formule que le web : dégradé des cartes). */
export const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
export const tintColors = (s: string): [string, string] => [`hsl(${hueOf(s)}, 55%, 36%)`, `hsl(${(hueOf(s) + 45) % 360}, 55%, 22%)`]

type IconName = 'logo-android' | 'terminal-outline' | 'logo-discord' | 'logo-tux' | 'cube-outline' | 'code-slash-outline' | 'git-network-outline' | 'shield-checkmark-outline' | 'logo-windows' | 'logo-apple' | 'apps-outline' | 'flame-outline' | 'book-outline'
const ICONS: [RegExp, IconName][] = [
  [/heiphaistos/, 'flame-outline'], [/android/, 'logo-android'], [/cmd|powershell|shell/, 'terminal-outline'], [/discord/, 'logo-discord'],
  [/linux/, 'logo-tux'], [/logiciel/, 'cube-outline'], [/programmation|dev|code/, 'code-slash-outline'], [/r[eé]seau|network/, 'git-network-outline'],
  [/s[eé]curit/, 'shield-checkmark-outline'], [/windows/, 'logo-windows'], [/mac/, 'logo-apple'], [/application|app/, 'apps-outline'],
]
export const categoryIcon = (slug: string): IconName => ICONS.find(([re]) => re.test(slug.toLowerCase()))?.[1] ?? 'book-outline'
