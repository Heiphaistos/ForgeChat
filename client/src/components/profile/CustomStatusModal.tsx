import { useState, useRef, useEffect } from 'react'
import { X, Smile, Trash2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import toast from 'react-hot-toast'

interface CustomStatus {
  emoji: string
  text: string
  expires_at: string | null
}

interface Props {
  onClose: () => void
}

const EXPIRATION_OPTIONS = [
  { value: '', label: 'Ne pas effacer' },
  { value: '30m', label: 'Dans 30 minutes' },
  { value: '1h', label: 'Dans 1 heure' },
  { value: '4h', label: 'Dans 4 heures' },
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: 'Cette semaine' },
]

function computeExpiresAt(value: string): string | null {
  if (!value) return null
  const now = new Date()
  switch (value) {
    case '30m':
      now.setMinutes(now.getMinutes() + 30)
      return now.toISOString()
    case '1h':
      now.setHours(now.getHours() + 1)
      return now.toISOString()
    case '4h':
      now.setHours(now.getHours() + 4)
      return now.toISOString()
    case 'today': {
      now.setHours(23, 59, 59, 999)
      return now.toISOString()
    }
    case 'week': {
      const day = now.getDay()
      const daysUntilSunday = day === 0 ? 0 : 7 - day
      now.setDate(now.getDate() + daysUntilSunday)
      now.setHours(23, 59, 59, 999)
      return now.toISOString()
    }
    default:
      return null
  }
}

const QUICK_EMOJIS = ['😀', '👋', '🎯', '🔥', '💡', '🎮', '🎵', '📚', '☕', '🏖️', '😴', '🤔']

const STATUS_PRESETS = [
  { emoji: '🔴', label: 'Ne pas déranger', text: 'Ne pas déranger' },
  { emoji: '📅', label: 'En réunion', text: 'En réunion' },
  { emoji: '⏰', label: 'À plus tard', text: 'À plus tard' },
  { emoji: '🎮', label: 'En train de jouer', text: 'En train de jouer' },
  { emoji: '🎵', label: 'Écoute de la musique', text: 'Écoute de la musique' },
]

export default function CustomStatusModal({ onClose }: Props) {
  const { user, updateMe } = useAuth()
  const ref = useRef<HTMLDivElement>(null)

  const [emoji, setEmoji] = useState<string>(() => {
    if (!user?.custom_status) return ''
    const match = user.custom_status.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)/u)
    return match ? match[0] : ''
  })
  const [text, setText] = useState<string>(() => {
    if (!user?.custom_status) return ''
    const match = user.custom_status.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)\s*/u)
    return match ? user.custom_status.slice(match[0].length) : user.custom_status
  })
  const [expiration, setExpiration] = useState('')
  const [showEmojiGrid, setShowEmojiGrid] = useState(false)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const save = useMutation({
    mutationFn: (payload: { custom_status: CustomStatus | null }) =>
      api.patch('/user/settings', payload),
    onSuccess: (_res, variables) => {
      if (variables.custom_status) {
        const { emoji: e, text: t } = variables.custom_status
        const combined = [e, t].filter(Boolean).join(' ')
        updateMe({ custom_status: combined || null })
      } else {
        updateMe({ custom_status: null })
      }
      toast.success('Statut mis à jour')
      onClose()
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  })

  const handleSave = () => {
    const trimmedText = text.trim()
    const trimmedEmoji = emoji.trim()
    if (!trimmedEmoji && !trimmedText) {
      handleClear()
      return
    }
    const expires_at = computeExpiresAt(expiration)
    save.mutate({
      custom_status: {
        emoji: trimmedEmoji,
        text: trimmedText,
        expires_at,
      },
    })
  }

  const handleClear = () => {
    save.mutate({ custom_status: null })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0">
      <div
        ref={ref}
        className="bg-fc-channel border border-white/10 rounded-xl shadow-2xl w-full max-w-[400px] max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Smile size={18} className="text-fc-accent" />
            <span className="font-semibold text-white">Statut personnalisé</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Prévisualisation */}
          {(emoji || text) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-fc-bg/60 rounded-lg border border-white/5">
              {emoji && <span className="text-lg leading-none">{emoji}</span>}
              <span className="text-sm text-fc-text truncate">{text || 'Votre statut...'}</span>
            </div>
          )}

          {/* Presets rapides */}
          <div>
            <div className="text-xs text-fc-muted mb-2 font-semibold uppercase tracking-wide">Presets rapides</div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setEmoji(preset.emoji)
                    setText(preset.text)
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-fc-channel hover:bg-fc-hover rounded-lg text-xs text-white transition border border-fc-hover hover:border-fc-accent"
                >
                  <span>{preset.emoji}</span>
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Saisie */}
          <div className="flex gap-2">
            {/* Bouton emoji */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowEmojiGrid(v => !v)}
                className="w-10 h-10 flex items-center justify-center bg-fc-input rounded-lg border border-white/10 hover:border-fc-accent/60 transition text-lg"
                title="Choisir un emoji"
              >
                {emoji || <Smile size={18} className="text-fc-muted" />}
              </button>

              {showEmojiGrid && (
                <div className="absolute top-full left-0 mt-1 bg-fc-channel border border-white/10 rounded-lg p-2 shadow-2xl z-10 w-48">
                  <div className="grid grid-cols-6 gap-1">
                    {QUICK_EMOJIS.map(e => (
                      <button
                        key={e}
                        onClick={() => { setEmoji(e); setShowEmojiGrid(false) }}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-fc-hover text-base transition"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <input
                      type="text"
                      placeholder="Emoji personnalisé..."
                      maxLength={2}
                      value={emoji}
                      onChange={e => setEmoji(e.target.value)}
                      className="w-full px-2 py-1 bg-fc-input text-sm text-white rounded border border-white/10 outline-none focus:border-fc-accent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Texte */}
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Quel est votre statut ?"
              maxLength={128}
              className="flex-1 px-3 py-2 bg-fc-input rounded-lg border border-white/10 text-sm text-white placeholder-fc-muted outline-none focus:border-fc-accent transition"
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              autoFocus
            />
          </div>

          {/* Compteur caractères */}
          <div className="flex justify-end">
            <span className={`text-xs ${text.length > 100 ? 'text-fc-yellow' : 'text-fc-muted'}`}>
              {text.length}/128
            </span>
          </div>

          {/* Expiration */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide">
              Effacer après
            </label>
            <select
              value={expiration}
              onChange={e => setExpiration(e.target.value)}
              className="w-full px-3 py-2 bg-fc-input rounded-lg border border-white/10 text-sm text-white outline-none focus:border-fc-accent transition appearance-none cursor-pointer"
            >
              {EXPIRATION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={save.isPending}
              className="flex-1 py-2 bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
            >
              {save.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            {user?.custom_status && (
              <button
                onClick={handleClear}
                disabled={save.isPending}
                className="px-3 py-2 rounded-lg bg-fc-hover hover:bg-fc-red/20 text-fc-muted hover:text-fc-red transition flex items-center gap-1.5 text-sm disabled:opacity-50"
                title="Effacer le statut"
              >
                <Trash2 size={14} />
                Effacer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
