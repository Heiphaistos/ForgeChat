import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Toggle, Select, Field } from './shared'
import api from '../../api/client'
import toast from 'react-hot-toast'

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
          options={[{ value: 'everyone', label: 'Tout le monde' }, { value: 'friends', label: 'Amis uniquement' }, { value: 'nobody', label: 'Personne' }]} />
      </Field>

      <Field label="Qui peut vous envoyer des demandes d'amis">
        <Select value={friendRequestFrom} onChange={setFriendRequestFrom} className="w-full"
          options={[{ value: 'everyone', label: 'Tout le monde' }, { value: 'friends_of_friends', label: "Amis d'amis" }, { value: 'nobody', label: 'Personne' }]} />
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
        onClick={() => save.mutate({ show_online: showOnline, activity_visibility: activityVisibility, friend_request_from: friendRequestFrom, dm_from_all: dmFromAll, explicit_content_filter: explicitFilter })}
        disabled={save.isPending}
        className="w-full py-2.5 bg-fc-accent hover:bg-fc-accent/80 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
      >
        {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
      </button>

      <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div className="text-sm font-medium text-white mb-1">Exporter mes données</div>
        <div className="text-xs text-fc-muted mb-3">Télécharger une copie JSON de votre profil, messages, serveurs et amis (RGPD).</div>
        <button
          onClick={() => {
            api.get('/users/me/data-export', { responseType: 'blob' }).then(res => {
              const url = URL.createObjectURL(res.data)
              const a = document.createElement('a')
              a.href = url
              a.download = 'forgechat-mes-donnees.json'
              a.click()
              URL.revokeObjectURL(url)
            }).catch(() => toast.error('Erreur lors de l\'export'))
          }}
          className="px-4 py-2 bg-fc-sidebar hover:bg-fc-hover text-white text-sm rounded-lg transition"
        >
          Télécharger
        </button>
      </div>
    </div>
  )
}
