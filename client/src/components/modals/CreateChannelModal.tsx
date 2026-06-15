import { useState } from 'react'
import { Hash, Volume2, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  onClose: () => void
}

export default function CreateChannelModal({ serverId, onClose }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'text' | 'voice'>('text')
  const [topic, setTopic] = useState('')
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels`, {
      name: name.toLowerCase().replace(/\s+/g, '-'),
      type,
      topic: topic || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success('Canal créé !')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-fc-channel rounded-lg w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-fc-bg">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Créer un canal</h2>
              <p className="text-fc-muted text-sm mt-1">Dans <span className="text-white font-medium">ton serveur</span></p>
            </div>
            <button onClick={onClose} className="text-fc-muted hover:text-white transition">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2">
              Type de canal
            </label>
            <div className="space-y-2">
              {[
                { value: 'text', icon: Hash, label: 'Texte', desc: 'Envoyez des messages, images, GIFs, emojis, opinions...' },
                { value: 'voice', icon: Volume2, label: 'Vocal', desc: 'Parlez avec des membres de la communauté.' },
              ].map(({ value, icon: Icon, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setType(value as any)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition text-left
                    ${type === value ? 'border-fc-accent bg-fc-accent/10' : 'border-fc-hover bg-fc-hover/30 hover:bg-fc-hover'}`}
                >
                  <Icon size={20} className={type === value ? 'text-fc-accent' : 'text-fc-muted'} />
                  <div>
                    <div className={`font-medium text-sm ${type === value ? 'text-white' : 'text-fc-text'}`}>{label}</div>
                    <div className="text-xs text-fc-muted">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Nom */}
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
              Nom du canal
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fc-muted">
                {type === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}
              </span>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="nouveau-canal"
                maxLength={100}
                className="w-full pl-8 pr-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          </div>

          {/* Topic (texte seulement) */}
          {type === 'text' && (
            <div>
              <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                Description (optionnel)
              </label>
              <input
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="Description du canal..."
                maxLength={1024}
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
            </div>
          )}
        </div>

        <div className="p-4 bg-fc-bg/50 rounded-b-lg flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
            Annuler
          </button>
          <button
            onClick={() => name.trim() && create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            {create.isPending ? 'Création...' : 'Créer le canal'}
          </button>
        </div>
      </div>
    </div>
  )
}
