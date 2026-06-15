import { useState } from 'react'
import { Copy, Check, X, Link } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  serverName: string
  onClose: () => void
}

export default function InviteModal({ serverId, serverName, onClose }: Props) {
  const [inviteUrl, setInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const generate = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/invites`, { max_uses: null, expires_hours: 168 }),
    onSuccess: (res) => {
      const url = `${window.location.origin}/invite/${res.data.code}`
      setInviteUrl(url)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const copy = () => {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-fc-channel rounded-lg w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-fc-bg flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Inviter des amis sur <span className="text-fc-accent">{serverName}</span></h2>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {!inviteUrl ? (
            <div className="text-center py-4">
              <Link size={40} className="text-fc-muted mx-auto mb-3" />
              <p className="text-fc-muted text-sm mb-4">Génère un lien d'invitation valable 7 jours.</p>
              <button
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                className="px-5 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
              >
                {generate.isPending ? 'Génération...' : 'Générer un lien'}
              </button>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                Partage ce lien
              </p>
              <div className="flex gap-2">
                <div className="flex-1 px-3 py-2 bg-fc-input rounded text-fc-text text-sm font-mono truncate">
                  {inviteUrl}
                </div>
                <button
                  onClick={copy}
                  className={`px-4 py-2 rounded font-medium text-sm transition flex items-center gap-1.5
                    ${copied ? 'bg-fc-green text-white' : 'bg-fc-accent hover:bg-indigo-500 text-white'}`}
                >
                  {copied ? <><Check size={14} /> Copié</> : <><Copy size={14} /> Copier</>}
                </button>
              </div>
              <p className="text-xs text-fc-muted mt-2">Ce lien expire dans 7 jours · Utilisations illimitées</p>
              <button
                onClick={() => generate.mutate()}
                className="text-xs text-fc-accent hover:underline mt-1"
              >
                Générer un nouveau lien
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
