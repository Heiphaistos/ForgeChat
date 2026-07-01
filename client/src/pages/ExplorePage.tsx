import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Users, Compass, ChevronLeft } from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { useMobile } from '../contexts/MobileContext'

interface PublicServer {
  id: string
  name: string
  icon: string | null
  description: string | null
  member_count: number
  invite_code: string
}

export default function ExplorePage() {
  const [query, setQuery] = useState('')
  const nav = useNavigate()
  const { openSidebar } = useMobile()
  const qc = useQueryClient()

  const { data: servers = [], isLoading } = useQuery<PublicServer[]>({
    queryKey: ['explore'],
    queryFn: () => api.get('/explore').then(r => r.data),
  })

  const join = useMutation({
    mutationFn: (inviteCode: string) => api.post(`/servers/join/${inviteCode}`).then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Vous avez rejoint ${data.name ?? 'le serveur'} !`)
      if (data.id) nav(`/servers/${data.id}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Impossible de rejoindre'),
  })

  const filtered = servers.filter(s => {
    const q = query.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex-1 bg-fc-chat overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-10">
        {/* Bouton retour mobile */}
        <button
          className="md:hidden flex items-center gap-2 text-fc-muted hover:text-white transition mb-4"
          onClick={openSidebar}
        >
          <ChevronLeft size={20} />
          <span className="text-sm">Menu</span>
        </button>
        {/* En-tête */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-fc-accent/20 mb-4">
            <Compass size={32} className="text-fc-accent" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Explorer les serveurs</h1>
          <p className="text-fc-muted text-base">Découvrez des communautés publiques et rejoignez-les en un clic.</p>
        </div>

        {/* Barre de recherche */}
        <div className="relative max-w-lg mx-auto mb-10">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Rechercher un serveur..."
            className="w-full pl-9 pr-4 py-3 bg-fc-channel rounded-xl text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          />
        </div>

        {/* Grille */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 bg-fc-channel rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-fc-muted py-20">
            <Compass size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-base">
              {query ? `Aucun résultat pour "${query}"` : 'Aucun serveur public disponible.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(s => (
              <ServerCard
                key={s.id}
                server={s}
                onJoin={() => join.mutate(s.invite_code)}
                isJoining={join.isPending && join.variables === s.invite_code}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ServerCard({
  server,
  onJoin,
  isJoining,
}: {
  server: PublicServer
  onJoin: () => void
  isJoining: boolean
}) {
  return (
    <div className="group bg-fc-channel rounded-xl overflow-hidden hover:bg-fc-hover/30 transition-colors flex flex-col">
      {/* Banner / icône */}
      <div className="relative h-24 bg-gradient-to-br from-indigo-600/40 via-purple-600/30 to-fc-accent/20 flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-gradient-to-t from-black to-transparent" />
        <div className="relative w-16 h-16 rounded-2xl bg-fc-bg flex items-center justify-center font-bold text-2xl text-white shadow-lg overflow-hidden border-2 border-fc-hover">
          {server.icon
            ? <img src={server.icon} alt={server.name} className="w-full h-full object-cover" />
            : server.name.charAt(0).toUpperCase()}
        </div>
      </div>

      {/* Contenu */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="text-white font-semibold text-sm mb-1 truncate">{server.name}</h3>

        <p className="text-fc-muted text-xs line-clamp-2 flex-1 mb-3 leading-relaxed">
          {server.description ?? 'Aucune description.'}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-fc-muted text-xs">
            <Users size={13} />
            <span>{server.member_count.toLocaleString()} membre{server.member_count > 1 ? 's' : ''}</span>
          </div>
          <button
            onClick={onJoin}
            disabled={isJoining}
            className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
          >
            {isJoining ? 'Rejoindre...' : 'Rejoindre'}
          </button>
        </div>
      </div>
    </div>
  )
}
