import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Hash, MessageCircle, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
import toast from 'react-hot-toast'

export default function ServerSidebar() {
  const { serverId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get('/servers').then(r => r.data),
  })

  const createServer = useMutation({
    mutationFn: (name: string) => api.post('/servers', { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      nav(`/servers/${res.data.id}`)
      setShowCreate(false)
      toast.success('Serveur créé !')
    },
  })

  return (
    <div className="flex flex-col items-center py-3 w-[72px] bg-fc-bg gap-2 overflow-y-auto">
      {/* DMs */}
      <button
        onClick={() => nav('/friends')}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-accent rounded-full flex items-center justify-center transition-all hover:rounded-2xl"
        title="Messages directs"
      >
        <MessageCircle size={20} className="text-fc-text" />
      </button>

      <div className="w-8 h-px bg-fc-hover mx-auto" />

      {/* Serveurs */}
      {servers.map((s: any) => (
        <button
          key={s.id}
          onClick={() => nav(`/servers/${s.id}`)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all hover:rounded-2xl font-bold text-white
            ${serverId === s.id ? 'bg-fc-accent rounded-2xl' : 'bg-fc-channel hover:bg-fc-accent'}`}
          title={s.name}
        >
          {s.icon
            ? <img src={s.icon} alt={s.name} className="w-full h-full rounded-full object-cover" />
            : s.name.charAt(0).toUpperCase()}
        </button>
      ))}

      {/* Créer serveur */}
      <button
        onClick={() => setShowCreate(true)}
        className="w-12 h-12 bg-fc-channel hover:bg-fc-green rounded-full flex items-center justify-center transition-all hover:rounded-2xl text-fc-green hover:text-white"
        title="Créer un serveur"
      >
        <Plus size={24} />
      </button>

      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onCreate={(name) => createServer.mutate(name)}
        />
      )}
    </div>
  )
}

function CreateServerModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-fc-channel rounded-lg p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white mb-1">Créer un serveur</h2>
        <p className="text-fc-muted text-sm mb-4">Donne un nom à ton serveur.</p>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Mon serveur"
          className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent mb-4"
          onKeyDown={e => e.key === 'Enter' && name.trim() && onCreate(name.trim())}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition">Annuler</button>
          <button
            onClick={() => name.trim() && onCreate(name.trim())}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded transition"
          >
            Créer
          </button>
        </div>
      </div>
    </div>
  )
}
