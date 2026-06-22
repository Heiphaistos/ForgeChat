import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Users, Compass, CheckCircle, ChevronDown, Loader2 } from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useIntersection } from '../hooks/useIntersection'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoverServer {
  id: string
  name: string
  description?: string
  icon?: string
  banner?: string
  member_count: number
  online_count: number
  is_verified: boolean
  tags: string[]
  invite_code?: string
}

interface Page {
  servers: DiscoverServer[]
  next_page?: number
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Tout', 'Gaming', 'Musique', 'Art', 'Tech',
  'Éducation', 'Social', 'Anime', 'Sport', 'Autre',
] as const

type Category = typeof CATEGORIES[number]

const SORT_OPTIONS = [
  { value: 'popular', label: 'Populaire' },
  { value: 'recent', label: 'Récent' },
  { value: 'active', label: 'Membres actifs' },
] as const

type SortOption = typeof SORT_OPTIONS[number]['value']

// ─── ServerCard ───────────────────────────────────────────────────────────────

function ServerCard({
  server,
  onJoin,
  isJoining,
}: {
  server: DiscoverServer
  onJoin: () => void
  isJoining: boolean
}) {
  return (
    <div className="group bg-fc-channel rounded-xl overflow-hidden hover:bg-fc-hover/30 transition-colors flex flex-col">
      {/* Banner */}
      <div className="relative h-28 overflow-hidden flex-shrink-0">
        {server.banner ? (
          <img
            src={server.banner}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-600/40 via-purple-600/30 to-fc-accent/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

        {/* Avatar flottant */}
        <div className="absolute bottom-0 left-4 translate-y-1/2">
          <div className="w-14 h-14 rounded-2xl bg-fc-bg border-2 border-fc-channel flex items-center justify-center font-bold text-xl text-white overflow-hidden shadow-lg">
            {server.icon
              ? <img src={server.icon} alt={server.name} className="w-full h-full object-cover" />
              : server.name.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Contenu */}
      <div className="pt-10 px-4 pb-4 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <h3 className="text-white font-semibold text-sm truncate">{server.name}</h3>
          {server.is_verified && (
            <CheckCircle size={13} className="text-fc-accent flex-shrink-0" title="Serveur vérifié" />
          )}
        </div>

        <p className="text-fc-muted text-xs line-clamp-2 flex-1 mb-3 leading-relaxed">
          {server.description ?? 'Aucune description.'}
        </p>

        {/* Tags */}
        {server.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {server.tags.slice(0, 3).map(tag => (
              <span
                key={tag}
                className="px-1.5 py-0.5 bg-fc-bg text-fc-muted text-[10px] rounded font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-fc-green">
              <span className="w-1.5 h-1.5 rounded-full bg-fc-green inline-block" />
              {server.online_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-fc-muted">
              <Users size={11} />
              {server.member_count.toLocaleString()}
            </span>
          </div>
          <button
            onClick={onJoin}
            disabled={isJoining || !server.invite_code}
            className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            {isJoining ? 'Rejoindre...' : 'Rejoindre'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-fc-channel rounded-xl overflow-hidden animate-pulse">
      <div className="h-28 bg-fc-hover" />
      <div className="pt-10 px-4 pb-4 space-y-2">
        <div className="h-3 bg-fc-hover rounded w-1/2" />
        <div className="h-2 bg-fc-hover rounded w-full" />
        <div className="h-2 bg-fc-hover rounded w-3/4" />
        <div className="h-6 bg-fc-hover rounded w-20 ml-auto mt-4" />
      </div>
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ServerDiscoveryPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('Tout')
  const [sort, setSort] = useState<SortOption>('popular')
  const nav = useNavigate()
  const qc = useQueryClient()

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<Page>({
    queryKey: ['discovery', query, category, sort],
    queryFn: ({ pageParam = 1 }) => {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (category !== 'Tout') params.set('category', category)
      params.set('sort', sort)
      params.set('page', String(pageParam))
      return api.get(`/servers/discover?${params}`).then(r => r.data)
    },
    initialPageParam: 1,
    getNextPageParam: (last) => last.next_page ?? undefined,
  })

  // Infinite scroll — sentinel
  const sentinelRef = useIntersection<HTMLDivElement>(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  })

  const join = useMutation({
    mutationFn: (inviteCode: string) =>
      api.post(`/servers/join/${inviteCode}`).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Vous avez rejoint ${data.name ?? 'le serveur'} !`)
      if (data.id) nav(`/servers/${data.id}`)
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error ?? 'Impossible de rejoindre'),
  })

  const servers = data?.pages.flatMap(p => p.servers) ?? []

  return (
    <div className="flex-1 bg-fc-chat overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* En-tête */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-fc-accent/20 mb-4">
            <Compass size={32} className="text-fc-accent" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Découvrir des serveurs</h1>
          <p className="text-fc-muted text-base">
            Trouvez des communautés publiques qui vous correspondent.
          </p>
        </div>

        {/* Barre de filtres */}
        <div className="flex flex-wrap gap-3 mb-8 items-center">
          {/* Recherche */}
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un serveur..."
              className="w-full pl-9 pr-4 py-2.5 bg-fc-channel rounded-xl text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>

          {/* Catégorie */}
          <div className="relative">
            <select
              value={category}
              onChange={e => setCategory(e.target.value as Category)}
              className="appearance-none pl-3 pr-8 py-2.5 bg-fc-channel rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent cursor-pointer"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
          </div>

          {/* Tri */}
          <div className="relative">
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortOption)}
              className="appearance-none pl-3 pr-8 py-2.5 bg-fc-channel rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent cursor-pointer"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
          </div>
        </div>

        {/* Grille */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center text-fc-muted py-20">
            <Compass size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-base">
              {query ? `Aucun résultat pour "${query}"` : 'Aucun serveur public disponible.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {servers.map(s => (
                <ServerCard
                  key={s.id}
                  server={s}
                  onJoin={() => s.invite_code && join.mutate(s.invite_code)}
                  isJoining={join.isPending && join.variables === s.invite_code}
                />
              ))}
            </div>

            {/* Sentinel infinite scroll */}
            <div ref={sentinelRef} className="flex justify-center py-8">
              {isFetchingNextPage && (
                <Loader2 size={20} className="animate-spin text-fc-muted" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
