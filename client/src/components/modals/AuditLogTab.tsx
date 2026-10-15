import { useState } from 'react'
import {
  ScrollText, UserPlus, UserMinus, UserX, ShieldOff, ShieldCheck,
  Hash, Trash2, Crown, PenLine, MessageSquareX, Settings, Download, Lock, Unlock, Ticket,
} from 'lucide-react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT, t as tr, type Key } from '../../i18n'
import { toCsv } from '../community/format'
import { saveFile } from '../../lib/saveFile'

interface Server {
  id: string
}

interface AuditEntry {
  id: string
  action: string
  user_id: string | null
  username: string | null
  target_id: string | null
  target_name: string | null
  details: Record<string, unknown> | null
  created_at: string
}

interface Props {
  // Seul l'identifiant sert : aussi utilisé par la page d'administration (ServerAdminPage).
  server: Pick<Server, 'id'>
}

// Les clés DOIVENT matcher exactement les chaînes passées à log_event() côté backend
// (server/src/handlers/*.rs). Libellés : clés audit.<ACTION>.
const ACTION_CONFIG: Record<string, { color: string; Icon: any }> = {
  MEMBER_JOIN:     { color: 'text-fc-green',   Icon: UserPlus },
  MEMBER_LEAVE:    { color: 'text-fc-muted',   Icon: UserMinus },
  MEMBER_KICK:     { color: 'text-orange-400', Icon: UserX },
  MEMBER_BAN:      { color: 'text-fc-red',     Icon: ShieldOff },
  MEMBER_UNBAN:    { color: 'text-fc-green',   Icon: ShieldCheck },
  MEMBER_NICKNAME_CHANGE: { color: 'text-blue-400', Icon: PenLine },
  CHANNEL_CREATE:  { color: 'text-blue-400',   Icon: Hash },
  CHANNEL_DELETE:  { color: 'text-orange-400', Icon: Trash2 },
  ROLE_CREATE:     { color: 'text-blue-400',   Icon: Crown },
  ROLE_UPDATE:     { color: 'text-blue-400',   Icon: Crown },
  ROLE_DELETE:     { color: 'text-orange-400', Icon: Trash2 },
  MESSAGE_DELETE:  { color: 'text-fc-red',     Icon: MessageSquareX },
  MESSAGE_PIN:     { color: 'text-blue-400',   Icon: Hash },
  MESSAGE_UNPIN:   { color: 'text-fc-muted',   Icon: Hash },
  SERVER_UPDATE:   { color: 'text-blue-400',   Icon: Settings },
  OWNER_TRANSFER:  { color: 'text-red-400',    Icon: Crown },
  LOCKDOWN_ON:     { color: 'text-fc-red',     Icon: Lock },
  LOCKDOWN_OFF:    { color: 'text-fc-green',   Icon: Unlock },
  TICKET_OPEN:     { color: 'text-blue-400',   Icon: Ticket },
  TICKET_STATUS:   { color: 'text-fc-muted',   Icon: Ticket },
  TICKETS_UPDATE:  { color: 'text-blue-400',   Icon: Ticket },
  AUTOMOD_UPDATE:  { color: 'text-blue-400',   Icon: Settings },
  LEVELS_UPDATE:   { color: 'text-blue-400',   Icon: Settings },
  STARBOARD_UPDATE: { color: 'text-blue-400',  Icon: Settings },
  WELCOME_UPDATE:  { color: 'text-blue-400',   Icon: Settings },
  MEMBER_MOVE:     { color: 'text-blue-400',   Icon: UserX },
  MEMBER_DISCONNECT: { color: 'text-orange-400', Icon: UserX },
  MEMBER_VOICE_UPDATE: { color: 'text-orange-400', Icon: UserX },
  PURGE_MESSAGES:  { color: 'text-fc-red',     Icon: MessageSquareX },
  // Écrites par l'équipe du site (site_admin.rs, server_audit), en minuscules.
  site_supervision:     { color: 'text-red-400',  Icon: ShieldCheck },
  site_supervision_end: { color: 'text-fc-muted', Icon: ShieldCheck },
  site_suspend:         { color: 'text-fc-red',   Icon: Lock },
  site_unsuspend:       { color: 'text-fc-green', Icon: Unlock },
}

const PAGE = 50

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return tr('audit.now')
  if (diff < 3600) return tr('audit.minAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return tr('audit.hAgo', { n: Math.floor(diff / 3600) })
  return tr('audit.dAgo', { n: Math.floor(diff / 86400) })
}

const inputCls = 'px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm'

