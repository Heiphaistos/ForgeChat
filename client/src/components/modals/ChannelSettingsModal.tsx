import { useState } from 'react'
import { X, Hash, Volume2, Video, Radio } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

const SLOWMODE_OPTIONS = [
  { label: 'Désactivé', value: 0 },
  { label: '5 secondes', value: 5 },
  { label: '10 secondes', value: 10 },
  { label: '15 secondes', value: 15 },
  { label: '30 secondes', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '5 minutes', value: 300 },
  { label: '10 minutes', value: 600 },
  { label: '1 heure', value: 3600 },
]

interface Channel {
  id: string
  name: string
  type: string
  topic?: string
  slowmode_delay: number
  user_limit?: number
  is_nsfw: boolean
  voice_password_hash?: string | null
}

interface Props {
  channel: Channel
  serverId: string
  onClose: () => void
}

const isVoice = (type: string) => ['voice', 'video', 'stage'].includes(type)
const isText = (type: string) => ['text', 'announcement', 'forum'].includes(type)

export default function ChannelSettingsModal({ channel, serverId, onClose }: Props) {
  const qc = useQueryClient()

  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [slowmode, setSlowmode] = useState(channel.slowmode_delay ?? 0)
  const [userLimit, setUserLimit] = useState(channel.user_limit ?? 0)
  const [isNsfw, setIsNsfw] = useState(channel.is_nsfw)
  const [voicePassword, setVoicePassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [hasExistingPassword] = useState(!!channel.voice_password_hash)

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: name.trim() || undefined,
        topic: isText(channel.type) ? (topic.trim() || null) : undefined,
        slowmode_delay: isText(channel.type) ? slowmode : undefined,
        user_limit: isVoice(channel.type) ? (userLimit > 0 ? userLimit : null) : undefined,
        is_nsfw: isNsfw,
      }
      if (isVoice(channel.type)) {
        if (removePassword) {
          payload.remove_voice_password = true
        } else if (voicePassword.trim()) {
          payload.voice_password = voicePassword.trim()
        }
      }
      return api.patch(`/servers/${serverId}/channels/${channel.id}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success('Canal mis à jour')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur lors de la mise à jour'),
  })

  const channelIcon = isVoice(channel.type)
    ? channel.type === 'video' ? <Video size={18} className="text-purple-400" />
    : channel.type === 'stage' ? <Radio size={18} className="text-pink-400" />
    : <Volume2 size={18} className="text-blue-400" />
    : <Hash size={18} className="text-fc-muted" />

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-fc-channel rounded-lg w-[460px] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-fc-bg flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {channelIcon}
              <h2 className="text-lg font-bold text-white">Paramètres du canal</h2>
            </div>
            <p className="text-fc-muted text-sm">#{channel.name}</p>
          </div>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Nom */}
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
              Nom du canal
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              maxLength={100}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>

          {/* Topic (canaux texte) */}
          {isText(channel.type) && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                Description du canal
              </label>
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                maxLength={1024}
                placeholder="Description du canal..."
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          )}

          {/* Slowmode (canaux texte) */}
          {isText(channel.type) && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                Mode lent ⏱
              </label>
              <p className="text-xs text-fc-muted mb-2">
                Limite la fréquence d'envoi de messages par utilisateur.
              </p>
              <select
                value={slowmode}
                onChange={e => setSlowmode(Number(e.target.value))}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              >
                {SLOWMODE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* User limit (canaux vocaux) */}
          {isVoice(channel.type) && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                Limite d'utilisateurs
              </label>
              <p className="text-xs text-fc-muted mb-2">
                0 = illimité. Max 99.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={99}
                  value={userLimit}
                  onChange={e => setUserLimit(Number(e.target.value))}
                  className="flex-1 accent-fc-accent"
                />
                <span className="w-8 text-center text-sm font-semibold text-white">
                  {userLimit === 0 ? '∞' : userLimit}
                </span>
              </div>
            </div>
          )}

          {/* Mot de passe vocal */}
          {isVoice(channel.type) && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                Mot de passe vocal 🔒
              </label>
              {hasExistingPassword && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-yellow-400">Un mot de passe est déjà défini.</span>
                  <label className="flex items-center gap-1 cursor-pointer text-xs text-fc-muted">
                    <input
                      type="checkbox"
                      checked={removePassword}
                      onChange={e => {
                        setRemovePassword(e.target.checked)
                        if (e.target.checked) setVoicePassword('')
                      }}
                      className="accent-fc-red"
                    />
                    Supprimer
                  </label>
                </div>
              )}
              {!removePassword && (
                <input
                  type="password"
                  value={voicePassword}
                  onChange={e => setVoicePassword(e.target.value)}
                  placeholder={hasExistingPassword ? 'Nouveau mot de passe (laisser vide = inchangé)' : 'Définir un mot de passe...'}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                />
              )}
            </div>
          )}

          {/* NSFW */}
          <div className="flex items-center justify-between p-3 bg-fc-bg/50 rounded-lg">
            <div>
              <div className="text-sm font-medium text-white">Canal NSFW</div>
              <div className="text-xs text-fc-muted">Contenu réservé aux adultes</div>
            </div>
            <button
              onClick={() => setIsNsfw(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${isNsfw ? 'bg-fc-accent' : 'bg-fc-hover'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isNsfw ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-fc-bg/50 rounded-b-lg flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
            Annuler
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            {save.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
