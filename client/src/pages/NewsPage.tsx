// Actualités : articles des flux RSS (relayés par le bot RSSDI), pour tous les comptes.
// « À la une » mêle tous les sites ; la navigation par rubriques suit l'un des 10 thèmes au choix de
// chaque compte (molette à côté du titre) ; recherche plein texte ; repère « Nouveau » depuis la
// dernière visite (mémorisé sur cet appareil). Les cartes d'articles sont les mêmes pour tous les thèmes.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, ListTree, Newspaper, Search, Settings2, X } from 'lucide-react'
import api from '../api/client'
import { safeHref } from '../utils/safeUrl'
import { intlLocale, useT } from '../i18n'
import { clean, groupOf, key, mergePages, moveWithin, orderCategories, short, type GroupId } from './newsOrder'
import { hue, viewId, type Group, type Nav, type Rubric, type Site, type View } from './news/shared'
import { useNewsPrefs, type ThemeId } from './news/useNewsPrefs'
import NewsSettings from './news/NewsSettings'
import Theme1Sidebar from './news/Theme1Sidebar'
import Theme2Chips from './news/Theme2Chips'
import Theme3Tiles from './news/Theme3Tiles'
import Theme4Tabs from './news/Theme4Tabs'
import Theme5Rail from './news/Theme5Rail'
import Theme6Pins from './news/Theme6Pins'
import Theme7Mega from './news/Theme7Mega'
import Theme8Tabs from './news/Theme8Tabs'
import Theme9Columns from './news/Theme9Columns'
import { useProxiedImage } from '../hooks/useProxiedImage'

interface Article { id: string; title: string; link: string; summary: string | null; image: string | null; published_at: string; site?: string; site_id?: string; category?: string }

const SEEN_KEY = 'fc_news_seen'
const readJson = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d } catch { return d } }
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* réglage de confort */ } }

/** Thèmes en colonne latérale (bureau) / feuille du bas (téléphone) ; les autres se placent sous la barre. */
const ASIDE: Partial<Record<ThemeId, { C: ComponentType<{ nav: Nav }>; w: string }>> = {
  1: { C: Theme1Sidebar, w: 'w-64' }, 5: { C: Theme5Rail, w: 'w-80' }, 6: { C: Theme6Pins, w: 'w-72' }, 8: { C: Theme8Tabs, w: 'w-72' },
}

const when = (iso: string, t: ReturnType<typeof useT>) => {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return t('news.now')
  if (mins < 60) return t('news.minAgo', { n: mins })
  if (mins < 24 * 60) return t('news.hAgo', { n: Math.round(mins / 60) })
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' })
}
const host = (link: string) => { try { return new URL(link).hostname.replace(/^www\./, '') } catch { return '' } }

