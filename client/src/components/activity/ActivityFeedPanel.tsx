import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AtSign, Smile, MessageSquare, X, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../../api/client'

interface ActivityUser {
  id: string
  username: string
  avatar: string | null
}

interface ActivityItem {
  id: string
  type: 'message' | 'mention' | 'reaction'
  user: ActivityUser
  content: string
  channel_name: string
  timestamp: string
}

type FilterType = 'all' | 'mention' | 'reaction'

const FILTERS: { id: FilterType; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'Tout', icon: <Activity size={12} /> },
  { id: 'mention', label: 'Mentions', icon: <AtSign size={12} /> },
  { id: 'reaction', label: 'Réactions', icon: <Smile size={12} /> },
]

function ActivityTypeBadge({ type }: { type: ActivityItem['type'] }) {
  switch (type) {
    case 'mention':
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-fc-yellow font-medium">
          <AtSign size={10} />
          mention
        </span>
      )
    case 'reaction':
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-fc-green font-medium">
          <Smile size={10} />
          réaction
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-fc-muted font-medium">
          <MessageSquare size={10} />
          message
        </span>
      )
  }
}

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

function ActivityRow({ item }: { item: ActivityItem }) {
  const timeAgo = formatDistanceToNow(new Date(item.timestamp), {
    addSuffix: true,
    locale: fr,
  })

  return (
    <div className="flex gap-2 px-2 py-2 rounded-lg hover:bg-fc-hover/50 transition group cursor-default">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center font-semibold text-xs text-white overflow-hidden flex-shrink-0">
        {item.user.avatar
          ? <img src={item.user.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
          : item.user.username.charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-white truncate max-w-[90px]">
            {item.user.username}
          </span>
          <ActivityTypeBadge type={item.type} />
          <span className="text-[10px] text-fc-muted">#{item.channel_name}</span>
        </div>
        <p className="text-xs text-fc-muted mt-0.5 line-clamp-2 leading-relaxed">
          {item.content}
        </p>
        <span className="text-[10px] text-fc-muted/60">{timeAgo}</span>
      </div>
    </div>
  )
}

interface Props {
  onClose: () => void
}

export default function ActivityFeedPanel({ onClose }: Props) {
  const [filter, setFilter] = useState<FilterType>('all')

  const { data: items = [], isLoading } = useQuery<ActivityItem[]>({
    queryKey: ['activity-feed-panel'],
    queryFn: () => api.get('/activity-feed?limit=50').then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const filtered = filter === 'all'
    ? items
    : items.filter(i => i.type === filter || (filter === 'mention' && i.type === 'mention'))

  const sliced = filtered.slice(0, 50)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-fc-bg flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-fc-accent" />
          <span className="font-semibold text-white text-sm">Activité récente</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
        >
          <X size={14} />
        </button>
      </div>

      {/* Filtres */}
      <div className="flex gap-1 px-2 py-2 border-b border-fc-bg flex-shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              filter === f.id
                ? 'bg-fc-accent text-white'
                : 'text-fc-muted hover:text-white hover:bg-fc-hover'
            }`}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto p-1">
        {isLoading && (
          <div className="space-y-1 p-1">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {!isLoading && sliced.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
            <Activity size={32} className="text-fc-muted opacity-30 mb-3" />
            <p className="text-sm text-fc-muted">Aucune activité récente</p>
            <p className="text-xs text-fc-muted/60 mt-1">
              {filter !== 'all' ? 'Essayez le filtre "Tout"' : 'Les messages et mentions apparaîtront ici'}
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
