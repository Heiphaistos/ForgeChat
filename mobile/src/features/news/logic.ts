// Logique pure de la page Actualités (même règles que le web, client/src/pages/newsOrder.ts et news/*) :
// préférences, groupes de rubriques, déplacements, fusion de pages, genres des thèmes 9-10.
import { cleanCategory, newsCategoryKey, orderCategories, type NewsSite } from '@/api/news'

// ─── Préférences (format JSON partagé avec le web : /users/me/news-prefs) ─────────────

export const THEMES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export type ThemeId = (typeof THEMES)[number]
export const DEFAULT_THEME: ThemeId = 10

export interface NewsPrefs {
  /** Thème de navigation ; un numéro inconnu du mobile (thème plus récent du web) est gardé tel quel. */
  theme: number
  /** Épinglées : « c:<clé de rubrique> » ou « s:<id de site> », dans l'ordre choisi. */
  pins: string[]
  /** Ordre des rubriques (clés newsCategoryKey). */
  order: string[]
  /** Sites coupés : ni dans la navigation ni dans les articles. */
  muted: string[]
  /** Groupes (« g:<id> ») et rubriques repliés ou dépliés. */
  folded: Record<string, boolean>
}

// Bornes du web : le tout reste sous les 16 Ko acceptés par le serveur.
const strs = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 120).slice(0, max) : []

export function sanitizePrefs(v: unknown): NewsPrefs {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>
  const th = o.theme
  const theme = typeof th === 'number' && Number.isInteger(th) && th >= 1 && th <= 999 ? th : DEFAULT_THEME
  const folded: Record<string, boolean> = {}
  if (o.folded && typeof o.folded === 'object') {
    for (const [k, b] of Object.entries(o.folded as Record<string, unknown>).slice(0, 80)) if (typeof b === 'boolean' && k.length <= 120) folded[k] = b
  }
  return { theme, pins: strs(o.pins, 60), order: strs(o.order, 80), muted: strs(o.muted, 200), folded }
}

/** Thème affiché : inconnu du mobile → thème par défaut (sans toucher à la valeur enregistrée). */
export const shownTheme = (theme: number): ThemeId => (THEMES as readonly number[]).includes(theme) ? (theme as ThemeId) : DEFAULT_THEME

/** Épingle ou retire une rubrique / un site. */
export const togglePin = (pins: string[], id: string) => (pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id])

/** Déplace un élément au rang `to` d'une liste. */
export function moveItem(list: string[], id: string, to: number): string[] {
  const rest = list.filter((x) => x !== id)
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id)
  return rest
}

// ─── Groupes et rubriques ─────────────────────────────────────────────────────

/** Groupes de navigation (dossiers, onglets, colonnes) : chaque rubrique appartient à un seul. */
export const GROUPS = ['tech', 'societe', 'divert', 'youtube', 'bonsplans', 'autres'] as const
export type GroupId = (typeof GROUPS)[number]
const GROUP_OF: [string, GroupId][] = [
  ['youtube', 'youtube'], ['informatique', 'tech'], ['securite', 'tech'], ['ia', 'tech'],
  ['presse', 'societe'], ['actualite', 'societe'], ['sciences', 'societe'], ['sport', 'societe'],
  ['jeux', 'divert'], ['film', 'divert'], ['serie', 'divert'], ['manga', 'divert'], ['musique', 'divert'],
  ['bon plan', 'bonsplans'],
]
/** Le préfixe `p` désigne-t-il la clé `k` (« ia » seulement en mot entier) ? */
export const keyMatches = (k: string, p: string) => k === p || k.startsWith(p + ' ') || (p.length > 2 && k.startsWith(p))
/** Groupe d'une rubrique ; inconnue : « Autres ». */
export function groupOf(cat: string): GroupId {
  const k = newsCategoryKey(cat)
  return GROUP_OF.find(([p]) => keyMatches(k, p))?.[1] ?? 'autres'
}
/** Nom court dans son groupe : « YouTube · Jeux vidéo » devient « Jeux vidéo ». */
export const shortName = (cat: string) => cleanCategory(cat).replace(/^youtube\s*/i, '') || cleanCategory(cat)
/** Nom hors de son groupe : une rubrique YouTube garde « YouTube · ». */
export const longName = (cat: string) => (groupOf(cat) === 'youtube' ? `YouTube · ${shortName(cat)}` : shortName(cat))

/** Déplace `item` au rang `to` d'un sous-ensemble de `all` ; les rubriques hors sous-ensemble gardent leur place. */
export function moveWithin(all: string[], subset: string[], item: string, to: number): string[] {
  const sub = moveItem(subset, item, to)
  const slots = new Set(subset)
  let i = 0
  return all.map((c) => (slots.has(c) ? sub[i++]! : c))
}

export interface Rubric { cat: string; key: string; short: string; group: GroupId; sites: NewsSite[]; today: number }
export interface Group { id: GroupId; rubrics: Rubric[]; today: number }

const sum = (l: { today: number }[]) => l.reduce((n, x) => n + x.today, 0)

