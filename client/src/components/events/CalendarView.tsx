import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import api from '../../api/client'

interface CalendarEvent {
  id: string
  title: string
  description?: string
  starts_at: string
  ends_at?: string
  location?: string
  channel_id?: string
}

interface CalendarViewProps {
  serverId: string
  onCreateEvent?: (date: Date) => void
}

const WEEKDAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']

const EVENT_COLORS = [
  'bg-indigo-500/80 text-white',
  'bg-emerald-500/80 text-white',
  'bg-violet-500/80 text-white',
  'bg-amber-500/80 text-white',
  'bg-rose-500/80 text-white',
  'bg-sky-500/80 text-white',
]

function colorForEvent(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return EVENT_COLORS[hash % EVENT_COLORS.length]
}

function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildGrid(year: number, month: number): (Date | null)[] {
  // month is 0-indexed
  const first = new Date(year, month, 1)
  // Monday-first: getDay() returns 0=Sun, convert to 0=Mon
  const startDow = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const total = Math.ceil((startDow + daysInMonth) / 7) * 7
  const grid: (Date | null)[] = []
  for (let i = 0; i < total; i++) {
    const day = i - startDow + 1
    grid.push(day >= 1 && day <= daysInMonth ? new Date(year, month, day) : null)
  }
  return grid
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

interface EventPopoverProps {
  event: CalendarEvent
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

function EventPopover({ event, anchorRef, onClose }: EventPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (anchorRef.current && popRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      const pw = popRef.current.offsetWidth || 240
      const ph = popRef.current.offsetHeight || 160
      let left = rect.left
      let top = rect.bottom + 4
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8
      if (top + ph > window.innerHeight - 8) top = rect.top - ph - 4
      setPos({ top, left })
    }
  }, [anchorRef])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose, anchorRef])

  return (
    <div
      ref={popRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
      className="w-60 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl p-4"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-white leading-snug">{event.title}</span>
        <button onClick={onClose} className="text-fc-muted hover:text-white flex-shrink-0 p-0.5">
          <X size={14} />
        </button>
      </div>
      <div className="text-xs text-fc-muted space-y-1">
        <p>{formatFull(event.starts_at)}{event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}</p>
        {event.location && <p>📍 {event.location}</p>}
        {event.description && <p className="line-clamp-3 mt-1 text-white/70">{event.description}</p>}
      </div>
    </div>
  )
}

export default function CalendarView({ serverId, onCreateEvent }: CalendarViewProps) {
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [activeEvent, setActiveEvent] = useState<{ event: CalendarEvent; ref: React.RefObject<HTMLElement | null> } | null>(null)

  const monthKey = toYearMonth(new Date(cursor.year, cursor.month, 1))

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar_events', serverId, monthKey],
    queryFn: () => api.get(`/servers/${serverId}/events?month=${monthKey}`).then(r => {
      const raw = r.data as unknown[]
      return (raw as Array<Record<string, unknown>>).map(e => ({
        id:          String(e.id ?? ''),
        title:       String(e.title ?? ''),
        description: e.description != null ? String(e.description) : undefined,
        starts_at:   String(e.starts_at ?? e.start_time ?? ''),
        ends_at:     e.ends_at != null ? String(e.ends_at) : e.end_time != null ? String(e.end_time) : undefined,
        location:    e.location != null ? String(e.location) : undefined,
        channel_id:  e.channel_id != null ? String(e.channel_id) : undefined,
      } satisfies CalendarEvent))
    }),
    staleTime: 60_000,
  })

  const grid = buildGrid(cursor.year, cursor.month)

  const eventsForDay = (d: Date) =>
    events.filter(ev => ev.starts_at && sameDay(new Date(ev.starts_at), d))

  const prevMonth = () => {
    setCursor(c => {
      const m = c.month === 0 ? 11 : c.month - 1
      const y = c.month === 0 ? c.year - 1 : c.year
      return { year: y, month: m }
    })
  }

  const nextMonth = () => {
    setCursor(c => {
      const m = c.month === 11 ? 0 : c.month + 1
      const y = c.month === 11 ? c.year + 1 : c.year
      return { year: y, month: m }
    })
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('fr-FR', {
    month: 'long', year: 'numeric',
  })

  const handleTagClick = (ev: React.MouseEvent<HTMLButtonElement>, event: CalendarEvent) => {
    ev.stopPropagation()
    const ref = { current: ev.currentTarget as HTMLElement } as React.RefObject<HTMLElement | null>
    setActiveEvent(ae => ae?.event.id === event.id ? null : { event, ref })
  }

  return (
    <div className="flex flex-col h-full select-none">
      {/* Navigation mois */}
      <div className="flex items-center justify-between px-1 mb-3">
        <button
          onClick={prevMonth}
          className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-white capitalize">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* En-tête jours */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-[11px] font-semibold text-fc-muted uppercase py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Grille */}
      <div className="grid grid-cols-7 flex-1 gap-px bg-fc-hover rounded-lg overflow-hidden">
        {grid.map((day, i) => {
          if (!day) {
            return <div key={i} className="bg-fc-bg/40 min-h-[72px]" />
          }
          const isToday = sameDay(day, today)
          const dayEvents = eventsForDay(day)
          const visible = dayEvents.slice(0, 3)
          const overflow = dayEvents.length - 3

          return (
            <div
              key={i}
              onClick={() => onCreateEvent && dayEvents.length === 0 && onCreateEvent(day)}
              className={`bg-fc-bg min-h-[72px] p-1.5 flex flex-col gap-1 ${
                onCreateEvent && dayEvents.length === 0
                  ? 'cursor-pointer hover:bg-fc-hover/30 transition'
                  : ''
              } ${isToday ? 'bg-fc-accent/10' : ''}`}
            >
              <span className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0 ${
                isToday ? 'bg-fc-accent text-white font-bold' : 'text-fc-muted'
              }`}>
                {day.getDate()}
              </span>

              {visible.map(event => (
                <button
                  key={event.id}
                  onClick={e => handleTagClick(e, event)}
                  className={`text-[10px] px-1 py-0.5 rounded truncate text-left leading-tight ${colorForEvent(event.id)}`}
                  title={event.title}
                >
                  {event.title}
                </button>
              ))}

              {overflow > 0 && (
                <span className="text-[10px] text-fc-muted pl-1">+{overflow} autres</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Popover événement */}
      {activeEvent && (
        <EventPopover
          event={activeEvent.event}
          anchorRef={activeEvent.ref}
          onClose={() => setActiveEvent(null)}
        />
      )}
    </div>
  )
}
