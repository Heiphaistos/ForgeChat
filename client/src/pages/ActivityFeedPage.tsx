import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  Pin, Users, Trophy, Calendar, UserPlus, Zap, ChevronLeft,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../api/client'
import { useMobile } from '../contexts/MobileContext'

// ─── Types ──────────────────────────────────────────────────────────────────

export type ActivityType =
  | 'message_pin'
  | 'server_join'
  | 'achievement'
  | 'event_rsvp'
  | 'friend_join_server'

interface ActivityItem {
  id: string
  type: ActivityType
  actor: { id: string; username: string; avatar?: string }
  server?: { id: string; name: string }
  channel?: { id: string; name: string }
  timestamp: string
  metadata?: Record<string, unknown>
}

// ─── Config visuelle par type ────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  ActivityType,
  { icon: React.ReactNode; color: string; label: (item: ActivityItem) => React.ReactNode }
> = {
  server_join: {
    icon: <Users size={14} />,
    color: 'text-fc-green bg-fc-green/15',
    label: (item) => (
      <>
        <strong className="text-white">@{item.actor.username}</strong>
        {' a rejoint '}
        <strong className="text-fc-accent">{item.server?.name ?? 'un serveur'}</strong>
      </>
    ),
  },
  message_pin: {
    icon: <Pin size={14} />,
    color: 'text-yellow-400 bg-yellow-400/15',
    label: (item) => (
      <>
        <strong className="text-white">@{item.actor.username}</strong>
        {' a épinglé un message dans '}
        <strong className="text-fc-accent">#{item.channel?.name ?? 'un canal'}</strong>
        {item.server ? <> sur <strong className="text-fc-text">{item.server.name}</strong></> : null}
      </>
    ),
  },
  achievement: {
    icon: <Trophy size={14} />,
    color: 'text-orange-400 bg-orange-400/15',
    label: (item) => (
      <>
        <strong className="text-white">@{item.actor.username}</strong>
        {' a débloqué '}
        <strong className="text-orange-300">{String(item.metadata?.achievement ?? 'une récompense')}</strong>
      </>
    ),
  },
  event_rsvp: {
    icon: <Calendar size={14} />,
    color: 'text-blue-400 bg-blue-400/15',
    label: (item) => (
      <>
        <strong className="text-white">@{item.actor.username}</strong>
        {' participe à '}
        <strong className="text-blue-300">{String(item.metadata?.event ?? 'un événement')}</strong>
        {item.server ? <> sur <strong className="text-fc-text">{item.server.name}</strong></> : null}
      </>
    ),
  },
  friend_join_server: {
    icon: <UserPlus size={14} />,
    color: 'text-purple-400 bg-purple-400/15',
    label: (item) => (
      <>
        <strong className="text-white">@{item.actor.username}</strong>
        {' (ami) a rejoint '}
        <strong className="text-fc-accent">{item.server?.name ?? 'un serveur'}</strong>
      </>
    ),
  },
}

// ─── Filtres ─────────────────────────────────────────────────────────────────

type Filter = 'all' | 'friends' | 'servers' | 'me'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'friends', label: 'Amis' },
  { key: 'servers', label: 'Serveurs' },
  { key: 'me', label: 'Mes activités' },
]

function filterItems(items: ActivityItem[], filter: Filter): ActivityItem[] {
  switch (filter) {
    case 'friends': return items.filter(i => i.type === 'friend_join_server')
    case 'servers': return items.filter(i => i.type === 'server_join' || i.type === 'message_pin')
    case 'me': return items.filter(i => i.type === 'achievement' || i.type === 'event_rsvp')
    default: return items
  }
}

// ─── Composant item ──────────────────────────────────────────────────────────

function ActivityRow({ item }: { item: ActivityItem }) {
  const config = TYPE_CONFIG[item.type]
  if (!config) return null

  const timeAgo = formatDistanceToNow(new Date(item.timestamp), {
    addSuffix: true,
    locale: fr,
  })

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-fc-hover/30 transition rounded-lg">
      {/* Avatar acteur */}
      <div className="relative flex-shrink-0">
        <div className="w-9 h-9 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white overflow-hidden">
          {item.actor.avatar
            ? <img src={item.actor.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            : item.actor.username.charAt(0).toUpperCase()}
        </div>
        {/* Icône type superposée */}
        <div className={`absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center ${config.color}`}>
          {config.icon}
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fc-text leading-snug">
          {config.label(item)}
        </p>
        <span className="text-[11px] text-fc-muted mt-0.5 block">{timeAgo}</span>
      </div>
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ActivityFeedPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const { openSidebar } = useMobile()

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
  } = useInfiniteQuery({
    queryKey: ['activity-feed'],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await api.get('/activity-feed', {
        params: { offset: pageParam, limit: 20 },
      })
      return res.data as ActivityItem[]
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.flat().length : undefined,
    initialPageParam: 0,
  })

  const allItems: ActivityItem[] = data ? data.pages.flat() : []

  const visible = filterItems(allItems, filter)

  return (
    <div className="flex flex-col h-full bg-fc-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-fc-hover flex-shrink-0">
        <button
          className="flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0 md:hidden"
          onClick={openSidebar}
          aria-label="Retour"
        >
          <ChevronLeft size={20} />
        </button>
        <Zap size={18} className="text-fc-accent" />
        <h1 className="font-semibold text-white">Activité</h1>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-fc-hover flex-shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${
              filter === f.key
                ? 'bg-fc-accent text-white'
                : 'text-fc-muted hover:text-white hover:bg-fc-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-fc-muted gap-3">
            <Zap size={40} className="opacity-20" />
            <p className="text-sm">Aucune activité pour ce filtre</p>
          </div>
        ) : (
          <div className="p-2">
            {visible.map(item => (
              <ActivityRow key={item.id} item={item} />
            ))}

            {/* Chargement infini */}
            {hasNextPage && (
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full mt-2 py-2 text-xs text-fc-muted hover:text-white transition text-center"
              >
                {isFetchingNextPage ? 'Chargement...' : 'Voir plus'}
              </button>
            )}

            {isError && (
              <p className="text-center text-xs text-fc-muted py-2">
                Erreur lors du chargement de l'activité.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
