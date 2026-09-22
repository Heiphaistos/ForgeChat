import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useMobile } from '../contexts/MobileContext'
import { usePageTitle } from '../hooks/usePageTitle'

interface ImportStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  label: string | null
  server_id: string | null
  error: string | null
}

// Reprise du suivi si l'utilisateur quitte la page pendant un long import
const STORAGE_KEY = 'fc_discord_import_id'
const readStored = () => { try { return localStorage.getItem(STORAGE_KEY) } catch { return null } }
const writeStored = (id: string | null) => {
  try { if (id) localStorage.setItem(STORAGE_KEY, id); else localStorage.removeItem(STORAGE_KEY) } catch { /* stockage indisponible */ }
}

export default function ImportDiscordPage() {
  usePageTitle('Importer depuis Discord')
  const nav = useNavigate()
  const qc = useQueryClient()
  const { openSidebar } = useMobile()
  const [params] = useSearchParams()
  const [url, setUrl] = useState(params.get('src') ?? '')
  const [importId, setImportId] = useState<string | null>(() => (params.get('src') ? null : readStored()))

  const start = useMutation({
    mutationFn: (u: string) => api.post('/servers/import-discord', { url: u }).then(r => r.data.import_id as string),
    onSuccess: id => { writeStored(id); setImportId(id) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? "Impossible de lancer l'import"),
  })

  const { data: job, error: pollError } = useQuery<ImportStatus>({
    queryKey: ['discord-import', importId],
    queryFn: () => api.get(`/servers/import-discord/${importId}`).then(r => r.data),
    enabled: !!importId,
    refetchInterval: q => (q.state.data && ['completed', 'failed'].includes(q.state.data.status) ? false : 2000),
  })

  // Import inconnu (supprimé, autre compte) : repartir d'un formulaire vide
  useEffect(() => {
    if (pollError) { writeStored(null); setImportId(null) }
  }, [pollError])

  useEffect(() => {
    if (job?.status === 'completed' && job.server_id) {
      writeStored(null)
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Serveur importé !')
      nav(`/servers/${job.server_id}`)
    }
  }, [job?.status, job?.server_id, nav, qc])

  const running = !!importId && (!job || job.status === 'pending' || job.status === 'running')
  const failed = job?.status === 'failed'

  const reset = () => { writeStored(null); setImportId(null); start.reset() }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-fc-bg">
      <div className="px-4 py-4 border-b border-fc-hover flex items-center gap-3">
        <button
          className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label="Retour"
        >
          <ChevronLeft size={20} />
        </button>
        <Download size={20} className="text-fc-accent flex-shrink-0" aria-hidden />
        <h1 className="text-lg font-bold text-white truncate">Importer depuis Discord</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-lg mx-auto bg-fc-channel rounded-xl p-5 space-y-4">
          <p className="text-sm text-fc-muted leading-relaxed">
            Exportez votre serveur avec <span className="text-white font-medium">ArchiveForge</span>, puis collez ici le
            lien de transfert qu'il fournit. Un nouveau serveur est créé avec les catégories, salons, rôles, droits,
            fils, forums, messages, pièces jointes et emojis du serveur Discord.
          </p>

          {!running && !failed && (
            <form
              className="space-y-3"
              onSubmit={e => { e.preventDefault(); if (url.trim()) start.mutate(url.trim()) }}
            >
              <label htmlFor="af-url" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide">
                Lien de transfert ArchiveForge
              </label>
              <input
                id="af-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://forgearchive.heiphaistos.org/api/transfer/…"
                className="w-full min-w-0 bg-fc-bg text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-fc-accent placeholder:text-fc-muted/60"
              />
              <button
                type="submit"
                disabled={!url.trim() || start.isPending}
                className="w-full min-h-[44px] bg-fc-accent hover:bg-fc-accent/80 disabled:opacity-50 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
              >
                {start.isPending && <Loader2 size={16} className="animate-spin" aria-hidden />}
                Importer
              </button>
            </form>
          )}

          {running && (
            <div className="space-y-2" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white truncate">{job?.label ?? 'Démarrage…'}</span>
                <span className="text-fc-muted tabular-nums flex-shrink-0">{job?.progress ?? 0} %</span>
              </div>
              <div
                className="h-2 bg-fc-bg rounded-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job?.progress ?? 0}
              >
                <div className="h-full bg-fc-accent transition-all duration-500" style={{ width: `${job?.progress ?? 0}%` }} />
              </div>
              <p className="text-xs text-fc-muted">
                Un gros serveur peut prendre du temps. Vous pouvez quitter cette page : l'import continue et le
                suivi reprend quand vous revenez ici.
              </p>
            </div>
          )}

          {failed && (
            <div className="space-y-3">
              <div role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 break-words">
                {job?.error ?? "L'import a échoué."}
              </div>
              <button
                onClick={reset}
                className="w-full min-h-[44px] bg-fc-bg hover:bg-fc-hover text-white text-sm font-medium rounded-lg transition"
              >
                Réessayer avec un autre lien
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
