import { Mic, MicOff, Headphones, VolumeX, Settings, X, Activity, BellOff, LayoutDashboard } from 'lucide-react'
import NotificationBell from '../notifications/NotificationBell'
import { useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../store/auth'
import { useVoice } from '../../store/voice'
import api from '../../api/client'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

const STATUS_LABELS: Record<string, string> = {
  online: 'En ligne',
  idle: 'Absent',
  dnd: 'Ne pas déranger',
  invisible: 'Invisible',
}

const STATUS_ORDER = ['online', 'idle', 'dnd', 'invisible'] as const

function QuickStatusPopup({ onClose }: { onClose: () => void }) {
  const { user, updateMe } = useAuth()
  const nav = useNavigate()
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const [customEmoji, setCustomEmoji] = useState(user?.custom_status_emoji ?? '')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fermer au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const setStatus = async (status: string) => {
    try {
      await api.patch('/users/me', { status })
      updateMe({ status })
    } catch {
      toast.error('Impossible de changer le statut')
    }
  }

  const saveCustomStatus = async () => {
    setSaving(true)
    try {
      await api.patch('/user/status', {
        custom_status: customStatus.trim() || null,
        custom_status_emoji: customEmoji.trim() || null,
      })
      updateMe({
        custom_status: customStatus.trim() || null,
        custom_status_emoji: customEmoji.trim() || null,
      })
      toast.success('Statut mis à jour')
      onClose()
    } catch {
      toast.error('Erreur lors de la mise à jour')
    } finally {
      setSaving(false)
    }
  }

  const copyId = () => {
    navigator.clipboard.writeText(user?.id ?? '').then(() => toast.success('ID copié !'))
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-72 bg-fc-sidebar border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      {/* Bannière + Avatar */}
      <div className="relative">
        <div className="h-16 bg-gradient-to-br from-fc-accent/60 to-indigo-800/60 overflow-hidden">
          {user?.banner && (
            <img src={user.banner} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          )}
        </div>
        <div className="absolute left-3 -bottom-5 flex items-end gap-2">
          <div className="w-12 h-12 rounded-full border-4 border-fc-sidebar bg-fc-accent flex items-center justify-center font-bold text-white text-base overflow-hidden flex-shrink-0">
            {user?.avatar
              ? <img src={user.avatar} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              : user?.username.charAt(0).toUpperCase()}
          </div>
          <div className={`w-3.5 h-3.5 rounded-full border-2 border-fc-sidebar mb-0.5 ${STATUS_COLORS[user?.status ?? 'offline']}`} />
        </div>
        <button onClick={onClose} className="absolute top-2 right-2 p-0.5 rounded hover:bg-black/40 text-white/70 hover:text-white transition">
          <X size={14} />
        </button>
      </div>

      {/* Infos profil */}
      <div className="pt-7 px-3 pb-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{user?.username}</p>
            <p className="text-xs text-fc-muted truncate">#{user?.discriminator}</p>
          </div>
          <button
            onClick={copyId}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-fc-muted hover:text-white bg-fc-channel hover:bg-fc-hover rounded transition flex-shrink-0"
            title="Copier l'ID"
          >
            ID
          </button>
        </div>
        {(user?.custom_status || user?.bio) && (
          <p className="text-xs text-fc-muted mt-1 truncate">
            {user.custom_status_emoji && <span className="mr-1">{user.custom_status_emoji}</span>}
            {user.custom_status || user.bio}
          </p>
        )}
      </div>

      <div className="border-t border-white/10 mx-3" />

      {/* Statut */}
      <div className="p-2 grid grid-cols-2 gap-1">
        {STATUS_ORDER.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition hover:bg-fc-hover
              ${user?.status === s ? 'bg-fc-hover ring-1 ring-fc-accent/40' : ''}`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[s]}`} />
            <span className="text-xs text-fc-text truncate">{STATUS_LABELS[s]}</span>
          </button>
        ))}
      </div>

      {/* Statut personnalisé */}
      <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
        <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide">Statut personnalisé</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customEmoji}
            onChange={e => setCustomEmoji(e.target.value)}
            placeholder="😊"
            maxLength={2}
            className="w-10 fc-input text-center text-base py-1 flex-shrink-0"
          />
          <input
            type="text"
            value={customStatus}
            onChange={e => setCustomStatus(e.target.value)}
            placeholder="Ex : En réunion"
            maxLength={128}
            className="flex-1 fc-input text-xs py-1"
            onKeyDown={e => { if (e.key === 'Enter') saveCustomStatus() }}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={saveCustomStatus}
            disabled={saving}
            className="flex-1 btn-primary text-xs py-1.5 disabled:opacity-50"
          >
            {saving ? '...' : 'Sauvegarder'}
          </button>
          <button
            onClick={() => { nav('/settings'); onClose() }}
            className="px-3 py-1.5 text-xs rounded bg-fc-hover hover:bg-fc-hover/70 text-fc-muted hover:text-white transition"
          >
            Profil
          </button>
        </div>
      </div>
    </div>
  )
}

