// Rappels à venir (amélioration n° 47) : liste, ouverture du message, annulation. Le texte n'est
// pas repris (il peut être chiffré) : on ouvre le message à sa place.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { intlLocale, useT } from '../i18n'

interface Reminder {
  id: string; message_id: string; remind_at: string
  channel_id: string | null; server_id: string | null; dm_id: string | null
}

export default function UpcomingReminders() {
  const t = useT()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data = [] } = useQuery<Reminder[]>({ queryKey: ['reminders'], queryFn: () => api.get('/reminders').then(r => r.data), staleTime: 30_000 })
  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/reminders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  })
  if (data.length === 0) return null
  const open = (r: Reminder) => {
    if (r.server_id && r.channel_id) nav(`/servers/${r.server_id}/channels/${r.channel_id}?highlight=${r.message_id}`)
    else if (r.dm_id) nav(`/dms/${r.dm_id}?highlight=${r.message_id}`)
  }
  return (
    <section className="max-w-2xl mb-6" aria-labelledby="reminders-title">
      <h2 id="reminders-title" className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <AlarmClock size={12} aria-hidden /> {t('reminders.upcoming')} ({data.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {data.map(r => (
          <li key={r.id} className="flex items-center gap-3 bg-fc-channel rounded-lg px-3 py-2 border border-fc-hover/50">
            <button onClick={() => open(r)} className="flex-1 text-left text-sm text-white hover:underline">
              {t('reminders.at', { when: new Date(r.remind_at).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }) })}
              <span className="text-fc-muted"> · {t(r.dm_id ? 'reminders.inDm' : 'reminders.inChannel')}</span>
            </button>
            <button onClick={() => cancel.mutate(r.id)} aria-label={t('reminders.cancel')} title={t('reminders.cancel')}
              className="p-1 text-fc-muted hover:text-fc-red rounded"><X size={14} /></button>
          </li>
        ))}
      </ul>
    </section>
  )
}
