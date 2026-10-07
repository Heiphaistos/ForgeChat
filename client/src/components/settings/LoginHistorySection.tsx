import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { Monitor, Smartphone, Globe } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useT, dateLocale, t as tr } from '../../i18n'

interface Session {
  id: string
  device_info?: string
  last_seen: string
  created_at: string
}

function getDeviceIcon(deviceInfo?: string) {
  if (!deviceInfo) return <Globe size={16} />
  return /Android|iOS/.test(deviceInfo) ? <Smartphone size={16} /> : <Monitor size={16} />
}

// Étiquette posée par le serveur (« Firefox · Linux »…), ni IP ni user-agent brut.
function parseDevice(deviceInfo?: string) {
  return deviceInfo || tr('settings.sessions.unknownDevice')
}

export default function LoginHistorySection() {
  const t = useT()
  const locale = dateLocale()
  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['login-history'],
    queryFn: () => api.get('/users/me/login-history').then(r => r.data),
    staleTime: 60_000,
  })

  if (isLoading) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="text-xs text-fc-muted mb-4">
        {t('settings.history.intro')}
      </div>
      {sessions.map(s => (
        <div key={s.id} className="flex items-start gap-3 p-3 rounded-xl border bg-fc-channel border-fc-hover">
          <div className="mt-0.5 text-fc-muted">
            {getDeviceIcon(s.device_info)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium">
              {parseDevice(s.device_info)}
            </div>
            <div className="text-xs text-fc-muted mt-0.5">
              {t('settings.sessions.lastActive', { when: formatDistanceToNow(new Date(s.last_seen), { addSuffix: true, locale }) })}
            </div>
            <div className="text-xs text-fc-muted">
              {t('settings.sessions.created', { when: formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale }) })}
            </div>
          </div>
        </div>
      ))}
      {sessions.length === 0 && (
        <div className="text-fc-muted text-sm text-center py-8">{t('settings.history.empty')}</div>
      )}
    </div>
  )
}
