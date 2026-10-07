import { Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'

interface Follow { id: string; server_name: string; channel_name: string }

/** Réglages du salon : abonnés (salon d'annonces) et annonces suivies (salon texte). */
export default function ChannelFollowsSection({ channelId, isAnnouncement }: { channelId: string; isAnnouncement: boolean }) {
  const t = useT()
  const qc = useQueryClient()
  const { data } = useQuery<{ followers: Follow[]; following: Follow[] }>({
    queryKey: ['channel-follows', channelId],
    queryFn: () => api.get(`/channels/${channelId}/follows`).then(r => r.data),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/channel-follows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channel-follows', channelId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('servers.delete.failed')),
  })

  const list = (title: string, items: Follow[], empty: string, action: string) => (
    <div>
      <h4 className="text-sm font-semibold text-white mb-2">{title}</h4>
      {items.length === 0 ? <p className="text-xs text-fc-muted">{empty}</p> : (
        <ul className="space-y-1">
          {items.map(f => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm bg-fc-bg rounded px-3 py-2">
              <span className="truncate text-fc-text">{f.server_name} <span className="text-fc-muted">#{f.channel_name}</span></span>
              <button onClick={() => remove.mutate(f.id)} disabled={remove.isPending} aria-label={`${action} ${f.server_name} #${f.channel_name}`} title={action}
                className="p-1.5 text-fc-muted hover:text-red-400 rounded hover:bg-fc-hover"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="p-4 bg-fc-bg/50 rounded-xl border border-fc-hover space-y-4">
      {isAnnouncement && list(t('follows.followers'), data?.followers ?? [], t('follows.followersEmpty'), t('follows.removeFollower'))}
      {list(t('follows.following'), data?.following ?? [], t('follows.followingEmpty'), t('follows.unfollow'))}
    </div>
  )
}
