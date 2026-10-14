import { useState, useEffect } from 'react'
import { Calendar, Plus, Users, Edit2, Trash2, Check, Clock, X, List } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useWs } from '../store/ws'
import { useAuth } from '../store/auth'
import CalendarView from '../components/events/CalendarView'
import { AddToCalendar, EventRepeatFields, ExportIcsButton, RecurrenceBadge } from '../components/community/EventExtras'
import { useT, intlLocale, type Key } from '../i18n'

interface Props {
  serverId: string
}

// Aligned with backend ServerEvent struct
interface ServerEvent {
  id: string
  server_id: string
  channel_id: string | null
  name: string
  description: string | null
  event_type: string
  start_time: string
  end_time: string | null
  creator_id: string
  image_url: string | null
  max_attendees: number | null
  attendee_count: number | null
  user_rsvp: string | null
  recurrence?: string
  reminder_minutes?: number | null
}

type FilterType = 'upcoming' | 'past' | 'all'
type ViewMode = 'list' | 'calendar'

function getStatus(event: ServerEvent): 'upcoming' | 'live' | 'ended' {
  const now = Date.now()
  const start = new Date(event.start_time).getTime()
  const end = event.end_time ? new Date(event.end_time).getTime() : null
  if (start > now) return 'upcoming'
  if (end && now < end) return 'live'
  return 'ended'
}

const STATUS_BADGE: Record<string, { label: Key; cls: string }> = {
  upcoming: { label: 'events.upcoming',  cls: 'bg-blue-500/20 text-blue-300' },
  live:     { label: 'friends.call.ongoing', cls: 'bg-green-500/20 text-green-300' },
  ended:    { label: 'friends.call.ended',  cls: 'bg-fc-muted/20 text-fc-muted' },
}

