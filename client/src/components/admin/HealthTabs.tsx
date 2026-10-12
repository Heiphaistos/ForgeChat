// Administration du site : santé du serveur et événements de sécurité (audit 2026-10-12,
// améliorations n° 16 et 38). Comme le reste de la page d'administration : en français.
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'

interface Health {
  status: 'ok' | 'degraded' | 'down'; version: string; uptime_secs: number
  database: { state: string; ms: number | null }; redis: { state: string; ms: number | null }
  livekit: { state: string; ms: number | null }; email: string; antivirus: string
  disk: { free_bytes: number; total_bytes: number }; connected_users: number
}
interface SecurityKind { kind: string; label: string; threshold_per_hour: number; hours: number[]; total_24h: number }

const STATE: Record<string, [string, string]> = {
  ok: ['Opérationnel', 'text-fc-green'], degraded: ['Ralenti', 'text-fc-yellow'], down: ['En panne', 'text-fc-red'],
  off: ['Non configuré', 'text-fc-muted'], on: ['Actif', 'text-fc-green'],
}
const Badge = ({ s }: { s: string }) => {
  const [label, cls] = STATE[s] ?? [s, 'text-fc-muted']
  return <span className={`font-medium ${cls}`}>{label}</span>
}
const gb = (n: number) => `${(n / 1e9).toFixed(1)} Go`
function duration(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`
}

function Row({ name, state, ms }: { name: string; state: string; ms?: number | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-fc-hover last:border-0">
      <span className="text-sm text-white">{name}</span>
      <span className="text-sm"><Badge s={state} />{ms != null && <span className="text-fc-muted"> · {ms} ms</span>}</span>
    </div>
  )
}

export function HealthTab() {
  const { data, isError } = useQuery<Health>({ queryKey: ['site-admin', 'health'], queryFn: () => api.get('/admin/health').then(r => r.data), refetchInterval: 15_000 })
  if (isError) return <p className="text-fc-red">Santé indisponible.</p>
  if (!data) return <p className="text-fc-muted">Chargement…</p>
  const used = data.disk.total_bytes ? 1 - data.disk.free_bytes / data.disk.total_bytes : 0
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-fc-channel rounded-lg p-4 border border-fc-hover">
        <div className="text-lg">État général : <Badge s={data.status} /></div>
        <div className="text-xs text-fc-muted mt-1">Version {data.version} · en marche depuis {duration(data.uptime_secs)} · {data.connected_users} compte(s) connecté(s) en temps réel</div>
      </div>
      <div className="bg-fc-channel rounded-lg px-4 border border-fc-hover">
        <Row name="Base de données" state={data.database.state} ms={data.database.ms} />
        <Row name="Redis (temps réel, limites)" state={data.redis.state} ms={data.redis.ms} />
        <Row name="Serveur vocal (LiveKit)" state={data.livekit.state} ms={data.livekit.ms} />
        <Row name="Envoi d’e-mails" state={data.email} />
        <Row name="Antivirus des fichiers en clair" state={data.antivirus} />
      </div>
      <div className="bg-fc-channel rounded-lg p-4 border border-fc-hover">
        <div className="text-sm text-white mb-2">Disque des fichiers : {gb(data.disk.free_bytes)} libres sur {gb(data.disk.total_bytes)}</div>
        <div className="h-2 rounded bg-fc-hover overflow-hidden" role="progressbar" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${used > 0.9 ? 'bg-fc-red' : used > 0.75 ? 'bg-fc-yellow' : 'bg-fc-green'}`} style={{ width: `${Math.round(used * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}

export function SecurityTab() {
  const { data } = useQuery<{ kinds: SecurityKind[] }>({ queryKey: ['site-admin', 'security'], queryFn: () => api.get('/admin/security-events').then(r => r.data), refetchInterval: 60_000 })
  if (!data) return <p className="text-fc-muted">Chargement…</p>
  return (
    <div className="space-y-3 max-w-3xl">
      <p className="text-xs text-fc-muted">Compteurs par heure, sans aucune donnée personnelle. Au-delà du seuil, une alerte part dans les journaux et à SECURITY_ALERT_EMAIL.</p>
      {data.kinds.map(k => {
        const max = Math.max(k.threshold_per_hour, ...k.hours, 1)
        const over = k.hours.some(n => n > k.threshold_per_hour)
        return (
          <div key={k.kind} className={`bg-fc-channel rounded-lg p-3 border ${over ? 'border-fc-red/60' : 'border-fc-hover'}`}>
            <div className="flex justify-between text-sm">
              <span className="text-white">{k.label}</span>
              <span className="text-fc-muted">{k.total_24h} en 24 h · seuil {k.threshold_per_hour}/h</span>
            </div>
            <div className="flex items-end gap-0.5 h-10 mt-2" aria-label={`${k.label} : ${k.hours.join(', ')} par heure`}>
              {k.hours.map((n, i) => (
                <div key={i} title={`il y a ${23 - i} h : ${n}`} className={`flex-1 rounded-sm ${n > k.threshold_per_hour ? 'bg-fc-red' : n ? 'bg-fc-accent' : 'bg-fc-hover'}`}
                  style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
