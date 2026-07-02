import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Ban {
  user_id: string
  username: string
  discriminator: string
  avatar: string | null
  reason: string | null
  banned_at: string
}

export default function BansTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()

  const { data: bans = [], isLoading } = useQuery<Ban[]>({
    queryKey: ['bans', serverId],
    queryFn: () => api.get(`/servers/${serverId}/bans`).then(r => r.data),
    retry: false,
  })

  const unban = useMutation({
    mutationFn: (userId: string) => api.delete(`/servers/${serverId}/bans/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bans', serverId] })
      toast.success('Membre débanni')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  if (isLoading) return <div className="text-fc-muted text-sm">Chargement...</div>

  if (bans.length === 0) {
    return (
      <div className="text-center text-fc-muted py-12 text-sm">
        <div className="text-3xl mb-3">🔓</div>
        Aucun ban actif sur ce serveur.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-fc-muted text-sm mb-4">{bans.length} utilisateur(s) banni(s)</p>
      {bans.map(b => (
        <div key={b.user_id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
          <div className="w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center font-bold text-red-400 overflow-hidden flex-shrink-0">
            {b.avatar
              ? <img src={b.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : b.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium">{b.username}#{b.discriminator}</div>
            {b.reason && (
              <div className="text-xs text-fc-muted truncate">Raison : {b.reason}</div>
            )}
            <div className="text-xs text-fc-muted">
              Banni le {new Date(b.banned_at).toLocaleDateString('fr-FR')}
            </div>
          </div>
          <button
            onClick={() => unban.mutate(b.user_id)}
            disabled={unban.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-hover hover:bg-green-600/20 hover:text-green-400
                       text-fc-muted rounded text-xs transition disabled:opacity-50"
          >
            <UserCheck size={13} />
            Débannir
          </button>
        </div>
      ))}
    </div>
  )
}
