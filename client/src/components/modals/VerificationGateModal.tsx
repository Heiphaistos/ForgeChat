import { useState } from 'react'
import { Shield, CheckCircle2, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  serverName: string
  rules: string
  onVerified: () => void
  onClose?: () => void
}

export default function VerificationGateModal({ serverId, serverName, rules, onVerified, onClose }: Props) {
  const [accepted, setAccepted] = useState(false)

  const verify = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/verify`),
    onSuccess: () => {
      toast.success('Accès accordé !')
      onVerified()
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.error ?? 'Erreur de vérification')
    },
  })

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-3 md:px-0">
      <div className="bg-fc-channel rounded-xl p-6 w-full max-w-[480px] max-h-[90dvh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-fc-accent/20 flex items-center justify-center">
              <Shield size={20} className="text-fc-accent" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Vérification requise</h2>
              <p className="text-fc-muted text-xs">{serverName}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover">
              <X size={18} />
            </button>
          )}
        </div>

        <p className="text-fc-muted text-sm mb-4">
          Ce serveur exige que tu acceptes ses règles avant d'accéder aux canaux.
        </p>

        {/* Règles */}
        <div className="flex-1 overflow-y-auto mb-5">
          <div className="bg-fc-bg rounded-lg p-4 min-h-[120px] max-h-[300px] overflow-y-auto">
            <h3 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-3">
              Règles du serveur
            </h3>
            {rules ? (
              <pre className="text-white text-sm whitespace-pre-wrap font-sans leading-relaxed">
                {rules}
              </pre>
            ) : (
              <p className="text-fc-muted text-sm italic">Aucune règle spécifiée.</p>
            )}
          </div>
        </div>

        {/* Checkbox + Bouton */}
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="mt-0.5 flex-shrink-0">
              <input
                type="checkbox"
                checked={accepted}
                onChange={e => setAccepted(e.target.checked)}
                className="sr-only"
              />
              <div
                onClick={() => setAccepted(!accepted)}
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  accepted
                    ? 'bg-fc-accent border-fc-accent'
                    : 'border-fc-muted group-hover:border-fc-accent/60'
                }`}
              >
                {accepted && <CheckCircle2 size={12} className="text-white" />}
              </div>
            </div>
            <span className="text-sm text-fc-muted group-hover:text-white transition leading-relaxed">
              J'ai lu et j'accepte les règles du serveur
            </span>
          </label>

          <button
            onClick={() => verify.mutate()}
            disabled={!accepted || verify.isPending}
            className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition"
          >
            {verify.isPending ? 'Vérification...' : 'Accéder au serveur'}
          </button>
        </div>
      </div>
    </div>
  )
}
