import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Film, Check } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

const HIDDEN_ITEMS = [
  { id: 'email', label: 'Adresse e-mail' },
  { id: 'tag', label: 'Tag utilisateur' },
  { id: 'invites', label: 'Invitations de serveur' },
  { id: 'servers', label: 'Noms des serveurs' },
  { id: 'apps', label: 'Applications connectées' },
  { id: 'streaming_url', label: 'URLs de streaming' },
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
  const [hiddenItems, setHiddenItems] = useState<string[]>(['email', 'tag', 'invites', 'servers', 'apps', 'streaming_url'])

  useEffect(() => {
    if (settings) {
      setStreamerMode(settings.streamer_mode ?? false)
      setHiddenItems(settings.streamer_hidden_items ?? ['email', 'tag', 'invites', 'servers', 'apps', 'streaming_url'])
    }
  }, [settings])

  const toggleItem = (id: string) => {
    setHiddenItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white flex items-center gap-2">
            <Film size={14} /> Mode Streamer
          </div>
          <div className="text-xs text-fc-muted">Masque les informations sensibles à l'écran</div>
        </div>
        <Toggle value={streamerMode} onChange={setStreamerMode} />
      </div>

      {streamerMode && (
        <div className="space-y-2">
          <p className="text-xs text-fc-muted uppercase tracking-wide font-semibold mb-3">
            Choisir ce qui est masqué
          </p>
          {HIDDEN_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition border ${
                hiddenItems.includes(item.id)
                  ? 'bg-fc-accent/10 border-fc-accent/30 text-white'
                  : 'bg-fc-channel border-fc-hover text-fc-muted hover:text-white'
              }`}
            >
              <span className="text-sm">{item.label}</span>
              {hiddenItems.includes(item.id) && <Check size={14} className="text-fc-accent" />}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => save.mutate({ streamer_mode: streamerMode, streamer_hidden_items: hiddenItems })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
