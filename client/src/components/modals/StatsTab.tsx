import { useQuery } from '@tanstack/react-query'
import { Users, Radio, MessageSquare, Hash, Loader2 } from 'lucide-react'
import api from '../../api/client'
import { useT, intlLocale } from '../../i18n'
import StatsHistory from '../community/StatsHistory'

interface Props {
  serverId: string
}

interface Stats {
  member_count: number
  online_count: number
  message_count_week: number
  channel_count: number
}

interface StatCardProps {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: number | undefined
  loading: boolean
}

function StatCard({ icon, iconColor, label, value, loading }: StatCardProps) {
  const t = useT()
  return (
    <div
      className="flex flex-col gap-3 p-5 bg-fc-input rounded-xl"
      aria-label={`${label} : ${loading ? t('stats.loading') : (value?.toLocaleString(intlLocale()) ?? '—')}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconColor}`} aria-hidden>
        {icon}
      </div>
      {loading ? (
        <Loader2 size={22} aria-hidden className="animate-spin text-fc-muted" />
      ) : (
        <div className="text-2xl font-bold text-white" aria-hidden>
          {value?.toLocaleString(intlLocale()) ?? '—'}
        </div>
      )}
      <div className="text-sm text-fc-muted" aria-hidden>{label}</div>
    </div>
  )
}

export default function StatsTab({ serverId }: Props) {
  const t = useT()
  const { data, isLoading, error } = useQuery<Stats>({
    queryKey: ['server_stats', serverId],
    queryFn: () => api.get(`/servers/${serverId}/stats`).then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  })

  if (error) {
    return (
      <div role="alert" className="text-center text-fc-muted py-10 text-sm">
        {t('stats.error')}
      </div>
    )
  }

  const onlinePct = data && data.member_count > 0
    ? Math.min(100, Math.round((data.online_count / data.member_count) * 100))
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">{t('stats.title')}</h3>
        <p className="text-sm text-fc-muted mb-6">{t('stats.refresh')}</p>

        <div className="grid grid-cols-2 gap-4">
          <StatCard
            icon={<Users size={18} className="text-white" />}
            iconColor="bg-indigo-500/40"
            label={t('stats.members')}
            value={data?.member_count}
            loading={isLoading}
          />
          <StatCard
            icon={<Radio size={18} className="text-white" />}
            iconColor="bg-green-500/40"
            label={t('stats.online')}
            value={data?.online_count}
            loading={isLoading}
          />
          <StatCard
            icon={<MessageSquare size={18} className="text-white" />}
            iconColor="bg-purple-500/40"
            label={t('stats.messages')}
            value={data?.message_count_week}
            loading={isLoading}
          />
          <StatCard
            icon={<Hash size={18} className="text-white" />}
            iconColor="bg-yellow-500/40"
            label={t('stats.channels')}
            value={data?.channel_count}
            loading={isLoading}
          />
        </div>
      </div>

      {data && (
        <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3" aria-hidden>{t('stats.activity')}</div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-fc-hover rounded-full overflow-hidden">
              <div
                role="progressbar"
                aria-label={t('stats.onlineRate')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={onlinePct}
                aria-valuetext={t('stats.onlinePctLong', { n: onlinePct })}
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${onlinePct}%` }}
              />
            </div>
            <span className="text-xs text-fc-muted flex-shrink-0" aria-hidden>
              {t('stats.onlinePct', { n: onlinePct })}
            </span>
          </div>
        </div>
      )}
      <StatsHistory serverId={serverId} />
    </div>
  )
}
