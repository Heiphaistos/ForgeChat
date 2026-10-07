// Statistiques sur une période : membres (croissance), messages par jour (un compte,
// jamais le contenu), présence vocale, salons actifs. Graphiques SVG sans bibliothèque.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { intlLocale, useT } from '../../i18n'

interface Day { day: string; messages: number; joins: number; leaves: number; members: number; voice_minutes: number; voice_peak: number }
interface History {
  days: number
  member_count: number
  in_voice_now: number
  series: Day[]
  channels: { id: string; name: string; messages: number; authors: number }[]
}

function Chart({ title, values, labels, color, kind }: { title: string; values: number[]; labels: string[]; color: string; kind: 'bar' | 'line' }) {
  const W = 600, H = 140, P = 4
  const max = Math.max(1, ...values)
  const min = kind === 'line' ? Math.min(...values) : 0
  const span = Math.max(1, max - min)
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, values.length - (kind === 'line' ? 1 : 0))
  const y = (v: number) => H - P - ((v - min) * (H - 2 * P)) / span
  const bw = (W - 2 * P) / values.length - 2
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <figure className="p-4 bg-fc-input rounded-xl">
      <figcaption className="flex justify-between text-sm mb-2">
        <span className="text-white font-medium">{title}</span>
        <span className="text-fc-muted">{(kind === 'line' ? values[values.length - 1] ?? 0 : total).toLocaleString(intlLocale())}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" role="img" aria-label={title} preserveAspectRatio="none">
        {kind === 'bar'
          ? values.map((v, i) => (
            <rect key={i} x={x(i) + 1} y={y(v)} width={Math.max(1, bw)} height={H - P - y(v)} fill={color} rx={2}>
              <title>{`${labels[i]} : ${v}`}</title>
            </rect>
          ))
          : <polyline fill="none" stroke={color} strokeWidth={3} points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />}
      </svg>
      <div className="flex justify-between text-[10px] text-fc-muted mt-1"><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
    </figure>
  )
}

export default function StatsHistory({ serverId }: { serverId: string }) {
  const t = useT()
  const [days, setDays] = useState(30)
  const { data } = useQuery<History>({
    queryKey: ['server_stats_history', serverId, days],
    queryFn: () => api.get(`/servers/${serverId}/stats/history?days=${days}`).then(r => r.data),
    staleTime: 60_000,
    retry: false,
  })
  if (!data) return null
  const labels = data.series.map(d => new Date(d.day).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' }))
  return (
    <div className="space-y-3 mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{t('community.stats.title')}</h3>
        <select value={days} onChange={e => setDays(Number(e.target.value))} aria-label={t('community.stats.period')}
          className="px-2 py-1 bg-fc-input rounded text-white text-sm">
          {[7, 30, 90].map(d => <option key={d} value={d}>{t('community.stats.days', { n: d })}</option>)}
        </select>
      </div>
      <Chart title={t('community.stats.members')} kind="line" color="#3ba55c" labels={labels} values={data.series.map(d => d.members)} />
      <Chart title={t('community.stats.messages')} kind="bar" color="#5865f2" labels={labels} values={data.series.map(d => d.messages)} />
      <Chart title={t('community.stats.voice')} kind="bar" color="#faa61a" labels={labels} values={data.series.map(d => d.voice_minutes)} />
      <p className="text-xs text-fc-muted">{t('community.stats.voiceNow', { n: data.in_voice_now })}</p>
      <div className="p-4 bg-fc-input rounded-xl">
        <div className="text-sm text-white font-medium mb-2">{t('community.stats.channels')}</div>
        <ul className="space-y-1">
          {data.channels.map(c => (
            <li key={c.id} className="flex justify-between text-sm">
              <span className="text-fc-text truncate">#{c.name}</span>
              <span className="text-fc-muted flex-shrink-0">{t('community.stats.channelLine', { m: c.messages, a: c.authors })}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-fc-muted">{t('community.stats.privacy')}</p>
    </div>
  )
}
