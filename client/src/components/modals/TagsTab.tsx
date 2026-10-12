import { useState } from 'react'
import { Palette, Plus, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, intlLocale } from '../../i18n'
import ClanTag from '../ui/ClanTag'
import TagStyleFields from '../settings/TagStyleFields'
import { cleanTagStyle, type TagStyle } from '../../lib/nameStyle'

function hexToColorInt(h: string): number {
  return parseInt(h.replace('#', ''), 16)
}

interface ServerTag {
  id: string
  name: string
  color: number
  /** Style de marque (models/profile_style::parse_tag_style) : sans couleur principale. */
  style?: unknown
  created_at: string
}

/** Style d'un tag sans la couleur principale (elle reste la colonne `color`). */
function tagRest(style: unknown): Omit<TagStyle, 'color'> {
  const s = cleanTagStyle(style)
  return { color2: s?.color2, font: s?.font, badge: s?.badge, icon: s?.icon }
}

/** Couleur, seconde couleur, police, fond et icône d'un tag : PATCH /servers/:id/tags/:tag_id. */
function TagEditor({ serverId, tag, onClose }: { serverId: string; tag: ServerTag; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [color, setColor] = useState<number>(tag.color)
  const [style, setStyle] = useState<Omit<TagStyle, 'color'>>(tagRest(tag.style))
  const save = useMutation({
    // Le serveur revalide tout ; {} = style par défaut.
    mutationFn: () => api.patch(`/servers/${serverId}/tags/${tag.id}`, { color, style: cleanTagStyle(style) ?? {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags', serverId] })
      qc.invalidateQueries({ queryKey: ['members', serverId] })
      toast.success(t('pedit.clan.saved'))
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })
  return (
    <div className="mt-3 space-y-4 border-t border-fc-hover pt-3">
      <TagStyleFields name={tag.name} color={color} onColor={c => c != null && setColor(c)} value={style} onChange={setStyle} />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="px-4 py-2 bg-fc-accent hover:bg-fc-accent/80 disabled:opacity-50 rounded text-white text-sm font-medium transition">
          {save.isPending ? t('common.saving') : t('pedit.clan.save')}
        </button>
        <button onClick={() => setStyle({})} className="px-3 py-2 text-sm text-fc-muted hover:text-white">{t('pedit.clan.reset')}</button>
        <button onClick={onClose} className="px-3 py-2 text-sm text-fc-muted hover:text-white">{t('pedit.clan.close')}</button>
      </div>
    </div>
  )
}

export default function TagsTab({ serverId }: { serverId: string }) {
  const t = useT()
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#7289da')
  const [editing, setEditing] = useState<string | null>(null)

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
              <div key={tg.id} className="p-3 bg-fc-channel rounded-lg">
                <div className="flex items-center gap-3">
                  <ClanTag name={tg.name} color={tg.color} style={tg.style} />
                  <span className="flex-1 text-xs text-fc-muted">
                    {t('servers.create.createdOn', { date: new Date(tg.created_at).toLocaleDateString(intlLocale()) })}
                  </span>
                  <button
                    onClick={() => setEditing(editing === tg.id ? null : tg.id)}
                    aria-expanded={editing === tg.id}
                    aria-label={t('pedit.clan.editA11y', { tag: tg.name })}
                    title={t('pedit.clan.edit')}
                    className="p-1.5 text-fc-muted hover:text-white hover:bg-fc-hover rounded transition"
                  >
                    <Palette size={14} aria-hidden />
                  </button>
                  <button
                    onClick={() => deleteTag.mutate(tg.id)}
                    aria-label={t('chset.removeTag', { tag: tg.name })}
                    className="p-1.5 text-fc-muted hover:text-red-400 hover:bg-fc-hover rounded transition"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                {editing === tg.id && <TagEditor serverId={serverId} tag={tg} onClose={() => setEditing(null)} />}
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
