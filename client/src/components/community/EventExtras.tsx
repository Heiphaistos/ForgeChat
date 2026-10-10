// Événements : récurrence, rappel, export calendrier (.ics) et « ajouter à mon agenda ».
import { CalendarPlus, Download, Repeat, Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT, type Key } from '../../i18n'
import { googleCalendarUrl } from './format'
import { saveFile } from '../../lib/saveFile'

const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const
const REMINDERS = [5, 15, 30, 60, 1440]

const selectCls = 'w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm'

export function EventRepeatFields({ recurrence, reminder, onRecurrence, onReminder }: {
  recurrence: string
  reminder: string
  onRecurrence: (e: React.ChangeEvent<HTMLSelectElement>) => void
  onReminder: (e: React.ChangeEvent<HTMLSelectElement>) => void
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('community.events.repeat')}</span>
        <select value={recurrence} onChange={onRecurrence} className={selectCls}>
          {RECURRENCES.map(r => <option key={r} value={r}>{t(`community.events.r.${r}` as Key)}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">{t('community.events.reminder')}</span>
        <select value={reminder} onChange={onReminder} className={selectCls}>
          <option value="">{t('community.events.noReminder')}</option>
          {REMINDERS.map(m => <option key={m} value={m}>{m >= 60 ? t('community.events.hoursBefore', { n: m / 60 }) : t('community.events.minutesBefore', { n: m })}</option>)}
        </select>
      </label>
    </div>
  )
}

export function RecurrenceBadge({ recurrence, reminder }: { recurrence?: string; reminder?: number | null }) {
  const t = useT()
  return (
    <>
      {recurrence && recurrence !== 'none' && (
        <span className="flex items-center gap-1 text-fc-accent"><Repeat size={11} aria-hidden />{t(`community.events.r.${recurrence}` as Key)}</span>
      )}
      {!!reminder && <span className="flex items-center gap-1" title={t('community.events.reminder')}><Bell size={11} aria-hidden />{reminder >= 60 ? `${reminder / 60} h` : `${reminder} min`}</span>}
    </>
  )
}

async function downloadIcs(path: string, filename: string, okText: string, errText: string) {
  try {
    const { data } = await api.get<string>(path, { responseType: 'text' })
    if (await saveFile(data, filename, 'text/calendar')) toast.success(okText)
  } catch {
    toast.error(errText)
  }
}

export function ExportIcsButton({ serverId }: { serverId: string }) {
  const t = useT()
  return (
    <button onClick={() => downloadIcs(`/servers/${serverId}/events.ics`, 'evenements.ics', t('community.events.exported'), t('common.error'))}
      title={t('community.events.exportAll')} aria-label={t('community.events.exportAll')}
      className="flex items-center gap-1.5 px-3 py-2 bg-fc-hover text-white rounded text-sm transition hover:bg-fc-hover/70">
      <Download size={14} aria-hidden /> .ics
    </button>
  )
}

export function AddToCalendar({ serverId, event }: {
  serverId: string
  event: { id: string; name: string; description: string | null; start_time: string; end_time: string | null; recurrence?: string }
}) {
  const t = useT()
  return (
    <>
      <button onClick={() => downloadIcs(`/servers/${serverId}/events/${event.id}/ics`, 'evenement.ics', t('community.events.exported'), t('common.error'))}
        title={t('community.events.addToCalendar')} aria-label={t('community.events.addToCalendar')}
        className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition">
        <CalendarPlus size={13} aria-hidden />
      </button>
      <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer"
        title={t('community.events.google')} aria-label={t('community.events.google')}
        className="px-1.5 py-1 text-[10px] font-bold text-fc-muted hover:text-white hover:bg-fc-hover rounded transition">G</a>
    </>
  )
}
