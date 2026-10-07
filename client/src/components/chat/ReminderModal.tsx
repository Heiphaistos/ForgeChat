import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import { addMinutes, addHours, addDays, setHours, setMinutes, setSeconds } from 'date-fns'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT, type Key } from '../../i18n'

const PRESETS: { label: Key; fn: () => Date }[] = [
  {
    label: 'reminder.in20',
    fn: () => addMinutes(new Date(), 20),
  },
  {
    label: 'reminder.in1h',
    fn: () => addHours(new Date(), 1),
  },
  {
    label: 'reminder.tonight',
    fn: () => {
      const d = new Date()
      return setSeconds(setMinutes(setHours(d, 18), 0), 0)
    },
  },
  {
    label: 'reminder.tomorrow',
    fn: () => {
      const d = addDays(new Date(), 1)
      return setSeconds(setMinutes(setHours(d, 9), 0), 0)
    },
  },
]

interface Props {
  messageId: string
  onClose: () => void
}

export default function ReminderModal({ messageId, onClose }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const [custom, setCustom] = useState('')
  const [loading, setLoading] = useState(false)

  const setReminder = async (date: Date) => {
    if (date <= new Date()) {
      toast.error(t('reminder.future'))
      return
    }
    setLoading(true)
    try {
      await api.post(`/messages/${messageId}/remind`, { remind_at: date.toISOString() })
      toast.success(t('reminder.set'))
      onClose()
    } catch {
      toast.error(t('reminder.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-title"
      className="absolute bottom-8 right-0 z-50 bg-fc-sidebar border border-fc-hover rounded-xl shadow-2xl p-4 w-64"
    >
      <div className="flex items-center justify-between mb-3">
        <div id="reminder-title" className="flex items-center gap-2 text-sm font-medium text-white">
          <Bell size={14} className="text-fc-accent" aria-hidden />
          {t('reminder.title')}
        </div>
        <button onClick={onClose} aria-label={t('reminder.close')} className="text-fc-muted hover:text-white">
          <X size={14} aria-hidden />
        </button>
      </div>

      <div className="space-y-1">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => setReminder(p.fn())}
            disabled={loading}
            className="w-full text-left px-3 py-2 text-sm text-fc-text hover:bg-fc-hover rounded-lg transition disabled:opacity-50"
          >
            {t(p.label)}
          </button>
        ))}

        <div className="pt-2 border-t border-fc-hover space-y-2">
          <label htmlFor="reminder-custom-dt" className="text-xs text-fc-muted">{t('reminder.custom')}</label>
          <input
            id="reminder-custom-dt"
            type="datetime-local"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            aria-label={t('reminder.customLabel')}
            className="w-full bg-fc-hover border border-fc-hover rounded-lg px-2 py-1.5 text-sm text-white"
          />
          {custom && (
            <button
              onClick={() => setReminder(new Date(custom))}
              disabled={loading}
              className="w-full py-1.5 bg-fc-accent rounded-lg text-white text-sm font-medium hover:bg-fc-accent/80 transition disabled:opacity-50"
            >
              {t('reminder.apply')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
