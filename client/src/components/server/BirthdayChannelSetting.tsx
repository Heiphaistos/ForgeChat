// Message d'anniversaire automatique du serveur (lot « Profil et social ») : salon
// où souhaiter l'anniversaire des membres qui ont choisi ce serveur.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT } from '../../i18n'

export default function BirthdayChannelSetting({ serverId, channels }: { serverId: string; channels: { id: string; name: string; type: string }[] }) {
  const t = useT()
  const qc = useQueryClient()
  const key = ['birthday-channel', serverId]
  const { data } = useQuery<{ channel_id: string | null }>({
    queryKey: key,
    queryFn: () => api.get(`/servers/${serverId}/birthday-channel`).then(r => r.data),
  })
  const save = useMutation({
    mutationFn: (channel_id: string | null) => api.put(`/servers/${serverId}/birthday-channel`, { channel_id }).then(r => r.data),
    onSuccess: d => { qc.setQueryData(key, d); toast.success(t('soc.bday.serverSaved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })
  return (
    <div>
      <label htmlFor={`bday-${serverId}`} className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">🎂 {t('soc.bday.serverTitle')}</label>
      <p className="text-xs text-fc-muted mb-2">{t('soc.bday.serverDesc')}</p>
      <select id={`bday-${serverId}`} value={data?.channel_id ?? ''} disabled={!data || save.isPending}
        onChange={e => save.mutate(e.target.value || null)}
        className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm">
        <option value="">{t('soc.bday.serverOff')}</option>
        {channels.filter(c => c.type === 'text').map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
      </select>
    </div>
  )
}
