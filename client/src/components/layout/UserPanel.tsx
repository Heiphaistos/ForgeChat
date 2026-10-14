import { Mic, MicOff, Headphones, VolumeX, Settings, X, Activity, BellOff, LayoutDashboard, ShieldCheck, ChevronDown } from 'lucide-react'
import { useSiteAdmin } from '../../hooks/useSiteAdmin'
import NotificationBell from '../notifications/NotificationBell'
import { useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../store/auth'
import { useVoice } from '../../store/voice'
import { usePresence } from '../../store/presence'
import api, { mediaUrl } from '../../api/client'
import ProfileBanner from '../ui/ProfileBanner'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import MusicStatus from './MusicStatus'
import AccountSwitcher from '../AccountSwitcher'
import { useCallStore } from '../../store/call'
import { useGroupCall } from '../../store/groupCall'
import { useDeviceMenu } from '../voice/useDeviceMenu'

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-fc-green',
  idle: 'bg-fc-yellow',
  dnd: 'bg-fc-red',
  invisible: 'bg-fc-muted',
  offline: 'bg-fc-muted',
}

const STATUS_KEYS = {
  online: 'presence.online',
  idle: 'presence.idle',
  dnd: 'presence.dnd',
  invisible: 'presence.invisible',
} as const
const statusKey = (s: string) => STATUS_KEYS[s as keyof typeof STATUS_KEYS]

const STATUS_ORDER = ['online', 'idle', 'dnd', 'invisible'] as const
/** Effacer le statut personnalisé après N minutes (même liste que le serveur ; 0 = jamais). */
const STATUS_CLEAR_AFTER = [0, 30, 60, 240, 1440, 4320, 10080] as const

function QuickStatusPopup({ onClose }: { onClose: () => void }) {
  const tr = useT()
  const { user, updateMe } = useAuth()
  const nav = useNavigate()
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const [customEmoji, setCustomEmoji] = useState(user?.custom_status_emoji ?? '')
  const [clearAfter, setClearAfter] = useState(0)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fermer au clic extérieur ou Escape
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onMouse); document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const setStatus = async (status: string) => {
    try {
      await api.patch('/users/me', { status })
      updateMe({ status })
    } catch {
      toast.error(tr('up.statusError'))
    }
  }

  // Chaîne vide = effacer (le serveur la stocke en NULL). Avant, `null` était
  // ignoré par le serveur : un statut personnalisé ne s'effaçait jamais.
  const saveCustomStatus = async (text = customStatus, emoji = customEmoji) => {
    setSaving(true)
    try {
      await api.patch('/user/status', {
        custom_status: text.trim(),
        custom_status_emoji: emoji.trim(),
        clear_after_minutes: clearAfter,
      })
      updateMe({
        custom_status: text.trim() || null,
        custom_status_emoji: emoji.trim() || null,
        custom_status_expires_at: clearAfter && (text.trim() || emoji.trim()) ? new Date(Date.now() + clearAfter * 60_000).toISOString() : null,
      })
      toast.success(tr(text.trim() || emoji.trim() ? 'up.statusSaved' : 'up.statusCleared'))
      onClose()
    } catch {
      toast.error(tr('up.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const copyId = () => {
    navigator.clipboard.writeText(user?.id ?? '').then(() => toast.success(tr('up.idCopied')))
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={tr('up.dialog')}
      aria-modal="true"
      className="absolute bottom-full left-0 mb-2 w-72 bg-fc-sidebar border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      {/* Bannière + Avatar */}
      <div className="relative">
        <ProfileBanner src={user?.banner} minHeight={56} maxHeight={150} emptyClassName="h-16 bg-gradient-to-br from-fc-accent/60 to-indigo-800/60" />
        <div className="absolute left-3 -bottom-5 flex items-end gap-2">
          <div className="w-12 h-12 rounded-full border-4 border-fc-sidebar bg-fc-accent flex items-center justify-center font-bold text-white text-base overflow-hidden flex-shrink-0">
            {user?.avatar
              ? <img src={mediaUrl(user.avatar)} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              : user?.username.charAt(0).toUpperCase()}
          </div>
          <div className={`w-3.5 h-3.5 rounded-full border-2 border-fc-sidebar mb-0.5 ${STATUS_COLORS[user?.status ?? 'offline']}`} />
        </div>
        <button onClick={onClose} aria-label={tr('common.close')} className="absolute top-2 right-2 p-0.5 rounded hover:bg-black/40 text-white/70 hover:text-white transition">
          <X size={14} />
        </button>
      </div>

      {/* Infos profil */}
      <div className="pt-7 px-3 pb-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{user?.username}</p>
            <p className="text-xs text-fc-muted truncate streamer-blur">#{user?.discriminator}</p>
          </div>
          <button
            onClick={copyId}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-fc-muted hover:text-white bg-fc-channel hover:bg-fc-hover rounded transition flex-shrink-0"
            title={tr('up.copyId')}
            aria-label={tr('up.copyIdAria')}
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
            <span className="text-xs text-fc-text truncate">{tr(statusKey(s))}</span>
          </button>
        ))}
      </div>

      {/* Statut personnalisé */}
      <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
        <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide">{tr('up.customStatus')}</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customEmoji}
            onChange={e => setCustomEmoji(e.target.value)}
            placeholder="😊"
            maxLength={8}
            enterKeyHint="next"
            aria-label={tr('up.emojiAria')}
            className="w-10 fc-input text-center text-base py-1 flex-shrink-0"
          />
          <input
            type="text"
            value={customStatus}
            onChange={e => setCustomStatus(e.target.value)}
            placeholder={tr('up.textPlaceholder')}
            maxLength={128}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoComplete="off"
            aria-label={tr('up.textAria')}
            className="flex-1 fc-input text-xs py-1"
            onKeyDown={e => { if (e.key === 'Enter') void saveCustomStatus() }}
          />
        </div>
        <label className="flex items-center gap-2 text-[11px] text-fc-muted">
          {tr('status.clearAfter')}
          <select value={clearAfter} onChange={e => setClearAfter(Number(e.target.value))} className="flex-1 fc-input text-xs py-1">
            {STATUS_CLEAR_AFTER.map(m => <option key={m} value={m}>{tr(`status.clear.${m}` as 'status.clear.0')}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => void saveCustomStatus()}
            disabled={saving}
            className="flex-1 btn-primary text-xs py-1.5 disabled:opacity-50"
          >
            {saving ? '...' : tr('common.save')}
          </button>
          {(user?.custom_status || user?.custom_status_emoji) && (
            <button
              onClick={() => { setCustomStatus(''); setCustomEmoji(''); void saveCustomStatus('', '') }}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-fc-hover hover:bg-red-500/20 text-fc-muted hover:text-red-300 transition disabled:opacity-50"
            >
              {tr('up.clear')}
            </button>
          )}
          <button
            onClick={() => { nav('/settings'); onClose() }}
            className="px-3 py-1.5 text-xs rounded bg-fc-hover hover:bg-fc-hover/70 text-fc-muted hover:text-white transition"
          >
            {tr('up.profile')}
          </button>
        </div>
      </div>
      <MusicStatus />
      <AccountSwitcher />
    </div>
  )
}

