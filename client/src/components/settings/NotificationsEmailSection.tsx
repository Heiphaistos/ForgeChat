import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { Toggle } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

export default function NotificationsEmailSection() {
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
    onSuccess: () => { toast.success('Préférences email sauvegardées'); refetch() },
    onError: () => toast.error('Erreur lors de la sauvegarde'),
  })

  return (
    <div className="space-y-6">
      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white flex items-center gap-2">
              <Mail size={14} />
              Résumé email — DMs non lus
            </div>
            <div className="text-xs text-fc-muted mt-0.5">
              Reçois un email si tu as des messages directs non lus depuis plus de 24h (au plus une fois par jour)
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
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
