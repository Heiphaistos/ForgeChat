import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { Monitor, Smartphone, Globe } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'

interface Session {
  id: string
  device_info?: string
  ip_address?: string
  last_seen: string
  created_at: string
}

function getDeviceIcon(deviceInfo?: string) {
  if (!deviceInfo) return <Globe size={16} />
  const d = deviceInfo.toLowerCase()
  if (d.includes('mobile') || d.includes('android') || d.includes('iphone')) return <Smartphone size={16} />
  return <Monitor size={16} />
}

function parseDevice(deviceInfo?: string) {
  if (!deviceInfo) return 'Appareil inconnu'
  if (deviceInfo.includes('Tauri')) return 'Application ForgeChat'
  const match = deviceInfo.match(/\(([^)]+)\)/)
  if (match) return match[1].split(';')[0].trim()
  return deviceInfo.slice(0, 50)
}

export default function LoginHistorySection() {
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
        20 dernières connexions à votre compte
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
            {s.ip_address && (
              <div className="text-xs text-fc-muted mt-0.5">{s.ip_address}</div>
            )}
            <div className="text-xs text-fc-muted mt-0.5">
              Dernière activité {formatDistanceToNow(new Date(s.last_seen), { addSuffix: true, locale: fr })}
            </div>
            <div className="text-xs text-fc-muted">
              Créée {formatDistanceToNow(new Date(s.created_at), { addSuffix: true, locale: fr })}
            </div>
          </div>
        </div>
      ))}
      {sessions.length === 0 && (
        <div className="text-fc-muted text-sm text-center py-8">Aucun historique disponible</div>
      )}
    </div>
  )
}
