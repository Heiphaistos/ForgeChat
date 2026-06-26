import { useState, useEffect, useRef } from 'react'
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

  return (
    <div
      ref={modalRef}
      className="absolute top-10 right-0 z-50 bg-fc-bg border border-fc-hover rounded-lg shadow-xl w-72 p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-white text-sm font-semibold truncate">#{channelName}</span>
        <button onClick={onClose} className="text-fc-muted hover:text-white transition">
          <X size={14} />
        </button>
      </div>

      <p className="text-[11px] text-fc-muted uppercase font-semibold tracking-wide mb-2">Notifications</p>

      <div className="space-y-1 mb-3">
        {LEVELS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setLevel(opt.value)}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded text-left transition ${
              level === opt.value ? 'bg-fc-accent/20 text-white' : 'hover:bg-fc-hover text-fc-muted hover:text-white'
            }`}
          >
            <span className="mt-0.5 flex-shrink-0">{opt.icon}</span>
            <div>
              <div className="text-sm font-medium leading-tight">{opt.label}</div>
              <div className="text-[11px] text-fc-muted leading-tight">{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2.5 px-2.5 py-2 rounded hover:bg-fc-hover transition cursor-pointer mb-3">
        <input
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
}
