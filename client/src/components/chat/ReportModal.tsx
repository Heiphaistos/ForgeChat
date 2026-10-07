import { useState } from 'react'
import { X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT, type Key } from '../../i18n'

const REASONS: { value: string; label: Key }[] = [
  { value: 'spam', label: 'report.spam' },
  { value: 'harassment', label: 'report.harassment' },
  { value: 'nsfw', label: 'report.nsfw' },
  { value: 'other', label: 'report.other' },
]

interface Props {
  messageId: string
  onClose: () => void
}

export default function ReportModal({ messageId, onClose }: Props) {
  const t = useT()
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  useEscapeKey(onClose)

  const submit = async () => {
    if (!reason) { toast.error(t('report.chooseReason')); return }
    setLoading(true)
    try {
      await api.post(`/messages/${messageId}/report`, {
        reason,
        comment: comment.trim() || undefined,
      })
      toast.success(t('report.sent'))
      onClose()
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? t('report.error')
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
        className="bg-fc-channel border border-fc-hover rounded-xl shadow-2xl w-96 max-w-[95vw] max-h-[90dvh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="report-modal-title" className="text-white font-semibold text-lg">{t('report.title')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover text-fc-muted hover:text-white transition">
            <X size={16} aria-hidden />
          </button>
        </div>

        <p className="text-xs text-fc-muted mb-4">
          {t('report.intro')}
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
              {t(r.label)}
            </button>
          ))}
        </div>

        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder={t('report.comment')}
          maxLength={500}
          rows={3}
          enterKeyHint="done"
          autoCapitalize="sentences"
          className="w-full fc-input text-sm resize-none mb-4"
        />

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!reason || loading}
            className="flex-1 btn-primary text-sm disabled:opacity-40"
          >
            {loading ? t('common.sending') : t('report.submit')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-fc-hover text-fc-muted hover:text-white text-sm transition"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