interface UserPanelProps {
  onToggleActivity?: () => void
  activityOpen?: boolean
}

export default function UserPanel({ onToggleActivity, activityOpen }: UserPanelProps) {
  const { user, updateMe } = useAuth()
  const nav = useNavigate()
  const { joined, muted, deafened, toggleMute, toggleDeafen } = useVoice()
  const [showStatusPopup, setShowStatusPopup] = useState(false)

  const toggleFocus = async () => {
    if (!user) return
    const newVal = !user.focus_mode
    try {
      await api.patch('/user/focus-mode', { enabled: newVal })
      updateMe({ focus_mode: newVal })
      toast.success(newVal ? 'Mode focus activé 🔕' : 'Mode focus désactivé 🔔')
    } catch {
      toast.error('Erreur')
    }
  }

  if (!user) return null

  return (
    <div className="flex items-center gap-2 px-2 py-2 bg-fc-bg/50 border-t border-fc-bg flex-shrink-0 relative">
      {/* Popup statut rapide */}
      {showStatusPopup && (
        <QuickStatusPopup onClose={() => setShowStatusPopup(false)} />
      )}

      <button
        onClick={() => setShowStatusPopup(v => !v)}
        className="flex items-center gap-2 flex-1 min-w-0 rounded px-1 py-0.5 hover:bg-fc-hover transition text-left"
        title="Changer le statut"
      >
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden">
            {user.avatar
              ? <img src={user.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full rounded-full object-cover" />
              : user.username.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLORS[user.status] ?? 'bg-fc-muted'}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{user.username}</div>
          <div className="text-xs text-fc-muted truncate">
            {user.custom_status_emoji && <span className="mr-0.5">{user.custom_status_emoji}</span>}
            {user.custom_status || STATUS_LABELS[user.status] || `#${user.discriminator}`}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={toggleFocus}
          className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 rounded hover:bg-fc-hover transition flex items-center justify-center ${
            user.focus_mode ? 'text-fc-accent' : 'text-fc-muted hover:text-white'
          }`}
          title={user.focus_mode ? 'Mode focus actif — cliquer pour désactiver' : 'Activer mode focus (muet notifications)'}
        >
          <BellOff size={16} />
        </button>
        <NotificationBell />
        <button
          onClick={joined ? toggleMute : undefined}
          className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 rounded hover:bg-fc-hover transition flex items-center justify-center ${
            joined && muted ? 'text-red-400' : joined ? 'text-fc-muted hover:text-white' : 'text-fc-muted/30 cursor-default'
          }`}
          title={joined ? (muted ? 'Réactiver le micro (Ctrl+Shift+M)' : 'Couper le micro (Ctrl+Shift+M)') : 'Pas dans un canal vocal'}
        >
          {joined && muted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          onClick={joined ? toggleDeafen : undefined}
          className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 rounded hover:bg-fc-hover transition flex items-center justify-center ${
            joined && deafened ? 'text-red-400' : joined ? 'text-fc-muted hover:text-white' : 'text-fc-muted/30 cursor-default'
          }`}
          title={joined ? (deafened ? 'Réactiver le son (Ctrl+Shift+D)' : 'Couper le son (Ctrl+Shift+D)') : 'Pas dans un canal vocal'}
        >
          {joined && deafened ? <VolumeX size={16} /> : <Headphones size={16} />}
        </button>
        {onToggleActivity && (
          <button
            onClick={onToggleActivity}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 rounded hover:bg-fc-hover transition flex items-center justify-center ${activityOpen ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
            title="Activité récente (Ctrl+Shift+A)"
          >
            <Activity size={16} />
          </button>
        )}
        <button
          onClick={() => nav('/admin')}
          className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex items-center justify-center"
          title="Dashboard Admin"
        >
          <LayoutDashboard size={16} />
        </button>
        <button
          onClick={() => nav('/settings')}
          className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex items-center justify-center"
          title="Paramètres (Ctrl+,)"
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  )
}
