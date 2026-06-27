import { useState } from 'react'
import {
  ScrollText, UserPlus, UserMinus, UserX, ShieldOff, ShieldCheck,
  Hash, Trash2, Crown, MessageSquareX, Settings,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'

interface Server {
  id: string
}

interface AuditEntry {
  id: string
  action: string
  user_id: string
  username: string
  target_id: string | null
  target_name: string | null
  details: string | null
  created_at: string
}

interface Props {
  server: Server
}

type ActionFilter = 'all' | string

const ACTION_CONFIG: Record<string, { label: string; color: string; Icon: any }> = {
  member_join:    { label: 'Membre rejoint',        color: 'text-fc-green',   Icon: UserPlus },
  member_leave:   { label: 'Membre parti',          color: 'text-fc-muted',   Icon: UserMinus },
  member_kick:    { label: 'Membre expulsé',        color: 'text-orange-400', Icon: UserX },
  member_ban:     { label: 'Membre banni',          color: 'text-fc-red',     Icon: ShieldOff },
  member_unban:   { label: 'Membre débanni',        color: 'text-fc-green',   Icon: ShieldCheck },
  channel_create: { label: 'Canal créé',            color: 'text-blue-400',   Icon: Hash },
  channel_delete: { label: 'Canal supprimé',        color: 'text-orange-400', Icon: Trash2 },
  role_create:    { label: 'Rôle créé',             color: 'text-blue-400',   Icon: Crown },
  role_delete:    { label: 'Rôle supprimé',         color: 'text-orange-400', Icon: Trash2 },
  message_delete: { label: 'Message supprimé',      color: 'text-fc-red',     Icon: MessageSquareX },
  server_update:  { label: 'Serveur modifié',       color: 'text-blue-400',   Icon: Settings },
}

const ACTION_OPTIONS = [
  { value: 'all', label: 'Toutes les actions' },
  ...Object.entries(ACTION_CONFIG).map(([k, v]) => ({ value: k, label: v.label })),
]

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'à l\'instant'
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`
  return `il y a ${Math.floor(diff / 86400)} j`
}

export default function AuditLogTab({ server }: Props) {
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
          <ScrollText size={18} className="text-fc-accent" />
          Journal d'audit
        </h3>
        <p className="text-sm text-fc-muted mb-4">Historique des actions effectuées sur le serveur.</p>

        {/* Filtre */}
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm mb-5"
        >
          {ACTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Timeline */}
        {isLoading ? (
          <div className="text-center text-fc-muted py-10 text-sm">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-fc-muted py-10 text-sm">Aucune entrée dans le journal.</div>
        ) : (
          <div className="relative">
            {/* Ligne verticale */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-fc-hover" />

            <div className="space-y-1">
              {filtered.map(entry => {
                const cfg = ACTION_CONFIG[entry.action] ?? {
                  label: entry.action,
                  color: 'text-fc-muted',
                  Icon: ScrollText,
                }
                const { label, color, Icon } = cfg
                return (
                  <div key={entry.id} className="flex gap-4 pl-2 py-2 group hover:bg-fc-hover/20 rounded-lg transition">
                    {/* Icône sur la timeline */}
                    <div className={`w-6 h-6 rounded-full bg-fc-channel flex items-center justify-center flex-shrink-0 z-10 border-2 border-fc-bg ${color}`}>
                      <Icon size={11} />
                    </div>

                    {/* Contenu */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-white text-sm font-medium">{entry.username}</span>
                        <span className={`text-xs ${color}`}>{label}</span>
                        {entry.target_name && (
                          <span className="text-xs text-fc-muted">→ <span className="text-white">{entry.target_name}</span></span>
                        )}
                      </div>
                      {entry.details && (
                        <div className="text-xs text-fc-muted mt-0.5 truncate">{entry.details}</div>
                      )}
                    </div>

                    <div className="text-xs text-fc-muted flex-shrink-0 pt-0.5">
                      {timeAgo(entry.created_at)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