export default function NewsPage() {
  const t = useT()
  const sites = useQuery({ queryKey: ['news'], queryFn: () => api.get<{ sites: Site[] }>('/news').then(r => r.data.sites), refetchInterval: 120_000 })
  const [prefs, update] = useNewsPrefs()
  const [view, setView] = useState<View>({ kind: 'top' })
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState(false)
  const [settings, setSettings] = useState<{ section?: 'order' | 'sources' } | null>(null)
  // Dernière visite : les articles plus récents portent « Nouveau » ; la date avance en quittant la page.
  const [seen] = useState<number>(() => readJson(SEEN_KEY, 0))
  useEffect(() => () => writeJson(SEEN_KEY, Date.now()), [])
  useEffect(() => { const h = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(h) }, [search])

  const muted = useMemo(() => new Set(prefs.muted), [prefs.muted])
  const { rubrics, groups, visible } = useMemo(() => {
    const m = new Map<string, Site[]>()
    for (const s of sites.data ?? []) if (!muted.has(s.id)) m.set(s.category, [...(m.get(s.category) ?? []), s])
    const sum = (l: { today: number }[]) => l.reduce((n, x) => n + x.today, 0)
    const rubrics: Rubric[] = orderCategories([...m.keys()], prefs.order)
      .map(cat => ({ cat, key: key(cat), short: short(cat), group: groupOf(cat), sites: m.get(cat) ?? [], today: sum(m.get(cat) ?? []) }))
    // Groupes dans l'ordre de leur première rubrique : réordonner les rubriques range aussi les groupes.
    const gm = new Map<GroupId, Rubric[]>()
    for (const r of rubrics) gm.set(r.group, [...(gm.get(r.group) ?? []), r])
    const groups: Group[] = [...gm].map(([id, rs]) => ({ id, rubrics: rs, today: sum(rs) }))
    const visible = rubrics.flatMap(r => r.sites).sort((a, b) => a.name.localeCompare(b.name))
    return { rubrics, groups, visible }
  }, [sites.data, muted, prefs.order])

  const pick = useCallback((v: View) => { setView(v); setSearch(''); setQuery(''); setSheet(false) }, [])
  const closeSettings = useCallback(() => setSettings(null), [])
  const isFolded = (id: string, dflt: boolean) => prefs.folded[id] ?? dflt
  const nav: Nav = {
    t, rubrics, groups, sites: visible, view, pick, prefs, update, seen, isFolded,
    move: (subset, cat, to) => update({ order: moveWithin(rubrics.map(r => r.cat), subset, cat, to).map(key) }),
    toggleFold: (id, dflt) => update({ folded: { ...prefs.folded, [id]: !isFolded(id, dflt) } }),
    openSettings: section => { setSheet(false); setSettings({ section }) },
  }
  useEffect(() => {
    if (!sheet) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [sheet])

  const A = ASIDE[prefs.theme]
  const ready = !!sites.data?.length
  const title = (
    <div className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
      <h1 className="flex items-center gap-2 text-white font-semibold truncate"><Newspaper size={18} className="flex-shrink-0" /> {t('news.title')}</h1>
      <button onClick={() => setSettings({})} aria-label={t('news.customize')} title={t('news.customize')}
        className="p-1 rounded-md text-fc-muted hover:text-white hover:bg-fc-hover flex-shrink-0"><Settings2 size={16} /></button>
    </div>
  )

  const cols = prefs.theme === 9 || prefs.theme === 10
  // Thèmes 9-10 : `lead` remplace le titre dans la barre (bouton retour du téléphone) et les cartes prennent toute la largeur.
  const main = (lead?: ReactNode) => (
    <main className="flex-1 min-w-0 overflow-y-auto">
      <div className="sticky top-0 z-30 bg-fc-chat border-b border-fc-hover px-4 h-12 flex items-center gap-3">
        {cols ? lead : <div className={A ? 'md:hidden' : ''}>{title}</div>}
        {prefs.theme === 7 && ready && <Theme7Mega nav={nav} />}
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fc-muted" aria-hidden />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('news.search')} aria-label={t('news.search')}
            className="w-full pl-8 pr-8 py-1.5 bg-fc-input rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent" />
          {search && <button onClick={() => setSearch('')} aria-label={t('common.clearFilter')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white"><X size={14} /></button>}
        </div>
        {/* Téléphone : la colonne du thème s'ouvre en feuille depuis le bas. */}
        {A && ready && (
          <button onClick={() => setSheet(true)} aria-label={t('news.rubrics')} title={t('news.rubrics')}
            className="md:hidden flex-shrink-0 p-1.5 rounded-lg bg-fc-hover text-white"><ListTree size={16} /></button>
        )}
      </div>
      {ready && prefs.theme === 2 && <Theme2Chips nav={nav} />}
      {ready && prefs.theme === 4 && <Theme4Tabs nav={nav} />}
      {ready && prefs.theme === 3 && !query && <Theme3Tiles nav={nav} />}
      {sites.isLoading ? <p className="p-6 text-fc-muted text-sm">{t('common.loading')}</p>
        : !ready ? <p className="p-6 text-fc-muted text-sm">{t('news.empty')}</p>
        : <Feed key={`${view.kind}:${viewId(view)}:${query}`} view={view} query={query} seen={seen} muted={muted} wide={cols} onSite={id => { const s = sites.data?.find(x => x.id === id); if (s) pick({ kind: 'site', site: s }) }} />}
    </main>
  )

  return (
    <div className="flex h-full min-h-0 bg-fc-chat">
      {A && (
        <aside className={`${A.w} flex-shrink-0 border-r border-fc-hover bg-fc-channel hidden md:flex md:flex-col min-h-0`} aria-label={t('news.sites')}>
          <div className="flex items-center px-4 h-12 border-b border-fc-hover flex-shrink-0">{title}</div>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{ready && <A.C nav={nav} />}</div>
        </aside>
      )}
      {cols && ready ? <Theme9Columns nav={nav} compact={prefs.theme === 10} title={title} main={main} /> : main()}

      {sheet && A && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end md:hidden" role="dialog" aria-modal="true" aria-label={t('news.rubrics')}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setSheet(false)} aria-hidden />
          <div className={`relative w-full flex flex-col bg-fc-channel border-t border-fc-hover rounded-t-2xl shadow-2xl ${prefs.theme === 5 ? 'h-[80vh]' : 'max-h-[85vh]'}`}>
            <button onClick={() => setSheet(false)} aria-label={t('news.close')} className="flex-shrink-0 py-2"><span className="block mx-auto w-10 h-1 rounded-full bg-fc-hover" /></button>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col"><A.C nav={nav} /></div>
          </div>
        </div>,
        document.body,
      )}
      {settings && <NewsSettings nav={nav} all={sites.data ?? []} section={settings.section} onClose={closeSettings} />}
    </div>
  )
}

function Feed({ view, query, seen, muted, wide, onSite }: { view: View; query: string; seen: number; muted: Set<string>; wide?: boolean; onSite: (siteId: string) => void }) {
  const t = useT()
  const q = useInfiniteQuery({
    queryKey: ['news', 'feed', view.kind, viewId(view), query],
    queryFn: async ({ pageParam }) => {
      const get = (url: string, params: Record<string, string>) =>
        api.get<{ articles: Article[] }>(url, { params: { ...(pageParam ? { before: pageParam } : {}), ...params } }).then(r => r.data.articles)
      if (view.kind === 'site' && !query) return mergePages([await get('/news/sites/' + view.site.id + '/articles', {})])
      const cats = view.kind === 'category' ? [view.category] : view.kind === 'genre' ? view.categories : [null]
      return mergePages(await Promise.all(cats.map(c => get('/news/latest', { ...(c ? { category: c } : {}), ...(query ? { q: query } : {}) }))))
    },
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next,
  })
  const articles = (q.data?.pages.flatMap(p => p.articles) ?? []).filter(a => !a.site_id || !muted.has(a.site_id))
  const title = query ? t('news.results', { q: query }) : view.kind === 'top' ? t('news.top') : view.kind === 'category' ? clean(view.category) : view.kind === 'genre' ? view.label : view.site.name
  const [hero, ...rest] = articles

  return (
    <div className={`${wide ? '' : 'max-w-6xl mx-auto'} p-4 md:p-6 space-y-5`}>
      <header className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {view.kind === 'site' && <span className="text-sm text-fc-muted">{clean(view.site.category)}</span>}
      </header>
      {q.isLoading && <p className="text-fc-muted text-sm">{t('common.loading')}</p>}
      {!q.isLoading && !articles.length && <p className="text-fc-muted text-sm">{query ? t('news.noResult') : t('news.empty')}</p>}
      {hero && <Card a={hero} seen={seen} big showSite={view.kind !== 'site'} onSite={onSite} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rest.map(a => <Card key={a.id} a={a} seen={seen} showSite={view.kind !== 'site'} onSite={onSite} />)}
      </div>
      {q.hasNextPage && (
        <button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full py-2.5 rounded-lg bg-fc-hover text-sm text-fc-text hover:text-white">
          {q.isFetchingNextPage ? t('common.loading') : t('news.more')}
        </button>
      )}
    </div>
  )
}

function Card({ a, seen, big, showSite, onSite }: { a: Article; seen: number; big?: boolean; showSite: boolean; onSite: (id: string) => void }) {
  const t = useT()
  // Image via le proxy du serveur : ni fuite de l'IP du lecteur vers le site, ni `img-src https:` dans la CSP.
  const image = useProxiedImage(a.image)
  const isNew = seen > 0 && new Date(a.published_at).getTime() > seen
  const label = a.site ?? host(a.link)
  return (
    <article className={`group rounded-xl overflow-hidden bg-fc-channel border border-fc-hover hover:border-fc-accent/60 transition flex ${big ? 'flex-col md:flex-row' : 'flex-col'}`}>
      <a href={safeHref(a.link)} target="_blank" rel="noopener noreferrer nofollow" className={`relative block flex-shrink-0 bg-black ${big ? 'md:w-1/2 aspect-video md:aspect-auto md:min-h-[260px]' : 'aspect-video'}`} tabIndex={-1} aria-hidden>
        {image
          ? <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
          : <div className="absolute inset-0 flex items-center justify-center text-4xl font-black text-white/80" style={{ background: `linear-gradient(135deg, hsl(${hue(label)} 55% 30%), hsl(${(hue(label) + 50) % 360} 55% 18%))` }}>{label.charAt(0).toUpperCase()}</div>}
        {isNew && <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide bg-fc-accent text-white rounded px-1.5 py-0.5">{t('news.new')}</span>}
      </a>
      <div className={`flex flex-col gap-2 ${big ? 'p-5 md:p-6 justify-center' : 'p-4'}`}>
        <p className="flex items-center gap-1.5 text-xs text-fc-muted">
          {showSite && a.site_id ? <button onClick={() => onSite(a.site_id!)} className="font-semibold text-fc-accent hover:underline">{label}</button> : <span className="font-semibold">{label}</span>}
          <span aria-hidden>·</span><time dateTime={a.published_at}>{when(a.published_at, t)}</time>
        </p>
        <a href={safeHref(a.link)} target="_blank" rel="noopener noreferrer nofollow" className="block">
          <h3 className={`font-bold text-white group-hover:underline leading-snug ${big ? 'text-xl md:text-2xl' : 'text-base line-clamp-3'}`}>{a.title}</h3>
        </a>
        {a.summary && <p className={`text-sm text-fc-text leading-relaxed whitespace-pre-line ${big ? 'line-clamp-[10]' : 'line-clamp-6'}`}>{a.summary}</p>}
        <a href={safeHref(a.link)} target="_blank" rel="noopener noreferrer nofollow" className="mt-auto inline-flex items-center gap-1 text-xs text-fc-muted hover:text-white">
          {host(a.link)} <ExternalLink size={11} aria-hidden />
        </a>
      </div>
    </article>
  )
}
