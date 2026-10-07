import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { Toggle } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'

export default function NotificationsEmailSection() {
  const t = useT()
  const { data, refetch } = useQuery({
    queryKey: ['email-prefs'],
    queryFn: () => api.get('/user/email-prefs').then(r => r.data),
    staleTime: 60_000,
  })

  const [dmNotify, setDmNotify] = useState(false)

  useEffect(() => {
    if (data) setDmNotify(data.dm_unread_notify ?? false)
  }, [data])

  const save = useMutation({
    mutationFn: () => api.put('/user/email-prefs', { dm_unread_notify: dmNotify }),
    onSuccess: () => { toast.success(t('settings.email.saved')); refetch() },
    onError: () => toast.error(t('settings.email.saveError')),
  })

  return (
    <div className="space-y-6">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2">
              <Mail size={14} />
              {t('settings.email.digest')}
            </div>
            <div className="text-xs text-fc-muted mt-0.5">
              {t('settings.email.digestDesc')}
            </div>
          </div>
          <Toggle value={dmNotify} onChange={setDmNotify} />
        </div>
      </div>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? t('common.saving') : t('common.save')}
      </button>
    </div>
  )
}
