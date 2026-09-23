import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useChannelNotif, type NotifLevel } from '../../store/channelNotif'
import { MuteSelect, muteRequest, type MuteChoice } from './muteOptions'
import { useEscapeKey } from '../../hooks/useEscapeKey'

// Réglages de notification d'un serveur (comme Discord) : niveau, sourdine
// temporaire, « ignorer @everyone et @here ». Appliqués par le serveur aux
// mentions et au Web Push (server/src/notify.rs), et par App.tsx en direct.
const LEVELS: { value: NotifLevel; label: string }[] = [
  { value: 'inherit', label: 'Par défaut du serveur' },
  { value: 'all', label: 'Tous les messages' },
  { value: 'mentions', label: 'Mentions seulement' },
  { value: 'nothing', label: 'Rien' },
]

export default function ServerNotifModal({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose: () => void }) {
  const store = useChannelNotif()
  const wasMuted = store.isServerMuted(serverId)
  const currentUntil = store.mutedServers.get(serverId) ?? null
  const [level, setLevel] = useState<NotifLevel>(store.serverLevels.get(serverId) ?? 'inherit')
  const [mute, setMute] = useState<MuteChoice>(wasMuted ? 'keep' : 'off')
  const [suppress, setSuppress] = useState(store.suppressEveryone.has(serverId))
  const [saving, setSaving] = useState(false)
  useEscapeKey(onClose)

  const save = async () => {
    setSaving(true)
    try {
      const { body, until } = muteRequest(mute, currentUntil)
      await api.post('/user/notification-overrides', { server_id: serverId, level, suppress_everyone: suppress, ...body })
      store.setServerMuted(serverId, body.muted, until)
      store.setServerPrefs(serverId, level, suppress)
      toast.success('Préférences sauvegardées')
      onClose()
    } catch {
      toast.error('Erreur de sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sn-title"
        className="bg-fc-bg border border-fc-hover rounded-lg shadow-xl w-full max-w-sm p-4 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span id="sn-title" className="text-white font-semibold truncate">Notifications — {serverName}</span>
          <button onClick={onClose} aria-label="Fermer" className="text-fc-muted hover:text-white"><X size={16} aria-hidden /></button>
        </div>

        <div>
          <label htmlFor="sn-mute" className="block text-[11px] text-fc-muted uppercase font-semibold tracking-wide mb-1">Sourdine du serveur</label>
          <MuteSelect id="sn-mute" value={mute} onChange={setMute} currentUntil={currentUntil} wasMuted={wasMuted} />
        </div>

        <fieldset>
          <legend className="text-[11px] text-fc-muted uppercase font-semibold tracking-wide mb-1">Notifications</legend>
          {LEVELS.map(l => (
            <label key={l.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-fc-hover cursor-pointer text-sm text-fc-text">
              <input type="radio" name="sn-level" checked={level === l.value} onChange={() => setLevel(l.value)} className="accent-fc-accent" />
              {l.label}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-fc-hover cursor-pointer text-sm text-fc-text">
          <input type="checkbox" checked={suppress} onChange={e => setSuppress(e.target.checked)} className="accent-fc-accent" />
          Ignorer @everyone et @here
        </label>

        <button
          onClick={save}
          disabled={saving}
          className="w-full py-1.5 bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium rounded transition disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Appliquer'}
        </button>
      </div>
    </div>,
    document.body
  )
}
