import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import api from '../api/client'
import { Plus, AlertCircle, Clock, CheckCircle, XCircle, ChevronLeft, MessageSquare, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMobile } from '../contexts/MobileContext'
import { useT, type Key } from '../i18n'
import { postMessage, channelSendError } from '../e2e/channels'
import { exportTranscript } from '../components/community/transcript'

// Tickets natifs : chaque ticket est un SALON PRIVÉ (membre + équipe) chiffré de bout
// en bout ; le sujet est le premier message, chiffré ici. Le serveur ne garde que
// « Ticket #N ». La transcription est l'historique du salon, déchiffré sur l'appareil.

interface Ticket {
  id: string
  title: string
  number: number | null
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  creator_id: string
  assigned_to: string | null
  category_id: string | null
  channel_id: string | null
  created_at: string
  /** Qui l'a fermé : le créateur ne peut rouvrir que ce qu'il a fermé lui-même. */
  closed_by?: string | null
}

interface Category {
  id: string
  name: string
  emoji: string | null
}

const COLUMNS = [
  { status: 'open', icon: <AlertCircle size={14} />, color: 'text-fc-accent' },
  { status: 'in_progress', icon: <Clock size={14} />, color: 'text-fc-yellow' },
  { status: 'resolved', icon: <CheckCircle size={14} />, color: 'text-fc-green' },
  { status: 'closed', icon: <XCircle size={14} />, color: 'text-fc-muted' },
] as const

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-fc-muted/20 text-fc-muted',
  medium: 'bg-fc-accent/20 text-fc-accent',
  high: 'bg-fc-yellow/20 text-fc-yellow',
  urgent: 'bg-fc-red/20 text-fc-red',
}

const fieldCls = 'bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-sm text-white'

