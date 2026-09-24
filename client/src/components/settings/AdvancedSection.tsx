import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Trash2, Copy, Eye, EyeOff, Bug, ClipboardList } from 'lucide-react'
import { sendManualReport } from '../../lib/errorReporter'
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
  const [deletePassword, setDeletePassword] = useState('')
  const [showDeletePw, setShowDeletePw] = useState(false)

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/users/me', { data: { password: deletePassword } }),
    onSuccess: async () => { await logout(); nav('/login') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const [problem, setProblem] = useState('')
  const report = useMutation({
    mutationFn: async () => {
      if (!(await sendManualReport(problem))) throw new Error('envoi')
    },
    onSuccess: () => { setProblem(''); toast.success('Merci, le problème a été signalé') },
    onError: () => toast.error("Impossible d'envoyer le signalement (réessayez plus tard)"),
  })
  // Lien visible seulement pour les comptes autorisés (le serveur répond 403 aux autres).
  const { isSuccess: isDiagAdmin } = useQuery({
    queryKey: ['admin-diagnostics-access'],
    queryFn: () => api.get('/admin/diagnostics', { params: { limit: 1 } }),
    retry: false,
    staleTime: 5 * 60_000,
  })

  const canConfirmDelete = deleteInput === user.username && deletePassword.length >= 8

  function resetDelete() {
    setConfirmDelete(false)
    setDeleteInput('')
    setDeletePassword('')
  }

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
          <div>Version: {__APP_VERSION__}</div>
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
        <h3 className="text-sm font-semibold text-white mb-1">Signaler un problème</h3>
        <p className="text-xs text-fc-muted mb-2">
          Décrivez ce qui ne va pas. Les dernières erreurs de l'application (et, dans l'application de bureau, son journal) sont jointes automatiquement.
        </p>
        <textarea
          value={problem}
          onChange={e => setProblem(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Ex. : la page reste blanche après la mise à jour"
          aria-label="Description du problème"
          className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-accent outline-none resize-y"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={() => report.mutate()}
            disabled={report.isPending || !problem.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent text-white rounded-lg text-sm disabled:opacity-50 transition hover:bg-indigo-500"
          >
            <Bug size={14} /> {report.isPending ? 'Envoi...' : 'Envoyer le signalement'}
          </button>
          {isDiagAdmin && (
            <button
              onClick={() => nav('/admin/diagnostics')}
              className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
            >
              <ClipboardList size={12} /> Rapports d'erreurs reçus
            </button>
          )}
        </div>
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
              placeholder="Nom d'utilisateur"
              enterKeyHint="next"
              autoCapitalize="none"
              autoComplete="off"
              className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white focus:border-fc-red outline-none"
            />
            <div className="relative">
              <input
                type={showDeletePw ? 'text' : 'password'}
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                placeholder="Mot de passe"
                autoComplete="current-password"
                enterKeyHint="done"
                className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 pr-10 text-sm text-white focus:border-fc-red outline-none"
              />
              <button
                type="button"
                onClick={() => setShowDeletePw(v => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white transition"
              >
                {showDeletePw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={resetDelete}
                className="flex-1 py-2 border border-fc-hover text-fc-muted rounded-lg text-sm hover:text-white transition">
                Annuler
              </button>
              <button
                onClick={() => deleteAccount.mutate()}
                disabled={!canConfirmDelete || deleteAccount.isPending}
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
