import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useMobile } from '../contexts/MobileContext'
import { intlLocale } from '../i18n'

/** Signalements de messages privés (réservé au compte administrateur, FORGECHAT_ADMIN_EMAIL). */

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

const REASONS: Record<string, string> = { spam: 'Spam', harassment: 'Harcèlement', nsfw: 'Contenu adulte', other: 'Autre' }
const STATUSES = [['open', 'À traiter'], ['resolved', 'Traités'], ['dismissed', 'Rejetés']] as const

export default function DmReportsAdminPage() {
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
    onError: () => toast.error('Action impossible'),
  })

  // Compte non autorisé : on n'affiche rien.
  if (list.isError) return <div className="flex-1 bg-fc-bg" />

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-fc-bg">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-fc-bg shadow-sm min-h-[48px] sticky top-0 bg-fc-bg z-10">
        <button
          className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label="Ouvrir le menu"
        >
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold text-white truncate">Signalements de messages privés</h1>
        <button onClick={() => nav(-1)} className="ml-auto text-fc-muted hover:text-white text-sm transition">← Retour</button>
      </div>

      <div className="p-4 max-w-4xl mx-auto space-y-4">
        <div className="flex gap-2" role="tablist">
          {STATUSES.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={status === id} onClick={() => setStatus(id)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${status === id ? 'bg-fc-accent text-white' : 'bg-fc-channel text-fc-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {list.isLoading && <p className="text-sm text-fc-muted">Chargement…</p>}
        {list.data?.length === 0 && <p className="text-sm text-fc-muted">Aucun signalement.</p>}

        {list.data?.map(r => (
          <article key={r.id} className="bg-fc-channel rounded-lg p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fc-muted">
              <span className="px-2 py-0.5 rounded bg-fc-red/20 text-fc-red font-medium">{REASONS[r.reason] ?? r.reason}</span>
              <span>par {r.reporter_username ?? 'compte supprimé'}</span>
              <span>· contre <strong className="text-white">{r.author_username ?? 'compte supprimé'}</strong></span>
              <span className="ml-auto">{new Date(r.created_at).toLocaleString(intlLocale())}</span>
            </div>
            <blockquote className="border-l-2 border-fc-hover pl-3 text-sm text-white whitespace-pre-wrap break-words">
              {r.content || <em className="text-fc-muted">(message sans texte)</em>}
            </blockquote>
            {r.comment && <p className="text-sm text-fc-muted">Commentaire : {r.comment}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {r.status !== 'resolved' && (
                <button onClick={() => update.mutate({ id: r.id, next: 'resolved' })} className="px-3 py-1.5 rounded bg-fc-green/20 text-fc-green text-sm hover:bg-fc-green/30">Marquer traité</button>
              )}
              {r.status !== 'dismissed' && (
                <button onClick={() => update.mutate({ id: r.id, next: 'dismissed' })} className="px-3 py-1.5 rounded bg-fc-hover text-white text-sm">Rejeter</button>
              )}
              {r.status !== 'open' && (
                <button onClick={() => update.mutate({ id: r.id, next: 'open' })} className="px-3 py-1.5 rounded bg-fc-hover text-white text-sm">Rouvrir</button>
              )}
              {r.author_id && (
                <button onClick={() => nav(`/users/${r.author_id}`)} className="px-3 py-1.5 rounded bg-fc-hover text-white text-sm">Voir le profil</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
