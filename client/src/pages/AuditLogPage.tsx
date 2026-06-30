import { useState, useMemo } from 'react'
import {
  ScrollText, UserPlus, UserMinus, UserX, ShieldOff, ShieldCheck,
  Hash, Trash2, Crown, MessageSquareX, Settings, ChevronDown,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

interface Props {
  serverId: string
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

const ACTION_CONFIG: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  MEMBER_JOIN:    { label: 'Membre rejoint',   color: 'text-green-400',  Icon: UserPlus },
  MEMBER_LEAVE:   { label: 'Membre parti',     color: 'text-fc-muted',   Icon: UserMinus },
  MEMBER_KICK:    { label: 'Membre expulsé',   color: 'text-fc-red',     Icon: UserX },
  MEMBER_BAN:     { label: 'Membre banni',     color: 'text-fc-red',     Icon: ShieldOff },
  MEMBER_UNBAN:   { label: 'Membre débanni',   color: 'text-green-400',  Icon: ShieldCheck },
  CHANNEL_CREATE: { label: 'Canal créé',       color: 'text-blue-400',   Icon: Hash },
  CHANNEL_DELETE: { label: 'Canal supprimé',   color: 'text-blue-400',   Icon: Trash2 },
  ROLE_CREATE:    { label: 'Rôle créé',        color: 'text-purple-400', Icon: Crown },
  ROLE_DELETE:    { label: 'Rôle supprimé',    color: 'text-purple-400', Icon: Trash2 },
  ROLE_UPDATE:    { label: 'Rôle modifié',     color: 'text-purple-400', Icon: Crown },
  MESSAGE_DELETE: { label: 'Message supprimé', color: 'text-orange-400', Icon: MessageSquareX },
  SERVER_UPDATE:  { label: 'Serveur modifié',  color: 'text-green-400',  Icon: Settings },
  // legacy lowercase
  member_join:    { label: 'Membre rejoint',   color: 'text-green-400',  Icon: UserPlus },
  member_leave:   { label: 'Membre parti',     color: 'text-fc-muted',   Icon: UserMinus },
  member_kick:    { label: 'Membre expulsé',   color: 'text-fc-red',     Icon: UserX },
  member_ban:     { label: 'Membre banni',     color: 'text-fc-red',     Icon: ShieldOff },
  member_unban:   { label: 'Membre débanni',   color: 'text-green-400',  Icon: ShieldCheck },
  channel_create: { label: 'Canal créé',       color: 'text-blue-400',   Icon: Hash },
  channel_delete: { label: 'Canal supprimé',   color: 'text-blue-400',   Icon: Trash2 },
  role_create:    { label: 'Rôle créé',        color: 'text-purple-400', Icon: Crown },
  role_delete:    { label: 'Rôle supprimé',    color: 'text-purple-400', Icon: Trash2 },
  role_update:    { label: 'Rôle modifié',     color: 'text-purple-400', Icon: Crown },
  message_delete: { label: 'Message supprimé', color: 'text-orange-400', Icon: MessageSquareX },
  server_update:  { label: 'Serveur modifié',  color: 'text-green-400',  Icon: Settings },
}

const ACTION_OPTIONS = [
  { value: 'all', label: 'Toutes les actions' },
  { value: 'MEMBER_KICK',    label: 'Expulsions' },
  { value: 'MEMBER_BAN',     label: 'Bans' },
  { value: 'MEMBER_UNBAN',   label: 'Débans' },
  { value: 'CHANNEL_CREATE', label: 'Créations de canal' },
  { value: 'CHANNEL_DELETE', label: 'Suppressions de canal' },
  { value: 'ROLE_CREATE',    label: 'Créations de rôle' },
  { value: 'ROLE_DELETE',    label: 'Suppressions de rôle' },
  { value: 'ROLE_UPDATE',    label: 'Modifications de rôle' },
  { value: 'MESSAGE_DELETE', label: 'Suppressions de messages' },
  { value: 'SERVER_UPDATE',  label: 'Modifications serveur' },
]

const PAGE_SIZE = 50

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60)    return "à l'instant"
  if (diff < 3600)  return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`
  return `il y a ${Math.floor(diff / 86400)} j`
}

function getActionLabel(action: string): string {
  const norm = action.toUpperCase()
  const cfg = ACTION_CONFIG[norm] ?? ACTION_CONFIG[action]
  return cfg?.label ?? action
}

function buildDetails(entry: AuditEntry): string {
  const act = entry.action.toUpperCase()
  if (act === 'MEMBER_KICK' || act === 'member_kick') return `a expulsé un membre`
  if (act === 'MEMBER_BAN'  || act === 'member_ban')  return `a banni un membre`
  if (act === 'CHANNEL_CREATE' || act === 'channel_create') return `a créé un canal`
  if (act === 'CHANNEL_DELETE' || act === 'channel_delete') return `a supprimé un canal`
  if (act === 'ROLE_CREATE'  || act === 'role_create')  return `a créé un rôle`
  if (act === 'ROLE_DELETE'  || act === 'role_delete')  return `a supprimé un rôle`
  if (act === 'ROLE_UPDATE'  || act === 'role_update')  return `a modifié un rôle`
  if (act === 'MESSAGE_DELETE' || act === 'message_delete') return `a supprimé un message`
  if (act === 'SERVER_UPDATE' || act === 'server_update') return `a modifié le serveur`
  if (act === 'MEMBER_JOIN'  || act === 'member_join')  return `a rejoint le serveur`
  if (act === 'MEMBER_LEAVE' || act === 'member_leave') return `a quitté le serveur`
  if (act === 'MEMBER_UNBAN' || act === 'member_unban') return `a débanni un membre`
  return getActionLabel(entry.action)
}

export default function AuditLogPage({ serverId }: Props) {
  const [actionFilter, setActionFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('')
  const [page, setPage] = useState(1)

  const { data: entries = [], isLoading, isError } = useQuery<AuditEntry[]>({
    queryKey: ['audit', serverId],
    queryFn: () => api.get(`/servers/${serverId}/audit`).then(r => r.data),
    refetchInterval: 30_000,
  })

  const filtered = useMemo(() => {
    let list = [...entries].reverse() // newest first
    if (actionFilter !== 'all') {
      list = list.filter(e =>
        e.action === actionFilter ||
        e.action === actionFilter.toLowerCase()
      )
    }
    if (userFilter.trim()) {
      const q = userFilter.trim().toLowerCase()
      list = list.filter(e => (e.username ?? '').toLowerCase().includes(q))
    }
    return list
  }, [entries, actionFilter, userFilter])

  const visible = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = visible.length < filtered.length

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <ScrollText size={18} className="text-fc-accent" />
          Journal d'audit
        </h3>
        <p className="text-sm text-fc-muted mb-5">
          Historique chronologique des actions effectuées sur le serveur.
        </p>

        {/* Filtres */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <div className="relative">
            <select
              value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setPage(1) }}
              className="appearance-none pl-3 pr-8 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm cursor-pointer"
            >
              {ACTION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
          </div>

          <input
            value={userFilter}
            onChange={e => { setUserFilter(e.target.value); setPage(1) }}
            placeholder="Filtrer par utilisateur..."
            className="flex-1 min-w-[180px] px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          />
        </div>

        {/* Compteur */}
        {!isLoading && (
          <div className="text-xs text-fc-muted mb-4">
            {filtered.length} entrée{filtered.length !== 1 ? 's' : ''} trouvée{filtered.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Timeline */}
        {isLoading ? (
          <div className="text-center text-fc-muted py-12 text-sm">Chargement...</div>
        ) : isError ? (
          <div className="text-center py-12">
            <ScrollText size={40} className="mx-auto text-fc-muted/30 mb-3" />
            <p className="text-fc-muted text-sm">Impossible de charger le journal d'audit.</p>
            <p className="text-fc-muted/60 text-xs mt-1">Vérifiez que vous avez la permission Gérer le serveur.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12">
            <ScrollText size={40} className="mx-auto text-fc-muted/30 mb-3" />
            <p className="text-fc-muted text-sm">Aucune entrée dans le journal.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Ligne verticale */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-fc-hover" />

            <div className="space-y-1">
              {visible.map(entry => {
                const actKey = entry.action.toUpperCase()
                const cfg = ACTION_CONFIG[actKey] ?? ACTION_CONFIG[entry.action] ?? {
                  label: entry.action,
                  color: 'text-fc-muted',
                  Icon:  ScrollText,
                }
                const { color, Icon } = cfg
                return (
                  <div
                    key={entry.id}
                    className="flex gap-4 pl-2 py-2 group hover:bg-fc-hover/20 rounded-lg transition"
                  >
                    {/* Icône timeline */}
                    <div className={`w-6 h-6 rounded-full bg-fc-channel flex items-center justify-center flex-shrink-0 z-10 border-2 border-fc-bg ${color}`}>
                      <Icon size={11} />
                    </div>

                    {/* Contenu */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-white text-sm font-medium">{entry.username ?? 'Utilisateur inconnu'}</span>
                        <span className={`text-xs ${color}`}>{buildDetails(entry)}</span>
                        {entry.target_name && (
                          <span className="text-xs text-fc-muted">→ {entry.target_name}</span>
                        )}
                      </div>
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <div className="text-xs text-fc-muted mt-0.5 truncate">
                          {Object.entries(entry.details)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-fc-muted flex-shrink-0 pt-0.5 whitespace-nowrap">
                      {timeAgo(entry.created_at)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Charger plus */}
        {hasMore && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 bg-fc-channel hover:bg-fc-hover text-fc-muted hover:text-white rounded text-sm transition"
            >
              Charger plus ({filtered.length - visible.length} restant{filtered.length - visible.length > 1 ? 's' : ''})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