export default function AuditLogTab({ server }: Props) {
  const t = useT()
  const actionLabel = (a: string) => (a === 'all' ? t('audit.all') : ACTION_CONFIG[a] ? t(`audit.${a}` as Key) : a)
  const [action, setAction] = useState('all')
  const [userId, setUserId] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data: facets } = useQuery<{ actions: string[]; users: { user_id: string; username: string | null }[] }>({
    queryKey: ['audit_facets', server.id],
    queryFn: () => api.get(`/servers/${server.id}/audit/facets`).then(r => r.data),
    retry: false,
  })

  // Dates saisies en heure locale, envoyées en UTC ; « au » inclut toute la journée.
  const params = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams()
    if (action !== 'all') p.set('action', action)
    if (userId) p.set('user_id', userId)
    if (q.trim()) p.set('q', q.trim())
    if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString())
    if (to) p.set('to', new Date(`${to}T23:59:59`).toISOString())
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v))
    return p.toString()
  }

  const query = useInfiniteQuery<AuditEntry[]>({
    queryKey: ['audit', server.id, action, userId, q, from, to],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get(`/servers/${server.id}/audit?${params(pageParam ? { limit: PAGE, before: pageParam as string } : { limit: PAGE })}`).then(r => r.data),
    getNextPageParam: last => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    refetchInterval: 30_000,
    retry: false,
  })
  const entries = query.data?.pages.flat() ?? []
  const actions = ['all', ...new Set([...(facets?.actions ?? []), ...Object.keys(ACTION_CONFIG)])]

  const exportAs = async (format: 'csv' | 'json') => {
    try {
      const { data } = await api.get<AuditEntry[]>(`/servers/${server.id}/audit?${params({ limit: 1000 })}`)
      const stamp = new Date().toISOString().slice(0, 10)
      const saved = format === 'json'
        ? await saveFile(JSON.stringify(data, null, 2), `audit-${stamp}.json`, 'application/json')
        : await saveFile(toCsv(data as unknown as Record<string, unknown>[], ['created_at', 'action', 'username', 'user_id', 'target_name', 'target_id', 'details']), `audit-${stamp}.csv`, 'text/csv')
      if (saved) toast.success(t('community.audit.exported', { n: data.length }))
    } catch {
      toast.error(t('common.error'))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <ScrollText size={18} className="text-fc-accent" aria-hidden />
          {t('audit.title')}
        </h3>
        <p className="text-sm text-fc-muted mb-4">{t('audit.intro')}</p>

        {/* Filtres : action, auteur, période, recherche ; export de ce qui est filtré */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <select value={action} onChange={e => setAction(e.target.value)} aria-label={t('audit.filter')} className={inputCls}>
            {actions.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
          <select value={userId} onChange={e => setUserId(e.target.value)} aria-label={t('community.audit.who')} className={inputCls}>
            <option value="">{t('community.audit.everyone')}</option>
            {(facets?.users ?? []).map(u => <option key={u.user_id} value={u.user_id}>{u.username ?? u.user_id}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label={t('community.audit.from')} className={inputCls} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label={t('community.audit.to')} className={inputCls} />
          <input value={q} onChange={e => setQ(e.target.value)} maxLength={100} placeholder={t('community.audit.search')}
            aria-label={t('community.audit.search')} className={`${inputCls} sm:col-span-2`} />
        </div>
        <div className="flex gap-2 mb-5">
          <button onClick={() => exportAs('csv')} className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-hover text-white rounded text-sm"><Download size={13} aria-hidden /> CSV</button>
          <button onClick={() => exportAs('json')} className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-hover text-white rounded text-sm"><Download size={13} aria-hidden /> JSON</button>
        </div>

        {/* Timeline */}
        {query.isLoading ? (
          <div role="status" aria-label={t('audit.loading')} className="text-center text-fc-muted py-10 text-sm">{t('common.loading')}</div>
        ) : entries.length === 0 ? (
          <div role="status" className="text-center text-fc-muted py-10 text-sm">{t('audit.none')}</div>
        ) : (
          <div className="relative">
            <div aria-hidden className="absolute left-4 top-0 bottom-0 w-px bg-fc-hover" />
            <ul role="list" aria-label={t('audit.entries')} className="space-y-1">
              {entries.map(entry => {
                const { color, Icon } = ACTION_CONFIG[entry.action] ?? { color: 'text-fc-muted', Icon: ScrollText }
                const label = actionLabel(entry.action)
                const actor = entry.username ?? t('audit.unknownUser')
                const entryLabel = entry.target_name
                  ? `${actor} — ${label} → ${entry.target_name} (${timeAgo(entry.created_at)})`
                  : `${actor} — ${label} (${timeAgo(entry.created_at)})`
                return (
                  <li key={entry.id} aria-label={entryLabel} className="flex gap-4 pl-2 py-2 group hover:bg-fc-hover/20 rounded-lg transition">
                    <div aria-hidden className={`w-6 h-6 rounded-full bg-fc-channel flex items-center justify-center flex-shrink-0 z-10 border-2 border-fc-bg ${color}`}>
                      <Icon size={11} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5" aria-hidden>
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-white text-sm font-medium">{actor}</span>
                        <span className={`text-xs ${color}`}>{label}</span>
                        {entry.target_name && (
                          <span className="text-xs text-fc-muted">→ <span className="text-white">{entry.target_name}</span></span>
                        )}
                      </div>
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <div className="text-xs text-fc-muted mt-0.5 truncate">
                          {Object.entries(entry.details).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-fc-muted flex-shrink-0 pt-0.5" aria-hidden title={new Date(entry.created_at).toLocaleString()}>
                      {timeAgo(entry.created_at)}
                    </div>
                  </li>
                )
              })}
            </ul>
            {query.hasNextPage && (
              <button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}
                className="mt-3 w-full py-2 text-sm text-fc-accent hover:bg-fc-hover/30 rounded">
                {t('community.audit.more')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
