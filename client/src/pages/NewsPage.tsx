// Actualités : articles des flux RSS (relayés par le bot RSSDI), pour tous les comptes.
// « À la une » mêle tous les sites ; les rubriques se replient comme les catégories d'un serveur ;
// recherche plein texte ; repère « Nouveau » depuis la dernière visite (mémorisé sur cet appareil).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ExternalLink, Flame, Newspaper, Search, X } from 'lucide-react'
import api from '../api/client'
import { intlLocale, useT } from '../i18n'
import { clean, key, orderCategories } from './newsOrder'

interface Site { id: string; name: string; category: string; last_title: string | null; last_at: string | null; today: number }
interface Article { id: string; title: string; link: string; summary: string | null; image: string | null; published_at: string; site?: string; site_id?: string; category?: string }
type View = { kind: 'top' } | { kind: 'category'; category: string } | { kind: 'site'; site: Site }

const SEEN_KEY = 'fc_news_seen'
const FOLD_KEY = 'fc_news_folded'
const ORDER_KEY = 'fc_news_order'
const readJson = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d } catch { return d } }
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* réglage de confort */ } }

const when = (iso: string, t: ReturnType<typeof useT>) => {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return t('news.now')
  if (mins < 60) return t('news.minAgo', { n: mins })
  if (mins < 24 * 60) return t('news.hAgo', { n: Math.round(mins / 60) })
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' })
}
const host = (link: string) => { try { return new URL(link).hostname.replace(/^www\./, '') } catch { return '' } }
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

