import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { Monitor, Smartphone, Trash2, Globe, Shield, Clock, Cpu } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Session {
  id: string
  device: string | null
  ip: string | null
  last_seen: string
  created_at: string
}

function parseDevice(device: string | null): { label: string; Icon: typeof Monitor } {
  if (!device) return { label: 'Appareil inconnu', Icon: Monitor }
  const d = device.toLowerCase()
  if (d.includes('mobile') || d.includes('android') || d.includes('iphone') || d.includes('ios'))
    return { label: device, Icon: Smartphone }
  return { label: device, Icon: Monitor }
}

function getBrowser(device: string | null): string {
  if (!device) return ''
  if (device.toLowerCase().includes('chrome')) return 'Chrome'
  if (device.toLowerCase().includes('firefox')) return 'Firefox'
  if (device.toLowerCase().includes('safari')) return 'Safari'
  if (device.toLowerCase().includes('edge')) return 'Edge'
  return ''
}

export default function SessionsSection() {
  const qc = useQueryClient()
  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: () => api.get('/users/me/sessions').then(r => r.data),
    staleTime: 60_000,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
  const revokeAll = useMutation({
    mutationFn: () => Promise.all(sessions.slice(1).map(s => api.delete(`/users/me/sessions/${s.id}`))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })

  const current = sessions[0]
  const others = sessions.slice(1)

  if (isLoading) return (
    <div className="flex items-center justify-center py-12 text-fc-muted">
      <div className="w-5 h-5 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Résumé */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-fc-channel rounded-xl border border-fc-hover text-center">
          <Cpu size={18} className="mx-auto text-fc-accent mb-1" />
          <p className="text-lg font-bold text-white">{sessions.length}</p>
          <p className="text-xs text-fc-muted">Session{sessions.length > 1 ? 's' : ''} active{sessions.length > 1 ? 's' : ''}</p>
        </div>
        <div className="p-3 bg-fc-channel rounded-xl border border-fc-hover text-center">
          <Globe size={18} className="mx-auto text-fc-muted mb-1" />
          <p className="text-lg font-bold text-white">{new Set(sessions.map(s => s.ip)).size}</p>
          <p className="text-xs text-fc-muted">IP distincte{new Set(sessions.map(s => s.ip)).size > 1 ? 's' : ''}</p>
        </div>
        <div className="p-3 bg-fc-channel rounded-xl border border-fc-hover text-center">
          <Shield size={18} className="mx-auto text-fc-green mb-1" />
          <p className="text-lg font-bold text-white">{others.length}</p>
          <p className="text-xs text-fc-muted">Autre{others.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Session actuelle */}
      {current && (
        <section>
          <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Shield size={11} className="text-fc-green" /> Session actuelle
          </h3>
          <div className="p-4 bg-fc-channel rounded-xl border border-fc-green/30">
            <div className="flex items-start gap-3">
              {(() => { const { Icon } = parseDevice(current.device); return <Icon size={20} className="text-fc-accent flex-shrink-0 mt-0.5" /> })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-white truncate">{parseDevice(current.device).label}</p>
                  {getBrowser(current.device) && (
                    <span className="text-xs bg-fc-hover text-fc-muted px-1.5 py-0.5 rounded">{getBrowser(current.device)}</span>
                  )}
                  <span className="text-xs bg-fc-green/20 text-fc-green px-2 py-0.5 rounded-full">Actuelle</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fc-muted">
                  <span className="flex items-center gap-1"><Globe size={11} /> {current.ip ?? '—'}</span>
                  <span className="flex items-center gap-1"><Clock size={11} />
                    Connecté {formatDistanceToNow(new Date(current.last_seen), { addSuffix: true, locale: fr })}
                  </span>
                  <span className="flex items-center gap-1">
                    Depuis le {format(new Date(current.created_at), 'dd/MM/yyyy', { locale: fr })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Autres sessions */}
      {others.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide flex items-center gap-1.5">
              <Monitor size={11} /> Autres sessions ({others.length})
            </h3>
            <button
              onClick={() => revokeAll.mutate()}
              disabled={revokeAll.isPending}
              className="text-xs text-fc-red hover:text-red-300 transition disabled:opacity-50"
            >
              {revokeAll.isPending ? 'Révocation...' : 'Tout révoquer'}
            </button>
          </div>
          <div className="space-y-2">
            {others.map(s => {
              const { label, Icon } = parseDevice(s.device)
              const browser = getBrowser(s.device)
              return (
                <div key={s.id} className="flex items-start gap-3 p-3 bg-fc-channel rounded-xl border border-fc-hover">
                  <Icon size={18} className="text-fc-muted flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-white truncate">{label}</p>
                      {browser && <span className="text-xs bg-fc-hover text-fc-muted px-1.5 py-0.5 rounded">{browser}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fc-muted">
                      <span className="flex items-center gap-1"><Globe size={10} /> {s.ip ?? '—'}</span>
                      <span className="flex items-center gap-1"><Clock size={10} />
                        {formatDistanceToNow(new Date(s.last_seen), { addSuffix: true, locale: fr })}
                      </span>
                      <span>Créé le {format(new Date(s.created_at), 'dd/MM/yyyy', { locale: fr })}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => revoke.mutate(s.id)}
                    disabled={revoke.isPending}
                    className="p-1.5 text-fc-muted hover:text-fc-red rounded-lg hover:bg-fc-red/10 transition disabled:opacity-50 flex-shrink-0"
                    title="Révoquer cette session"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {sessions.length === 0 && (
        <p className="text-sm text-fc-muted text-center py-8">Aucune session enregistrée</p>
      )}
    </div>
  )
}
