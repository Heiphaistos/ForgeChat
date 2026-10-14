import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useMobile } from '../contexts/MobileContext'
import { intlLocale, useT, t as tr } from '../i18n'

/** Signalements de messages privés (réservé au rôle El Patron). */

interface DmReport {
  id: string
  reason: string
  comment: string | null
  content: string | null
  status: string
  created_at: string
  reporter_username: string | null
  author_id: string | null
  author_username: string | null
}

const REASONS = (): Record<string, string> => ({ spam: tr('hc.dm.spam'), harassment: tr('hc.dm.harass'), nsfw: tr('hc.dm.nsfw'), other: tr('hc.dm.other') })
const STATUSES = [['open', 'hc.dm.open'], ['resolved', 'hc.dm.resolved'], ['dismissed', 'hc.dm.dismissed']] as const

export default function DmReportsAdminPage() {
  const t = useT()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { openSidebar } = useMobile()
  const [status, setStatus] = useState<string>('open')

  const list = useQuery<DmReport[]>({
    queryKey: ['admin-dm-reports', status],
    queryFn: () => api.get('/admin/dm-reports', { params: { status } }).then(r => r.data),
    retry: false,
  })

  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) => api.patch(`/admin/dm-reports/${id}`, { status: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-dm-reports'] }),
    onError: () => toast.error(t('hc.gm.fail')),
  })

  // Compte non autorisé : on n'affiche rien.
  if (list.isError) return <div className="flex-1 bg-fc-bg" />

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-fc-bg">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm min-h-[48px] sticky top-0 bg-fc-bg z-10">
        <button
          className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label={t('hc.adm.openMenu')}
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold text-white truncate">{t('hc.dm.title')}</h1>
        <button onClick={() => nav(-1)} className="ml-auto text-fc-muted hover:text-white text-sm transition">← {t('common.back')}</button>
      </div>

      <div className="p-4 max-w-4xl mx-auto space-y-4">
        <div className="flex gap-2" role="tablist">
          {STATUSES.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={status === id} onClick={() => setStatus(id)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${status === id ? 'bg-fc-accent text-white' : 'bg-fc-channel text-fc-muted hover:text-white'}`}>
              {t(label)}
            </button>
          ))}
        </div>

        {list.isLoading && <p className="text-sm text-fc-muted">{t('hc.thr.loadingShort')}</p>}
        {list.data?.length === 0 && <p className="text-sm text-fc-muted">{t('hc.dm.none')}</p>}

        {list.data?.map(r => (
          <article key={r.id} className="bg-fc-channel rounded-lg p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fc-muted">
              <span className="px-2 py-0.5 rounded bg-fc-red/20 text-fc-red font-medium">{REASONS()[r.reason] ?? r.reason}</span>
              <span>{t('hc.dm.by', { name: r.reporter_username ?? t('hc.dm.deletedAcc') })}</span>
              <span>{t('hc.dm.against')} <strong className="text-white">{r.author_username ?? t('hc.dm.deletedAcc')}</strong></span>
              <span className="ml-auto">{new Date(r.created_at).toLocaleString(intlLocale())}</span>
            </div>
            <blockquote className="border-l-2 border-fc-hover pl-3 text-sm text-white whitespace-pre-wrap break-words">
              {r.content || <em className="text-fc-muted">{t('hc.dm.noText')}</em>}
            </blockquote>
            {r.comment && <p className="text-sm text-fc-muted">Commentaire : {r.comment}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {r.status !== 'resolved' && (
                <button onClick={() => update.mutate({ id: r.id, next: 'resolved' })} className="px-3 py-1.5 rounded bg-fc-green/20 text-fc-green text-sm hover:bg-fc-green/30">{t('hc.dm.markDone')}</button>
              )}
              {r.status !== 'dismissed' && (
                <button onClick={() => update.mutate({ id: r.id, next: 'dismissed' })} className="px-3 py-1.5 rounded bg-fc-hover text-white text-sm">{t('hc.dm.dismiss')}</button>
              )}
              {r.status !== 'open' && (
                <button onClick={() => update.mutate({ id: r.id, next: 'open' })} className="px-3 py-1.5 rounded bg-fc-hover text-white text-sm">{t('hc.dm.reopen')}</button>
              )}
              {r.author_id && (
                <button onClick={() => nav(`/users/${r.author_id}`)} className="px-3 py-1.5 rounded bg-fc-hover text-white text-sm">{t('hc.dm.profile')}</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