export default function NewsPage() {
  const t = useT()
  const sites = useQuery({ queryKey: ['news'], queryFn: () => api.get<{ sites: Site[] }>('/news').then(r => r.data.sites), refetchInterval: 120_000 })
  const [view, setView] = useState<View>({ kind: 'top' })
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<Record<string, boolean>>(() => readJson(FOLD_KEY, {}))
  const [order, setOrder] = useState<string[]>(() => readJson(ORDER_KEY, []))
  const [dragging, setDragging] = useState<string | null>(null)
  // Dernière visite : les articles plus récents portent « Nouveau » ; la date avance en quittant la page.
  const [seen] = useState<number>(() => readJson(SEEN_KEY, 0))
  useEffect(() => () => writeJson(SEEN_KEY, Date.now()), [])
  useEffect(() => { const h = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(h) }, [search])

  const groups = useMemo(() => {
    const m = new Map<string, Site[]>()
    for (const s of sites.data ?? []) m.set(s.category, [...(m.get(s.category) ?? []), s])
    return orderCategories([...m.keys()], order).map(c => [c, m.get(c)!] as const)
  }, [sites.data, order])
  /** Place la rubrique `cat` à la position `to` et mémorise l'ordre complet. */
  const move = (cat: string, to: number) => {
    const list = groups.map(([c]) => c).filter(c => c !== cat)
    list.splice(Math.max(0, Math.min(to, list.length)), 0, cat)
    const next = list.map(key)
    setOrder(next); writeJson(ORDER_KEY, next)
  }
  const toggle = (cat: string) => { const next = { ...folded, [cat]: !(folded[cat] ?? true) }; setFolded(next); writeJson(FOLD_KEY, next) }
  const isFolded = (cat: string) => folded[cat] ?? true
  const pick = (v: View) => { setView(v); setSearch(''); setQuery('') }

  return (
    <div className="flex h-full min-h-0 bg-fc-chat">
      <aside className="w-64 flex-shrink-0 border-r border-fc-hover overflow-y-auto bg-fc-channel hidden md:flex md:flex-col" aria-label={t('news.sites')}>
        <h1 className="flex items-center gap-2 px-4 h-12 text-white font-semibold border-b border-fc-hover flex-shrink-0"><Newspaper size={18} /> {t('news.title')}</h1>
        <nav className="p-2 space-y-0.5">
          <button onClick={() => pick({ kind: 'top' })} aria-current={view.kind === 'top' ? 'page' : undefined}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm font-medium ${view.kind === 'top' ? 'bg-fc-hover text-white' : 'text-fc-text hover:bg-fc-hover/60'}`}>
            <Flame size={15} className="text-orange-400" /> {t('news.top')}
          </button>
          {groups.map(([cat, list], idx) => {
            const today = list.reduce((n, s) => n + s.today, 0)
            const open = !isFolded(cat)
            return (
              <div key={cat} className={`pt-2 ${dragging && dragging !== cat ? 'rounded' : ''}`}
                onDragOver={e => { if (dragging) e.preventDefault() }}
                onDrop={e => { e.preventDefault(); if (dragging && dragging !== cat) move(dragging, idx); setDragging(null) }}>
                <div className={`flex items-center group ${dragging === cat ? 'opacity-40' : ''}`} draggable
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragging(cat) }} onDragEnd={() => setDragging(null)}
                  title={t('news.reorder')}>
                  <button onClick={() => toggle(cat)} aria-expanded={open}
                    onKeyDown={e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(cat, idx + (e.key === 'ArrowUp' ? -1 : 1)) } }}
                    className="flex-1 flex items-center gap-1 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted hover:text-white">
                    <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                    <span className="truncate">{clean(cat)}</span>
                  </button>
                  <button onClick={() => pick({ kind: 'category', category: cat })} title={t('news.allOf', { name: clean(cat) })}
                    className={`text-[10px] font-bold rounded-full px-1.5 mr-1 ${today ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white'}`}>
                    {today || t('news.all')}
                  </button>
                </div>
                {open && list.map(s => (
                  <button key={s.id} onClick={() => pick({ kind: 'site', site: s })} aria-current={view.kind === 'site' && view.site.id === s.id ? 'page' : undefined}
                    className={`w-full flex items-center justify-between gap-2 pl-5 pr-2 py-1.5 rounded text-sm text-left ${view.kind === 'site' && view.site.id === s.id ? 'bg-fc-hover text-white' : 'text-fc-text hover:bg-fc-hover/60'}`}>
                    <span className="truncate">{s.name}</span>
                    {s.today > 0 && <span className="flex-shrink-0 text-[10px] font-bold text-fc-accent">{s.today}</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-fc-chat/95 backdrop-blur border-b border-fc-hover px-4 h-12 flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fc-muted" aria-hidden />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('news.search')} aria-label={t('news.search')}
              className="w-full pl-8 pr-8 py-1.5 bg-fc-input rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent" />
            {search && <button onClick={() => setSearch('')} aria-label={t('common.clearFilter')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white"><X size={14} /></button>}
          </div>
          {/* Téléphone (web) : rubriques et sites en liste déroulante */}
          <select className="md:hidden bg-fc-input text-white rounded-lg px-2 py-1.5 text-sm max-w-[45%]" aria-label={t('news.sites')}
            value={view.kind === 'site' ? view.site.id : view.kind === 'category' ? `c:${view.category}` : 'top'}
            onChange={e => {
              const v = e.target.value
              if (v === 'top') pick({ kind: 'top' })
              else if (v.startsWith('c:')) pick({ kind: 'category', category: v.slice(2) })
              else { const s = sites.data?.find(x => x.id === v); if (s) pick({ kind: 'site', site: s }) }
            }}>
            <option value="top">{t('news.top')}</option>
            {groups.map(([cat, list]) => (
              <optgroup key={cat} label={clean(cat)}>
                <option value={`c:${cat}`}>{t('news.allOf', { name: clean(cat) })}</option>
                {list.map(s => <option key={s.id} value={s.id}>{s.name}{s.today ? ` (${s.today})` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {sites.isLoading ? <p className="p-6 text-fc-muted text-sm">{t('common.loading')}</p>
          : !sites.data?.length ? <p className="p-6 text-fc-muted text-sm">{t('news.empty')}</p>
          : <Feed key={`${view.kind}:${view.kind === 'site' ? view.site.id : view.kind === 'category' ? view.category : ''}:${query}`} view={view} query={query} seen={seen} onSite={id => { const s = sites.data?.find(x => x.id === id); if (s) pick({ kind: 'site', site: s }) }} />}
      </main>
    </div>
  )
}

function Feed({ view, query, seen, onSite }: { view: View; query: string; seen: number; onSite: (siteId: string) => void }) {
  const t = useT()
  const q = useInfiniteQuery({
    queryKey: ['news', 'feed', view.kind, view.kind === 'site' ? view.site.id : view.kind === 'category' ? view.category : '', query],
    queryFn: ({ pageParam }) => {
      const before = pageParam ? { before: pageParam } : {}
      if (view.kind === 'site' && !query) return api.get<{ articles: Article[] }>('/news/sites/' + view.site.id + '/articles', { params: before }).then(r => r.data.articles)
      return api.get<{ articles: Article[] }>('/news/latest', { params: { ...before, ...(view.kind === 'category' ? { category: view.category } : {}), ...(query ? { q: query } : {}) } }).then(r => r.data.articles)
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last, _all) => (last.length >= 30 ? last[last.length - 1].published_at : undefined),
  })
  const articles = q.data?.pages.flat() ?? []
  const title = query ? t('news.results', { q: query }) : view.kind === 'top' ? t('news.top') : view.kind === 'category' ? clean(view.category) : view.site.name
  const [hero, ...rest] = articles

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
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
  const [broken, setBroken] = useState(false)
  const isNew = seen > 0 && new Date(a.published_at).getTime() > seen
  const label = a.site ?? host(a.link)
  return (
    <article className={`group rounded-xl overflow-hidden bg-fc-channel border border-fc-hover hover:border-fc-accent/60 transition flex ${big ? 'flex-col md:flex-row' : 'flex-col'}`}>
      <a href={a.link} target="_blank" rel="noopener noreferrer nofollow" className={`relative block flex-shrink-0 bg-black ${big ? 'md:w-1/2 aspect-video md:aspect-auto md:min-h-[260px]' : 'aspect-video'}`} tabIndex={-1} aria-hidden>
        {a.image && !broken
          ? <img src={a.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300" />
          : <div className="absolute inset-0 flex items-center justify-center text-4xl font-black text-white/80" style={{ background: `linear-gradient(135deg, hsl(${hue(label)} 55% 30%), hsl(${(hue(label) + 50) % 360} 55% 18%))` }}>{label.charAt(0).toUpperCase()}</div>}
        {isNew && <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide bg-fc-accent text-white rounded px-1.5 py-0.5">{t('news.new')}</span>}
      </a>
      <div className={`flex flex-col gap-2 ${big ? 'p-5 md:p-6 justify-center' : 'p-4'}`}>
        <p className="flex items-center gap-1.5 text-xs text-fc-muted">
          {showSite && a.site_id ? <button onClick={() => onSite(a.site_id!)} className="font-semibold text-fc-accent hover:underline">{label}</button> : <span className="font-semibold">{label}</span>}
          <span aria-hidden>·</span><time dateTime={a.published_at}>{when(a.published_at, t)}</time>
        </p>
        <a href={a.link} target="_blank" rel="noopener noreferrer nofollow" className="block">
          <h3 className={`font-bold text-white group-hover:underline leading-snug ${big ? 'text-xl md:text-2xl' : 'text-base line-clamp-3'}`}>{a.title}</h3>
        </a>
        {a.summary && <p className={`text-sm text-fc-text leading-relaxed whitespace-pre-line ${big ? 'line-clamp-[10]' : 'line-clamp-6'}`}>{a.summary}</p>}
        <a href={a.link} target="_blank" rel="noopener noreferrer nofollow" className="mt-auto inline-flex items-center gap-1 text-xs text-fc-muted hover:text-white">
          {host(a.link)} <ExternalLink size={11} aria-hidden />
        </a>
      </div>
    </article>
  )
}