function formatDateFR(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(intlLocale(), {
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
  name: string
  description: string
  start_time: string
  end_time: string
  recurrence: string
  reminder: string
}

interface EventModalProps {
  initial?: Partial<EventFormData>
  onClose: () => void
  onSubmit: (data: EventFormData) => void
  loading: boolean
  mode: 'create' | 'edit'
}

function EventModal({ initial, onClose, onSubmit, loading, mode }: EventModalProps) {
  const t = useT()
  const [form, setForm] = useState<EventFormData>({
    name:        initial?.name        ?? '',
    description: initial?.description ?? '',
    start_time:  initial?.start_time  ?? '',
    end_time:    initial?.end_time    ?? '',
    recurrence:  initial?.recurrence  ?? 'none',
    reminder:    initial?.reminder    ?? '',
  })

  const set = (k: keyof EventFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.start_time) {
      toast.error(t('events.required'))
      return
    }
    onSubmit(form)
  }

  const titleId = `event-modal-title-${mode}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <div
        className="bg-fc-channel w-full max-w-md rounded-xl shadow-2xl max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-fc-hover">
          <h3 id={titleId} className="text-lg font-semibold text-white">
            {mode === 'create' ? t('events.create') : t('events.edit')}
          </h3>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-fc-muted hover:text-white transition p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded hover:bg-fc-hover"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              {t('events.titleLabel')} <span className="text-fc-red">*</span>
            </label>
            <input
              value={form.name}
              onChange={set('name')}
              maxLength={100}
              placeholder={t('events.namePh')}
              enterKeyHint="next"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              {t('srv.description')}
            </label>
            <textarea
              value={form.description}
              onChange={set('description')}
              maxLength={1000}
              rows={3}
              placeholder={t('events.descPh')}
              enterKeyHint="next"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                {t('settings.notif.start')} <span className="text-fc-red">*</span>
              </label>
              <input aria-label={t('settings.notif.start')}
                type="datetime-local"
                value={form.start_time}
                onChange={set('start_time')}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                {t('settings.notif.end')}
              </label>
              <input aria-label={t('settings.notif.end')}
                type="datetime-local"
                value={form.end_time}
                onChange={set('end_time')}
                min={form.start_time}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          </div>

          <EventRepeatFields recurrence={form.recurrence} reminder={form.reminder}
            onRecurrence={set('recurrence')} onReminder={set('reminder')} />

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-fc-hover text-fc-muted hover:text-white rounded text-sm font-medium transition"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
            >
              {loading ? t('common.recording') : mode === 'create' ? t('common.create') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ServerEventsPage({ serverId }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const { on } = useWs()
  const { user } = useAuth()
  const [filter, setFilter] = useState<FilterType>('upcoming')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ServerEvent | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [createDate, setCreateDate] = useState<Date | null>(null)

  const backendFilter = filter === 'past' ? 'past' : filter === 'all' ? 'all' : 'upcoming'

  const { data: events = [], isLoading } = useQuery<ServerEvent[]>({
    queryKey: ['server_events', serverId, backendFilter],
    queryFn: () => api.get(`/servers/${serverId}/events?filter=${backendFilter}`).then(r => r.data),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    const invalidate = (d: any) => {
      if (d.server_id === serverId) qc.invalidateQueries({ queryKey: ['server_events', serverId] })
    }
    const offs = [
      on('SERVER_EVENT_CREATE', invalidate),
      on('SERVER_EVENT_UPDATE', invalidate),
      on('SERVER_EVENT_DELETE', invalidate),
      on('EVENT_RSVP_UPDATE', invalidate),
    ]
    return () => offs.forEach(off => off())
  }, [serverId, on, qc])

  const createEvent = useMutation({
    mutationFn: (data: EventFormData) =>
      api.post(`/servers/${serverId}/events`, {
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        start_time: new Date(data.start_time).toISOString(),
        end_time: data.end_time ? new Date(data.end_time).toISOString() : undefined,
        recurrence: data.recurrence,
        reminder_minutes: data.reminder ? Number(data.reminder) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server_events', serverId] })
      setShowCreate(false)
      setCreateDate(null)
      toast.success(t('events.created'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('servers.create.error')),
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, data, prevStart }: { id: string; data: EventFormData; prevStart: string }) =>
      api.put(`/servers/${serverId}/events/${id}`, {
        name: data.name.trim() || undefined,
        // Chaîne vide acceptée par le serveur : c'est ce qui permet de vider la description.
        description: data.description.trim(),
        // Le serveur refuse toute date de début passée : la renvoyer inchangée rendait
        // impossible la moindre retouche d'un événement déjà commencé.
        start_time: data.start_time && data.start_time !== prevStart ? new Date(data.start_time).toISOString() : undefined,
        end_time: data.end_time ? new Date(data.end_time).toISOString() : null,
        recurrence: data.recurrence,
        reminder_minutes: data.reminder ? Number(data.reminder) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server_events', serverId] })
      setEditing(null)
      toast.success(t('events.updated'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('events.updateError')),
  })

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api.delete(`/servers/${serverId}/events/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server_events', serverId] })
      setDeletingId(null)
      toast.success(t('events.deleted'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('settings.adv.deleteError')),
  })

  const toggleAttend = useMutation({
    mutationFn: ({ id, rsvp }: { id: string; rsvp: string }) =>
      api.post(`/events/${id}/attend`, { status: rsvp }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server_events', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const FILTERS: { id: FilterType; label: Key }[] = [
    { id: 'upcoming', label: 'events.upcoming' },
    { id: 'past',     label: 'events.past' },
    { id: 'all',      label: 'friends.tab.all' },
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
            {t('srv.tab.events')}
          </h3>
          <p className="text-sm text-fc-muted mt-0.5">{t('events.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t('events.viewMode')} className="flex items-center bg-fc-hover rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-fc-channel text-white' : 'text-fc-muted hover:text-white'
              }`}
            >
              <List size={13} aria-hidden />
              {t('events.list')}
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              aria-pressed={viewMode === 'calendar'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition ${
                viewMode === 'calendar' ? 'bg-fc-channel text-white' : 'text-fc-muted hover:text-white'
              }`}
            >
              <Calendar size={13} aria-hidden />
              {t('events.calendar')}
            </button>
          </div>

          <ExportIcsButton serverId={serverId} />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
          >
            <Plus size={14} />
            {t('common.create')}
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
          <div role="group" aria-label={t('events.filter')} className="flex gap-1 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  filter === f.id
                    ? 'bg-fc-accent text-white'
                    : 'text-fc-muted hover:text-white hover:bg-fc-hover'
                }`}
              >
                {t(f.label)}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="text-center text-fc-muted py-12 text-sm">{t('common.loading')}</div>
          ) : events.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={40} className="mx-auto text-fc-muted/30 mb-3" />
              <p className="text-fc-muted text-sm">{t('events.none')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.map(event => {
                const status = getStatus(event)
                const badge = STATUS_BADGE[status]
                const isAttending = event.user_rsvp === 'going'
                const canManage = user && event.creator_id === user.id
                return (
                  <div key={event.id} className="bg-fc-channel rounded-lg p-4 hover:bg-fc-hover/20 transition">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-12 h-12 bg-fc-accent/20 rounded-lg flex flex-col items-center justify-center text-fc-accent">
                        <span className="text-xs font-medium leading-none uppercase">
                          {new Date(event.start_time).toLocaleDateString(intlLocale(), { month: 'short' })}
                        </span>
                        <span className="text-lg font-bold leading-none">
                          {new Date(event.start_time).getDate()}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-white font-semibold text-sm truncate">{event.name}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.cls}`}>
                            {t(badge.label)}
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
                          <RecurrenceBadge recurrence={event.recurrence} reminder={event.reminder_minutes} />
                          <span className="flex items-center gap-1">
                            <Users size={11} />
                            {t((event.attendee_count ?? 0) !== 1 ? 'events.participants.other' : 'events.participants.one', { n: event.attendee_count ?? 0 })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <AddToCalendar serverId={serverId} event={event} />
                        <button
                          onClick={() => toggleAttend.mutate({ id: event.id, rsvp: isAttending ? 'not_going' : 'going' })}
                          disabled={toggleAttend.isPending}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition ${
                            isAttending
                              ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                              : 'bg-fc-hover text-fc-muted hover:text-white'
                          }`}
                        >
                          {isAttending ? <><Check size={12} /> {t('events.going')}</> : t('events.attend')}
                        </button>

                        {canManage && (
                          <>
                            <button
                              onClick={() => setEditing(event)}
                              className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                              title={t('common.edit')}
                              aria-label={t('common.edit')}
                            >
                              <Edit2 size={13} />
                            </button>

                            {deletingId === event.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => deleteEvent.mutate(event.id)}
                                  disabled={deleteEvent.isPending}
                                  className="p-1.5 text-fc-red hover:bg-fc-red/10 rounded transition"
                                  aria-label={t('events.confirmDelete')}
                                  title={t('events.confirm')}
                                >
                                  <Check size={13} aria-hidden />
                                </button>
                                <button
                                  onClick={() => setDeletingId(null)}
                                  aria-label={t('events.cancelDelete')}
                                  className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                                >
                                  <X size={13} aria-hidden />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeletingId(event.id)}
                                className="p-1.5 text-fc-muted hover:text-fc-red hover:bg-fc-hover rounded transition"
                                title={t('common.delete')}
                                aria-label={t('common.delete')}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </>
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

      {showCreate && (
        <EventModal
          mode="create"
          initial={createInitial}
          onClose={() => { setShowCreate(false); setCreateDate(null) }}
          onSubmit={data => createEvent.mutate(data)}
          loading={createEvent.isPending}
        />
      )}

      {editing && (
        <EventModal
          mode="edit"
          initial={{
            name:        editing.name,
            description: editing.description ?? '',
            start_time:  toDatetimeLocal(editing.start_time),
            end_time:    editing.end_time ? toDatetimeLocal(editing.end_time) : '',
            recurrence:  editing.recurrence ?? 'none',
            reminder:    editing.reminder_minutes ? String(editing.reminder_minutes) : '',
          }}
          onClose={() => setEditing(null)}
          onSubmit={data => updateEvent.mutate({ id: editing.id, data, prevStart: toDatetimeLocal(editing.start_time) })}
          loading={updateEvent.isPending}
        />
      )}
    </div>
  )
}