interface UserPanelProps {
  onToggleActivity?: () => void
  activityOpen?: boolean
  /** PC, page Actualités : seulement l'avatar et les paramètres, à la largeur du rail des serveurs. */
  compact?: boolean
}

export default function UserPanel({ onToggleActivity, activityOpen, compact = false }: UserPanelProps) {
  const hideOnPc = compact ? 'md:hidden' : ''
  const isSiteAdmin = useSiteAdmin()
  const tr = useT()
  const { user, updateMe } = useAuth()
  const nav = useNavigate()
  const { joined, muted, deafened, screenSharing, toggleMute, toggleDeafen } = useVoice()
  const inDmCall = useCallStore(s => s.callState === 'connected')
  const inGroupCall = useGroupCall(s => s.status === 'connected')
  const devices = useDeviceMenu()
  // « En partage d'écran » / « En vocal » remplacent le statut tant que ça dure (comme Discord).
  const callStatus = screenSharing ? tr('dock.status.sharing') : joined || inDmCall || inGroupCall ? tr('dock.status.inVoice') : null
  const [showStatusPopup, setShowStatusPopup] = useState(false)
  // Absence automatique (toutes les sessions inactives) : calculée par le
  // serveur, reçue comme n'importe quelle présence.
  const liveStatus = usePresence(s => (user ? s.statuses[user.id] : undefined))
  const shownStatus = user?.status === 'online' && liveStatus === 'idle' ? 'idle' : user?.status ?? 'offline'

  const toggleFocus = async () => {
    if (!user) return
    const newVal = !user.focus_mode
    try {
      await api.patch('/user/focus-mode', { enabled: newVal })
      updateMe({ focus_mode: newVal })
      toast.success(tr(newVal ? 'up.focusOn' : 'up.focusOff'))
    } catch {
      toast.error(tr('common.error'))
    }
  }

  if (!user) return null

  return (
    <div className={`fc-user-panel flex items-center gap-2 px-2 py-2 bg-fc-bg/50 border-t border-fc-bg flex-shrink-0 relative pb-safe ${compact ? 'md:w-[72px] md:flex-col md:px-0 md:gap-1' : ''}`}>
      {/* Popup statut rapide */}
      {showStatusPopup && (
        <QuickStatusPopup onClose={() => setShowStatusPopup(false)} />
      )}

      <button
        onClick={() => setShowStatusPopup(v => !v)}
        className={`flex items-center gap-2 flex-1 min-w-0 rounded px-1 py-0.5 hover:bg-fc-hover transition text-left ${compact ? 'md:flex-none' : ''}`}
        title={compact ? tr('up.changeStatusOf', { name: user.username }) : tr('up.changeStatus')}
      >
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center font-bold text-sm text-white overflow-hidden">
            {user.avatar
              ? <img src={mediaUrl(user.avatar)} alt="" loading="eager" decoding="async" className="w-full h-full rounded-full object-cover" />
              : user.username.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel ${STATUS_COLORS[shownStatus] ?? 'bg-fc-muted'}`} />
        </div>
        <div className={`min-w-0 ${hideOnPc}`}>
          <div className="text-sm font-semibold text-white truncate">{user.username}</div>
          <div className="text-xs text-fc-muted truncate">
            {callStatus ?? <>
              {user.custom_status_emoji && <span className="mr-0.5">{user.custom_status_emoji}</span>}
              {user.custom_status || (statusKey(shownStatus) ? tr(statusKey(shownStatus)) : '') || <span className="streamer-blur">#{user.discriminator}</span>}
            </>}
          </div>
        </div>
      </button>

      <div className="fc-user-panel-actions flex items-center gap-0.5 flex-shrink-0">
        <div className={`contents ${compact ? 'md:hidden' : ''}`}>
        <button
          onClick={toggleFocus}
          className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover transition flex items-center justify-center ${
            user.focus_mode ? 'text-fc-accent' : 'text-fc-muted hover:text-white'
          }`}
          title={tr(user.focus_mode ? 'up.focusActive' : 'up.focusEnable')}
          aria-label={tr(user.focus_mode ? 'up.focusActive' : 'up.focusEnable')}
          aria-pressed={user.focus_mode}
        >
          <BellOff size={16} />
        </button>
        <NotificationBell />
        <div className="flex items-center">
          <button
            onClick={joined ? toggleMute : undefined}
            aria-disabled={!joined}
            aria-label={joined ? tr(muted ? 'voice.micUnmute' : 'voice.micMute') : tr('up.notInVoice')}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover transition flex items-center justify-center ${
              joined && muted ? 'text-red-400' : joined ? 'text-fc-muted hover:text-white' : 'text-fc-muted/30 cursor-default'
            }`}
            title={joined ? tr(muted ? 'up.micUnmuteKey' : 'up.micMuteKey') : tr('up.notInVoice')}
          >
            {joined && muted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <DeviceChevron onClick={devices.openInput} label={tr('dock.dev.inputMenu')} />
        </div>
        <div className="flex items-center">
          <button
            onClick={joined ? toggleDeafen : undefined}
            aria-disabled={!joined}
            aria-label={joined ? tr(deafened ? 'voice.soundRestore' : 'voice.soundOff') : tr('up.notInVoice')}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover transition flex items-center justify-center ${
              joined && deafened ? 'text-red-400' : joined ? 'text-fc-muted hover:text-white' : 'text-fc-muted/30 cursor-default'
            }`}
            title={joined ? tr(deafened ? 'up.soundRestoreKey' : 'up.soundOffKey') : tr('up.notInVoice')}
          >
            {joined && deafened ? <VolumeX size={16} /> : <Headphones size={16} />}
          </button>
          <DeviceChevron onClick={devices.openOutput} label={tr('dock.dev.outputMenu')} />
        </div>
        {onToggleActivity && (
          <button
            onClick={onToggleActivity}
            className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover transition flex items-center justify-center ${activityOpen ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
            title={tr('up.activityKey')}
            aria-label={tr('up.activity')}
            aria-pressed={activityOpen}
          >
            <Activity size={16} />
          </button>
        )}
        {isSiteAdmin && (
          <button
            onClick={() => nav('/admin/site')}
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover text-fc-accent hover:text-white transition flex items-center justify-center"
            title={tr('up.siteAdmin')}
            aria-label={tr('up.siteAdminAria')}
          >
            <ShieldCheck size={16} />
          </button>
        )}
        <button
          onClick={() => nav('/admin')}
          className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex items-center justify-center"
          title={tr('up.dashboard')}
          aria-label={tr('up.dashboard')}
        >
          <LayoutDashboard size={16} />
        </button>
        </div>
        <button
          onClick={() => nav('/settings')}
          className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 p-1.5 md:p-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex items-center justify-center"
          title={tr('up.settingsKey')}
          aria-label={tr('up.settings')}
        >
          <Settings size={16} />
        </button>
      </div>
      {devices.node}
    </div>
  )
}

/** Petite flèche à côté du micro et du casque : menu de choix du périphérique. */
function DeviceChevron({ onClick, label }: { onClick: (e: React.MouseEvent) => void; label: string }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-haspopup="menu"
      className="min-h-[44px] md:min-h-0 px-0.5 py-1 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex items-center">
      <ChevronDown size={12} />
    </button>
  )
}
