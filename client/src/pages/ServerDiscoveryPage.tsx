import { useEffect, useState } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Users, Compass, Tag, ChevronLeft, Activity, X } from 'lucide-react'
import api, { mediaUrl } from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useMobile } from '../contexts/MobileContext'
import { intlLocale, useT, type Key } from '../i18n'
import ServerProfileModal, { type DirectoryServer } from '../components/community/ServerProfileModal'

// Annuaire des serveurs publics : catégories, étiquettes, recherche et tri faits par
// le serveur (GET /explore), page de présentation (GET /explore/:id).

const CATEGORIES = ['all', 'gaming', 'community', 'tech', 'music', 'education', 'arts', '18plus'] as const
const SORTS = ['members', 'activity', 'recent', 'alpha'] as const

function SkeletonCard() {
  return (
    <div className="bg-fc-channel rounded-xl overflow-hidden animate-pulse flex flex-col">
      <div className="h-28 bg-fc-hover/50" />
      <div className="p-4 flex flex-col gap-2">
        <div className="h-4 w-2/3 bg-fc-hover rounded" />
        <div className="h-3 w-full bg-fc-hover/60 rounded" />
        <div className="h-3 w-4/5 bg-fc-hover/60 rounded" />
      </div>
    </div>
  )
}

function ServerCard({ server, onOpen, onJoin, onTag, isJoining }: {
  server: DirectoryServer
  onOpen: () => void
  onJoin: () => void
  onTag: (tag: string) => void
  isJoining: boolean
}) {
  const t = useT()
  const fmt = (n: number) => n.toLocaleString(intlLocale())
  return (
    <div className="group bg-fc-channel rounded-xl overflow-hidden hover:bg-fc-hover/20 transition-colors flex flex-col border border-transparent hover:border-fc-hover/40">
      <button onClick={onOpen} className="relative h-28 overflow-hidden flex-shrink-0 text-left" aria-label={t('community.directory.open', { name: server.name })}>
        {server.banner
          ? <img src={mediaUrl(server.banner)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gradient-to-br from-fc-bg to-fc-channel" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute -bottom-5 left-4 w-12 h-12 rounded-xl bg-fc-bg border-2 border-fc-channel flex items-center justify-center font-bold text-lg text-white shadow-lg overflow-hidden">
          {server.icon ? <img src={mediaUrl(server.icon)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : server.name.charAt(0).toUpperCase()}
        </div>
      </button>
      <div className="p-4 pt-8 flex flex-col flex-1">
        <button onClick={onOpen} className="text-white font-semibold text-sm mb-1 truncate text-left hover:underline">{server.name}</button>
        {!!server.tags?.length && (
          <div className="flex flex-wrap gap-1 mb-2">
            {server.tags.slice(0, 4).map(tag => (
              <button key={tag} onClick={() => onTag(tag)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-fc-accent/15 text-fc-accent font-medium hover:bg-fc-accent/25">
                <Tag size={9} aria-hidden />{tag}
              </button>
            ))}
          </div>
        )}
        <p className="text-fc-muted text-xs line-clamp-2 flex-1 mb-3 leading-relaxed">{server.description ?? t('community.directory.noDesc')}</p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-fc-muted text-xs">
            <span className="flex items-center gap-1"><Users size={12} aria-hidden />{fmt(server.member_count)}</span>
            <span className="flex items-center gap-1" title={t('community.directory.activity')}><Activity size={12} aria-hidden />{fmt(server.activity ?? 0)}</span>
          </div>
          <button onClick={onJoin} disabled={isJoining || !server.invite_code}
            className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed">
            {t('community.directory.join')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ServerDiscoveryPage() {
  const t = useT()
  usePageTitle(t('community.directory.page'))
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [sort, setSort] = useState<(typeof SORTS)[number]>('members')
  const [profile, setProfile] = useState<string | null>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { openSidebar } = useMobile()

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(id)
  }, [query])

  const { data: servers = [], isLoading } = useQuery<DirectoryServer[]>({
    queryKey: ['servers', 'discover', category, tag, debounced, sort],
    queryFn: () => {
      const p = new URLSearchParams({ sort })
      if (category !== 'all') p.set('category', category)
      if (tag) p.set('tag', tag)
      if (debounced) p.set('q', debounced)
      return api.get(`/explore?${p.toString()}`).then(r => r.data)
    },
  })

  const join = useMutation({
    mutationFn: (server: DirectoryServer) => api.post(`/servers/join/${server.invite_code}`).then(r => r.data),
    onSuccess: (data, server) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(t('community.directory.joined', { name: server.name }))
      setProfile(null)
      if (data.id) nav(`/servers/${data.id}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? t('community.directory.joinError')),
  })

  return (
    <div className="flex-1 bg-fc-chat overflow-y-auto overscroll-contain">
      <div className="flex items-center gap-2 px-4 py-2 md:hidden border-b border-fc-hover flex-shrink-0">
        <button className="flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
          onClick={openSidebar} aria-label={t('common.back')}>
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold text-white text-sm">{t('community.directory.page')}</span>
      </div>
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8 md:py-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-fc-accent/20 mb-4">
            <Compass size={32} className="text-fc-accent" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">{t('community.directory.heading')}</h1>
          <p className="text-fc-muted text-base">{t('community.directory.sub')}</p>
        </div>

        <div className="flex flex-wrap gap-2 justify-center mb-6">
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)} aria-pressed={category === cat}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${category === cat ? 'bg-fc-accent text-white' : 'bg-fc-channel text-fc-muted hover:text-white hover:bg-fc-hover'}`}>
              {t(`community.directory.cat.${cat}` as Key)}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('community.directory.search')}
              aria-label={t('community.directory.search')} inputMode="search" autoComplete="off" enterKeyHint="search" autoCapitalize="none" maxLength={100}
              className="w-full pl-9 pr-4 py-2.5 bg-fc-channel rounded-xl text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as (typeof SORTS)[number])} aria-label={t('community.directory.sort')}
            className="px-3 py-2.5 bg-fc-channel rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent cursor-pointer">
            {SORTS.map(s => <option key={s} value={s}>{t(`community.directory.sort.${s}` as Key)}</option>)}
          </select>
        </div>
        {tag && (
          <div className="flex justify-center mb-6">
            <button onClick={() => setTag(null)} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-fc-accent/20 text-fc-accent text-sm">
              <Tag size={12} aria-hidden />{tag}<X size={12} aria-label={t('common.clearFilter')} />
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center text-fc-muted py-20">
            <Compass size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-base">{t('community.directory.empty')}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-fc-muted mb-4">{t('community.directory.count', { n: servers.length })}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {servers.map(s => (
                <ServerCard key={s.id} server={s} onOpen={() => setProfile(s.id)} onJoin={() => join.mutate(s)} onTag={setTag}
                  isJoining={join.isPending && join.variables?.id === s.id} />
              ))}
            </div>
          </>
        )}
      </div>
      {profile && (
        <ServerProfileModal serverId={profile} onClose={() => setProfile(null)} onJoin={s => join.mutate(s)}
          joining={join.isPending} onTag={setTag} />
      )}
    </div>
  )
}
