import { useState } from 'react'
import { X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'

const REASONS = [
  { value: 'spam', label: '🚫 Spam' },
  { value: 'harassment', label: '😡 Harcèlement' },
  { value: 'nsfw', label: '🔞 Contenu NSFW' },
  { value: 'other', label: '⚠️ Autre' },
]

interface Props {
  messageId: string
  onClose: () => void
}

export default function ReportModal({ messageId, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  useEscapeKey(onClose)

  const submit = async () => {
    if (!reason) { toast.error('Choisissez une raison'); return }
    setLoading(true)
    try {
      await api.post(`/messages/${messageId}/report`, {
        reason,
        comment: comment.trim() || undefined,
      })
      toast.success('Signalement envoyé aux modérateurs')
      onClose()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Erreur lors du signalement'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-96 max-w-[95vw] p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-lg">Signaler le message</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-fc-muted mb-4">
          Sélectionne la raison du signalement. L'équipe de modération sera notifiée.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {REASONS.map(r => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={`px-3 py-2.5 rounded-lg text-sm text-left transition border ${
                reason === r.value
                  ? 'border-fc-accent bg-fc-accent/10 text-white'
                  : 'border-fc-hover bg-fc-bg hover:border-fc-accent/50 text-fc-muted hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Commentaire optionnel..."
          maxLength={500}
          rows={3}
          className="w-full fc-input text-sm resize-none mb-4"
        />

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!reason || loading}
            className="flex-1 btn-primary text-sm disabled:opacity-40"
          >
            {loading ? 'Envoi...' : 'Signaler'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-fc-hover text-fc-muted hover:text-white text-sm transition"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}
