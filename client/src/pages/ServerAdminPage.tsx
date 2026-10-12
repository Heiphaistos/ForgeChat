import { useState, Component, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart2, ScrollText, Shield, Calendar, Flag, ArrowLeft, Trash2, AlertTriangle, CheckCircle, XCircle, ChevronLeft } from 'lucide-react'
import { useMobile } from '../contexts/MobileContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import toast from 'react-hot-toast'
import { confirm } from '../components/ui/ConfirmModal'
import ServerStatsPage from './ServerStatsPage'
import AuditLogPage from './AuditLogPage'
import AutoModPage from './AutoModPage'
import ServerEventsPage from './ServerEventsPage'
import { intlLocale } from '../i18n'

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
  message_content: string | null
  reason: string
  comment: string | null
  status: string
  created_at: string
  author_id?: string | null
  author_username?: string | null
  actions?: { action: string; detail: string | null; at: string; moderator: string | null }[]
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

  const textChannels = channels.filter(c => c.type === 'text' || c.type === 'announcement')

  const purge = useMutation({
    mutationFn: () => api.post(`/channels/${purgeChannelId}/purge`, {
      // datetime-local n'a pas de fuseau : sans conversion, le serveur l'interprète dans le sien.
      before: purgeBefore ? new Date(purgeBefore).toISOString() : undefined,
      limit: purgeLimit,
    }),
    onSuccess: (r) => toast.success(`${r.data.deleted} messages supprimés`),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Erreur lors de la purge'),
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
          onClick={async () => {
            if (!purgeChannelId) return
            if (!await confirm({ message: `Purger jusqu'à ${purgeLimit} messages ? Action irréversible.`, title: 'Purge de messages', danger: true, confirmLabel: 'Purger' })) return
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

  // Actions rapides (amélioration n° 39) : même code et mêmes permissions qu'ailleurs, signalement
  // clos et action inscrite à son historique.
  const act = useMutation({
    mutationFn: ({ id, action, duration_minutes }: { id: string; action: string; duration_minutes?: number }) =>
      api.post(`/servers/${serverId}/reports/${id}/action`, { action, duration_minutes }),
    onSuccess: () => { toast.success('Action appliquée'); qc.invalidateQueries({ queryKey: ['server-reports', serverId] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Action impossible'),
  })
  const ACTION_LABEL: Record<string, string> = {
    delete: 'message supprimé', timeout: 'exclusion temporaire', kick: 'expulsion', ban: 'bannissement',
    resolve: 'clos', dismiss: 'rejeté',
  }
  const quick = async (r: Report, action: string, label: string, duration_minutes?: number) => {
    if (await confirm({ message: `${label} ${r.author_username ? `(${r.author_username})` : ''} ?`, title: 'Signalement', danger: true, confirmLabel: label })) {
      act.mutate({ id: r.id, action, duration_minutes })
    }
  }

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
              <span className="text-xs text-fc-muted">{new Date(r.created_at).toLocaleDateString(intlLocale())}</span>
            </div>
            <p className="text-xs text-fc-muted mt-1 truncate italic">
              {r.message_content ? `"${r.message_content}"` : 'Message supprimé depuis'}
            </p>
            {r.comment && (
              <p className="text-xs text-fc-muted mt-1 truncate">{r.comment}</p>
            )}
            {r.author_username && <p className="text-xs text-fc-muted mt-1">Auteur : {r.author_username}</p>}
            {r.status === 'pending' && r.author_id && (
              <div className="flex flex-wrap gap-1 mt-2">
                <button onClick={() => quick(r, 'delete', 'Supprimer le message')} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">Supprimer le message</button>
                <button onClick={() => quick(r, 'timeout', 'Exclure 1 h', 60)} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">Exclure 1 h</button>
                <button onClick={() => quick(r, 'timeout', 'Exclure 24 h', 1440)} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">Exclure 24 h</button>
                <button onClick={() => quick(r, 'kick', 'Expulser')} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">Expulser</button>
                <button onClick={() => quick(r, 'ban', 'Bannir')} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-red/80 text-white hover:bg-fc-red">Bannir</button>
              </div>
            )}
            {!!r.actions?.length && (
              <ul className="mt-2 text-[11px] text-fc-muted space-y-0.5">
                {r.actions.map((a, i) => (
                  <li key={i}>• {new Date(a.at).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' })} — {a.moderator ?? '?'} : {ACTION_LABEL[a.action] ?? a.action}{a.detail ? ` (${a.detail})` : ''}</li>
                ))}
              </ul>
            )}
          </div>
          {r.status === 'pending' && (
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={() => act.mutate({ id: r.id, action: 'resolve' })}
                disabled={act.isPending}
                title="Marquer comme résolu"
                className="p-1 rounded hover:bg-fc-green/20 text-fc-green transition"
              >
                <CheckCircle size={16} />
              </button>
              <button
                onClick={() => act.mutate({ id: r.id, action: 'dismiss' })}
                disabled={act.isPending}
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
          className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
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
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
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