export default function TicketsPage() {
  const t = useT()
  const nav = useNavigate()
  const { serverId } = useParams<{ serverId: string }>()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { on } = useWs()
  const { openSidebar } = useMobile()
  const [subject, setSubject] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const { data: settings } = useQuery<{ enabled: boolean; is_staff: boolean }>({
    queryKey: ['community', serverId, 'tickets/settings'],
    queryFn: () => api.get(`/servers/${serverId}/tickets/settings`).then(r => r.data),
    enabled: !!serverId,
  })
  const { data: tickets = [] } = useQuery<Ticket[]>({
    queryKey: ['tickets', serverId],
    queryFn: () => api.get(`/servers/${serverId}/tickets`).then(r => r.data),
    enabled: !!serverId,
  })
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['ticket-categories', serverId],
    queryFn: () => api.get(`/servers/${serverId}/ticket-categories`).then(r => r.data),
    enabled: !!serverId,
  })

  useEffect(() => {
    if (!serverId) return
    const refresh = (key: string) => (d: any) => { if (d.server_id === serverId) qc.invalidateQueries({ queryKey: [key, serverId] }) }
    const offs = [on('TICKET_CREATE', refresh('tickets')), on('TICKET_UPDATE', refresh('tickets')), on('TICKET_CATEGORY_CREATE', refresh('ticket-categories'))]
    return () => offs.forEach(off => off())
  }, [serverId, on, qc])

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Ticket>(`/servers/${serverId}/tickets`, {
        priority: newPriority,
        ...(newCategoryId ? { category_id: newCategoryId } : {}),
      })
      // Le salon vient d'être créé : le serveur doit connaître ses membres avant la clé.
      await qc.invalidateQueries({ queryKey: ['server', serverId] })
      if (data.channel_id && subject.trim()) {
        await postMessage(serverId!, data.channel_id, subject.trim(),
          body => api.post(`/servers/${serverId}/channels/${data.channel_id}/messages`, body))
      }
      return data
    },
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ['tickets', serverId] })
      setSubject('')
      setShowCreate(false)
      toast.success(t('community.tickets.opened', { n: data.number ?? '' }))
      if (data.channel_id) nav(`/servers/${serverId}/channels/${data.channel_id}`)
    },
    onError: (e: any) => toast.error(channelSendError(e, e?.response?.data?.error ?? t('common.error'))),
  })

  const update = useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; priority?: string }) =>
      api.patch(`/servers/${serverId}/tickets/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets', serverId] }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? t('common.error')),
  })

  const createCategory = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/ticket-categories`, { name: newCatName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-categories', serverId] })
      setNewCatName('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? t('common.error')),
  })

  const transcript = async (ticket: Ticket) => {
    if (!ticket.channel_id || !serverId) return
    try {
      const n = await exportTranscript(serverId, ticket.channel_id, ticket.title)
      toast.success(t('community.tickets.transcriptDone', { n }))
    } catch {
      toast.error(t('common.error'))
    }
  }

  const staff = !!settings?.is_staff
  const byStatus = (status: string) => tickets.filter(tk => tk.status === status)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 md:px-6 py-4 border-b border-fc-hover flex-wrap">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
            onClick={openSidebar}
            aria-label={t('common.back')}
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-white">{t('community.tickets.menu')}</h1>
        </div>
        {settings?.enabled && (
          <button
            onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-2 px-3 py-1.5 bg-fc-accent text-white rounded-lg text-sm font-medium hover:bg-fc-accent/80"
          >
            <Plus size={16} /> {t('community.tickets.open')}
          </button>
        )}
      </div>

      {settings && !settings.enabled && (
        <p className="px-6 py-3 text-sm text-fc-muted border-b border-fc-hover">{t('community.tickets.disabled')}</p>
      )}

      {showCreate && (
        <div className="px-4 md:px-6 py-4 border-b border-fc-hover bg-fc-channel/50 space-y-2 max-w-xl">
          <textarea
            value={subject}
            onChange={e => setSubject(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={t('community.tickets.subject')}
            className={`${fieldCls} w-full resize-none`}
          />
          <p className="text-xs text-fc-muted">{t('community.tickets.subjectHint')}</p>
          <div className="flex gap-2 flex-wrap">
            <select value={newPriority} onChange={e => setNewPriority(e.target.value)} aria-label={t('community.tickets.priority')} className={fieldCls}>
              {PRIORITIES.map(p => <option key={p} value={p}>{t(`community.tickets.p.${p}` as Key)}</option>)}
            </select>
            {categories.length > 0 && (
              <select value={newCategoryId} onChange={e => setNewCategoryId(e.target.value)} aria-label={t('community.tickets.type')} className={fieldCls}>
                <option value="">{t('community.tickets.type')}</option>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</option>)}
              </select>
            )}
            <button
              onClick={() => create.mutate()}
              disabled={!subject.trim() || create.isPending}
              className="px-4 py-2 bg-fc-accent text-white rounded-lg text-sm disabled:opacity-50"
            >
              {create.isPending ? t('common.creating') : t('community.tickets.open')}
            </button>
          </div>
          {staff && (
            <div className="flex gap-2 pt-2">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)} maxLength={100}
                placeholder={t('community.tickets.newType')} className={`${fieldCls} flex-1`} />
              <button onClick={() => createCategory.mutate()} disabled={!newCatName.trim() || createCategory.isPending}
                className="px-3 py-1.5 bg-fc-hover text-white rounded-lg text-sm disabled:opacity-50">{t('community.add')}</button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-x-auto p-4 md:p-6">
        <div className="flex gap-4 h-full min-w-max">
          {COLUMNS.map(col => (
            <div key={col.status} className="w-72 flex flex-col gap-3">
              <div className={`flex items-center gap-2 px-1 font-semibold text-sm ${col.color}`}>
                {col.icon}
                {t(`community.tickets.s.${col.status}` as Key)}
                <span className="ml-auto text-fc-muted font-normal">{byStatus(col.status).length}</span>
              </div>
              <div className="flex flex-col gap-2 flex-1 overflow-y-auto overscroll-contain">
                {byStatus(col.status).map(ticket => {
                  const mine = ticket.creator_id === user?.id
                  const closed = ticket.status === 'closed' || ticket.status === 'resolved'
                  return (
                    <div key={ticket.id} className="bg-fc-channel border border-fc-hover rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-white font-medium">{ticket.title}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                          {t(`community.tickets.p.${ticket.priority}` as Key)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ticket.channel_id && (
                          <button onClick={() => nav(`/servers/${serverId}/channels/${ticket.channel_id}`)}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-fc-hover text-white">
                            <MessageSquare size={12} aria-hidden /> {t('community.tickets.goTo')}
                          </button>
                        )}
                        {ticket.channel_id && (
                          <button onClick={() => transcript(ticket)} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-fc-hover text-fc-muted hover:text-white">
                            <FileText size={12} aria-hidden /> {t('community.tickets.transcript')}
                          </button>
                        )}
                        {staff && !closed && ticket.status !== 'in_progress' && (
                          <button onClick={() => update.mutate({ id: ticket.id, status: 'in_progress' })} className="text-xs px-2 py-1 rounded bg-fc-hover text-fc-muted hover:text-white">
                            {t('community.tickets.take')}
                          </button>
                        )}
                        {(staff || (mine && (!closed || ticket.closed_by === user?.id))) && (
                          <button onClick={() => update.mutate({ id: ticket.id, status: closed ? 'open' : 'closed' })}
                            className="text-xs px-2 py-1 rounded bg-fc-hover text-fc-muted hover:text-white">
                            {t(closed ? 'community.tickets.reopen' : 'community.tickets.close')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {byStatus(col.status).length === 0 && (
                  <div className="text-center py-8 text-fc-muted text-xs">{t('community.tickets.none')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
