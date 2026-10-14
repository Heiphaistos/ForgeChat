import { useState, Component, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart2, ScrollText, Shield, Calendar, Flag, ArrowLeft, Trash2, AlertTriangle, CheckCircle, XCircle, ChevronLeft } from 'lucide-react'
import { useMobile } from '../contexts/MobileContext'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import toast from 'react-hot-toast'
import { confirm } from '../components/ui/ConfirmModal'
import ServerStatsPage from './ServerStatsPage'
import AuditLogTab from '../components/modals/AuditLogTab'
import AutoModPage from './AutoModPage'
import ServerEventsPage from './ServerEventsPage'
import { intlLocale, useT, t as tr } from '../i18n'

// Composant classe : pas de hook, la langue est lue via tr() au rendu.
class TabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-fc-muted">
        <AlertTriangle size={28} className="text-fc-red" />
        <p className="text-sm">{tr('sadm.tabError')}</p>
        <p className="text-xs opacity-60">{(this.state.error as Error).message}</p>
        <button onClick={() => this.setState({ error: null })} className="text-xs text-fc-accent hover:underline mt-1">{tr('sadm.retry')}</button>
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
  const t = useT()
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
    onSuccess: (r) => toast.success(t('sadm.purge.done', { n: r.data.deleted })),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? t('sadm.purge.fail')),
  })

  return (
    <div className="space-y-4">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-red/30 space-y-3">
        <h3 className="text-sm font-semibold text-fc-red flex items-center gap-2">
          <Trash2 size={14} />
          {t('sadm.purge.title')}
        </h3>
        <p className="text-xs text-fc-muted">{t('sadm.purge.hint')}</p>

        <select
          value={purgeChannelId}
          onChange={e => setPurgeChannelId(e.target.value)}
          aria-label={t('sadm.purge.channel')}
          className="w-full fc-input text-sm"
        >
          <option value="">{t('sadm.purge.pick')}</option>
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
            placeholder={t('sadm.purge.before')}
            aria-label={t('sadm.purge.before')}
          />
          <input
            type="number"
            value={purgeLimit}
            onChange={e => setPurgeLimit(Number(e.target.value))}
            min={1}
            max={1000}
            aria-label={t('sadm.purge.limit')}
            className="w-24 fc-input text-sm"
          />
        </div>

        <button
          onClick={async () => {
            if (!purgeChannelId) return
            if (!await confirm({ message: t('sadm.purge.confirm', { n: purgeLimit }), title: t('sadm.purge.title'), danger: true, confirmLabel: t('sadm.purge.confirmBtn') })) return
            purge.mutate()
          }}
          disabled={!purgeChannelId || purge.isPending}
          className="px-4 py-2 bg-fc-red hover:bg-fc-red/80 text-white text-sm rounded-lg transition disabled:opacity-50"
        >
          {purge.isPending ? t('sadm.purge.running') : t('sadm.purge.go')}
        </button>
      </div>
    </div>
  )
}

