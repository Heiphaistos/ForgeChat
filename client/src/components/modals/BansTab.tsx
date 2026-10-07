import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import api, { mediaUrl } from '../../api/client'
import toast from 'react-hot-toast'
import { useServerPerms, PERM } from '../../hooks/useServerPerms'
import { useT, intlLocale } from '../../i18n'

interface Ban {
  user_id: string
  username: string
  discriminator: string
  avatar: string | null
  reason: string | null
  banned_at: string
  /** null = bannissement définitif */
  expires_at?: string | null
}

export default function BansTab({ serverId }: { serverId: string }) {
  const t = useT()
  const qc = useQueryClient()
  // Lever un ban définitif exige « Bannir définitivement » (BAN_MEMBERS).
  const canBanForever = useServerPerms(serverId).has(PERM.BAN_MEMBERS)

  const { data: bans = [], isLoading } = useQuery<Ban[]>({
    queryKey: ['bans', serverId],
    queryFn: () => api.get(`/servers/${serverId}/bans`).then(r => r.data),
    staleTime: 30_000,
    retry: false,
  })

  const unban = useMutation({
    mutationFn: (userId: string) => api.delete(`/servers/${serverId}/bans/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bans', serverId] })
      toast.success(t('bans.unbanned'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  if (isLoading) return <div role="status" aria-label={t('bans.loading')} className="text-fc-muted text-sm">{t('common.loading')}</div>

  if (bans.length === 0) {
    return (
      <div role="status" className="text-center text-fc-muted py-12 text-sm">
        <div className="text-3xl mb-3" aria-hidden>🔓</div>
        {t('bans.none')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p aria-live="polite" aria-atomic="true" className="text-fc-muted text-sm mb-4">{t('bans.count', { n: bans.length })}</p>
      {bans.map(b => (
        <div key={b.user_id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
          <div className="w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center font-bold text-red-400 overflow-hidden flex-shrink-0" aria-hidden>
            {b.avatar
              ? <img src={mediaUrl(b.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : <span aria-hidden>{b.username.charAt(0).toUpperCase()}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-medium">{b.username}#{b.discriminator}</div>
            {b.reason && (
              <div className="text-xs text-fc-muted truncate">{t('bans.reason', { reason: b.reason })}</div>
            )}
            <div className="text-xs text-fc-muted">
              {t('bans.on', { date: new Date(b.banned_at).toLocaleDateString(intlLocale()) })}
              {b.expires_at ? t('bans.until', { date: new Date(b.expires_at).toLocaleString(intlLocale()) }) : t('bans.permanent')}
            </div>
          </div>
          {(b.expires_at || canBanForever) && <button
            onClick={() => unban.mutate(b.user_id)}
            disabled={unban.isPending}
            aria-label={t('bans.unbanName', { name: b.username })}
            aria-busy={unban.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-hover hover:bg-green-600/20 hover:text-green-400
                       text-fc-muted rounded text-xs transition disabled:opacity-50"
          >
            <UserCheck size={13} aria-hidden />
            <span aria-hidden>{t('bans.unban')}</span>
          </button>}
        </div>
      ))}
    </div>
  )
}
