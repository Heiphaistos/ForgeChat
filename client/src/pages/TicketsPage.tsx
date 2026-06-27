import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import api from '../api/client'
import { Plus, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

interface Ticket {
  id: string
  title: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  creator_id: string
  assigned_to: string | null
  category_id: string | null
  created_at: string
}

interface Category {
  id: string
  name: string
  emoji: string | null
}

const COLUMNS = [
  { status: 'open', label: 'Ouvert', icon: <AlertCircle size={14} />, color: 'text-fc-accent' },
  { status: 'in_progress', label: 'En cours', icon: <Clock size={14} />, color: 'text-fc-yellow' },
  { status: 'resolved', label: 'Résolu', icon: <CheckCircle size={14} />, color: 'text-fc-green' },
  { status: 'closed', label: 'Fermé', icon: <XCircle size={14} />, color: 'text-fc-muted' },
] as const

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-fc-muted/20 text-fc-muted',
  medium: 'bg-fc-accent/20 text-fc-accent',
  high: 'bg-fc-yellow/20 text-fc-yellow',
  urgent: 'bg-fc-red/20 text-fc-red',
}

export default function TicketsPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { on } = useWs()
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [showCreate, setShowCreate] = useState(false)

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
    const offCreate = on('TICKET_CREATE', (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['tickets', serverId] })
    })
    const offUpdate = on('TICKET_UPDATE', (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['tickets', serverId] })
    })
    const offCatCreate = on('TICKET_CATEGORY_CREATE', (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['ticket-categories', serverId] })
    })
    return () => { offCreate(); offUpdate(); offCatCreate() }
  }, [serverId, on, qc])

  const createMutation = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/tickets`, {
      title: newTitle,
      priority: newPriority,
      ...(newCategoryId ? { category_id: newCategoryId } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets', serverId] })
      setNewTitle('')
      setShowCreate(false)
      toast.success('Ticket créé')
    },
    onError: () => toast.error('Erreur lors de la création'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; priority?: string }) =>
      api.patch(`/servers/${serverId}/tickets/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets', serverId] }),
  })

  const visibleTickets = filterCategoryId
    ? tickets.filter(t => t.category_id === filterCategoryId)
    : tickets
  const byStatus = (status: string) => visibleTickets.filter(t => t.status === status)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-fc-hover">
        <div className="flex items-center gap-3">
          <div className="md:hidden w-8 flex-shrink-0" />
          <h1 className="text-xl font-bold text-white">Tickets</h1>
          {categories.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilterCategoryId('')}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${!filterCategoryId ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
              >
                Tous
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setFilterCategoryId(f => f === cat.id ? '' : cat.id)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${filterCategoryId === cat.id ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted hover:text-white'}`}
                >
                  {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center gap-2 px-3 py-1.5 bg-fc-accent text-white rounded-lg text-sm font-medium hover:bg-fc-accent/80"
        >
          <Plus size={16} /> Nouveau ticket
        </button>
      </div>

      {showCreate && (
        <div className="px-6 py-4 border-b border-fc-hover bg-fc-channel/50">
          <div className="flex gap-3 max-w-lg">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Titre du ticket..."
              className="flex-1 bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
              onKeyDown={e => e.key === 'Enter' && newTitle.trim() && createMutation.mutate()}
            />
            <select
              value={newPriority}
              onChange={e => setNewPriority(e.target.value)}
              className="bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
              <option value="urgent">Urgent</option>
            </select>
            {categories.length > 0 && (
              <select
                value={newCategoryId}
                onChange={e => setNewCategoryId(e.target.value)}
                className="bg-fc-hover border border-fc-hover rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">Catégorie</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newTitle.trim() || createMutation.isPending}
              className="px-4 py-2 bg-fc-accent text-white rounded-lg text-sm disabled:opacity-50"
            >
              Créer
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex gap-4 h-full min-w-max">
          {COLUMNS.map(col => (
            <div key={col.status} className="w-72 flex flex-col gap-3">
              <div className={`flex items-center gap-2 px-1 font-semibold text-sm ${col.color}`}>
                {col.icon}
                {col.label}
                <span className="ml-auto text-fc-muted font-normal">{byStatus(col.status).length}</span>
              </div>
              <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
                {byStatus(col.status).map(ticket => (
                  <div key={ticket.id} className="bg-fc-channel border border-fc-hover rounded-xl p-3 space-y-2">
                    <p className="text-sm text-white font-medium leading-snug">{ticket.title}</p>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[ticket.priority]}`}>
                        {ticket.priority}
                      </span>
                      {ticket.creator_id === user?.id && col.status !== 'closed' && (
                        <select
                          value={ticket.status}
                          onChange={e => updateMutation.mutate({ id: ticket.id, status: e.target.value })}
                          className="text-xs bg-fc-hover border border-fc-hover rounded px-2 py-0.5 text-fc-muted"
                        >
                          <option value="open">Ouvert</option>
                          <option value="in_progress">En cours</option>
                          <option value="resolved">Résolu</option>
                          <option value="closed">Fermé</option>
                        </select>
                      )}
                    </div>
                  </div>
                ))}
                {byStatus(col.status).length === 0 && (
                  <div className="text-center py-8 text-fc-muted text-xs">Aucun ticket</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
