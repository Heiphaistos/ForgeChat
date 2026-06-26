import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { Users, MessageSquare, Server, Hash } from 'lucide-react'

interface AdminStats {
  total_users: number
  total_messages: number
  messages_today: number
  total_servers: number
  total_channels: number
  top_servers: { name: string; messages: number }[]
  messages_per_day: { day: string; count: number }[]
}

export default function AdminPage() {
  const nav = useNavigate()
  const { data: stats, isLoading, error } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-full bg-fc-bg">
      <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-full bg-fc-bg gap-3">
      <p className="text-fc-muted">Accès refusé ou erreur</p>
      <button onClick={() => nav(-1)} className="text-fc-accent text-sm hover:underline">← Retour</button>
    </div>
  )

  const cards = [
    { label: 'Utilisateurs', value: stats?.total_users ?? 0, icon: <Users size={20} />, color: 'text-fc-accent' },
    { label: 'Messages', value: stats?.total_messages ?? 0, icon: <MessageSquare size={20} />, color: 'text-green-400' },
    { label: "Aujourd'hui", value: stats?.messages_today ?? 0, icon: <MessageSquare size={20} />, color: 'text-yellow-400' },
    { label: 'Serveurs', value: stats?.total_servers ?? 0, icon: <Server size={20} />, color: 'text-purple-400' },
    { label: 'Canaux', value: stats?.total_channels ?? 0, icon: <Hash size={20} />, color: 'text-blue-400' },
  ]

  const maxMsgs = Math.max(1, ...(stats?.messages_per_day.map(d => d.count) ?? [1]))

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-fc-bg">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Dashboard Admin</h1>
          <button onClick={() => nav(-1)} className="text-fc-muted hover:text-white text-sm transition">← Retour</button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {cards.map(c => (
            <div key={c.label} className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
              <div className={`${c.color} mb-2`}>{c.icon}</div>
              <div className="text-2xl font-bold text-white">{c.value.toLocaleString('fr-FR')}</div>
              <div className="text-xs text-fc-muted mt-1">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <h2 className="text-sm font-semibold text-white mb-4">Messages — 7 derniers jours</h2>
          <div className="flex items-end gap-1 h-24">
            {(stats?.messages_per_day ?? []).map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-fc-accent/70 hover:bg-fc-accent rounded-t transition"
                  style={{ height: `${Math.max(4, Math.round((d.count / maxMsgs) * 80))}px` }}
                  title={`${d.day}: ${d.count}`}
                />
                <span className="text-[10px] text-fc-muted">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        {(stats?.top_servers?.length ?? 0) > 0 && (
          <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
            <h2 className="text-sm font-semibold text-white mb-3">Top serveurs (7 jours)</h2>
            <div className="space-y-2">
              {stats!.top_servers.map((s, i) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="text-fc-muted text-sm w-5 text-right">{i + 1}.</span>
                  <span className="text-white text-sm flex-1">{s.name}</span>
                  <span className="text-fc-accent text-sm font-medium">{s.messages.toLocaleString('fr-FR')} msgs</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
