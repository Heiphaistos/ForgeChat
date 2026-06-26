import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart2, ScrollText, Shield, Calendar, Flag, ArrowLeft } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import ServerStatsPage from './ServerStatsPage'
import AuditLogPage from './AuditLogPage'
import AutoModPage from './AutoModPage'
import ServerEventsPage from './ServerEventsPage'

type Tab = 'stats' | 'audit' | 'automod' | 'events' | 'reports'

interface Report {
  id: string
  reporter_username: string
  message_id: string
  reason: string
  comment: string | null
  status: string
  created_at: string
}

function ReportsTab({ serverId }: { serverId: string }) {
  const { data: reports = [], isLoading } = useQuery<Report[]>({
    queryKey: ['server-reports', serverId],
    queryFn: () => api.get(`/servers/${serverId}/reports`).then(r => r.data),
  })

  const REASON_LABEL: Record<string, string> = {
    spam: 'Spam',
    harassment: 'Harcèlement',
    nsfw: 'NSFW',
    other: 'Autre',
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (reports.length === 0) return (
    <div className="text-center text-fc-muted py-16 text-sm">Aucun signalement.</div>
  )

  return (
    <div className="space-y-2">
      {reports.map(r => (
        <div key={r.id} className="bg-fc-channel rounded-lg p-3 flex items-start gap-3">
          <span className={`mt-0.5 flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
            r.status === 'pending' ? 'bg-fc-red/20 text-fc-red' : 'bg-fc-hover text-fc-muted'
          }`}>
            {r.status === 'pending' ? 'En attente' : 'Traité'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-white">{REASON_LABEL[r.reason] ?? r.reason}</span>
              <span className="text-xs text-fc-muted">par {r.reporter_username}</span>
              <span className="text-xs text-fc-muted">{new Date(r.created_at).toLocaleDateString('fr-FR')}</span>
            </div>
            {r.comment && (
              <p className="text-xs text-fc-muted mt-1 truncate">{r.comment}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ServerAdminPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('stats')

  if (!serverId) return null

  const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'stats',   label: 'Statistiques',     Icon: BarChart2 },
    { id: 'audit',   label: 'Journal d\'audit', Icon: ScrollText },
    { id: 'automod', label: 'AutoMod',           Icon: Shield },
    { id: 'events',  label: 'Événements',        Icon: Calendar },
    { id: 'reports', label: 'Signalements',      Icon: Flag },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-fc-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-fc-hover flex-shrink-0">
        <button
          onClick={() => nav(-1)}
          className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
          title="Retour"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-semibold text-base">Panel Administration</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-fc-hover flex-shrink-0 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              tab === id
                ? 'bg-fc-accent text-white'
                : 'text-fc-muted hover:text-white hover:bg-fc-hover'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'stats'   && <ServerStatsPage serverId={serverId} />}
        {tab === 'audit'   && <AuditLogPage serverId={serverId} />}
        {tab === 'automod' && <AutoModPage serverId={serverId} />}
        {tab === 'events'  && <ServerEventsPage serverId={serverId} />}
        {tab === 'reports' && <ReportsTab serverId={serverId} />}
      </div>
    </div>
  )
}
