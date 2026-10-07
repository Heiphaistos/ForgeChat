import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, intlLocale } from '../../i18n'

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
  const t = useT()
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
      toast.success(t('tags.created'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const deleteTag = useMutation({
    mutationFn: (tagId: string) => api.delete(`/servers/${serverId}/tags/${tagId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags', serverId] })
      toast.success(t('tags.deleted'))
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">{t('tags.title')}</h3>
        <p className="text-sm text-fc-muted mb-4">
          {t('tags.intro')}
        </p>

        {/* Créer un tag */}
        <div className="flex gap-2 mb-6">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16))}
            placeholder={t('tags.namePh')}
            maxLength={16}
            aria-label={t('tags.nameLabel')}
            enterKeyHint="done"
            autoCapitalize="characters"
            autoComplete="off"
            className="flex-1 px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent font-mono"
            onKeyDown={e => e.key === 'Enter' && newName.trim() && createTag.mutate()}
          />
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            title={t('tags.color')}
            aria-label={t('tags.color')}
            className="w-10 h-9 rounded cursor-pointer bg-fc-input border-0 p-0.5"
          />
          <button
            onClick={() => createTag.mutate()}
            disabled={!newName.trim() || createTag.isPending}
            aria-busy={createTag.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
            {createTag.isPending ? t('common.creating') : t('common.create')}
          </button>
        </div>

        {/* Liste des tags */}
        {tags.length === 0 ? (
          <div role="status" className="text-center text-fc-muted py-10 text-sm">
            {t('tags.none')}
          </div>
        ) : (
          <div className="space-y-2">
            {tags.map(tg => (
              <div key={tg.id} className="flex items-center gap-3 p-3 bg-fc-channel rounded-lg">
                <div
                  aria-hidden
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colorIntToHex(tg.color) }}
                />
                <span
                  className="text-sm font-bold font-mono px-2 py-0.5 rounded border"
                  style={{ borderColor: colorIntToHex(tg.color), color: colorIntToHex(tg.color) }}
                >
                  [{tg.name}]
                </span>
                <span className="flex-1 text-xs text-fc-muted">
                  {t('servers.create.createdOn', { date: new Date(tg.created_at).toLocaleDateString(intlLocale()) })}
                </span>
                <button
                  onClick={() => deleteTag.mutate(tg.id)}
                  aria-label={t('chset.removeTag', { tag: tg.name })}
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
        {t('tags.hintBefore')}<strong className="text-white">{t('srv.tab.members')}</strong>{t('tags.hintAfter')}
      </div>
    </div>
  )
}
