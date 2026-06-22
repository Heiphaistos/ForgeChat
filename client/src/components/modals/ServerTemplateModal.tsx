import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface ServerTemplate {
  id: string
  name: string
  description: string
  icon: string
  channels: Array<{ name: string; type: 'text' | 'voice' | 'announcement' }>
  categories: string[]
}

const TEMPLATES: ServerTemplate[] = [
  {
    id: 'gaming',
    name: 'Gaming',
    icon: '🎮',
    description: 'Serveur pour jouer ensemble',
    categories: ['Texte', 'Vocal'],
    channels: [
      { name: 'général', type: 'text' },
      { name: 'annonces', type: 'announcement' },
      { name: 'recherche-équipe', type: 'text' },
      { name: 'stratégie', type: 'text' },
      { name: 'Voice', type: 'voice' },
      { name: 'Gaming', type: 'voice' },
    ],
  },
  {
    id: 'community',
    name: 'Communauté',
    icon: '🌍',
    description: 'Serveur communautaire ouvert',
    categories: ['Info', 'Discussion'],
    channels: [
      { name: 'accueil', type: 'text' },
      { name: 'annonces', type: 'announcement' },
      { name: 'général', type: 'text' },
      { name: 'aide', type: 'text' },
      { name: 'Vocal général', type: 'voice' },
    ],
  },
  {
    id: 'devteam',
    name: 'Dev Team',
    icon: '💻',
    description: 'Espace de travail pour développeurs',
    categories: ['Général', 'Vocal'],
    channels: [
      { name: 'général', type: 'text' },
      { name: 'projets', type: 'text' },
      { name: 'code-review', type: 'text' },
      { name: 'bugs', type: 'text' },
      { name: 'standup', type: 'text' },
      { name: 'Dev call', type: 'voice' },
    ],
  },
  {
    id: 'music',
    name: 'Musique',
    icon: '🎵',
    description: 'Partagez vos coups de cœur musicaux',
    categories: ['Texte', 'Vocal'],
    channels: [
      { name: 'découvertes', type: 'text' },
      { name: 'playlists', type: 'text' },
      { name: 'concerts', type: 'text' },
      { name: 'Écoute ensemble', type: 'voice' },
    ],
  },
  {
    id: 'education',
    name: 'Éducation',
    icon: '📚',
    description: 'Apprendre et progresser ensemble',
    categories: ['Info', 'Travail'],
    channels: [
      { name: 'annonces', type: 'announcement' },
      { name: 'ressources', type: 'text' },
      { name: 'questions', type: 'text' },
      { name: 'projets', type: 'text' },
      { name: 'Étude', type: 'voice' },
    ],
  },
]

interface Props {
  onClose: () => void
}

export default function ServerTemplateModal({ onClose }: Props) {
  const [selected, setSelected] = useState<ServerTemplate | null>(null)
  const [name, setName] = useState('')
  const [step, setStep] = useState<'grid' | 'name'>('grid')
  const nav = useNavigate()
  const qc = useQueryClient()

  const createServer = useMutation({
    mutationFn: async ({ serverName, template }: { serverName: string; template: ServerTemplate }) => {
      const res = await api.post('/api/servers', { name: serverName })
      const serverId = res.data.id
      for (const ch of template.channels) {
        try {
          await api.post(`/api/servers/${serverId}/channels`, { name: ch.name, type: ch.type })
        } catch {
          // ignore individual channel failures
        }
      }
      return res
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Serveur créé depuis le template !')
      nav(`/servers/${res.data.id}`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur lors de la création'),
  })

  const handleSelect = (t: ServerTemplate) => {
    setSelected(t)
    setName(t.name)
    setStep('name')
  }

  const handleCreate = () => {
    if (!selected || !name.trim()) return
    createServer.mutate({ serverName: name.trim(), template: selected })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-fc-channel rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-fc-hover">
          <div>
            {step === 'name' && selected && (
              <button
                onClick={() => setStep('grid')}
                className="text-fc-muted hover:text-white transition text-sm mr-3"
              >
                ←
              </button>
            )}
            <span className="text-lg font-bold text-white">
              {step === 'grid' ? 'Choisir un template' : `Template : ${selected?.icon} ${selected?.name}`}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition">
            <X size={16} />
          </button>
        </div>

        {/* Grid */}
        {step === 'grid' && (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-sm text-fc-muted mb-4">Sélectionnez un template pour créer votre serveur avec des canaux préconfigurés.</p>
            <div className="grid grid-cols-1 gap-3">
              {TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t)}
                  className="flex items-start gap-4 p-4 bg-fc-bg hover:bg-fc-hover rounded-xl text-left transition border border-transparent hover:border-fc-accent/40 group"
                >
                  <span className="text-3xl flex-shrink-0 mt-0.5">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white group-hover:text-fc-accent transition">{t.name}</div>
                    <div className="text-xs text-fc-muted mt-0.5">{t.description}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {t.channels.map(ch => (
                        <span key={ch.name} className="text-[10px] bg-fc-hover px-1.5 py-0.5 rounded text-fc-muted">
                          {ch.type === 'voice' ? '🔊' : ch.type === 'announcement' ? '📢' : '#'} {ch.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Name step */}
        {step === 'name' && selected && (
          <div className="p-5">
            <p className="text-sm text-fc-muted mb-4">
              {selected.channels.length} canaux seront créés automatiquement.
            </p>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              Nom du serveur
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={selected.name}
              maxLength={100}
              className="w-full px-3 py-2 bg-fc-input border border-fc-hover rounded-lg text-white outline-none focus:border-fc-accent mb-4"
              onKeyDown={e => e.key === 'Enter' && name.trim() && handleCreate()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || createServer.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-fc-accent/80 disabled:opacity-50 text-white rounded-lg text-sm transition font-medium"
              >
                {createServer.isPending ? 'Création...' : 'Créer le serveur'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
