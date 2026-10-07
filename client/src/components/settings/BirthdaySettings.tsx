// Anniversaire (lot « Profil et social ») : jour et mois, année facultative jamais
// affichée, visibilité (personne / amis / amis + serveurs choisis) et serveurs où il
// est fêté (/users/me/birthday).
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { intlLocale, useT } from '../../i18n'
import { validBirthday } from '../../utils/birthday'
import { Field, Select } from './shared'

interface MyBirthday {
  birthday: { month: number; day: number; year: number | null } | null
  visibility: 'nobody' | 'friends' | 'servers'
  server_ids: string[]
}
interface ServerLite { id: string; name: string }

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export default function BirthdaySettings() {
  const t = useT()
  const qc = useQueryClient()
  const { data } = useQuery<MyBirthday>({ queryKey: ['my-birthday'], queryFn: () => api.get('/users/me/birthday').then(r => r.data) })
  const { data: servers = [] } = useQuery<ServerLite[]>({ queryKey: ['servers'], queryFn: () => api.get('/servers').then(r => r.data) })
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [visibility, setVisibility] = useState<MyBirthday['visibility']>('nobody')
  const [chosen, setChosen] = useState<string[]>([])

  useEffect(() => {
    if (!data) return
    setDay(data.birthday ? String(data.birthday.day) : '')
    setMonth(data.birthday ? String(data.birthday.month) : '')
    setYear(data.birthday?.year ? String(data.birthday.year) : '')
    setVisibility(data.visibility)
    setChosen(data.server_ids)
  }, [data])

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/users/me/birthday', body).then(r => r.data as MyBirthday),
    onSuccess: d => { qc.setQueryData(['my-birthday'], d); toast.success(t('soc.bday.saved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const submit = () => {
    const y = year.trim() ? Number(year) : null
    const date = day && month ? { month: Number(month), day: Number(day), year: y } : null
    if ((day || month) && (!date || !validBirthday(date.month, date.day, y))) {
      toast.error(t('soc.bday.invalid'))
      return
    }
    save.mutate({ birthday: date, visibility, server_ids: chosen })
  }
  const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(intlLocale(), { month: 'long' })

  return (
    <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
      <div className="text-sm font-medium text-white">🎂 {t('soc.bday.title')}</div>
      <div className="grid grid-cols-3 gap-2 streamer-blur">
        <Field label={t('soc.bday.day')}>
          <input type="number" min={1} max={31} value={day} onChange={e => setDay(e.target.value)} className="w-full fc-input text-sm" />
        </Field>
        <Field label={t('soc.bday.month')}>
          <select value={month} onChange={e => setMonth(e.target.value)} className="w-full fc-input text-sm">
            <option value="">—</option>
            {MONTHS.map(m => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </Field>
        <Field label={t('soc.bday.year')}>
          <input type="number" min={1900} max={new Date().getFullYear()} value={year} onChange={e => setYear(e.target.value)} className="w-full fc-input text-sm" />
        </Field>
      </div>
      <Field label={t('soc.bday.visibility')}>
        <Select value={visibility} onChange={v => setVisibility(v as MyBirthday['visibility'])} className="w-full"
          options={[
            { value: 'nobody', label: t('soc.bday.nobody') },
            { value: 'friends', label: t('soc.bday.friends') },
            { value: 'servers', label: t('soc.bday.servers') },
          ]} />
      </Field>
      {visibility === 'servers' && (
        <fieldset className="space-y-1 max-h-48 overflow-y-auto">
          <legend className="text-xs text-fc-muted mb-1">{t('soc.bday.pick')}</legend>
          {servers.map(s => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-fc-text">
              <input type="checkbox" checked={chosen.includes(s.id)}
                onChange={e => setChosen(c => e.target.checked ? [...c, s.id] : c.filter(id => id !== s.id))} />
              <span className="truncate">{s.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex gap-2">
        <button onClick={submit} disabled={save.isPending}
          className="px-4 py-2 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition">
          {save.isPending ? t('common.saving') : t('soc.bday.save')}
        </button>
        {data?.birthday && (
          <button onClick={() => save.mutate({ birthday: null })} disabled={save.isPending}
            className="px-4 py-2 bg-fc-hover text-fc-muted hover:text-white rounded-lg text-sm transition disabled:opacity-50">
            {t('soc.bday.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
