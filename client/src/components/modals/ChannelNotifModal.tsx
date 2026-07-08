import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Bell, BellOff, BellRing, X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  channelId: string
  channelName: string
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}

type Level = 'inherit' | 'all' | 'mentions' | 'nothing'

const LEVELS: { value: Level; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'inherit', label: 'Par défaut du serveur', desc: 'Suit les paramètres du serveur', icon: <Bell size={16} /> },
  { value: 'all', label: 'Tous les messages', desc: 'Notification pour chaque message', icon: <BellRing size={16} /> },
  { value: 'mentions', label: 'Mentions seulement', desc: 'Uniquement les @mentions et réponses', icon: <Bell size={16} /> },
  { value: 'nothing', label: 'Aucune notification', desc: 'Silencieux pour ce canal', icon: <BellOff size={16} /> },
]

export default function ChannelNotifModal({ channelId, channelName, onClose, anchorRef }: Props) {
  const [level, setLevel] = useState<Level>('inherit')
  const [muted, setMuted] = useState(false)
  const [saving, setSaving] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get(`/user/channel-notif/${channelId}`)
      .then(r => { setLevel(r.data.level ?? 'inherit'); setMuted(r.data.muted ?? false) })
      .catch(() => null)
  }, [channelId])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const save = async () => {
    setSaving(true)
    try {
      await api.post(`/user/channel-notif/${channelId}`, { level, muted })
      toast.success('Préférences sauvegardées')
      onClose()
    } catch {
      toast.error('Erreur de sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  // Bottom-sheet sur mobile (popover ancré au bouton inadapté au petit écran)
  const isSheet = window.innerWidth < 768

  const body = (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="cn-title"
      className={isSheet
        ? 'fixed bottom-0 inset-x-0 z-[9999] bg-fc-bg border-t border-fc-hover rounded-t-2xl shadow-2xl p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] overflow-y-auto overscroll-contain sheet-slide-up'
        : 'absolute top-10 right-0 z-50 bg-fc-bg border border-fc-hover rounded-lg shadow-xl w-72 p-3'}
      style={isSheet ? { maxHeight: '70dvh' } : undefined}
    >
      {isSheet && <div className="mx-auto mb-2 w-10 h-1 rounded-full bg-fc-hover" aria-hidden />}
      <div className="flex items-center justify-between mb-3">
        <span id="cn-title" className="text-white text-sm font-semibold truncate">#{channelName}</span>
        <button onClick={onClose} aria-label="Fermer les notifications" className="text-fc-muted hover:text-white transition">
          <X size={14} aria-hidden />
        </button>
      </div>

      <p id="cn-notif-label" className="text-[11px] text-fc-muted uppercase font-semibold tracking-wide mb-2">Notifications</p>

      <div role="radiogroup" aria-labelledby="cn-notif-label" className="space-y-1 mb-3">
        {LEVELS.map(opt => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={level === opt.value}
            onClick={() => setLevel(opt.value)}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded text-left transition ${
              level === opt.value ? 'bg-fc-accent/20 text-white' : 'hover:bg-fc-hover text-fc-muted hover:text-white'
            }`}
          >
            <span className="mt-0.5 flex-shrink-0" aria-hidden>{opt.icon}</span>
            <div>
              <div className="text-sm font-medium leading-tight">{opt.label}</div>
              <div className="text-[11px] text-fc-muted leading-tight">{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <label htmlFor="cn-mute" className="flex items-center gap-2.5 px-2.5 py-2 rounded hover:bg-fc-hover transition cursor-pointer mb-3">
        <input
          id="cn-mute"
          type="checkbox"
          checked={muted}
          onChange={e => setMuted(e.target.checked)}
          className="rounded accent-fc-accent"
        />
        <div>
          <div className="text-sm text-white">Mettre en sourdine</div>
          <div className="text-[11px] text-fc-muted">Aucun son ni badge</div>
        </div>
      </label>

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-1.5 bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium rounded transition disabled:opacity-50"
      >
        {saving ? 'Enregistrement…' : 'Appliquer'}
      </button>
    </div>
  )

  if (isSheet) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998] bg-black/50" aria-hidden onClick={onClose} />
        {body}
      </>,
      document.body
    )
  }
  return body
}
