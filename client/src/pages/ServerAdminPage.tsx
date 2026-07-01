import { useState, Component, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart2, ScrollText, Shield, Calendar, Flag, ArrowLeft, Trash2, AlertTriangle, CheckCircle, XCircle, ChevronLeft } from 'lucide-react'
import { useMobile } from '../contexts/MobileContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import toast from 'react-hot-toast'
import ServerStatsPage from './ServerStatsPage'
import AuditLogPage from './AuditLogPage'
import AutoModPage from './AutoModPage'
import ServerEventsPage from './ServerEventsPage'

class TabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-fc-muted">
        <AlertTriangle size={28} className="text-fc-red" />
        <p className="text-sm">Une erreur est survenue dans cet onglet.</p>
        <p className="text-xs opacity-60">{(this.state.error as Error).message}</p>
        <button onClick={() => this.setState({ error: null })} className="text-xs text-fc-accent hover:underline mt-1">Réessayer</button>
      </div>
    )
    return this.props.children
  }
}

type Tab = 'stats' | 'audit' | 'automod' | 'events' | 'reports' | 'moderation'

interface Report {
  id: string
  reporter_username: string
  message_id: string
  reason: string
  comment: string | null
  status: string
  created_at: string
}

interface Channel {
  id: string
  name: string
  type: string
}

function ModerationTab({ serverId }: { serverId: string }) {
  const [purgeChannelId, setPurgeChannelId] = useState('')
  const [purgeBefore, setPurgeBefore] = useState('')
  const [purgeLimit, setPurgeLimit] = useState(100)

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['server-channels-mod', serverId],
    queryFn: () => api.get(`/servers/${serverId}/channels`).then(r => r.data),
  })

  const textChannels = channels.filter(c => c.type === 'text')

  const purge = useMutation({
    mutationFn: () => api.post(`/channels/${purgeChannelId}/purge`, {
      before: purgeBefore || undefined,
      limit: purgeLimit,
    }),
    onSuccess: (r) => toast.success(`${r.data.deleted} messages supprimés`),
    onError: () => toast.error('Erreur lors de la purge'),
  })

  return (
    <div className="space-y-4">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-red/30 space-y-3">
        <h3 className="text-sm font-semibold text-fc-red flex items-center gap-2">
          <Trash2 size={14} />
          Purge de messages
        </h3>
        <p className="text-xs text-fc-muted">Supprime des messages en masse dans un canal. Action irréversible.</p>

        <select
          value={purgeChannelId}
          onChange={e => setPurgeChannelId(e.target.value)}
          className="w-full fc-input text-sm"
        >
          <option value="">Choisir un canal...</option>
          {textChannels.map(c => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>

        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={purgeBefore}
            onChange={e => setPurgeBefore(e.target.value)}
            className="flex-1 fc-input text-sm"
            placeholder="Avant (optionnel)"
          />
          <input
            type="number"
            value={purgeLimit}
            onChange={e => setPurgeLimit(Number(e.target.value))}
            min={1}
            max={1000}
            className="w-24 fc-input text-sm"
          />
        </div>

        <button
          onClick={() => {
            if (!purgeChannelId) return
            if (!confirm(`Purger jusqu'à ${purgeLimit} messages ? Action irréversible.`)) return
            purge.mutate()
          }}
          disabled={!purgeChannelId || purge.isPending}
          className="px-4 py-2 bg-fc-red hover:bg-fc-red/80 text-white text-sm rounded-lg transition disabled:opacity-50"
        >
          {purge.isPending ? 'Purge en cours...' : 'Purger les messages'}
        </button>
      </div>
    </div>
  )
}

function ReportsTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const { data: reports = [], isLoading } = useQuery<Report[]>({
    queryKey: ['server-reports', serverId],
    queryFn: () => api.get(`/servers/${serverId}/reports`).then(r => r.data),
  })

  const updateReport = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/servers/${serverId}/reports/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server-reports', serverId] }),
    onError: () => toast.error('Erreur lors de la mise à jour'),
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
            r.status === 'pending' ? 'bg-fc-red/20 text-fc-red'
            : r.status === 'resolved' ? 'bg-fc-green/20 text-fc-green'
            : 'bg-fc-hover text-fc-muted'
          }`}>
            {r.status === 'pending' ? 'En attente' : r.status === 'resolved' ? 'Résolu' : 'Rejeté'}
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
          {r.status === 'pending' && (
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={() => updateReport.mutate({ id: r.id, status: 'resolved' })}
                disabled={updateReport.isPending}
                title="Marquer comme résolu"
                className="p-1 rounded hover:bg-fc-green/20 text-fc-green transition"
              >
                <CheckCircle size={16} />
              </button>
              <button
                onClick={() => updateReport.mutate({ id: r.id, status: 'dismissed' })}
                disabled={updateReport.isPending}
                title="Rejeter"
                className="p-1 rounded hover:bg-fc-hover text-fc-muted transition"
              >
                <XCircle size={16} />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function ServerAdminPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const nav = useNavigate()
  const { openSidebar } = useMobile()
  const [tab, setTab] = useState<Tab>('stats')

  if (!serverId) return null

  const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'stats',      label: 'Statistiques',     Icon: BarChart2 },
    { id: 'audit',      label: 'Journal d\'audit', Icon: ScrollText },
    { id: 'automod',    label: 'AutoMod',           Icon: Shield },
    { id: 'events',     label: 'Événements',        Icon: Calendar },
    { id: 'reports',    label: 'Signalements',      Icon: Flag },
    { id: 'moderation', label: 'Modération',        Icon: Trash2 },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-fc-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-fc-hover flex-shrink-0">
        {/* Mobile: ouvrir la sidebar pour naviguer */}
        <button
          className="md:hidden flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label="Retour"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => nav(-1)}
          className="hidden md:flex p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
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
        <TabErrorBoundary key={tab}>
          {tab === 'stats'      && <ServerStatsPage serverId={serverId} />}
          {tab === 'audit'      && <AuditLogPage serverId={serverId} />}
          {tab === 'automod'    && <AutoModPage serverId={serverId} />}
          {tab === 'events'     && <ServerEventsPage serverId={serverId} />}
          {tab === 'reports'    && <ReportsTab serverId={serverId} />}
          {tab === 'moderation' && <ModerationTab serverId={serverId} />}
        </TabErrorBoundary>
      </div>
    </div>
  )
}
