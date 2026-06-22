import { BarChart2, Users, Wifi, MessageSquare, TrendingUp, Hash, UserPlus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'

interface Props {
  serverId: string
}

interface ServerStats {
  member_count: number
  online_count: number
  message_count_today: number
  message_count_week: number
  new_members_today: number
  new_members_week: number
  top_channels: { id: string; name: string; messages: number }[]
  active_hours: number[] // 24 values
}

interface MetricCardProps {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: number | undefined
  sub?: string
  loading: boolean
}

function MetricCard({ icon, iconBg, label, value, sub, loading }: MetricCardProps) {
  return (
    <div className="p-4 bg-fc-channel rounded-lg flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        {loading ? (
          <div className="h-6 w-16 bg-fc-hover animate-pulse rounded mb-1" />
        ) : (
          <div className="text-xl font-bold text-white">
            {value !== undefined ? value.toLocaleString('fr-FR') : '—'}
          </div>
        )}
        <div className="text-xs text-fc-muted">{label}</div>
        {sub && <div className="text-xs text-fc-muted/60 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function BarChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-0.5 h-16">
      {data.map((v, i) => {
        const pct = (v / max) * 100
        const isActive = pct > 60
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div
              className={`w-full rounded-sm transition-all ${isActive ? 'bg-fc-accent' : 'bg-fc-hover'} group-hover:bg-indigo-400`}
              style={{ height: `${Math.max(4, pct)}%` }}
            />
            {/* Tooltip heure */}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-fc-bg text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap z-10">
              {i}h: {v}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ServerStatsPage({ serverId }: Props) {
  const { data, isLoading, error } = useQuery<ServerStats>({
    queryKey: ['server_stats_full', serverId],
    queryFn: () => api.get(`/servers/${serverId}/stats`).then(r => r.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (error) {
    return (
      <div className="text-center py-12">
        <BarChart2 size={40} className="mx-auto text-fc-muted/30 mb-3" />
        <p className="text-fc-muted text-sm">Impossible de charger les statistiques.</p>
      </div>
    )
  }

  const topMax = data?.top_channels?.[0]?.messages ?? 1

  const onlineRatio = data && data.member_count > 0
    ? Math.round((data.online_count / data.member_count) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          <BarChart2 size={18} className="text-fc-accent" />
          Statistiques du serveur
        </h3>
        <p className="text-sm text-fc-muted">Actualisées toutes les minutes.</p>
      </div>

      {/* Métriques rapides — 4 cards 2x2 */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<Users size={18} className="text-white" />}
          iconBg="bg-indigo-500/30"
          label="Membres total"
          value={data?.member_count}
          loading={isLoading}
        />
        <MetricCard
          icon={<Wifi size={18} className="text-white" />}
          iconBg="bg-green-500/30"
          label="En ligne"
          value={data?.online_count}
          sub={data ? `${onlineRatio}% du serveur` : undefined}
          loading={isLoading}
        />
        <MetricCard
          icon={<MessageSquare size={18} className="text-white" />}
          iconBg="bg-purple-500/30"
          label="Messages aujourd'hui"
          value={data?.message_count_today}
          loading={isLoading}
        />
        <MetricCard
          icon={<TrendingUp size={18} className="text-white" />}
          iconBg="bg-orange-500/30"
          label="Messages cette semaine"
          value={data?.message_count_week}
          loading={isLoading}
        />
      </div>

      {/* Taux d'activité */}
      {data && (
        <div className="p-4 bg-fc-channel rounded-lg border border-fc-hover">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
            Taux de présence
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-fc-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${onlineRatio}%` }}
              />
            </div>
            <span className="text-xs text-fc-muted flex-shrink-0">{onlineRatio}% en ligne</span>
          </div>
        </div>
      )}

      {/* Nouveaux membres */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={<UserPlus size={18} className="text-white" />}
          iconBg="bg-teal-500/30"
          label="Nouveaux aujourd'hui"
          value={data?.new_members_today}
          loading={isLoading}
        />
        <MetricCard
          icon={<UserPlus size={18} className="text-white" />}
          iconBg="bg-cyan-500/30"
          label="Nouveaux cette semaine"
          value={data?.new_members_week}
          loading={isLoading}
        />
      </div>

      {/* Top salons */}
      {(isLoading || (data?.top_channels && data.top_channels.length > 0)) && (
        <div>
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
            Top salons actifs
          </div>
          <div className="space-y-2">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 bg-fc-channel animate-pulse rounded-lg" />
                ))
              : data!.top_channels.slice(0, 5).map((ch, idx) => {
                  const pct = topMax > 0 ? (ch.messages / topMax) * 100 : 0
                  return (
                    <div key={ch.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                      <span className="text-xs text-fc-muted w-4 flex-shrink-0 font-mono">{idx + 1}</span>
                      <Hash size={13} className="text-fc-muted flex-shrink-0" />
                      <span className="text-sm text-white truncate min-w-0 flex-1">{ch.name}</span>
                      <div className="w-24 h-1.5 bg-fc-hover rounded-full overflow-hidden flex-shrink-0">
                        <div
                          className="h-full bg-fc-accent rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-fc-muted flex-shrink-0 w-16 text-right">
                        {ch.messages.toLocaleString('fr-FR')} msg
                      </span>
                    </div>
                  )
                })
            }
          </div>
        </div>
      )}

      {/* Activité par heure */}
      {(isLoading || data?.active_hours) && (
        <div className="p-4 bg-fc-channel rounded-lg">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-4">
            Activité par heure (aujourd'hui)
          </div>
          {isLoading ? (
            <div className="h-16 bg-fc-hover animate-pulse rounded" />
          ) : (
            <>
              <BarChart data={data!.active_hours} />
              <div className="flex justify-between mt-2 text-xs text-fc-muted">
                <span>0h</span>
                <span>6h</span>
                <span>12h</span>
                <span>18h</span>
                <span>23h</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
