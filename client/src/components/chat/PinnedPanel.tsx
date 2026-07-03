import { X, Pin, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { useFormatDate } from '../../hooks/useFormatDate'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  channelId: string
  channelName: string
  onClose: () => void
}

export default function PinnedPanel({ serverId, channelId, channelName, onClose }: Props) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const { formatShortDate } = useFormatDate()

  const jumpToMessage = (msgId: string) => {
    nav(`/servers/${serverId}/channels/${channelId}?highlight=${msgId}`)
    onClose()
  }

  const { data: pinned = [], isLoading } = useQuery({
    queryKey: ['pinned', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/pins`).then(r => r.data),
  })

  const unpin = useMutation({
    mutationFn: (msgId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/pin`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pinned', channelId] })
      toast.success('Message désépinglé')
    },
    onError: () => toast.error('Impossible de désépingler'),
  })

  return (
    <div
      role="complementary"
      aria-label={`Messages épinglés — #${channelName}`}
      className="absolute inset-0 z-10 md:relative md:inset-auto md:z-auto md:w-64 bg-fc-channel border-l border-fc-bg flex flex-col flex-shrink-0 panel-slide-right"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-fc-bg">
        <div className="flex items-center gap-2">
          <Pin size={16} className="text-fc-accent" aria-hidden />
          <span className="font-semibold text-white text-sm">Messages épinglés</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer les messages épinglés"
          className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading && (
          <div className="text-center text-fc-muted text-sm py-6">Chargement...</div>
        )}

        {!isLoading && pinned.length === 0 && (
          <div className="text-center py-8">
            <Pin size={32} className="mx-auto mb-2 text-fc-muted opacity-40" aria-hidden />
            <p className="text-sm text-fc-muted">Aucun message épinglé</p>
            <p className="text-xs text-fc-muted mt-1 opacity-70">
              Survole un message → bouton pin
            </p>
          </div>
        )}

        {pinned.map((msg: any) => (
          <div
            key={msg.id}
            role="article"
            aria-label={`Message de ${msg.author_username}`}
            onClick={() => jumpToMessage(msg.id)}
            className="bg-fc-bg rounded-lg p-3 border border-fc-hover group relative cursor-pointer hover:border-fc-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {msg.author_avatar
                ? <img src={msg.author_avatar} alt={msg.author_username} loading="lazy" decoding="async" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                : <div className="w-5 h-5 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0" aria-hidden>
                    {msg.author_username?.charAt(0).toUpperCase()}
                  </div>
              }
              <span className="text-xs font-semibold text-white">{msg.author_username}</span>
              <span className="text-xs text-fc-muted ml-auto">
                {formatShortDate(msg.created_at)}
              </span>
            </div>
            <p className="text-xs text-fc-text leading-relaxed line-clamp-4">{msg.content}</p>

            <button
              onClick={e => { e.stopPropagation(); unpin.mutate(msg.id) }}
              aria-label={`Désépingler le message de ${msg.author_username}`}
              className="absolute top-2 right-2 p-1 text-fc-muted hover:text-fc-red rounded opacity-0 group-hover:opacity-100 transition hover:bg-fc-hover"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-fc-bg text-xs text-fc-muted" aria-hidden>
        #{channelName} · {pinned.length} épinglé(s)
      </div>
    </div>
  )
}
