import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Users, Compass, Tag } from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoverServer {
  id: string
  name: string
  icon: string | null
  banner: string | null
  description: string | null
  member_count: number
  invite_code: string | null
  tags: string[] | null
  category: string | null
}

type Category =
  | 'all'
  | 'gaming'
  | 'community'
  | 'tech'
  | 'music'
  | 'education'
  | 'arts'
  | '18plus'

type SortMode = 'popular' | 'recent' | 'alpha'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'gaming', label: 'Gaming' },
  { key: 'community', label: 'Communauté' },
  { key: 'tech', label: 'Tech' },
  { key: 'music', label: 'Musique' },
  { key: 'education', label: 'Éducation' },
  { key: 'arts', label: 'Arts' },
  { key: '18plus', label: '18+' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMemberCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k membres`
  return `${n} membre${n > 1 ? 's' : ''}`
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-fc-channel rounded-xl overflow-hidden animate-pulse flex flex-col">
      <div className="h-28 bg-fc-hover/50" />
      <div className="p-4 flex flex-col gap-2">
        <div className="h-4 w-2/3 bg-fc-hover rounded" />
        <div className="h-3 w-full bg-fc-hover/60 rounded" />
        <div className="h-3 w-4/5 bg-fc-hover/60 rounded" />
        <div className="flex justify-between mt-3">
          <div className="h-3 w-20 bg-fc-hover/40 rounded" />
          <div className="h-7 w-20 bg-fc-hover/40 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

// ─── Server Card ──────────────────────────────────────────────────────────────

interface ServerCardProps {
  server: DiscoverServer
  onJoin: () => void
  isJoining: boolean
}

function ServerCard({ server, onJoin, isJoining }: ServerCardProps) {
  const initial = server.name.charAt(0).toUpperCase()

  return (
    <div className="group bg-fc-channel rounded-xl overflow-hidden hover:bg-fc-hover/20 transition-colors flex flex-col border border-transparent hover:border-fc-hover/40">
      {/* Bannière */}
      <div className="relative h-28 overflow-hidden flex-shrink-0">
        {server.banner ? (
          <img
            src={server.banner}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-fc-bg to-fc-channel" />
        )}
        {/* Gradient overlay bas */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {/* Icône flottante */}
        <div className="absolute -bottom-5 left-4">
          <div className="w-12 h-12 rounded-xl bg-fc-bg border-2 border-fc-channel flex items-center justify-center font-bold text-lg text-white shadow-lg overflow-hidden">
            {server.icon ? (
              <img src={server.icon} alt={server.name} className="w-full h-full object-cover" />
            ) : (
              initial
            )}
          </div>
        </div>
      </div>

      {/* Contenu */}
      <div className="p-4 pt-8 flex flex-col flex-1">
        <h3 className="text-white font-semibold text-sm mb-1 truncate">{server.name}</h3>

        {/* Tags */}
        {server.tags && server.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {server.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-fc-accent/15 text-fc-accent font-medium"
              >
                <Tag size={9} />
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="text-fc-muted text-xs line-clamp-2 flex-1 mb-3 leading-relaxed">
          {server.description ?? 'Aucune description.'}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-fc-muted text-xs">
            <Users size={12} />
            <span>{formatMemberCount(server.member_count)}</span>
          </div>
          <button
            onClick={onJoin}
            disabled={isJoining || !server.invite_code}
            className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isJoining ? 'Rejoindre...' : 'Rejoindre'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ServerDiscoveryPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [sort, setSort] = useState<SortMode>('popular')
  const nav = useNavigate()
  const qc = useQueryClient()

  const { data: servers = [], isLoading } = useQuery<DiscoverServer[]>({
    queryKey: ['servers', 'discover', category],
    queryFn: () => {
      const params = category !== 'all' ? `?category=${category}` : ''
      return api.get(`/explore${params}`).then((r) => r.data)
    },
  })

  const join = useMutation({
    mutationFn: (server: DiscoverServer) =>
      api.post(`/servers/join/${server.invite_code}`).then((r) => r.data),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Vous avez rejoint ${variables.name} !`)
      if (data.id) nav(`/servers/${data.id}`)
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error ?? 'Impossible de rejoindre')
    },
  })

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    let list = servers.filter((s) => {
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q)
      )
    })

    if (sort === 'popular') {
      list = [...list].sort((a, b) => b.member_count - a.member_count)
    } else if (sort === 'alpha') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    }
    // 'recent' — on conserve l'ordre du serveur (ORDER BY created_at DESC)

    return list
  }, [servers, query, sort])

  return (
    <div className="flex-1 bg-fc-chat overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* En-tête */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-fc-accent/20 mb-4">
            <Compass size={32} className="text-fc-accent" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Découvrir des serveurs</h1>
          <p className="text-fc-muted text-base">Rejoignez des communautés publiques en un clic.</p>
        </div>

        {/* Filtres par catégorie */}
        <div className="flex flex-wrap gap-2 justify-center mb-6">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition
                ${category === cat.key
                  ? 'bg-fc-accent text-white'
                  : 'bg-fc-channel text-fc-muted hover:text-white hover:bg-fc-hover'}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Barre de recherche + tri */}
        <div className="flex gap-3 mb-8 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un serveur..."
              className="w-full pl-9 pr-4 py-2.5 bg-fc-channel rounded-xl text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="px-3 py-2.5 bg-fc-channel rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent cursor-pointer"
          >
            <option value="popular">Plus populaires</option>
            <option value="recent">Plus récents</option>
            <option value="alpha">Alphabétique</option>
          </select>
        </div>

        {/* Contenu */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-fc-muted py-20">
            <Compass size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-base">
              {query
                ? `Aucun résultat pour "${query}"`
                : 'Aucun serveur public dans cette catégorie.'}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-fc-muted mb-4">
              {filtered.length} serveur{filtered.length > 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  onJoin={() => join.mutate(s)}
                  isJoining={join.isPending && (join.variables as DiscoverServer)?.id === s.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
