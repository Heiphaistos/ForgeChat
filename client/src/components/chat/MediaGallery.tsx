// Galerie des médias et fichiers d'une conversation privée (audit 2026-10-12, amélioration n° 46).
// Le serveur ne renvoie que les messages qui portent des fichiers (`media=1`) ; ils sont
// déchiffrés ici comme dans la conversation, et chaque fichier chiffré l'est à l'affichage.
import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import api from '../../api/client'
import { useT } from '../../i18n'
import { openDm, type RawDm } from '../../e2e/dmMessages'
import { displayAttachments, type ServerAttachment } from '../../e2e/files'
import E2EAttachment from '../../e2e/E2EAttachment'

type Filter = 'media' | 'files'
const PAGE = 50
const isMedia = (ct: string) => ct.startsWith('image/') || ct.startsWith('video/')

export default function MediaGallery({ dmId, onClose, onJump }: { dmId: string; onClose: () => void; onJump: (messageId: string) => void }) {
  const t = useT()
  const [filter, setFilter] = useState<Filter>('media')
  const q = useInfiniteQuery({
    queryKey: ['dm-media', dmId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const raw = (await api.get<RawDm[]>(`/dms/${dmId}/messages`, { params: { media: 1, limit: PAGE, ...(pageParam ? { before: pageParam } : {}) } })).data
      return Promise.all(raw.map(m => openDm(dmId, m)))
    },
    getNextPageParam: last => (last.length === PAGE ? last[0]?.id ?? null : null),
  })
  const items = useMemo(() => {
    type Row = { id: string; created_at: string; attachments?: ServerAttachment[]; e2e_body?: unknown }
    const msgs = (q.data?.pages ?? []).flat() as unknown as Row[]
    msgs.sort((a, b) => b.created_at.localeCompare(a.created_at))
    return msgs.flatMap(m => displayAttachments(m.attachments ?? [], m.e2e_body)
      .map(att => ({ att, messageId: m.id, at: m.created_at })))
  }, [q.data])
  const shown = items.filter(i => (filter === 'media') === isMedia(i.att.content_type ?? ''))

  return (
    <div className="border-b border-fc-bg bg-fc-channel max-h-[60vh] flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-fc-bg">
        <div role="tablist" aria-label={t('gallery.title')} className="flex gap-1">
          {(['media', 'files'] as const).map(f => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm ${filter === f ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white hover:bg-fc-hover'}`}>
              {t(f === 'media' ? 'gallery.media' : 'gallery.files')}
            </button>
          ))}
        </div>
        <button onClick={onClose} aria-label={t('gallery.close')} className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover"><X size={15} /></button>
      </div>
      <div className="overflow-y-auto p-3">
        {q.isLoading && <p className="text-sm text-fc-muted">{t('common.loading')}</p>}
        {!q.isLoading && shown.length === 0 && <p className="text-sm text-fc-muted">{t('gallery.empty')}</p>}
        <div className={filter === 'media' ? 'grid grid-cols-3 sm:grid-cols-4 gap-2' : 'flex flex-col gap-2'}>
          {shown.map(({ att, messageId }, i) => (
            <div key={`${messageId}-${i}`} className="relative group">
              {att.e2e || att.e2eLocked
                ? <E2EAttachment att={att} mediaClass={filter === 'media' ? 'w-full h-28 object-cover rounded' : undefined} />
                : <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-sm text-fc-text underline break-all">{att.filename}</a>}
              <button onClick={() => onJump(messageId)}
                className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100">
                {t('gallery.jump')}
              </button>
            </div>
          ))}
        </div>
        {q.hasNextPage && (
          <button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mt-3 text-sm text-fc-muted hover:text-white">
            {t('gallery.more')}
          </button>
        )}
      </div>
    </div>
  )
}
