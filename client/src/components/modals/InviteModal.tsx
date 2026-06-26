import { useState } from 'react'
import { Copy, Check, X, Link, RefreshCw, Clock, Users, ChevronDown } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  serverName: string
  onClose: () => void
}

interface Invite {
  id: string
  code: string
  uses: number
  max_uses: number | null
  expires_at: string | null
  created_at: string
  inviter?: { username: string }
}

const EXPIRY_OPTIONS = [
  { label: '30 minutes', hours: 0.5 },
  { label: '1 heure', hours: 1 },
  { label: '6 heures', hours: 6 },
  { label: '12 heures', hours: 12 },
  { label: '1 jour', hours: 24 },
  { label: '7 jours', hours: 168 },
  { label: 'Jamais', hours: null },
]

const MAX_USES_OPTIONS = [
  { label: 'Illimité', value: null },
  { label: '1 utilisation', value: 1 },
  { label: '5 utilisations', value: 5 },
  { label: '10 utilisations', value: 10 },
  { label: '25 utilisations', value: 25 },
  { label: '50 utilisations', value: 50 },
  { label: '100 utilisations', value: 100 },
]

function formatExpiry(iso: string | null): string {
  if (!iso) return 'Jamais'
  const d = new Date(iso)
  const now = Date.now()
  const diff = d.getTime() - now
  if (diff < 0) return 'Expiré'
  if (diff < 3600_000) return `${Math.ceil(diff / 60_000)} min`
  if (diff < 86400_000) return `${Math.ceil(diff / 3600_000)}h`
  return `${Math.ceil(diff / 86400_000)}j`
}

export default function InviteModal({ serverId, serverName, onClose }: Props) {
  const [inviteUrl, setInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [expiryHours, setExpiryHours] = useState<number | null>(168)
  const [maxUses, setMaxUses] = useState<number | null>(null)
  const [showExisting, setShowExisting] = useState(false)
  const qc = useQueryClient()

  const { data: existingInvites = [] } = useQuery<Invite[]>({
    queryKey: ['invites', serverId],
    queryFn: () => api.get(`/servers/${serverId}/invites`).then(r => r.data),
    enabled: showExisting,
  })

  const generate = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/invites`, {
      max_uses: maxUses,
      expires_hours: expiryHours,
    }),
    onSuccess: (res) => {
      const url = `${window.location.origin}/invite/${res.data.code}`
      setInviteUrl(url)
      qc.invalidateQueries({ queryKey: ['invites', serverId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteInvite = useMutation({
    mutationFn: (code: string) => api.delete(`/servers/${serverId}/invites/${code}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', serverId] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const copy = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-fc-channel rounded-xl w-[480px] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-fc-bg flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Inviter sur <span className="text-fc-accent">{serverName}</span></h2>
            <p className="text-xs text-fc-muted mt-0.5">Partage un lien pour rejoindre le serveur</p>
          </div>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Paramètres */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                <Clock size={9} className="inline mr-1" />Expiration
              </label>
              <div className="relative">
                <select
                  value={expiryHours ?? ''}
                  onChange={e => setExpiryHours(e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full appearance-none bg-fc-input text-white text-sm px-3 py-2 rounded outline-none focus:ring-2 focus:ring-fc-accent pr-7"
                >
                  {EXPIRY_OPTIONS.map(opt => (
                    <option key={String(opt.hours)} value={opt.hours ?? ''}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
                <Users size={9} className="inline mr-1" />Utilisations max
              </label>
              <div className="relative">
                <select
                  value={maxUses ?? ''}
                  onChange={e => setMaxUses(e.target.value === '' ? null : Number(e.target.value))}
                  className="w-full appearance-none bg-fc-input text-white text-sm px-3 py-2 rounded outline-none focus:ring-2 focus:ring-fc-accent pr-7"
                >
                  {MAX_USES_OPTIONS.map(opt => (
                    <option key={String(opt.value)} value={opt.value ?? ''}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-fc-muted pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Lien généré */}
          {!inviteUrl ? (
            <div className="text-center py-5">
              <Link size={36} className="text-fc-muted mx-auto mb-3 opacity-60" />
              <p className="text-fc-muted text-sm mb-4">Configurez les paramètres puis générez un lien.</p>
              <button
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                className="px-6 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
              >
                {generate.isPending ? 'Génération...' : 'Générer le lien'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[10px] font-semibold text-fc-muted uppercase tracking-wide">Lien d'invitation</label>
              <div className="flex gap-2">
                <div className="flex-1 px-3 py-2 bg-fc-input rounded text-fc-text text-sm font-mono truncate">
                  {inviteUrl}
                </div>
                <button
                  onClick={() => copy(inviteUrl)}
                  className={`px-3 py-2 rounded font-medium text-sm transition flex items-center gap-1.5
                    ${copied ? 'bg-fc-green text-white' : 'bg-fc-accent hover:bg-indigo-500 text-white'}`}
                >
                  {copied ? <><Check size={14} /> Copié</> : <><Copy size={14} /></>}
                </button>
                <button
                  onClick={() => { setInviteUrl(''); generate.mutate() }}
                  disabled={generate.isPending}
                  className="px-3 py-2 rounded bg-fc-hover hover:bg-fc-hover/70 text-fc-muted hover:text-white transition"
                  title="Régénérer"
                >
                  <RefreshCw size={14} className={generate.isPending ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-fc-muted">
                <span>
                  {expiryHours === null ? 'Pas d\'expiration' : `Expire dans ${EXPIRY_OPTIONS.find(o => o.hours === expiryHours)?.label?.toLowerCase()}`}
                </span>
                <span>·</span>
                <span>{maxUses === null ? 'Utilisations illimitées' : `Max ${maxUses} utilisation${maxUses !== 1 ? 's' : ''}`}</span>
              </div>
              {/* QR code */}
              <div className="flex flex-col items-center gap-2 pt-2 border-t border-fc-hover">
                <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide">QR Code</p>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(inviteUrl)}&bgcolor=1e1f29&color=ffffff&qzone=1`}
                  alt="QR code invitation"
                  className="w-32 h-32 rounded-lg border border-fc-hover"
                />
                <p className="text-[10px] text-fc-muted">Scanner pour rejoindre</p>
              </div>
            </div>
          )}

          {/* Invitations existantes */}
          <div>
            <button
              onClick={() => setShowExisting(v => !v)}
              className="flex items-center gap-1.5 text-xs text-fc-accent hover:underline"
            >
              <ChevronDown size={12} className={`transition ${showExisting ? 'rotate-180' : ''}`} />
              {showExisting ? 'Masquer' : 'Voir'} les invitations existantes
            </button>

            {showExisting && existingInvites.length > 0 && (
              <div className="mt-3 space-y-2">
                {existingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 px-3 py-2 bg-fc-bg/40 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-fc-text truncate">{inv.code}</span>
                        <span className="text-[10px] text-fc-muted">{inv.uses ?? 0}/{inv.max_uses ?? '∞'} util.</span>
                        <span className="text-[10px] text-fc-muted">Exp: {formatExpiry(inv.expires_at)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => copy(`${window.location.origin}/invite/${inv.code}`)}
                      className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={() => deleteInvite.mutate(inv.code)}
                      className="p-1.5 rounded hover:bg-red-500/20 text-fc-muted hover:text-red-400 transition"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showExisting && existingInvites.length === 0 && (
              <p className="text-xs text-fc-muted mt-2">Aucune invitation active.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
