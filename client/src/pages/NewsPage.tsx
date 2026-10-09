// Actualités : les nouveaux articles des flux RSS (relayés par le bot RSSDI), classés par rubrique
// puis par site, ouverts à tous les comptes. Un site = sa page d'articles avec image et résumé.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ExternalLink, Newspaper } from 'lucide-react'
import api from '../api/client'
import { intlLocale, useT } from '../i18n'

interface Site { id: string; name: string; category: string; last_title: string | null; last_at: string | null; today: number }
interface Article { id: string; title: string; link: string; summary: string | null; image: string | null; published_at: string }

const when = (iso: string) => new Date(iso).toLocaleString(intlLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const host = (link: string) => { try { return new URL(link).hostname.replace(/^www\./, '') } catch { return '' } }
/** Rubrique affichée : sans les décorations des noms de forum (⭒, emoji, lettres en gras Unicode). */
const clean = (s: string) => s.normalize('NFKC').replace(/[⭒•·]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/-/g, ' ').trim()

export default function NewsPage() {
  const t = useT()
  const sites = useQuery({ queryKey: ['news'], queryFn: () => api.get<{ sites: Site[] }>('/news').then(r => r.data.sites), refetchInterval: 120_000 })
  const [picked, setPicked] = useState<string | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, Site[]>()
    for (const s of sites.data ?? []) m.set(clean(s.category), [...(m.get(clean(s.category)) ?? []), s])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [sites.data])
  const siteId = picked ?? sites.data?.[0]?.id ?? null
  const site = sites.data?.find(s => s.id === siteId)

  return (
    <div className="flex h-full min-h-0 bg-fc-chat">
      <aside className="w-64 flex-shrink-0 border-r border-fc-hover overflow-y-auto bg-fc-channel hidden md:block" aria-label={t('news.sites')}>
        <h1 className="flex items-center gap-2 px-4 py-3 text-white font-semibold border-b border-fc-hover"><Newspaper size={18} /> {t('news.title')}</h1>
        {groups.map(([cat, list]) => (
          <section key={cat} className="py-2">
            <h2 className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-fc-muted">{cat}</h2>
            {list.map(s => (
              <button key={s.id} onClick={() => setPicked(s.id)} aria-current={s.id === siteId ? 'page' : undefined}
                className={`w-full flex items-center justify-between gap-2 px-4 py-1.5 text-sm text-left transition ${s.id === siteId ? 'bg-fc-hover text-white' : 'text-fc-text hover:bg-fc-hover/60'}`}>
                <span className="truncate">{s.name}</span>
                {s.today > 0 && <span className="flex-shrink-0 text-[10px] font-bold rounded-full px-1.5 bg-fc-accent text-white">{s.today}</span>}
              </button>
            ))}
          </section>
        ))}
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Téléphone : choix du site en liste déroulante */}
        <div className="md:hidden p-3 border-b border-fc-hover">
          <select value={siteId ?? ''} onChange={e => setPicked(e.target.value)} aria-label={t('news.sites')} className="w-full bg-fc-input text-white rounded-lg px-3 py-2 text-sm">
            {groups.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>{list.map(s => <option key={s.id} value={s.id}>{s.name}{s.today ? ` (${s.today})` : ''}</option>)}</optgroup>
            ))}
          </select>
        </div>
        {sites.isLoading ? <p className="p-6 text-fc-muted text-sm">{t('common.loading')}</p>
          : !sites.data?.length ? <p className="p-6 text-fc-muted text-sm">{t('news.empty')}</p>
          : site && <SiteArticles site={site} />}
      </main>
    </div>
  )
}

function SiteArticles({ site }: { site: Site }) {
  const t = useT()
  const q = useInfiniteQuery({
    queryKey: ['news', site.id],
    queryFn: ({ pageParam }) => api.get<{ articles: Article[] }>('/news/sites/' + site.id + '/articles', { params: pageParam ? { before: pageParam } : {} }).then(r => r.data.articles),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.length === 30 ? last[last.length - 1].published_at : undefined),
  })
  const articles = q.data?.pages.flat() ?? []
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-fc-muted">{clean(site.category)}</p>
        <h2 className="text-2xl font-bold text-white">{site.name}</h2>
      </header>
      {articles.map(a => (
        <article key={a.id} className="rounded-xl overflow-hidden bg-fc-channel border border-fc-hover">
          <a href={a.link} target="_blank" rel="noopener noreferrer nofollow" className="block group">
            {a.image && <img src={a.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="w-full max-h-72 object-cover bg-black" onError={e => { e.currentTarget.style.display = 'none' }} />}
            <div className="p-4 space-y-1.5">
              <h3 className="text-base font-semibold text-white group-hover:underline">{a.title}</h3>
              {a.summary && <p className="text-sm text-fc-text leading-relaxed whitespace-pre-line">{a.summary}</p>}
              <p className="flex items-center gap-1.5 text-xs text-fc-muted">
                {when(a.published_at)} · {host(a.link)} <ExternalLink size={11} aria-hidden />
              </p>
            </div>
          </a>
        </article>
      ))}
      {q.hasNextPage && (
        <button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="w-full py-2 rounded-lg bg-fc-hover text-sm text-fc-text hover:text-white">
          {q.isFetchingNextPage ? t('common.loading') : t('news.more')}
        </button>
      )}
    </div>
  )
}
