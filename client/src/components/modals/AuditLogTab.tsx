import { useState } from 'react'
import {
  ScrollText, UserPlus, UserMinus, UserX, ShieldOff, ShieldCheck,
  Hash, Trash2, Crown, MessageSquareX, Settings,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { useT, t as tr, type Key } from '../../i18n'

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
  server: Server
}

type ActionFilter = 'all' | string

// Les clés DOIVENT matcher exactement les chaînes passées à log_event() côté backend
// (server/src/handlers/*.rs) -- toutes en MAJUSCULES_SNAKE_CASE. Un mismatch de casse
// ici faisait que le journal entier retombait silencieusement sur l'icône/label
// générique pour CHAQUE entrée, jamais un seul match réel. Libellés : clés audit.<ACTION>.
const ACTION_CONFIG: Record<string, { color: string; Icon: any }> = {
  MEMBER_JOIN:     { color: 'text-fc-green',   Icon: UserPlus },
  MEMBER_LEAVE:    { color: 'text-fc-muted',   Icon: UserMinus },
  MEMBER_KICK:     { color: 'text-orange-400', Icon: UserX },
  MEMBER_BAN:      { color: 'text-fc-red',     Icon: ShieldOff },
  MEMBER_UNBAN:    { color: 'text-fc-green',   Icon: ShieldCheck },
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
}

const ACTION_OPTIONS = ['all', ...Object.keys(ACTION_CONFIG)]

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return tr('audit.now')
  if (diff < 3600) return tr('audit.minAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return tr('audit.hAgo', { n: Math.floor(diff / 3600) })
  return tr('audit.dAgo', { n: Math.floor(diff / 86400) })
}

export default function AuditLogTab({ server }: Props) {
  const t = useT()
  const actionLabel = (a: string) => (a === 'all' ? t('audit.all') : ACTION_CONFIG[a] ? t(`audit.${a}` as Key) : a)
  const [filter, setFilter] = useState<ActionFilter>('all')

  const { data: entries = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit', server.id],
    queryFn: () => api.get(`/servers/${server.id}/audit`).then(r => r.data),
    refetchInterval: 30_000,
    retry: false,
  })

  const filtered = filter === 'all' ? entries : entries.filter(e => e.action === filter)

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <ScrollText size={18} className="text-fc-accent" aria-hidden />
          {t('audit.title')}
        </h3>
        <p className="text-sm text-fc-muted mb-4">{t('audit.intro')}</p>

        {/* Filtre */}
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label={t('audit.filter')}
          className="px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm mb-5"
        >
          {ACTION_OPTIONS.map(a => (
            <option key={a} value={a}>{actionLabel(a)}</option>
          ))}
        </select>

        {/* Timeline */}
        {isLoading ? (
          <div role="status" aria-label={t('audit.loading')} className="text-center text-fc-muted py-10 text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div role="status" className="text-center text-fc-muted py-10 text-sm">{t('audit.none')}</div>
        ) : (
          <div className="relative">
            {/* Ligne verticale */}
            <div aria-hidden className="absolute left-4 top-0 bottom-0 w-px bg-fc-hover" />

            <ul role="list" aria-label={t('audit.entries')} className="space-y-1">
              {filtered.map(entry => {
                const cfg = ACTION_CONFIG[entry.action] ?? {
                  color: 'text-fc-muted',
                  Icon: ScrollText,
                }
                const { color, Icon } = cfg
                const label = actionLabel(entry.action)
                const actor = entry.username ?? t('audit.unknownUser')
                const entryLabel = entry.target_name
                  ? `${actor} — ${label} → ${entry.target_name} (${timeAgo(entry.created_at)})`
                  : `${actor} — ${label} (${timeAgo(entry.created_at)})`
                return (
                  <li key={entry.id} aria-label={entryLabel} className="flex gap-4 pl-2 py-2 group hover:bg-fc-hover/20 rounded-lg transition">
                    {/* Icône sur la timeline */}
                    <div aria-hidden className={`w-6 h-6 rounded-full bg-fc-channel flex items-center justify-center flex-shrink-0 z-10 border-2 border-fc-bg ${color}`}>
                      <Icon size={11} />
                    </div>

                    {/* Contenu */}
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

                    <div className="text-xs text-fc-muted flex-shrink-0 pt-0.5" aria-hidden>
                      {timeAgo(entry.created_at)}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
