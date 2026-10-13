// Administration du site : santé du serveur et événements de sécurité (audit 2026-10-12,
// améliorations n° 16 et 38). Textes traduits (i18n/parts/auditRest.ts).
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { useT, type Key } from '../../i18n'

type TFn = ReturnType<typeof useT>

interface Health {
  status: 'ok' | 'degraded' | 'down'; version: string; uptime_secs: number
  database: { state: string; ms: number | null }; redis: { state: string; ms: number | null }
  livekit: { state: string; ms: number | null }; email: string; antivirus: string
  disk: { free_bytes: number; total_bytes: number }; connected_users: number
}
interface SecurityKind { kind: string; label: string; threshold_per_hour: number; hours: number[]; total_24h: number }

const STATE: Record<string, [Key, string]> = {
  ok: ['hlth.ok', 'text-fc-green'], degraded: ['hlth.degraded', 'text-fc-yellow'], down: ['hlth.down', 'text-fc-red'],
  off: ['hlth.off', 'text-fc-muted'], on: ['hlth.on', 'text-fc-green'],
}
const Badge = ({ s }: { s: string }) => {
  const t = useT()
  const known = STATE[s]
  return <span className={`font-medium ${known?.[1] ?? 'text-fc-muted'}`}>{known ? t(known[0]) : s}</span>
}
const gb = (t: TFn, n: number) => t('hlth.gb', { n: (n / 1e9).toFixed(1) })
function duration(t: TFn, s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? t('hlth.dh', { d, h }) : h ? t('hlth.hm', { h, m }) : t('hlth.m', { m })
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
  const t = useT()
  if (isError) return <p className="text-fc-red">{t('hlth.unavailable')}</p>
  if (!data) return <p className="text-fc-muted">{t('hlth.loading')}</p>
  const used = data.disk.total_bytes ? 1 - data.disk.free_bytes / data.disk.total_bytes : 0
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-fc-channel rounded-lg p-4 border border-fc-hover">
        <div className="text-lg">{t('hlth.overall')} <Badge s={data.status} /></div>
        <div className="text-xs text-fc-muted mt-1">{t('hlth.summary', { version: data.version, uptime: duration(t, data.uptime_secs), users: data.connected_users })}</div>
      </div>
      <div className="bg-fc-channel rounded-lg px-4 border border-fc-hover">
        <Row name={t('hlth.db')} state={data.database.state} ms={data.database.ms} />
        <Row name={t('hlth.redis')} state={data.redis.state} ms={data.redis.ms} />
        <Row name={t('hlth.livekit')} state={data.livekit.state} ms={data.livekit.ms} />
        <Row name={t('hlth.email')} state={data.email} />
        <Row name={t('hlth.antivirus')} state={data.antivirus} />
      </div>
      <div className="bg-fc-channel rounded-lg p-4 border border-fc-hover">
        <div className="text-sm text-white mb-2">{t('hlth.disk', { free: gb(t, data.disk.free_bytes), total: gb(t, data.disk.total_bytes) })}</div>
        <div className="h-2 rounded bg-fc-hover overflow-hidden" role="progressbar" aria-label={t('hlth.diskUsage')} aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full ${used > 0.9 ? 'bg-fc-red' : used > 0.75 ? 'bg-fc-yellow' : 'bg-fc-green'}`} style={{ width: `${Math.round(used * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}

export function SecurityTab() {
  const { data } = useQuery<{ kinds: SecurityKind[] }>({ queryKey: ['site-admin', 'security'], queryFn: () => api.get('/admin/security-events').then(r => r.data), refetchInterval: 60_000 })
  const t = useT()
  if (!data) return <p className="text-fc-muted">{t('hlth.loading')}</p>
  return (
    <div className="space-y-3 max-w-3xl">
      <p className="text-xs text-fc-muted">{t('secev.intro')}</p>
      {data.kinds.map(k => {
        const max = Math.max(k.threshold_per_hour, ...k.hours, 1)
        const over = k.hours.some(n => n > k.threshold_per_hour)
        return (
          <div key={k.kind} className={`bg-fc-channel rounded-lg p-3 border ${over ? 'border-fc-red/60' : 'border-fc-hover'}`}>
            <div className="flex justify-between text-sm">
              <span className="text-white">{k.label}</span>
              <span className="text-fc-muted">{t('secev.totals', { total: k.total_24h, threshold: k.threshold_per_hour })}</span>
            </div>
            <div className="flex items-end gap-0.5 h-10 mt-2" role="img" aria-label={t('secev.chart', { label: k.label, hours: k.hours.join(', ') })}>
              {k.hours.map((n, i) => (
                <div key={i} title={t('secev.hourAgo', { h: 23 - i, n })} className={`flex-1 rounded-sm ${n > k.threshold_per_hour ? 'bg-fc-red' : n ? 'bg-fc-accent' : 'bg-fc-hover'}`}
                  style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
