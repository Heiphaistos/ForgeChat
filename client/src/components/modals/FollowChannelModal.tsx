import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Megaphone, X } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'

interface Target { server_id: string; server_name: string; channels: { id: string; name: string }[] }

/** Suivre un salon d'annonces : ses messages publiés arrivent dans un salon
 *  texte d'un serveur qu'on administre. */
export default function FollowChannelModal({ channelId, channelName, onClose }: { channelId: string; channelName: string; onClose: () => void }) {
  useEscapeKey(onClose)
  const [target, setTarget] = useState('')
  const { data: targets = [], isLoading } = useQuery<Target[]>({
    queryKey: ['follow-targets', channelId],
    queryFn: () => api.get(`/channels/${channelId}/follow-targets`).then(r => r.data),
  })
  const follow = useMutation({
    mutationFn: () => api.post(`/channels/${channelId}/follow`, { target_channel_id: target }),
    onSuccess: () => { toast.success(`#${channelName} est maintenant suivi`); onClose() },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Abonnement impossible'),
  })

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3" onClick={onClose}>
      <div className="bg-fc-channel rounded-xl p-5 w-full max-w-[440px] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="follow-title" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 id="follow-title" className="text-white font-bold flex items-center gap-2">
            <Megaphone size={18} className="text-yellow-400" aria-hidden /> Suivre #{channelName}
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="text-fc-muted hover:text-white p-2 rounded hover:bg-fc-hover"><X size={18} aria-hidden /></button>
        </div>
        <p className="text-sm text-fc-muted mb-4">Les annonces publiées dans ce salon seront recopiées dans le salon choisi.</p>
        {isLoading ? (
          <p className="text-sm text-fc-muted">Chargement…</p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-fc-muted">Il faut gérer les salons d'au moins un serveur pour suivre des annonces.</p>
        ) : (
          <select value={target} onChange={e => setTarget(e.target.value)} aria-label="Salon de destination"
            className="w-full px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent">
            <option value="">Choisir un salon…</option>
            {targets.map(t => (
              <optgroup key={t.server_id} label={t.server_name}>
                {t.channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-fc-muted hover:text-white">Annuler</button>
          <button onClick={() => follow.mutate()} disabled={!target || follow.isPending}
            className="px-4 py-2 text-sm bg-fc-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">Suivre</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
