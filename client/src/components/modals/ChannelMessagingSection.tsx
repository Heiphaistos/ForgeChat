// Réglages de discussion d'un salon textuel : messages éphémères et fils automatiques.
// Enregistrés aussitôt (PUT …/messaging, droit de modifier les salons).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT, type Key } from '../../i18n'

const DURATIONS: { value: number | null; label: Key }[] = [
  { value: null, label: 'disappear.off' },
  { value: 3600, label: 'disappear.1h' },
  { value: 86_400, label: 'disappear.24h' },
  { value: 604_800, label: 'disappear.7d' },
]

interface Props {
  serverId: string
  channelId: string
  disappearSeconds?: number | null
  autoThreads?: boolean
}

export default function ChannelMessagingSection({ serverId, channelId, disappearSeconds, autoThreads }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [disappear, setDisappear] = useState<number | null>(disappearSeconds ?? null)
  const [threads, setThreads] = useState(!!autoThreads)
  const save = useMutation({
    mutationFn: (body: { disappear_seconds?: number | null; auto_threads?: boolean }) =>
      api.put(`/servers/${serverId}/channels/${channelId}/messaging`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['server', serverId] }),
    onError: (e: any) => {
      setDisappear(disappearSeconds ?? null)
      setThreads(!!autoThreads)
      toast.error(e?.response?.data?.error ?? t('disappear.failed'))
    },
  })

  return (
    <div className="space-y-3 bg-fc-bg/50 rounded-xl border border-fc-hover p-4">
      <h4 className="text-sm font-semibold text-white">{t('chanMsg.title')}</h4>
      <div>
        <label htmlFor="chan-disappear" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
          {t('disappear.title')}
        </label>
        <select
          id="chan-disappear"
          value={disappear ?? ''}
          disabled={save.isPending}
          onChange={e => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            setDisappear(v)
            save.mutate({ disappear_seconds: v })
          }}
          className="w-full fc-input text-sm"
        >
          {DURATIONS.map(d => <option key={String(d.value)} value={d.value ?? ''}>{t(d.label)}</option>)}
        </select>
        <p className="text-xs text-fc-muted mt-1">{t('disappear.hint')}</p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={threads}
          disabled={save.isPending}
          onChange={e => { setThreads(e.target.checked); save.mutate({ auto_threads: e.target.checked }) }}
        />
        <span>
          <span className="block text-sm text-white">{t('autothread.setting')}</span>
          <span className="block text-xs text-fc-muted">{t('autothread.hint')}</span>
        </span>
      </label>
    </div>
  )
}
