import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'

function colorIntToHex(c: number): string {
  return '#' + (c >>> 0).toString(16).padStart(6, '0')
}
function hexToColorInt(h: string): number {
  return parseInt(h.replace('#', ''), 16)
}

interface ServerTag {
  id: string
  name: string
  color: number
  created_at: string
}

export default function TagsTab({ serverId }: { serverId: string }) {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#7289da')

  const { data: tags = [] } = useQuery<ServerTag[]>({
    queryKey: ['tags', serverId],
    queryFn: () => api.get(`/servers/${serverId}/tags`).then(r => r.data),
  })

  const createTag = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/tags`, {
      name: newName.trim(),
      color: hexToColorInt(newColor),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags', serverId] })
      setNewName('')
      toast.success('Tag créé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteTag = useMutation({
    mutationFn: (tagId: string) => api.delete(`/servers/${serverId}/tags/${tagId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags', serverId] })
      toast.success('Tag supprimé')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">Marques de clan</h3>
        <p className="text-sm text-fc-muted mb-4">
          Crée des tags personnalisés (ex. [ALPHA], [MOD]) que tu peux assigner aux membres.
          Ils apparaissent à côté du pseudo dans la liste des membres.
        </p>

        {/* Créer un tag */}
        <div className="flex gap-2 mb-6">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16))}
            placeholder="NOM_DU_TAG"
            maxLength={16}
            aria-label="Nom du tag (majuscules, chiffres, tiret bas)"
            className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent font-mono"
            onKeyDown={e => e.key === 'Enter' && newName.trim() && createTag.mutate()}
          />
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            title="Couleur du tag"
            aria-label="Couleur du tag"
            className="w-10 h-9 rounded cursor-pointer bg-fc-input border-0 p-0.5"
          />
          <button
            onClick={() => createTag.mutate()}
            disabled={!newName.trim() || createTag.isPending}
            aria-busy={createTag.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
            {createTag.isPending ? 'Création...' : 'Créer'}
          </button>
        </div>

        {/* Liste des tags */}
        {tags.length === 0 ? (
          <div role="status" className="text-center text-fc-muted py-10 text-sm">
            Aucun tag pour ce serveur. Crées-en un !
          </div>
        ) : (
          <div className="space-y-2">
            {tags.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                <div
                  aria-hidden
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colorIntToHex(t.color) }}
                />
                <span
                  className="text-sm font-bold font-mono px-2 py-0.5 rounded border"
                  style={{ borderColor: colorIntToHex(t.color), color: colorIntToHex(t.color) }}
                >
                  [{t.name}]
                </span>
                <span className="flex-1 text-xs text-fc-muted">
                  Créé le {new Date(t.created_at).toLocaleDateString('fr-FR')}
                </span>
                <button
                  onClick={() => deleteTag.mutate(t.id)}
                  aria-label={`Supprimer le tag ${t.name}`}
                  className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 bg-fc-channel/50 rounded-lg border border-fc-hover text-xs text-fc-muted">
        Pour assigner des tags aux membres, va dans l'onglet <strong className="text-white">Membres</strong> et clique sur un membre.
      </div>
    </div>
  )
}