/** Rubriques (sources coupées exclues) dans l'ordre choisi, groupes dans l'ordre de leur première rubrique, sites visibles A-Z. */
export function buildNews(all: NewsSite[], order: string[], muted: string[]): { rubrics: Rubric[]; groups: Group[]; visible: NewsSite[] } {
  const off = new Set(muted)
  const m = new Map<string, NewsSite[]>()
  for (const s of all) if (!off.has(s.id)) m.set(s.category, [...(m.get(s.category) ?? []), s])
  const rubrics: Rubric[] = orderCategories([...m.keys()], order).map((cat) => {
    const sites = m.get(cat) ?? []
    return { cat, key: newsCategoryKey(cat), short: shortName(cat), group: groupOf(cat), sites, today: sum(sites) }
  })
  const gm = new Map<GroupId, Rubric[]>()
  for (const r of rubrics) gm.set(r.group, [...(gm.get(r.group) ?? []), r])
  const groups: Group[] = [...gm].map(([id, rs]) => ({ id, rubrics: rs, today: sum(rs) }))
  const visible = rubrics.flatMap((r) => r.sites).sort((a, b) => a.name.localeCompare(b.name))
  return { rubrics, groups, visible }
}

/** Sources rangées par initiale (A-Z, « # » pour le reste). */
export function byLetter(sites: NewsSite[]): [string, NewsSite[]][] {
  const letters = new Map<string, NewsSite[]>()
  for (const s of sites) {
    const c = s.name.trim().charAt(0).toUpperCase().normalize('NFD').replace(/\p{M}/gu, '')
    const l = /[A-Z]/.test(c) ? c : '#'
    letters.set(l, [...(letters.get(l) ?? []), s])
  }
  return [...letters]
}

// ─── Vues et fil d'articles ───────────────────────────────────────────────────

/** « genre » : plusieurs rubriques lues ensemble (thèmes 9-10 : toutes les rubriques YouTube). */
export type View =
  | { kind: 'top' }
  | { kind: 'category'; category: string }
  | { kind: 'site'; site: NewsSite }
  | { kind: 'genre'; id: string; label: string; categories: string[] }

/** Identifiant stable d'une vue (clé de requête et de composant). */
export const viewId = (v: View) => (v.kind === 'site' ? v.site.id : v.kind === 'category' ? v.category : v.kind === 'genre' ? v.id : '')
/** Rubrique de la vue courante (rubrique ou site), sinon null. */
export const viewCategory = (v: View) => (v.kind === 'category' ? v.category : v.kind === 'site' ? v.site.category : null)

/** Taille d'une page de /news/latest (LIMIT du serveur). */
export const LATEST_PAGE = 40
const time = (a: { published_at: string }) => Date.parse(a.published_at)
/** Fusionne des pages de plusieurs rubriques (le serveur n'en filtre qu'une par requête). On coupe à la fin
 *  la plus récente parmi les pages pleines : plus ancien, un article d'une rubrique passerait avant ceux
 *  qu'une autre n'a pas encore renvoyés ; `next` reprend là. Avec une seule liste : découpage habituel. */
export function mergePages<A extends { id: string; published_at: string }>(lists: A[][], page = LATEST_PAGE): { articles: A[]; next?: string } {
  const ends = lists.filter((l) => l.length >= page).map((l) => l[l.length - 1]!)
  const last = ends.sort((a, b) => time(b) - time(a))[0]
  const ids = new Set<string>()
  const articles = lists
    .flat()
    .filter((a) => (!last || time(a) >= time(last)) && !ids.has(a.id) && !!ids.add(a.id))
    .sort((a, b) => time(b) - time(a))
  return { articles, next: last?.published_at }
}

// ─── Genres (thèmes 9 et 10) ──────────────────────────────────────────────────

/** Genre = une rubrique, sauf YouTube : toutes ses rubriques n'en font qu'un. */
export interface Genre { id: string; label: string; group: GroupId; rubrics: Rubric[]; sites: NewsSite[]; today: number }

export function families(groups: Group[], youtubeLabel: string): { g: Group; list: Genre[] }[] {
  const make = (id: string, label: string, group: GroupId, rubrics: Rubric[]): Genre =>
    ({ id, label, group, rubrics, sites: rubrics.flatMap((r) => r.sites), today: sum(rubrics) })
  return groups.map((g) => ({
    g,
    list: g.id === 'youtube' ? [make('youtube', youtubeLabel, g.id, g.rubrics)] : g.rubrics.map((r) => make(r.key, r.short, g.id, [r])),
  }))
}
export const genreView = (x: Genre): View =>
  x.rubrics.length === 1
    ? { kind: 'category', category: x.rubrics[0]!.cat }
    : { kind: 'genre', id: x.id, label: x.label, categories: x.rubrics.map((r) => r.cat) }
export function genreOfView(v: View, all: Genre[]): Genre | undefined {
  if (v.kind === 'genre') return all.find((x) => x.id === v.id)
  const cat = viewCategory(v)
  return cat === null ? undefined : all.find((x) => x.rubrics.some((r) => r.cat === cat))
}
