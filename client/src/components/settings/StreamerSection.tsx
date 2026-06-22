import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Film, Check } from 'lucide-react'
import { Toggle } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

const HIDDEN_ITEMS = [
  'Adresse e-mail', 'Tag utilisateur', 'Invitations de serveur',
  'URLs de streaming', 'Informations personnelles du profil',
  "Notifications d'appel entrant",
]

export default function StreamerSection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })
  const [streamerMode, setStreamerMode] = useState(false)

  useEffect(() => { if (settings) setStreamerMode(settings.streamer_mode ?? false) }, [settings])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white flex items-center gap-2"><Film size={14} /> Mode Streamer</div>
          <div className="text-xs text-fc-muted">Masque les informations sensibles à l'écran</div>
        </div>
        <Toggle value={streamerMode} onChange={setStreamerMode} />
      </div>

      {streamerMode && (
        <div className="space-y-2">
          <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold">Éléments masqués</p>
          {HIDDEN_ITEMS.map(item => (
            <div key={item} className="flex items-center gap-2 text-sm text-fc-muted">
              <Check size={12} className="text-fc-green" /> {item}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => save.mutate({ streamer_mode: streamerMode })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
