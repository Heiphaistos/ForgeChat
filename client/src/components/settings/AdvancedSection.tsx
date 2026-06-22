import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { Trash2, Copy } from 'lucide-react'
import { useAuth } from '../../store/auth'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  user: any
}

export default function AdvancedSection({ user }: Props) {
  const nav = useNavigate()
  const { logout } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/users/me'),
    onSuccess: async () => { await logout(); nav('/login') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Cache local</h3>
        <button
          onClick={() => { localStorage.clear(); toast.success('Cache vidé — rechargement...'); setTimeout(() => location.reload(), 800) }}
          className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition"
        >
          Vider le cache
        </button>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-white mb-1">Informations de débogage</h3>
        <div className="bg-fc-channel rounded-lg p-3 text-xs font-mono text-fc-muted space-y-1">
          <div>UserID: {user.id}</div>
          <div>Version: 3.1.0</div>
          <div>UA: {navigator.userAgent.slice(0, 60)}...</div>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(user.id); toast.success('ID copié') }}
          className="mt-2 flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
        >
          <Copy size={12} /> Copier l'ID utilisateur
        </button>
      </div>

      <div className="border-t border-fc-hover pt-6">
        <h3 className="text-sm font-semibold text-fc-red mb-1">Zone dangereuse</h3>
        <p className="text-xs text-fc-muted mb-3">La suppression du compte est irréversible.</p>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 px-4 py-2 bg-fc-red/10 text-fc-red rounded-lg text-sm hover:bg-fc-red/20 transition"
          >
            <Trash2 size={14} /> Supprimer mon compte
          </button>
        ) : (
          <div className="space-y-3 p-4 border border-fc-red/40 rounded-xl">
            <p className="text-sm text-white">Tapez <strong>{user.username}</strong> pour confirmer</p>
            <input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              className="w-full bg-fc-channel border border-fc-red/40 rounded-lg px-3 py-2 text-sm text-white focus:border-fc-red outline-none"
            />
            <div className="flex gap-2">
              <button onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
                className="flex-1 py-2 border border-fc-hover text-fc-muted rounded-lg text-sm hover:text-white transition">
                Annuler
              </button>
              <button
                onClick={() => deleteAccount.mutate()}
                disabled={deleteInput !== user.username || deleteAccount.isPending}
                className="flex-1 py-2 bg-fc-red text-white rounded-lg text-sm disabled:opacity-50 transition hover:bg-fc-red/80"
              >
                {deleteAccount.isPending ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
