import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useMobile } from '../contexts/MobileContext'

/** Rapports d'erreurs des applis (réservé aux comptes de FORGECHAT_ADMIN_USER_IDS). */

interface ReportSummary {
  id: string
  created_at: string
  last_seen: string
  user_id: string | null
  platform: string
  app_version: string | null
  kind: string
  message: string
  count: number
  has_log: boolean
}

interface ReportDetail extends Omit<ReportSummary, 'has_log'> {
  username: string | null
  stack: string | null
  log: string | null
  user_agent: string | null
  url: string | null
}

const PAGE = 50
const PLATFORMS = ['', 'web', 'windows', 'linux', 'macos', 'other']
const KINDS = ['', 'js_error', 'unhandled_rejection', 'react_crash', 'startup_failure', 'desktop_log', 'manual']
const fmt = (d: string) => new Date(d).toLocaleString('fr-FR')

export default function DiagnosticsAdminPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { openSidebar } = useMobile()
  const [platform, setPlatform] = useState('')
  const [kind, setKind] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  const list = useQuery<{ items: ReportSummary[]; total: number }>({
    queryKey: ['admin-diagnostics', platform, kind, offset],
    queryFn: () => api.get('/admin/diagnostics', {
      params: { limit: PAGE, offset, platform: platform || undefined, kind: kind || undefined },
    }).then(r => r.data),
    retry: false,
  })

  const detail = useQuery<ReportDetail>({
    queryKey: ['admin-diagnostic', selected],
    queryFn: () => api.get(`/admin/diagnostics/${selected}`).then(r => r.data),
    enabled: !!selected,
    retry: false,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/diagnostics/${id}`),
    onSuccess: () => {
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['admin-diagnostics'] })
      toast.success('Rapport supprimé')
    },
    onError: () => toast.error('Suppression impossible'),
  })

  // Compte non autorisé : on n'affiche rien.
  if (list.isError) return <div className="flex-1 bg-fc-bg" />

  const total = list.data?.total ?? 0
  const selectCls = 'bg-fc-channel border border-fc-hover rounded-lg px-2 py-1.5 text-sm text-white'

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
        <h1 className="text-lg font-bold text-white truncate">Rapports d'erreurs</h1>
        <button onClick={() => nav(-1)} className="ml-auto text-fc-muted hover:text-white text-sm transition">← Retour</button>
      </div>

      <div className="p-4 max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Plateforme" value={platform} className={selectCls}
            onChange={e => { setPlatform(e.target.value); setOffset(0) }}>
            {PLATFORMS.map(p => <option key={p} value={p}>{p || 'Toutes plateformes'}</option>)}
          </select>
          <select aria-label="Type" value={kind} className={selectCls}
            onChange={e => { setKind(e.target.value); setOffset(0) }}>
            {KINDS.map(k => <option key={k} value={k}>{k || 'Tous types'}</option>)}
          </select>
          <span className="text-xs text-fc-muted ml-auto">{total} rapport(s)</span>
        </div>

        {list.isLoading && <p className="text-fc-muted text-sm">Chargement…</p>}
        {list.data?.items.length === 0 && <p className="text-fc-muted text-sm">Aucun rapport.</p>}

        <ul className="space-y-2">
          {list.data?.items.map(r => (
            <li key={r.id}>
              <button
                onClick={() => setSelected(selected === r.id ? null : r.id)}
                className={`w-full text-left p-3 rounded-xl border transition ${selected === r.id ? 'border-fc-accent bg-fc-hover' : 'border-fc-hover bg-fc-channel hover:bg-fc-hover'}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fc-muted">
                  <span>{fmt(r.last_seen)}</span>
                  <span className="text-white font-medium">{r.platform}</span>
                  <span>v{r.app_version ?? '?'}</span>
                  <span className="text-yellow-400">{r.kind}</span>
                  {r.count > 1 && <span className="text-fc-red font-semibold">×{r.count}</span>}
                  {r.has_log && <span>journal</span>}
                </div>
                <div className="text-sm text-white mt-1 break-words line-clamp-2">{r.message || '(sans message)'}</div>
              </button>
              {selected === r.id && (
                <div className="mt-2 p-3 rounded-xl border border-fc-hover bg-fc-channel space-y-2 text-xs text-fc-muted">
                  {detail.isLoading && <p>Chargement…</p>}
                  {detail.data && (
                    <>
                      <div className="space-y-0.5 break-words">
                        <div>Première fois : {fmt(detail.data.created_at)}</div>
                        <div>Utilisateur : {detail.data.username ?? detail.data.user_id ?? 'anonyme'}</div>
                        {detail.data.url && <div>URL : {detail.data.url}</div>}
                        {detail.data.user_agent && <div>Navigateur : {detail.data.user_agent}</div>}
                      </div>
                      <pre className="whitespace-pre-wrap break-words text-white bg-fc-bg rounded-lg p-2">{detail.data.message}</pre>
                      {detail.data.stack && (
                        <details open>
                          <summary className="cursor-pointer text-white">Pile d'appels</summary>
                          <pre tabIndex={0} className="mt-1 whitespace-pre-wrap break-words bg-fc-bg rounded-lg p-2 max-h-80 overflow-auto">{detail.data.stack}</pre>
                        </details>
                      )}
                      {detail.data.log && (
                        <details>
                          <summary className="cursor-pointer text-white">Journal ({Math.round(detail.data.log.length / 1024)} Ko)</summary>
                          <pre tabIndex={0} className="mt-1 whitespace-pre-wrap break-words bg-fc-bg rounded-lg p-2 max-h-96 overflow-auto">{detail.data.log}</pre>
                        </details>
                      )}
                      <button
                        onClick={() => remove.mutate(r.id)}
                        disabled={remove.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-red/10 text-fc-red rounded-lg hover:bg-fc-red/20 transition disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Supprimer
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {total > PAGE && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
              className="px-3 py-1.5 rounded-lg border border-fc-hover text-fc-muted hover:text-white disabled:opacity-40">Précédent</button>
            <span className="text-fc-muted">{offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
            <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}
              className="px-3 py-1.5 rounded-lg border border-fc-hover text-fc-muted hover:text-white disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>
    </div>
  )
}
