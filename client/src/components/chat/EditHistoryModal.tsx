import { useQuery } from '@tanstack/react-query'
import { X, History } from 'lucide-react'
import api from '../../api/client'
import { useFormatDate } from '../../hooks/useFormatDate'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface Props {
  messageId: string
  serverId: string
  channelId: string
  onClose: () => void
}

export default function EditHistoryModal({ messageId, serverId, channelId, onClose }: Props) {
  useEscapeKey(onClose)
  const { formatTs } = useFormatDate()
  const { data: edits = [], isLoading } = useQuery<{ content: string; edited_at: string }[]>({
    queryKey: ['message_edits', messageId],
    queryFn: () =>
      api.get(`/servers/${serverId}/channels/${channelId}/messages/${messageId}/edits`)
        .then(r => r.data),
    staleTime: 30_000,
  })

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90dvh] bg-fc-bg border border-fc-hover rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-fc-hover">
          <div className="flex items-center gap-2 font-semibold text-white">
            <History size={16} className="text-fc-accent" />
            Historique des modifications
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Corps */}
        <div className="overflow-y-auto max-h-[60vh] p-4 space-y-2">
          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && edits.length === 0 && (
            <p className="text-sm text-fc-muted text-center py-8">
              Aucun historique disponible.
            </p>
          )}

          {edits.map((edit, i) => (
            <div key={i} className="rounded-lg bg-fc-input p-3">
              <div className="text-xs text-fc-muted mb-1.5">
                {formatTs(edit.edited_at)}
              </div>
              <div className="text-sm text-fc-muted whitespace-pre-wrap break-words leading-relaxed">
                {edit.content}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-fc-hover flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-fc-hover hover:bg-fc-hover/80 text-fc-text rounded-lg text-sm transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
