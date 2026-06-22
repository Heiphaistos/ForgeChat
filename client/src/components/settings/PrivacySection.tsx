import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
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

function Select({ value, onChange, options, className = '' }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; className?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none ${className}`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

export default function PrivacySection() {
  const { data: settings, refetch } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.put('/user/settings', data),
    onSuccess: () => { toast.success('Sauvegardé'); refetch() },
  })

  const [showOnline, setShowOnline] = useState(true)
  const [activityVisibility, setActivityVisibility] = useState('everyone')
  const [friendRequestFrom, setFriendRequestFrom] = useState('everyone')
  const [dmFromAll, setDmFromAll] = useState(true)
  const [explicitFilter, setExplicitFilter] = useState('none')

  useEffect(() => {
    if (settings) {
      setShowOnline(settings.show_online ?? true)
      setActivityVisibility(settings.activity_visibility ?? 'everyone')
      setFriendRequestFrom(settings.friend_request_from ?? 'everyone')
      setDmFromAll(settings.dm_from_all ?? true)
      setExplicitFilter(settings.explicit_content_filter ?? 'none')
    }
  }, [settings])

  return (
    <div className="space-y-4">
      {[
        { label: 'Afficher mon statut en ligne', desc: 'Les autres peuvent voir si vous êtes connecté', value: showOnline, onChange: setShowOnline },
        { label: 'Autoriser les DMs de tout le monde', desc: 'Messages directs de personnes non-amies', value: dmFromAll, onChange: setDmFromAll },
      ].map(item => (
        <div key={item.label} className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div>
            <div className="text-sm font-medium text-white">{item.label}</div>
            <div className="text-xs text-fc-muted">{item.desc}</div>
          </div>
          <Toggle value={item.value} onChange={item.onChange} />
        </div>
      ))}

      <Field label="Qui peut voir votre activité">
        <Select value={activityVisibility} onChange={setActivityVisibility} className="w-full"
          options={[
            { value: 'everyone', label: 'Tout le monde' },
            { value: 'friends', label: 'Amis uniquement' },
            { value: 'nobody', label: 'Personne' },
          ]} />
      </Field>

      <Field label="Qui peut vous envoyer des demandes d'amis">
        <Select value={friendRequestFrom} onChange={setFriendRequestFrom} className="w-full"
          options={[
            { value: 'everyone', label: 'Tout le monde' },
            { value: 'friends_of_friends', label: "Amis d'amis" },
            { value: 'nobody', label: 'Personne' },
          ]} />
      </Field>

      <Field label="Filtre de contenu explicite">
        <Select value={explicitFilter} onChange={setExplicitFilter} className="w-full"
          options={[
            { value: 'none', label: 'Désactivé' },
            { value: 'members_without_roles', label: 'Membres sans rôles' },
            { value: 'all', label: 'Tous les messages' },
          ]} />
      </Field>

      <button
        onClick={() => save.mutate({
          show_online: showOnline,
          activity_visibility: activityVisibility,
          friend_request_from: friendRequestFrom,
          dm_from_all: dmFromAll,
          explicit_content_filter: explicitFilter,
        })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>
    </div>
  )
}