function ReportsTab({ serverId }: { serverId: string }) {
  const t = useT()
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
    onSuccess: () => { toast.success(t('sadm.rep.applied')); qc.invalidateQueries({ queryKey: ['server-reports', serverId] }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('sadm.rep.fail')),
  })
  const ACTION_LABEL: Record<string, string> = {
    delete: t('sadm.rep.log.delete'), timeout: t('sadm.rep.log.timeout'), kick: t('sadm.rep.log.kick'), ban: t('sadm.rep.log.ban'),
    resolve: t('sadm.rep.log.resolve'), dismiss: t('sadm.rep.log.dismiss'),
  }
  const quick = async (r: Report, action: string, label: string, duration_minutes?: number) => {
    if (await confirm({ message: `${label} ${r.author_username ? `(${r.author_username})` : ''} ?`, title: t('sadm.rep.title'), danger: true, confirmLabel: label })) {
      act.mutate({ id: r.id, action, duration_minutes })
    }
  }

  const REASON_LABEL: Record<string, string> = {
    spam: t('sadm.rep.reason.spam'),
    harassment: t('sadm.rep.reason.harassment'),
    nsfw: t('sadm.rep.reason.nsfw'),
    other: t('sadm.rep.reason.other'),
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (reports.length === 0) return (
    <div className="text-center text-fc-muted py-16 text-sm">{t('sadm.rep.none')}</div>
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
            {r.status === 'pending' ? t('sadm.rep.pending') : r.status === 'resolved' ? t('sadm.rep.resolved') : t('sadm.rep.dismissed')}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-white">{REASON_LABEL[r.reason] ?? r.reason}</span>
              <span className="text-xs text-fc-muted">{t('sadm.rep.by', { name: r.reporter_username })}</span>
              <span className="text-xs text-fc-muted">{new Date(r.created_at).toLocaleDateString(intlLocale())}</span>
            </div>
            <p className="text-xs text-fc-muted mt-1 truncate italic">
              {r.message_content ? `"${r.message_content}"` : t('sadm.rep.gone')}
            </p>
            {r.comment && (
              <p className="text-xs text-fc-muted mt-1 truncate">{r.comment}</p>
            )}
            {r.author_username && <p className="text-xs text-fc-muted mt-1">{t('sadm.rep.author', { name: r.author_username ?? '' })}</p>}
            {r.status === 'pending' && r.author_id && (
              <div className="flex flex-wrap gap-1 mt-2">
                <button onClick={() => quick(r, 'delete', t('sadm.rep.delete'))} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">{t('sadm.rep.delete')}</button>
                <button onClick={() => quick(r, 'timeout', t('sadm.rep.timeout1'), 60)} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">{t('sadm.rep.timeout1')}</button>
                <button onClick={() => quick(r, 'timeout', t('sadm.rep.timeout24'), 1440)} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">{t('sadm.rep.timeout24')}</button>
                <button onClick={() => quick(r, 'kick', t('sadm.rep.kick'))} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-hover text-white hover:bg-fc-red/30">{t('sadm.rep.kick')}</button>
                <button onClick={() => quick(r, 'ban', t('sadm.rep.ban'))} disabled={act.isPending}
                  className="px-2 py-0.5 text-xs rounded bg-fc-red/80 text-white hover:bg-fc-red">{t('sadm.rep.ban')}</button>
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
                title={t('sadm.rep.markResolved')}
                aria-label={t('sadm.rep.markResolved')}
                className="p-1 rounded hover:bg-fc-green/20 text-fc-green transition"
              >
                <CheckCircle size={16} />
              </button>
              <button
                onClick={() => act.mutate({ id: r.id, action: 'dismiss' })}
                disabled={act.isPending}
                title={t('sadm.rep.dismiss')}
                aria-label={t('sadm.rep.dismiss')}
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
  const t = useT()
  const nav = useNavigate()
  const { openSidebar } = useMobile()
  const [tab, setTab] = useState<Tab>('stats')

  if (!serverId) return null

  const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'stats',      label: t('sadm.tab.stats'),     Icon: BarChart2 },
    { id: 'audit',      label: t('sadm.srv.tab.audit'), Icon: ScrollText },
    { id: 'automod',    label: t('sadm.tab.automod'),           Icon: Shield },
    { id: 'events',     label: t('sadm.tab.events'),        Icon: Calendar },
    { id: 'reports',    label: t('sadm.tab.reports'),      Icon: Flag },
    { id: 'moderation', label: t('sadm.tab.moderation'),        Icon: Trash2 },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-fc-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-fc-hover flex-shrink-0">
        {/* Mobile: ouvrir la sidebar pour naviguer */}
        <button
          className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label={t('sadm.srv.back')}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={() => nav(-1)}
          className="hidden md:flex p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
          title={t('sadm.srv.back')}
          aria-label={t('sadm.srv.back')}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-semibold text-base">{t('sadm.srv.title')}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-fc-hover flex-shrink-0 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0 transition ${
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
          {tab === 'audit'      && <AuditLogTab server={{ id: serverId }} />}
          {tab === 'automod'    && <AutoModPage serverId={serverId} />}
          {tab === 'events'     && <ServerEventsPage serverId={serverId} />}
          {tab === 'reports'    && <ReportsTab serverId={serverId} />}
          {tab === 'moderation' && <ModerationTab serverId={serverId} />}
        </TabErrorBoundary>
      </div>
    </div>
  )
}
