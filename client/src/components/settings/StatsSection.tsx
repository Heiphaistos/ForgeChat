import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Stats {
  messages_sent: number
  servers_joined: number
  friends_count: number
  reactions_given: number
  reactions_received: number
  member_since: string
}

export default function StatsSection() {
  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ['my-stats'],
    queryFn: () => api.get('/users/me/stats').then(r => r.data),
    staleTime: 300_000,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const items = [
    { label: 'Messages envoyés', value: stats?.messages_sent ?? 0, emoji: '💬' },
    { label: 'Serveurs rejoints', value: stats?.servers_joined ?? 0, emoji: '🌐' },
    { label: 'Amis', value: stats?.friends_count ?? 0, emoji: '👥' },
    { label: 'Réactions données', value: stats?.reactions_given ?? 0, emoji: '⚡' },
    { label: 'Réactions reçues', value: stats?.reactions_received ?? 0, emoji: '❤️' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {items.map(item => (
          <div key={item.label} className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
            <div className="text-2xl mb-1">{item.emoji}</div>
            <div className="text-2xl font-bold text-white">{item.value.toLocaleString('fr-FR')}</div>
            <div className="text-xs text-fc-muted mt-0.5">{item.label}</div>
          </div>
        ))}
      </div>
      {stats?.member_since && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover text-sm text-fc-muted">
          Membre depuis{' '}
          <span className="text-white font-medium">
            {formatDistanceToNow(new Date(stats.member_since), { addSuffix: true, locale: fr })}
          </span>
        </div>
      )}
    </div>
  )
}
