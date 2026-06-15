import { useState } from 'react'
import { X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import toast from 'react-hot-toast'

interface Props {
  onClose: () => void
}

const STATUSES = [
  { value: 'online', label: 'En ligne', color: 'bg-fc-green' },
  { value: 'idle', label: 'Absent', color: 'bg-fc-yellow' },
  { value: 'dnd', label: 'Ne pas déranger', color: 'bg-fc-red' },
  { value: 'invisible', label: 'Invisible', color: 'bg-fc-muted' },
]

export default function UserProfileModal({ onClose }: Props) {
  const { user, updateMe } = useAuth()
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const [status, setStatus] = useState(user?.status ?? 'online')

  const save = useMutation({
    mutationFn: () => api.patch('/users/me', { username, bio, custom_status: customStatus, status }),
    onSuccess: (res) => {
      updateMe(res.data)
      toast.success('Profil mis à jour')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  if (!user) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-fc-channel rounded-lg w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Banner */}
        <div className="h-24 bg-gradient-to-r from-fc-accent to-purple-600 rounded-t-lg relative">
          <button onClick={onClose} className="absolute top-3 right-3 text-white/70 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        {/* Avatar */}
        <div className="px-6 pb-6">
          <div className="flex items-end justify-between -mt-10 mb-4">
            <div className="w-20 h-20 rounded-full bg-fc-accent border-4 border-fc-channel flex items-center justify-center font-bold text-2xl text-white">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="text-xs text-fc-muted">#{user.discriminator}</div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                Nom d'utilisateur
              </label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                maxLength={32}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                À propos de moi
              </label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                maxLength={190}
                rows={3}
                placeholder="Parle un peu de toi..."
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                Statut personnalisé
              </label>
              <input
                value={customStatus}
                onChange={e => setCustomStatus(e.target.value)}
                maxLength={128}
                placeholder="Ce que tu fais..."
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                Statut
              </label>
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setStatus(s.value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded border transition text-sm
                      ${status === s.value ? 'border-fc-accent bg-fc-accent/10 text-white' : 'border-fc-hover text-fc-muted hover:text-white hover:border-fc-hover'}`}
                  >
                    <div className={`w-3 h-3 rounded-full ${s.color} flex-shrink-0`} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
                Annuler
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
              >
                {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
