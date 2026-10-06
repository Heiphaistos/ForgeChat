import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useEscapeKey } from '../../hooks/useEscapeKey'

/**
 * Suppression définitive d'un serveur (propriétaire). Le serveur exige le mot de passe et, si la
 * double authentification est activée, son code (server/src/handlers/servers.rs, verify_reauth) :
 * 403 `totp_required` fait apparaître le champ du code même si le profil local n'est pas à jour.
 */
export default function DeleteServerModal({ server, onClose }: { server: { id: string; name: string }; onClose: () => void }) {
  useEscapeKey(onClose)
  const qc = useQueryClient()
  const nav = useNavigate()
  const [nom, setNom] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [demande2fa, setDemande2fa] = useState(useAuth(s => !!(s.user as { totp_enabled?: boolean } | null)?.totp_enabled))
  const [erreur, setErreur] = useState('')
  const nomOk = nom.trim().toLowerCase() === server.name.trim().toLowerCase()

  const supprimer = useMutation({
    mutationFn: () => api.delete(`/servers/${server.id}`, { data: { password, totp_code: code.trim() || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Serveur « ${server.name} » supprimé`)
      onClose()
      nav('/friends')
    },
    onError: (e: { response?: { status?: number; data?: { error?: string } } }) => {
      const msg = e.response?.data?.error
      if (e.response?.status === 403 && msg === 'totp_required') {
        setDemande2fa(true)
        setErreur('Entre le code de ton application de double authentification.')
      } else if (e.response?.status === 429) {
        setErreur('Trop d’essais. Réessaie dans quelques minutes.')
      } else {
        setErreur(msg ?? 'Suppression impossible.')
      }
    },
  })

  const pret = nomOk && password.length > 0 && (!demande2fa || code.trim().length >= 6) && !supprimer.isPending

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[120] px-3 md:px-0" onClick={onClose}>
      <form
        className="bg-fc-channel rounded-xl w-full max-w-[460px] max-h-[90dvh] overflow-y-auto shadow-2xl border border-fc-red/40"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (pret) { setErreur(''); supprimer.mutate() } }}
        role="dialog" aria-modal="true" aria-labelledby="delete-server-title"
      >
        <div className="p-5 border-b border-fc-bg flex items-center justify-between">
          <h2 id="delete-server-title" className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert size={20} className="text-fc-red" aria-hidden /> Supprimer « {server.name} »
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-fc-muted hover:text-white p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-fc-muted">
            Tous les salons, messages, rôles et invitations seront <span className="text-white font-semibold">définitivement supprimés</span>. Cette action est irréversible.
          </p>
          <label className="block">
            <span className="block text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Tape le nom du serveur</span>
            <input value={nom} onChange={e => setNom(e.target.value)} placeholder={server.name} autoFocus autoComplete="off"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-red text-sm" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Ton mot de passe</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-red text-sm" />
          </label>
          {demande2fa && (
            <label className="block">
              <span className="block text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">Code de double authentification (ou code de secours)</span>
              <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-red text-sm tracking-widest" />
            </label>
          )}
          {erreur && <p role="alert" className="text-sm text-fc-red">{erreur}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded text-sm text-fc-text hover:bg-fc-hover">Annuler</button>
            <button type="submit" disabled={!pret}
              className="px-4 py-2 rounded text-sm font-medium bg-fc-red text-white hover:bg-red-600 transition flex items-center gap-2 disabled:opacity-40">
              <Trash2 size={14} aria-hidden /> {supprimer.isPending ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
