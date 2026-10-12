import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import { Monitor, Smartphone, Trash2, Shield, ShieldAlert, Clock, Cpu } from 'lucide-react'
import { useAuth } from '../../store/auth'
import { formatDistanceToNow } from 'date-fns'
import { useT, t as tr, dateLocale, intlLocale } from '../../i18n'

interface Session {
  id: string
  device: string | null
  last_seen: string
  created_at: string
  current?: boolean
}

// Le serveur ne garde qu'une étiquette (« Chrome · Windows », « ForgeChat Android »), ni IP ni user-agent.
function parseDevice(device: string | null): { label: string; Icon: typeof Monitor } {
  if (!device) return { label: tr('settings.sessions.unknownDevice'), Icon: Monitor }
  return { label: device, Icon: /Android|iOS/.test(device) ? Smartphone : Monitor }
}

export default function SessionsSection() {
  const t = useT()
  const locale = dateLocale()
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
    mutationFn: () => Promise.all(others.map(s => api.delete(`/users/me/sessions/${s.id}`))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })

  // Verrouillage d'urgence (amélioration n° 25) : tout est fermé, y compris cette session.
  const lock = useMutation({
    mutationFn: () => api.post('/users/me/panic'),
    onSuccess: async () => {
      await useAuth.getState().logout().catch(() => {})
      window.location.assign('/verrouiller')
    },
  })

  // La liste est triée par last_seen : la première n'est pas forcément celle-ci.
  // Seul le drapeau `current` du serveur l'identifie ; sans lui, pas de « Tout révoquer ».
  const current = sessions.find(s => s.current)
  const others = sessions.filter(s => !s.current)

  if (isLoading) return (
    <div className="flex items-center justify-center py-12 text-fc-muted">
      <div className="w-5 h-5 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Résumé */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-fc-channel rounded-xl border border-fc-hover text-center">
          <Cpu size={18} className="mx-auto text-fc-accent mb-1" />
          <p className="text-lg font-bold text-white">{sessions.length}</p>
          <p className="text-xs text-fc-muted">{t(sessions.length > 1 ? 'settings.sessions.active.other' : 'settings.sessions.active.one')}</p>
        </div>
        <div className="p-3 bg-fc-channel rounded-xl border border-fc-hover text-center">
          <Shield size={18} className="mx-auto text-fc-green mb-1" />
          <p className="text-lg font-bold text-white">{others.length}</p>
          <p className="text-xs text-fc-muted">{t(others.length > 1 ? 'settings.sessions.others.other' : 'settings.sessions.others.one')}</p>
        </div>
      </div>

      {/* Session actuelle */}
      {current && (
        <section>
          <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Shield size={11} className="text-fc-green" /> {t('settings.sessions.current')}
          </h3>
          <div className="p-4 bg-fc-channel rounded-xl border border-fc-green/30">
            <div className="flex items-start gap-3">
              {(() => { const { Icon } = parseDevice(current.device); return <Icon size={20} className="text-fc-accent flex-shrink-0 mt-0.5" /> })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-white truncate">{parseDevice(current.device).label}</p>
                  <span className="text-xs bg-fc-green/20 text-fc-green px-2 py-0.5 rounded-full">{t('settings.sessions.currentBadge')}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fc-muted">
                  <span className="flex items-center gap-1"><Clock size={11} />
                    {t('settings.sessions.connected', { when: formatDistanceToNow(new Date(current.last_seen), { addSuffix: true, locale }) })}
                  </span>
                  <span className="flex items-center gap-1">
                    {t('settings.sessions.since', { date: new Date(current.created_at).toLocaleDateString(intlLocale()) })}
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
              <Monitor size={11} /> {current ? t('settings.sessions.otherSessions') : t('settings.section.sessions')} ({others.length})
            </h3>
            {current && <button
              onClick={() => revokeAll.mutate()}
              disabled={revokeAll.isPending}
              className="text-xs text-fc-red hover:text-red-300 transition disabled:opacity-50"
            >
              {revokeAll.isPending ? t('settings.sessions.revoking') : t('settings.sessions.revokeAll')}
            </button>}
          </div>
          <div className="space-y-2">
            {others.map(s => {
              const { label, Icon } = parseDevice(s.device)
              return (
                <div key={s.id} className="flex items-start gap-3 p-3 bg-fc-channel rounded-xl border border-fc-hover">
                  <Icon size={18} className="text-fc-muted flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-white truncate">{label}</p>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fc-muted">
                      <span className="flex items-center gap-1"><Clock size={10} />
                        {formatDistanceToNow(new Date(s.last_seen), { addSuffix: true, locale })}
                      </span>
                      <span>{t('settings.sessions.createdOn', { date: new Date(s.created_at).toLocaleDateString(intlLocale()) })}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => revoke.mutate(s.id)}
                    disabled={revoke.isPending}
                    className="p-1.5 text-fc-muted hover:text-fc-red rounded-lg hover:bg-fc-red/10 transition disabled:opacity-50 flex-shrink-0"
                    title={t('settings.sessions.revoke')}
                    aria-label={t('settings.sessions.revoke')}
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
        <p className="text-sm text-fc-muted text-center py-8">{t('settings.sessions.empty')}</p>
      )}

      <section className="p-4 bg-fc-channel rounded-xl border border-fc-red/30 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ShieldAlert size={16} className="text-fc-red" /> {t('guard.lock.title')}
        </h3>
        <p className="text-xs text-fc-muted">{t('guard.lock.intro')}</p>
        <button
          onClick={() => { if (window.confirm(t('guard.lock.confirm'))) lock.mutate() }}
          disabled={lock.isPending}
          className="px-3 py-1.5 bg-fc-red rounded-lg text-white text-sm font-medium disabled:opacity-50"
        >
          {lock.isPending ? t('guard.lock.pending') : t('guard.lock.button')}
        </button>
      </section>
    </div>
  )
}
