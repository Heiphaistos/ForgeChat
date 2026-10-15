// Tutoriels vidéo : catégories (Android, Linux, Windows…) puis sous-catégories distribution / version,
// recherche, cartes et « Voir plus ». Filtres dans l'adresse (?category=&group=&q=) pour le bouton retour.
// Contrat : GET /tutorials/catalog et GET /tutorials (voir pages/tutorials/shared.tsx).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { GraduationCap, ListTree, Play, Search, X } from 'lucide-react'
import api from '../api/client'
import { useT } from '../i18n'
import { categoryIcon, tint, type Category, type Tutorial, type TutorialPage } from './tutorials/shared'

const PER_PAGE = 24
const chip = (on: boolean) =>
  `flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm border whitespace-nowrap ${on ? 'border-fc-accent bg-fc-accent/15 text-white' : 'border-fc-hover bg-fc-channel text-fc-text hover:text-white'}`
const rowCls = (on: boolean) => `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${on ? 'bg-fc-accent/15 text-white font-semibold' : 'text-fc-text hover:bg-fc-hover hover:text-white'}`
const subCls = (on: boolean) => `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition ${on ? 'bg-fc-accent/15 text-white font-semibold' : 'text-fc-text hover:bg-fc-hover hover:text-white'}`

export default function TutorialsPage() {
  const t = useT()
  const [sp, setSp] = useSearchParams()
  const category = sp.get('category') ?? ''
  const group = sp.get('group') ?? ''
  const urlQ = sp.get('q') ?? ''
  const [search, setSearch] = useState(urlQ)
  const [sheet, setSheet] = useState(false)
  useEffect(() => setSearch(urlQ), [urlQ])

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setSp(next)
  }
  useEffect(() => {
    const h = setTimeout(() => { if (search.trim() !== urlQ) set({ q: search.trim() }) }, 300)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `set` dépend de sp, on ne relance que sur la saisie
  }, [search])

  const catalog = useQuery({ queryKey: ['tutorials', 'catalog'], queryFn: () => api.get<{ categories: Category[] }>('/tutorials/catalog').then(r => r.data.categories), staleTime: 300_000 })
  const cats = catalog.data ?? []
  const current = cats.find(c => c.slug === category)
  const total = cats.reduce((n, c) => n + c.count, 0)

  const list = useInfiniteQuery({
    queryKey: ['tutorials', 'list', category, group, urlQ],
    queryFn: ({ pageParam }) => api.get<TutorialPage>('/tutorials', { params: { category, group, q: urlQ, page: pageParam, per_page: PER_PAGE } }).then(r => r.data),
    initialPageParam: 1,
    getNextPageParam: l => (l.page * l.per_page < l.total ? l.page + 1 : undefined),
  })
  const items = list.data?.pages.flatMap(p => p.items) ?? []
  const shown = list.data?.pages[0]?.total ?? 0
  const heading = urlQ ? t('tuto.results', { q: urlQ }) : current ? current.name : t('tuto.all')
  const count = (n: number) => (n === 1 ? t('tuto.countOne') : t('tuto.count', { n }))

  useEffect(() => {
    if (!sheet) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [sheet])

  const pickCat = (slug: string, g = '') => { set({ category: slug, group: g }); setSheet(false) }
  const filters = (
    <nav aria-label={t('tuto.categories')} className="p-2 space-y-0.5">
      <button onClick={() => pickCat('')} className={rowCls(!category)}><GraduationCap size={16} aria-hidden /><span className="flex-1 text-left truncate">{t('tuto.all')}</span><span className="text-xs text-fc-muted">{total}</span></button>
      {cats.map(c => {
        const Icon = categoryIcon(c.slug)
        const on = c.slug === category
        return (
          <div key={c.slug}>
            <button onClick={() => pickCat(c.slug)} aria-current={on && !group ? 'true' : undefined} className={rowCls(on)}>
              <Icon size={16} aria-hidden /><span className="flex-1 text-left truncate">{c.name}</span><span className="text-xs text-fc-muted">{c.count}</span>
            </button>
            {on && c.groups.length > 0 && (
              <div className="ml-4 pl-2 border-l border-fc-hover my-0.5 space-y-0.5">
                <button onClick={() => pickCat(c.slug)} className={subCls(!group)}><span className="flex-1 text-left truncate">{t('tuto.allVersions')}</span></button>
                {c.groups.map(g => (
                  <button key={g.key} onClick={() => pickCat(c.slug, g.key)} aria-current={group === g.key ? 'true' : undefined} className={subCls(group === g.key)}>
                    <span className="flex-1 text-left truncate">{g.label}</span><span className="text-xs text-fc-muted">{g.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="flex h-full min-h-0 bg-fc-chat">
      <aside className="w-64 flex-shrink-0 border-r border-fc-hover bg-fc-channel hidden md:flex md:flex-col min-h-0" aria-label={t('tuto.categories')}>
        <div className="flex items-center gap-2 px-4 h-12 border-b border-fc-hover flex-shrink-0 text-white font-semibold"><GraduationCap size={18} aria-hidden /> {t('tuto.title')}</div>
        <div className="flex-1 min-h-0 overflow-y-auto">{filters}</div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-30 bg-fc-chat border-b border-fc-hover px-4 h-12 flex items-center gap-3">
          <h1 className="md:hidden flex items-center gap-2 text-white font-semibold flex-shrink-0"><GraduationCap size={18} aria-hidden /> {t('tuto.title')}</h1>
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fc-muted" aria-hidden />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('tuto.search')} aria-label={t('tuto.search')}
              className="w-full pl-8 pr-8 py-1.5 bg-fc-input rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent" />
            {search && <button onClick={() => setSearch('')} aria-label={t('common.clearFilter')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white"><X size={14} /></button>}
          </div>
          <button onClick={() => setSheet(true)} aria-label={t('tuto.filters')} title={t('tuto.filters')} className="md:hidden flex-shrink-0 p-1.5 rounded-lg bg-fc-hover text-white"><ListTree size={16} /></button>
        </div>

        {/* Téléphone : catégories puis versions en pastilles défilantes */}
        <div className="md:hidden px-4 pt-3 space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => pickCat('')} className={chip(!category)}>{t('tuto.all')}</button>
            {cats.map(c => <button key={c.slug} onClick={() => pickCat(c.slug)} className={chip(c.slug === category)}>{c.name}</button>)}
          </div>
          {current && current.groups.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button onClick={() => pickCat(current.slug)} className={chip(!group)}>{t('tuto.allVersions')}</button>
              {current.groups.map(g => <button key={g.key} onClick={() => pickCat(current.slug, g.key)} className={chip(group === g.key)}>{g.label}</button>)}
            </div>
          )}
        </div>

        <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
          <header>
            <h2 className="text-2xl font-bold text-white">{heading}{group && !urlQ && <span className="text-fc-muted font-semibold"> · {current?.groups.find(g => g.key === group)?.label ?? group}</span>}</h2>
            <p className="text-sm text-fc-muted mt-1">{list.isSuccess ? count(shown) : t('tuto.intro')}</p>
          </header>
          {list.isLoading && <p className="text-fc-muted text-sm">{t('common.loading')}</p>}
          {list.isError && <p className="text-sm text-fc-muted">{t('tuto.error')} <button onClick={() => void list.refetch()} className="text-fc-accent hover:underline">{t('tuto.retry')}</button></p>}
          {list.isSuccess && !items.length && <p className="text-fc-muted text-sm">{urlQ ? t('tuto.noResult') : t('tuto.empty')}</p>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map(tu => <Card key={tu.slug} tu={tu} />)}</div>
          {list.hasNextPage && (
            <button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="w-full py-2.5 rounded-lg bg-fc-hover text-sm text-fc-text hover:text-white">
              {list.isFetchingNextPage ? t('common.loading') : t('tuto.more')}
            </button>
          )}
        </div>
      </main>

      {sheet && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end md:hidden" role="dialog" aria-modal="true" aria-label={t('tuto.filters')}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setSheet(false)} aria-hidden />
          <div className="relative w-full flex flex-col bg-fc-channel border-t border-fc-hover rounded-t-2xl shadow-2xl max-h-[85vh]">
            <button onClick={() => setSheet(false)} aria-label={t('tuto.close')} className="flex-shrink-0 py-2"><span className="block mx-auto w-10 h-1 rounded-full bg-fc-hover" /></button>
            <div className="flex-1 min-h-0 overflow-y-auto">{filters}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function Card({ tu }: { tu: Tutorial }) {
  const Icon = categoryIcon(tu.category.slug)
  return (
    <Link to={`/tutos/${encodeURIComponent(tu.slug)}`} className="group rounded-xl overflow-hidden bg-fc-channel border border-fc-hover hover:border-fc-accent/60 transition flex flex-col">
      <div className="relative aspect-video flex items-center justify-center" style={{ background: tint(tu.category.slug) }}>
        <Icon size={52} className="text-white/25" aria-hidden />
        <span className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/45 flex items-center justify-center text-white group-hover:bg-fc-accent transition" aria-hidden><Play size={20} fill="currentColor" /></span>
        <span className="absolute top-2 left-2 text-[11px] font-semibold bg-black/50 text-white rounded px-1.5 py-0.5">{tu.category.name}</span>
        {tu.group && <span className="absolute top-2 right-2 text-[11px] font-semibold bg-white/90 text-black rounded px-1.5 py-0.5">{tu.group}</span>}
      </div>
      <div className="flex flex-col gap-2 p-4 flex-1">
        <h3 className="font-bold text-white group-hover:underline leading-snug line-clamp-2">{tu.title}</h3>
        {tu.description && <p className="text-sm text-fc-text leading-relaxed line-clamp-3">{tu.description}</p>}
        {tu.tags.length > 0 && <p className="mt-auto flex flex-wrap gap-1.5 pt-1">{tu.tags.slice(0, 4).map(g => <span key={g} className="text-[11px] px-2 py-0.5 rounded-full bg-fc-hover text-fc-muted">{g}</span>)}</p>}
      </div>
    </Link>
  )
}
