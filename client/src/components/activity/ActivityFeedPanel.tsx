import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, X } from 'lucide-react'
import api from '../../api/client'
// Même contrat serveur que la page Activité (server_join, friend_join_server, message_pin) :
// on réutilise son rendu plutôt que d'en maintenir un second qui dérive.
import { ActivityRow, FILTERS, filterItems, type ActivityItem, type Filter } from '../../pages/ActivityFeedPage'

function SkeletonRow() {
  return (
    <div className="flex gap-2 px-2 py-2 animate-pulse">
      <div className="w-7 h-7 rounded-full bg-fc-hover flex-shrink-0" />
      <div className="flex-1 space-y-1.5 min-w-0">
        <div className="h-2.5 bg-fc-hover rounded w-3/4" />
        <div className="h-2 bg-fc-hover rounded w-full" />
        <div className="h-2 bg-fc-hover rounded w-1/2" />
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
}

export default function ActivityFeedPanel({ onClose }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const { data: items = [], isLoading } = useQuery<ActivityItem[]>({
    queryKey: ['activity-feed-panel'],
    queryFn: () => api.get('/activity-feed?limit=50').then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const filtered = filterItems(items, filter)

  const sliced = filtered.slice(0, 50)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-fc-bg flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-fc-accent" aria-hidden />
          <span className="font-semibold text-white text-sm">Activité récente</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer l'activité récente"
          className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {/* Filtres */}
      <div role="tablist" aria-label="Filtrer l'activité" className="flex gap-1 px-2 py-2 border-b border-fc-bg flex-shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              filter === f.key
                ? 'bg-fc-accent text-white'
                : 'text-fc-muted hover:text-white hover:bg-fc-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-1">
        {isLoading && (
          <div className="space-y-1 p-1" aria-busy="true" aria-label="Chargement de l'activité">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {!isLoading && sliced.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
            <Activity size={32} className="text-fc-muted opacity-30 mb-3" aria-hidden />
            <p className="text-sm text-fc-muted">Aucune activité récente</p>
            <p className="text-xs text-fc-muted/60 mt-1">
              {filter !== 'all' ? 'Essayez le filtre "Tout"' : 'Arrivées dans vos serveurs et messages épinglés'}
            </p>
          </div>
        )}

        {!isLoading && sliced.length > 0 && (
          <div className="space-y-0.5">
            {sliced.map(item => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        )}

        {!isLoading && filtered.length > 50 && (
          <p className="text-center text-[10px] text-fc-muted py-2">
            Affichage des 50 derniers événements
          </p>
        )}
      </div>
    </div>
  )
}
