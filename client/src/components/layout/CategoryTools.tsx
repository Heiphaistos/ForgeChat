// Actions de la liste des salons ajoutées au lot E1 : catégories (renommer, monter / descendre,
// surcharges, synchroniser les salons) et statut des salons vocaux. Entrées de menu + fenêtres,
// gardées hors de ChannelSidebar (taille du fichier).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useT } from '../../i18n'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { ContextMenuEntry } from '../ui/ContextMenu'
import { confirm } from '../ui/ConfirmModal'
import TextPromptDialog from '../ui/TextPromptDialog'
import PermissionOverridesEditor from '../modals/PermissionOverridesEditor'
import { applyCategoryPositions, mergeCategory, moveId, type CategoryLike } from '../../lib/discordFeatures'

interface VoiceChannel { id: string; name: string; type: string; voice_status?: string | null }
type Dialog =
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'perms'; id: string; name: string }
  | { kind: 'voice'; channel: VoiceChannel }

const errText = (e: unknown, fallback: string) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback

function CategoryPermissionsDialog({ serverId, id, name, onClose }: { serverId: string; id: string; name: string; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  useEscapeKey(onClose)
  const sync = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/categories/${id}/sync-permissions`).then(r => r.data as { synced_channel_ids: string[] }),
    onSuccess: d => {
      const n = d.synced_channel_ids?.length ?? 0
      toast.success(t(n > 1 ? 'dfeat.cat.synced.other' : 'dfeat.cat.synced.one', { n }))
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      qc.invalidateQueries({ queryKey: ['channel-permissions'] })
    },
    onError: e => toast.error(errText(e, t('common.error'))),
  })
  const askSync = async () => {
    if (await confirm({ message: t('dfeat.cat.syncConfirm', { name }), confirmLabel: t('dfeat.cat.sync') })) sync.mutate()
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="cat-perms-title" onClick={e => e.stopPropagation()}
        className="bg-fc-channel rounded-xl w-full max-w-[600px] max-h-[90dvh] flex flex-col shadow-2xl">
        <div className="p-5 border-b border-fc-bg flex items-start justify-between gap-3">
          <div>
            <h2 id="cat-perms-title" className="font-bold text-white text-lg">{t('dfeat.cat.permsTitle', { name })}</h2>
            <p className="text-xs text-fc-muted mt-1">{t('dfeat.cat.permsHint')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="text-fc-muted hover:text-white p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="p-5 h-[400px] min-h-0">
          <PermissionOverridesEditor basePath={`/servers/${serverId}/categories/${id}/permissions`} queryKey={['category-permissions', id]} serverId={serverId} />
        </div>
        <div className="px-5 py-4 border-t border-fc-bg flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">{t('common.close')}</button>
          <button onClick={askSync} disabled={sync.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {t('dfeat.cat.sync')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useSidebarExtras(serverId: string | undefined, categories: CategoryLike[], canEdit: boolean, voiceChannelId: string | null) {
  const t = useT()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const catKey = ['categories', serverId]

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/servers/${serverId}/categories/${id}`, { name }).then(r => r.data),
    onSuccess: (cat: CategoryLike) => {
      qc.setQueryData<CategoryLike[]>(catKey, old => (old ? mergeCategory(old, cat) : old))
      toast.success(t('dfeat.cat.renamed'))
      setDialog(null)
    },
    onError: e => toast.error(errText(e, t('common.error'))),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.patch(`/servers/${serverId}/categories/reorder`, { category_ids: ids }).then(r => r.data),
    onSuccess: (d: { positions?: unknown }) => qc.setQueryData<CategoryLike[]>(catKey, old => (old ? applyCategoryPositions(old, d.positions) : old)),
    onError: e => toast.error(errText(e, t('dfeat.cat.reorderFailed'))),
  })

  const voiceStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string | null }) =>
      api.put(`/servers/${serverId}/channels/${id}/voice-status`, { status }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success(t(v.status ? 'dfeat.voice.saved' : 'dfeat.voice.cleared'))
      setDialog(null)
    },
    onError: e => toast.error(errText(e, t('common.error'))),
  })

  /** Entrées du menu d'en-tête d'une catégorie réelle (pas les groupes « Sans catégorie », texte, vocal). */
  const categoryEntries = (id: string, name: string): ContextMenuEntry[] => {
    if (!canEdit || !categories.some(c => c.id === id)) return []
    const ids = categories.map(c => c.id)
    const up = moveId(ids, id, -1)
    const down = moveId(ids, id, 1)
    return [
      { label: t('dfeat.cat.rename'), onClick: () => setDialog({ kind: 'rename', id, name }) },
      { label: t('dfeat.cat.moveUp'), disabled: !up || reorder.isPending, onClick: () => up && reorder.mutate(up) },
      { label: t('dfeat.cat.moveDown'), disabled: !down || reorder.isPending, onClick: () => down && reorder.mutate(down) },
      { label: t('dfeat.cat.perms'), onClick: () => setDialog({ kind: 'perms', id, name }) },
    ]
  }

  /** Statut d'un salon vocal / scène : connecté à ce salon ou droit de modifier les salons. */
  const voiceEntries = (ch: VoiceChannel): ContextMenuEntry[] => {
    if ((ch.type !== 'voice' && ch.type !== 'stage') || (!canEdit && voiceChannelId !== ch.id)) return []
    return [
      { label: t(ch.voice_status ? 'dfeat.voice.edit' : 'dfeat.voice.set'), onClick: () => setDialog({ kind: 'voice', channel: ch }) },
      ...(ch.voice_status ? [{ label: t('dfeat.voice.clear'), onClick: () => voiceStatus.mutate({ id: ch.id, status: null }) }] : []),
    ]
  }

  const close = () => setDialog(null)
  const node = !serverId || !dialog ? null
    : dialog.kind === 'rename' ? (
      <TextPromptDialog title={t('dfeat.cat.renameTitle', { name: dialog.name })} label={t('dfeat.cat.name')} initial={dialog.name}
        maxLength={100} busy={rename.isPending} onClose={close} onSubmit={name => rename.mutate({ id: dialog.id, name })} />
    ) : dialog.kind === 'perms' ? (
      <CategoryPermissionsDialog serverId={serverId} id={dialog.id} name={dialog.name} onClose={close} />
    ) : (
      <TextPromptDialog title={t('dfeat.voice.title', { name: dialog.channel.name })} label={t('dfeat.voice.label')}
        initial={dialog.channel.voice_status ?? ''} placeholder={t('dfeat.voice.ph')} maxLength={500} allowEmpty
        busy={voiceStatus.isPending} onClose={close} onSubmit={status => voiceStatus.mutate({ id: dialog.channel.id, status: status || null })} />
    )

  return { categoryEntries, voiceEntries, node }
}
