import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { Monitor, Smartphone, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Session {
  id: string
  device: string | null
  ip: string | null
  last_seen: string
  created_at: string
}

export default function SessionsSection() {
  const qc = useQueryClient()
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => api.get('/users/me/sessions').then(r => r.data),
    staleTime: 60_000,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-fc-muted">
        {sessions.length} session{sessions.length > 1 ? 's' : ''} active{sessions.length > 1 ? 's' : ''}
      </p>
      {sessions.map((s, i) => (
        <div key={s.id} className="flex items-center justify-between p-3 bg-fc-channel rounded-xl border border-fc-hover gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {s.device?.toLowerCase().includes('mobile') || s.device?.toLowerCase().includes('android') || s.device?.toLowerCase().includes('iphone')
              ? <Smartphone size={18} className="text-fc-muted flex-shrink-0" />
              : <Monitor size={18} className="text-fc-muted flex-shrink-0" />
            }
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{s.device ?? 'Appareil inconnu'}</p>
              <p className="text-xs text-fc-muted">
                {s.ip ?? '—'} · {formatDistanceToNow(new Date(s.last_seen), { addSuffix: true, locale: fr })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {i === 0 && (
              <span className="text-xs bg-fc-green/20 text-fc-green px-2 py-0.5 rounded-full whitespace-nowrap">
                Actuelle
              </span>
            )}
            {i !== 0 && (
              <button
                onClick={() => revoke.mutate(s.id)}
                disabled={revoke.isPending}
                className="p-1.5 text-fc-muted hover:text-fc-red rounded-lg hover:bg-fc-red/10 transition disabled:opacity-50"
                title="Révoquer cette session"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}
      {sessions.length === 0 && (
        <p className="text-sm text-fc-muted text-center py-8">Aucune session enregistrée</p>
      )}
    </div>
  )
}
