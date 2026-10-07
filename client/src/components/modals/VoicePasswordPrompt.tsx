import { useState } from 'react'
import { X, Lock } from 'lucide-react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT } from '../../i18n'

interface Props {
  channelName: string
  onConfirm: (password: string) => void
  onClose: () => void
}

export default function VoicePasswordPrompt({ channelName, onConfirm, onClose }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const [password, setPassword] = useState('')

  const submit = () => {
    if (!password.trim()) return
    onConfirm(password.trim())
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0" onClick={onClose}>
      <div
        className="bg-fc-channel rounded-lg w-full max-w-[360px] max-h-[90dvh] overflow-y-auto shadow-2xl p-6"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-password-modal-title"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-yellow-400" />
            <h2 id="voice-password-modal-title" className="text-lg font-bold text-white">{t('vpw.title')}</h2>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="text-fc-muted hover:text-white transition p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover">
            <X size={18} aria-hidden />
          </button>
        </div>

        <p className="text-sm text-fc-muted mb-4">
          {t('vpw.before')}<span className="text-white font-semibold">#{channelName}</span>{t('vpw.after')}
        </p>

        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={t('vpw.placeholder')}
          aria-label={t('auth.password')}
          enterKeyHint="go"
          autoFocus
          autoComplete="current-password"
          className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm mb-4"
        />

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!password.trim()}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            {t('explore.join')}
          </button>
        </div>
      </div>
    </div>
  )
}
