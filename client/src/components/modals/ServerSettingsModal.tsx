import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Server {
  id: string
  name: string
  description?: string
  is_public: boolean
  member_count: number
}

interface Props {
  server: Server
  onClose: () => void
}

export default function ServerSettingsModal({ server, onClose }: Props) {
  const [tab, setTab] = useState<'general' | 'roles' | 'members' | 'bans'>('general')
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [isPublic, setIsPublic] = useState(server.is_public)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const qc = useQueryClient()
  const nav = useNavigate()

  const update = useMutation({
    mutationFn: () => api.patch(`/servers/${server.id}`, { name, description, is_public: isPublic }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', server.id] })
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Serveur mis à jour')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteServer = useMutation({
    mutationFn: () => api.delete(`/servers/${server.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      nav('/')
      toast.success('Serveur supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const tabs = [
    { id: 'general', label: 'Général' },
    { id: 'roles', label: 'Rôles' },
    { id: 'members', label: 'Membres' },
    { id: 'bans', label: 'Bans' },
  ] as const

  return (
    <div className="fixed inset-0 bg-black/80 flex z-50">
      <div className="flex w-full h-full">
        {/* Sidebar settings */}
        <div className="w-[220px] bg-fc-channel flex-shrink-0 p-4">
          <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 px-2 truncate">
            {server.name}
          </div>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition mb-0.5
                ${tab === t.id ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover/50'}`}
            >
              {t.label}
            </button>
          ))}
          <div className="mt-4 border-t border-fc-hover pt-4">
            <button
              onClick={() => deleteServer.mutate()}
              disabled={deleteConfirm !== server.name}
              className="w-full text-left px-2 py-1.5 rounded text-sm text-fc-red hover:bg-fc-red/10 transition flex items-center gap-2 disabled:opacity-40"
            >
              <Trash2 size={14} /> Supprimer le serveur
            </button>
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 bg-fc-chat overflow-y-auto">
          <div className="max-w-2xl mx-auto p-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold text-white">Paramètres du serveur</h2>
              <button onClick={onClose} className="text-fc-muted hover:text-white transition p-2 hover:bg-fc-hover rounded">
                <X size={20} />
              </button>
            </div>

            {tab === 'general' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                    Nom du serveur
                  </label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    maxLength={100}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none text-sm"
                    placeholder="Décrivez votre serveur..."
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-fc-channel rounded-lg">
                  <div>
                    <div className="font-medium text-white text-sm">Serveur public</div>
                    <div className="text-xs text-fc-muted">Visible dans la liste des serveurs publics</div>
                  </div>
                  <button
                    onClick={() => setIsPublic(!isPublic)}
                    className={`w-11 h-6 rounded-full transition relative ${isPublic ? 'bg-fc-green' : 'bg-fc-muted'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${isPublic ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="p-4 bg-fc-channel/50 rounded-lg border border-fc-hover">
                  <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">Zone de danger</div>
                  <p className="text-sm text-fc-muted mb-3">
                    Pour supprimer le serveur, tape son nom : <span className="text-white font-mono">{server.name}</span>
                  </p>
                  <input
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder={server.name}
                    className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-red text-sm"
                  />
                </div>

                <button
                  onClick={() => update.mutate()}
                  disabled={update.isPending}
                  className="px-5 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium text-sm transition disabled:opacity-50"
                >
                  {update.isPending ? 'Sauvegarde...' : 'Sauvegarder les modifications'}
                </button>
              </div>
            )}

            {tab === 'roles' && (
              <div className="text-fc-muted text-sm">
                Gestion des rôles (à venir dans v1.1)
              </div>
            )}
            {tab === 'members' && (
              <div className="text-fc-muted text-sm">
                {server.member_count} membre(s) · Gestion avancée (à venir dans v1.1)
              </div>
            )}
            {tab === 'bans' && (
              <div className="text-fc-muted text-sm">
                Aucun ban actif.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
