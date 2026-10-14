// Paramètres du serveur → Invitations (MANAGE_SERVER) : chaque code, ses utilisations, son
// créateur et les membres encore présents arrivés par lui (GET /servers/:id/invite-tracking).
import { useQuery } from '@tanstack/react-query'
import api, { mediaUrl } from '../../api/client'
import { useT } from '../../i18n'
import { useFormatDate } from '../../hooks/useFormatDate'

interface MiniUser { id: string; username: string; avatar: string | null }
interface TrackedInvite {
  code: string
  uses: number
  max_uses: number | null
  expires_at: string | null
  created_at: string | null
  revoked: boolean
  inviter: MiniUser | null
  members: { user: MiniUser; joined_at: string }[]
}

function Avatar({ user }: { user: MiniUser }) {
  return (
    <span className="w-6 h-6 rounded-full bg-fc-accent/40 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden flex-shrink-0" aria-hidden>
      {user.avatar
        ? <img src={mediaUrl(user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : user.username.charAt(0).toUpperCase()}
    </span>
  )
}

export default function InviteTrackingTab({ serverId }: { serverId: string }) {
  const t = useT()
  const { formatDate, formatTs } = useFormatDate()
  const { data: invites = [], isLoading, isError } = useQuery<TrackedInvite[]>({
    queryKey: ['invite-tracking', serverId],
    queryFn: () => api.get(`/servers/${serverId}/invite-tracking`).then(r => r.data),
    staleTime: 30_000,
    retry: false,
  })

  if (isLoading) return <div role="status" className="text-fc-muted text-sm">{t('common.loading')}</div>
  if (isError) return <div role="alert" className="text-fc-red text-sm">{t('dfeat.inv.loadFailed')}</div>

  const now = Date.now()
  return (
    <div className="space-y-3">
      <p className="text-sm text-fc-muted">{t('dfeat.inv.intro')} {t('dfeat.inv.untracked')}</p>
      {invites.length === 0 && <div role="status" className="text-center text-fc-muted py-12 text-sm">{t('dfeat.inv.empty')}</div>}
      <ul className="space-y-2">
        {invites.map(inv => {
          const expired = !!inv.expires_at && new Date(inv.expires_at).getTime() < now
          return (
            <li key={`${inv.code}:${inv.revoked}`} className={`p-3 bg-fc-channel rounded-lg ${inv.revoked ? 'opacity-75' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <code className="font-mono text-sm text-white streamer-blur">{inv.code}</code>
                {inv.revoked && <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-fc-red/20 text-fc-red">{t('dfeat.inv.revoked')}</span>}
                {!inv.revoked && expired && <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">{t('dfeat.inv.expired')}</span>}
                <span className="text-xs text-fc-muted ml-auto">
                  {inv.max_uses ? t('dfeat.inv.usesMax', { n: inv.uses, max: inv.max_uses }) : t('dfeat.inv.uses', { n: inv.uses })}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-fc-muted">
                {inv.inviter
                  ? <span className="flex items-center gap-1.5"><Avatar user={inv.inviter} />{t('dfeat.inv.by', { name: inv.inviter.username })}</span>
                  : !inv.revoked && <span>{t('dfeat.inv.byDeleted')}</span>}
                {inv.created_at && <span>{t('dfeat.inv.created', { date: formatDate(inv.created_at) })}</span>}
                {inv.expires_at && !expired && <span>{t('dfeat.inv.expires', { date: formatTs(inv.expires_at) })}</span>}
              </div>
              {/* Liste native repliable : clavier et lecteurs d'écran gérés par le navigateur. */}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-fc-accent select-none">{t('dfeat.inv.members', { n: inv.members.length })}</summary>
                {inv.members.length === 0
                  ? <p className="text-xs text-fc-muted mt-1">{t('dfeat.inv.noMembers')}</p>
                  : (
                    <ul className="mt-1.5 space-y-1 max-h-60 overflow-y-auto overscroll-contain">
                      {inv.members.map(m => (
                        <li key={m.user.id} className="flex items-center gap-2 text-sm text-fc-text">
                          <Avatar user={m.user} />
                          <span className="truncate">{m.user.username}</span>
                          <span className="text-xs text-fc-muted ml-auto flex-shrink-0">{t('dfeat.inv.joined', { date: formatDate(m.joined_at) })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
