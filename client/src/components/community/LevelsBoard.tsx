// Niveaux natifs : ma carte de niveau (générée sur l'appareil) et le classement.
import { useQuery } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import { useAuth } from '../../store/auth'
import { intlLocale, useT } from '../../i18n'
import GeneratedCard from './GeneratedCard'
import { levelProgress } from './format'

interface Member {
  user_id: string
  username: string
  avatar: string | null
  xp: number
  level: number
  level_xp: number
  next_level_xp: number
  messages: number
  voice_minutes: number
  rank: number
}

export default function LevelsBoard({ serverId }: { serverId: string }) {
  const t = useT()
  const me = useAuth(s => s.user)
  const { data: settings } = useQuery<{ enabled: boolean }>({
    queryKey: ['community', serverId, 'levels'],
    queryFn: () => api.get(`/servers/${serverId}/levels`).then(r => r.data),
  })
  const enabled = !!settings?.enabled
  const { data: board = [] } = useQuery<Member[]>({
    queryKey: ['levels_board', serverId],
    queryFn: () => api.get(`/servers/${serverId}/levels/leaderboard?limit=50`).then(r => r.data),
    enabled,
  })
  const { data: mine } = useQuery<Member>({
    queryKey: ['levels_board', serverId, 'me'],
    queryFn: () => api.get(`/servers/${serverId}/levels/members/${me?.id}`).then(r => r.data),
    enabled: enabled && !!me?.id,
  })
  if (!enabled) return null
  const fmt = (n: number) => n.toLocaleString(intlLocale())
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-white">{t('community.levels.board')}</h2>
      {mine && (
        <GeneratedCard filename="niveau.png" data={{
          name: mine.username,
          avatar: mine.avatar,
          title: mine.username,
          subtitle: t('community.levels.cardLine', { n: mine.level, rank: mine.rank || '—' }),
          progress: levelProgress(mine.xp, mine.level_xp, mine.next_level_xp),
          footer: t('community.levels.xp', { xp: fmt(mine.xp), next: fmt(mine.next_level_xp) }),
          accent: '#faa61a',
        }} />
      )}
      <ol className="space-y-1.5">
        {board.map(m => (
          <li key={m.user_id} className={`flex items-center gap-3 p-3 rounded-xl ${m.user_id === me?.id ? 'bg-fc-accent/10' : 'bg-fc-channel'}`}>
            <span className="w-8 text-center text-fc-muted font-bold text-sm">#{m.rank}</span>
            {m.avatar
              ? <img src={mediaUrl(m.avatar)} alt="" className="w-8 h-8 rounded-full object-cover" />
              : <span className="w-8 h-8 rounded-full bg-fc-hover flex items-center justify-center text-sm text-white">{m.username[0]?.toUpperCase()}</span>}
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{m.username}</div>
              <div className="h-1.5 bg-fc-hover rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-yellow-400" style={{ width: `${Math.round(levelProgress(m.xp, m.level_xp, m.next_level_xp) * 100)}%` }} />
              </div>
            </div>
            <div className="text-right">
              <div className="text-white text-sm font-semibold">{t('community.levels.level', { n: m.level })}</div>
              <div className="text-[11px] text-fc-muted">{fmt(m.xp)} XP</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-fc-muted">{t('community.levels.privacy')}</p>
    </section>
  )
}
