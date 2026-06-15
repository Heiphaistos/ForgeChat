import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, MessageCircle, Check, X } from 'lucide-react'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'

export default function FriendsPage() {
  const [tab, setTab] = useState<'all' | 'pending' | 'add'>('all')
  const [addInput, setAddInput] = useState('')
  const qc = useQueryClient()
  const nav = useNavigate()

  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get('/friends').then(r => r.data),
  })

  const accepted = friends.filter((f: any) => f.status === 'accepted')
  const pending = friends.filter((f: any) => f.status === 'pending')

  const sendRequest = useMutation({
    mutationFn: (user_id: string) => api.post('/friends', { user_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['friends'] }); setAddInput('') ; toast.success('Demande envoyée') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const accept = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  })

  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/friends/${id}/decline`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends'] }),
  })

  const openDm = async (userId: string) => {
    const { data } = await api.post(`/dms/${userId}`)
    nav(`/dms/${data.dm_id}`)
  }

  const tabBtn = (t: typeof tab, label: string, count?: number) => (
    <button
      onClick={() => setTab(t)}
      className={`px-3 py-1 rounded text-sm font-medium transition
        ${tab === t ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
    >
      {label}{count !== undefined && count > 0 ? ` (${count})` : ''}
    </button>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-fc-bg shadow-sm flex-shrink-0">
        <span className="font-semibold text-white">Amis</span>
        <div className="flex gap-1">
          {tabBtn('all', 'Tous', accepted.length)}
          {tabBtn('pending', 'En attente', pending.length)}
          {tabBtn('add', 'Ajouter un ami')}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'add' && (
          <div className="max-w-lg">
            <h3 className="font-semibold text-white mb-1">Ajouter un ami</h3>
            <p className="text-fc-muted text-sm mb-3">Entre l'ID utilisateur pour envoyer une demande.</p>
            <div className="flex gap-2">
              <input
                value={addInput}
                onChange={e => setAddInput(e.target.value)}
                placeholder="ID utilisateur (UUID)"
                className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                onKeyDown={e => e.key === 'Enter' && addInput && sendRequest.mutate(addInput)}
              />
              <button
                onClick={() => addInput && sendRequest.mutate(addInput)}
                className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm transition"
              >
                Envoyer
              </button>
            </div>
          </div>
        )}

        {tab === 'pending' && (
          <div className="space-y-2">
            {pending.length === 0 && (
              <p className="text-fc-muted text-sm">Aucune demande en attente.</p>
            )}
            {pending.map((f: any) => (
              <div key={f.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg hover:bg-fc-hover transition">
                <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center font-bold text-white">
                  {f.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white text-sm">{f.username}</div>
                  <div className="text-xs text-fc-muted">Demande reçue</div>
                </div>
                <button onClick={() => accept.mutate(f.id)} className="p-2 bg-fc-green/20 hover:bg-fc-green/30 text-fc-green rounded-full transition">
                  <Check size={16} />
                </button>
                <button onClick={() => decline.mutate(f.id)} className="p-2 bg-fc-red/20 hover:bg-fc-red/30 text-fc-red rounded-full transition">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === 'all' && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              Tous les amis — {accepted.length}
            </div>
            {accepted.length === 0 && (
              <p className="text-fc-muted text-sm">Tu n'as pas encore d'amis. Ajoutes-en !</p>
            )}
            {accepted.map((f: any) => (
              <div
                key={f.id}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-fc-hover transition group cursor-pointer"
                onClick={() => openDm(f.friend_id)}
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center font-bold text-white">
                    {f.username.charAt(0).toUpperCase()}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-fc-channel
                    ${f.user_status === 'online' ? 'bg-fc-green' : 'bg-fc-muted'}`} />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-white text-sm">{f.username}</div>
                  <div className={`text-xs ${f.user_status === 'online' ? 'text-fc-green' : 'text-fc-muted'}`}>
                    {f.user_status === 'online' ? 'En ligne' : 'Hors ligne'}
                  </div>
                </div>
                <button className="p-2 text-fc-muted hover:text-white opacity-0 group-hover:opacity-100 transition rounded hover:bg-fc-input">
                  <MessageCircle size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
