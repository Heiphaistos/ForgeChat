import { useState } from 'react'
import { Calendar, Plus, MapPin, Users, Edit2, Trash2, Check, Clock, X, List } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import toast from 'react-hot-toast'
import CalendarView from '../components/events/CalendarView'

interface Props {
  serverId: string
}

interface ServerEvent {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  location: string | null
  channel_id: string | null
  creator_id: string
  status: 'upcoming' | 'live' | 'ended'
  attendee_count: number
  is_attending: boolean
}

type FilterType = 'upcoming' | 'live' | 'ended' | 'all'
type ViewMode = 'list' | 'calendar'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  upcoming: { label: 'À venir',  cls: 'bg-blue-500/20 text-blue-300' },
  live:     { label: 'En cours', cls: 'bg-green-500/20 text-green-300' },
  ended:    { label: 'Terminé',  cls: 'bg-fc-muted/20 text-fc-muted' },
}

function formatDateFR(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface EventFormData {
  title: string
  description: string
  start_time: string
  end_time: string
  location: string
}

interface EventModalProps {
  initial?: Partial<EventFormData>
  onClose: () => void
  onSubmit: (data: EventFormData) => void
  loading: boolean
  mode: 'create' | 'edit'
}

function EventModal({ initial, onClose, onSubmit, loading, mode }: EventModalProps) {
  const [form, setForm] = useState<EventFormData>({
    title:       initial?.title       ?? '',
    description: initial?.description ?? '',
    start_time:  initial?.start_time  ?? '',
    end_time:    initial?.end_time    ?? '',
    location:    initial?.location    ?? '',
  })

  const set = (k: keyof EventFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.start_time) {
      toast.error('Titre et date de début requis')
      return
    }
    onSubmit(form)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-fc-channel w-full max-w-md rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-fc-hover">
          <h3 className="text-lg font-semibold text-white">
            {mode === 'create' ? 'Créer un événement' : "Modifier l'événement"}
          </h3>
          <button
            onClick={onClose}
            className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              Titre <span className="text-fc-red">*</span>
            </label>
            <input
              value={form.title}
              onChange={set('title')}
              maxLength={100}
              placeholder="Nom de l'événement"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={set('description')}
              maxLength={1000}
              rows={3}
              placeholder="Décrivez l'événement..."
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                Début <span className="text-fc-red">*</span>
              </label>
              <input
                type="datetime-local"
                value={form.start_time}
                onChange={set('start_time')}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                Fin
              </label>
              <input
                type="datetime-local"
                value={form.end_time}
                onChange={set('end_time')}
                min={form.start_time}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              Lieu
            </label>
            <input
              value={form.location}
              onChange={set('location')}
              maxLength={200}
              placeholder="Ex: Canal #général, Discord, Paris..."
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-fc-hover text-fc-muted hover:text-white rounded text-sm font-medium transition"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              {loading ? 'Enregistrement...' : mode === 'create' ? 'Créer' : 'Sauvegarder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ServerEventsPage({ serverId }: Props) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<FilterType>('upcoming')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ServerEvent | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [createDate, setCreateDate] = useState<Date | null>(null)

  const { data: events = [], isLoading } = useQuery<ServerEvent[]>({
    queryKey: ['server_events', serverId],
    queryFn: () => api.get(`/servers/${serverId}/events`).then(r => r.data),
    refetchInterval: 60_000,
  })

  const createEvent = useMutation({
    mutationFn: (data: EventFormData) =>
      api.post(`/servers/${serverId}/events`, {
        ...data,
        start_time: data.start_time ? new Date(data.start_time).toISOString() : undefined,
        end_time:   data.end_time   ? new Date(data.end_time).toISOString()   : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server_events', serverId] })
      setShowCreate(false)
      setCreateDate(null)
      toast.success('Événement créé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur création'),
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EventFormData }) =>
      api.put(`/servers/${serverId}/events/${id}`, {
        ...data,
        start_time: data.start_time ? new Date(data.start_time).toISOString() : undefined,
        end_time:   data.end_time   ? new Date(data.end_time).toISOString()   : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server_events', serverId] })
      setEditing(null)
      toast.success('Événement mis à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur mise à jour'),
  })

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api.delete(`/servers/${serverId}/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server_events', serverId] })
      setDeletingId(null)
      toast.success('Événement supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const toggleAttend = useMutation({
    mutationFn: (eventId: string) => api.post(`/events/${eventId}/attend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server_events', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const filtered = filter === 'all' ? events : events.filter(e => e.status === filter)

  const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'upcoming', label: 'À venir' },
    { id: 'live',     label: 'En cours' },
    { id: 'ended',    label: 'Passés' },
    { id: 'all',      label: 'Tous' },
  ]

  const handleCalendarCreate = (date: Date) => {
    setCreateDate(date)
    setShowCreate(true)
  }

  const createInitial = createDate ? {
    start_time: toDatetimeLocal(createDate.toISOString()),
  } : undefined

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Calendar size={18} className="text-fc-accent" />
            Événements
          </h3>
          <p className="text-sm text-fc-muted mt-0.5">Planifiez et gérez les événements du serveur.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle vue liste / calendrier */}
          <div className="flex items-center bg-fc-hover rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-fc-channel text-white' : 'text-fc-muted hover:text-white'
              }`}
            >
              <List size={13} />
              Liste
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
                viewMode === 'calendar' ? 'bg-fc-channel text-white' : 'text-fc-muted hover:text-white'
              }`}
            >
              <Calendar size={13} />
              Calendrier
            </button>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
          >
            <Plus size={14} />
            Créer
          </button>
        </div>
      </div>

      {/* Vue Calendrier */}
      {viewMode === 'calendar' && (
        <div className="h-[520px]">
          <CalendarView serverId={serverId} onCreateEvent={handleCalendarCreate} />
        </div>
      )}

      {/* Vue Liste */}
      {viewMode === 'list' && (
        <>
          {/* Filtres */}
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  filter === f.id
                    ? 'bg-fc-accent text-white'
                    : 'text-fc-muted hover:text-white hover:bg-fc-hover'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Liste */}
          {isLoading ? (
            <div className="text-center text-fc-muted py-12 text-sm">Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={40} className="mx-auto text-fc-muted/30 mb-3" />
              <p className="text-fc-muted text-sm">Aucun événement dans cette catégorie.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(event => {
                const badge = STATUS_BADGE[event.status] ?? STATUS_BADGE.upcoming
                return (
                  <div key={event.id} className="bg-fc-channel rounded-lg p-4 hover:bg-fc-hover/20 transition">
                    <div className="flex items-start gap-3">
                      {/* Icône date */}
                      <div className="flex-shrink-0 w-12 h-12 bg-fc-accent/20 rounded-lg flex flex-col items-center justify-center text-fc-accent">
                        <span className="text-xs font-medium leading-none uppercase">
                          {new Date(event.start_time).toLocaleDateString('fr-FR', { month: 'short' })}
                        </span>
                        <span className="text-lg font-bold leading-none">
                          {new Date(event.start_time).getDate()}
                        </span>
                      </div>

                      {/* Contenu */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-white font-semibold text-sm truncate">{event.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>

                        {event.description && (
                          <p className="text-xs text-fc-muted mb-2 line-clamp-2">{event.description}</p>
                        )}

                        <div className="flex items-center gap-3 flex-wrap text-xs text-fc-muted">
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatDateFR(event.start_time)}
                            {event.end_time && ` → ${formatDateFR(event.end_time)}`}
                          </span>
                          {event.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={11} />
                              {event.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Users size={11} />
                            {event.attendee_count} participant{event.attendee_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => toggleAttend.mutate(event.id)}
                          disabled={toggleAttend.isPending}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition ${
                            event.is_attending
                              ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                              : 'bg-fc-hover text-fc-muted hover:text-white'
                          }`}
                        >
                          {event.is_attending ? <><Check size={12} /> Inscrit</> : 'Participer'}
                        </button>

                        <button
                          onClick={() => setEditing(event)}
                          className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                          title="Modifier"
                        >
                          <Edit2 size={13} />
                        </button>

                        {deletingId === event.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteEvent.mutate(event.id)}
                              disabled={deleteEvent.isPending}
                              className="p-1.5 text-fc-red hover:bg-fc-red/10 rounded transition"
                              title="Confirmer"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              onClick={() => setDeletingId(null)}
                              className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeletingId(event.id)}
                            className="p-1.5 text-fc-muted hover:text-fc-red hover:bg-fc-hover rounded transition"
                            title="Supprimer"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Modal création */}
      {showCreate && (
        <EventModal
          mode="create"
          initial={createInitial}
          onClose={() => { setShowCreate(false); setCreateDate(null) }}
          onSubmit={data => createEvent.mutate(data)}
          loading={createEvent.isPending}
        />
      )}

      {/* Modal édition */}
      {editing && (
        <EventModal
          mode="edit"
          initial={{
            title:       editing.title,
            description: editing.description ?? '',
            start_time:  toDatetimeLocal(editing.start_time),
            end_time:    editing.end_time ? toDatetimeLocal(editing.end_time) : '',
            location:    editing.location ?? '',
          }}
          onClose={() => setEditing(null)}
          onSubmit={data => updateEvent.mutate({ id: editing.id, data })}
          loading={updateEvent.isPending}
        />
      )}
    </div>
  )
}
