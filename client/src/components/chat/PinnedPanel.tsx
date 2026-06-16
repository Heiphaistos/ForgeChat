import { X, Pin, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  channelId: string
  channelName: string
  onClose: () => void
}

export default function PinnedPanel({ serverId, channelId, channelName, onClose }: Props) {
  const qc = useQueryClient()

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
    <div className="w-64 bg-fc-channel border-l border-fc-bg flex flex-col flex-shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-fc-bg">
        <div className="flex items-center gap-2">
          <Pin size={16} className="text-fc-accent" />
          <span className="font-semibold text-white text-sm">Messages épinglés</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading && (
          <div className="text-center text-fc-muted text-sm py-6">Chargement...</div>
        )}

        {!isLoading && pinned.length === 0 && (
          <div className="text-center py-8">
            <Pin size={32} className="mx-auto mb-2 text-fc-muted opacity-40" />
            <p className="text-sm text-fc-muted">Aucun message épinglé</p>
            <p className="text-xs text-fc-muted mt-1 opacity-70">
              Survole un message → bouton pin
            </p>
          </div>
        )}

        {pinned.map((msg: any) => (
          <div
            key={msg.id}
            className="bg-fc-bg rounded-lg p-3 border border-fc-hover group relative"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-5 h-5 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {msg.author_username?.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-semibold text-white">{msg.author_username}</span>
              <span className="text-xs text-fc-muted ml-auto">
                {format(new Date(msg.created_at), 'dd/MM HH:mm', { locale: fr })}
              </span>
            </div>
            <p className="text-xs text-fc-text leading-relaxed line-clamp-4">{msg.content}</p>

            <button
              onClick={() => unpin.mutate(msg.id)}
              className="absolute top-2 right-2 p-1 text-fc-muted hover:text-fc-red rounded opacity-0 group-hover:opacity-100 transition hover:bg-fc-hover"
              title="Désépingler"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-fc-bg text-xs text-fc-muted">
        #{channelName} · {pinned.length} épinglé(s)
      </div>
    </div>
  )
}
