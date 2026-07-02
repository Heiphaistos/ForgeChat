import { useState } from 'react'
import { X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useAuth } from '../../store/auth'

interface Props {
  serverId: string
  currentNickname: string | null
  onClose: () => void
}

export default function NicknameModal({ serverId, currentNickname, onClose }: Props) {
  const { user } = useAuth()
  const [value, setValue] = useState(currentNickname ?? '')

  const save = useMutation({
    mutationFn: (nickname: string | null) =>
      api.patch(`/servers/${serverId}/nickname`, { nickname }),
    onSuccess: () => {
      toast.success(value.trim() ? 'Surnom mis à jour' : 'Surnom réinitialisé')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const displayName = value.trim() || user?.username || 'Vous'

  const handleSave = () => {
    save.mutate(value.trim() || null)
  }

  const handleReset = () => {
    setValue('')
    save.mutate(null)
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0"
      onClick={onClose}
    >
      <div
        className="bg-fc-channel rounded-lg p-6 w-full max-w-[420px] max-h-[90dvh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">Changer mon surnom</h2>
          <button
            onClick={onClose}
            className="text-fc-muted hover:text-white transition p-1 hover:bg-fc-hover rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* Input */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
            Surnom
          </label>
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            maxLength={32}
            placeholder="Entrez votre surnom..."
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
          />
          <div className="text-xs text-fc-muted mt-1 text-right">{value.length}/32</div>
        </div>

        {/* Preview */}
        <div className="p-3 bg-fc-bg/50 rounded-lg mb-5">
          <div className="text-xs text-fc-muted mb-1">Aperçu</div>
          <div className="text-sm text-white">
            Tu apparaîtras comme :{' '}
            <span className="font-semibold text-fc-accent">{displayName}</span>
          </div>
        </div>

        {/* Boutons */}
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={handleReset}
            disabled={save.isPending || (!currentNickname && !value)}
            className="px-4 py-2 text-fc-muted hover:text-white hover:bg-fc-hover rounded text-sm transition disabled:opacity-40"
          >
            Réinitialiser
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-fc-muted hover:text-white transition text-sm"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={save.isPending || value === (currentNickname ?? '')}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
          >
            {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  )
}
