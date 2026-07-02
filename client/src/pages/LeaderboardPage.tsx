import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import api from '../api/client'
import { ChevronLeft } from 'lucide-react'
import { useMobile } from '../contexts/MobileContext'

interface LeaderboardEntry {
  user_id: string
  username: string
  avatar: string | null
  messages: number
  active_days: number
}

const MEDALS = ['🥇', '🥈', '🥉']
const PERIODS = [
  { value: 'week', label: '7 jours' },
  { value: 'month', label: '30 jours' },
  { value: 'all', label: 'Tout' },
]

export default function LeaderboardPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const { user } = useAuth()
  const { openSidebar } = useMobile()
  const [period, setPeriod] = useState('month')

  const { data: entries = [], isLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard', serverId, period],
    queryFn: () => api.get(`/servers/${serverId}/leaderboard?period=${period}`).then(r => r.data),
    enabled: !!serverId,
  })

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-fc-muted text-sm">Chargement du classement...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              className="md:hidden flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
              onClick={openSidebar}
              aria-label="Retour"
            >
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-2xl font-bold text-white">Classement</h1>
          </div>
          <div className="flex gap-1 bg-fc-channel rounded-lg p-1">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-sm rounded-md transition ${
                  period === p.value
                    ? 'bg-fc-accent text-white'
                    : 'text-fc-muted hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="text-center py-16 text-fc-muted">
            Aucune activité sur cette période
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, idx) => {
              const isMe = entry.user_id === user?.id
              return (
                <div
                  key={entry.user_id}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition ${
                    isMe
                      ? 'bg-fc-accent/10 border-fc-accent/30'
                      : 'bg-fc-channel border-fc-hover hover:border-fc-accent/20'
                  }`}
                >
                  <div className="w-8 text-center flex-shrink-0">
                    {idx < 3
                      ? <span className="text-xl">{MEDALS[idx]}</span>
                      : <span className="text-fc-muted font-bold text-sm">#{idx + 1}</span>
                    }
                  </div>

                  <div className="w-9 h-9 rounded-full bg-fc-hover flex-shrink-0 overflow-hidden">
                    {entry.avatar ? (
                      <img src={entry.avatar} alt={entry.username} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-fc-muted text-sm font-bold">
                        {entry.username[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${isMe ? 'text-fc-accent' : 'text-white'}`}>
                      {entry.username}
                      {isMe && <span className="ml-2 text-xs text-fc-accent">(vous)</span>}
                    </p>
                    <p className="text-xs text-fc-muted">
                      {entry.active_days} jour{entry.active_days > 1 ? 's' : ''} actif{entry.active_days > 1 ? 's' : ''}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-white font-semibold">{entry.messages.toLocaleString()}</p>
                    <p className="text-xs text-fc-muted">messages</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
