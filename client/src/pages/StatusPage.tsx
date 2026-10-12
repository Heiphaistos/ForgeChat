import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { intlLocale, useT } from '../i18n'
import type { Key } from '../i18n'

// Page d'état publique (amélioration n° 50) : /statut, sans compte. Le serveur ne donne que des
// états (ok, ralenti, en panne, non configuré), jamais de détail interne ; rafraîchie toutes les 30 s.
interface Status { status: string; components: Record<string, string>; checked_at: string }

const COMPONENTS: [string, Key][] = [
  ['api', 'status.api'], ['database', 'status.database'], ['realtime', 'status.realtime'], ['voice', 'status.voice'], ['email', 'status.email'],
]
const COLORS: Record<string, string> = { ok: 'bg-fc-green', degraded: 'bg-fc-yellow', down: 'bg-fc-red', off: 'bg-fc-muted' }

export default function StatusPage() {
  const t = useT()
  const { data, isError } = useQuery<Status>({
    queryKey: ['public-status'],
    queryFn: () => api.get('/status').then(r => r.data),
    refetchInterval: 30_000,
    retry: 1,
  })
  const overall = isError ? 'down' : data?.status
  const label = (s: string | undefined) => t(s === 'ok' ? 'status.ok' : s === 'degraded' ? 'status.degraded' : s === 'off' ? 'status.off' : s === 'down' ? 'status.down' : 'status.loading')
  return (
    <div className="min-h-screen overflow-y-auto bg-fc-bg px-4 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-white">{t('status.title')}</h1>
        <div className="bg-fc-channel rounded-xl p-5 flex items-center gap-3" role="status" aria-live="polite">
          <span className={`w-3 h-3 rounded-full ${COLORS[overall ?? ''] ?? 'bg-fc-hover'}`} aria-hidden />
          <span className="text-lg text-white">{overall === 'ok' ? t('status.allOk') : label(overall)}</span>
        </div>
        <ul className="bg-fc-channel rounded-xl divide-y divide-fc-hover">
          {COMPONENTS.map(([id, name]) => {
            const s = isError ? 'down' : data?.components[id]
            return (
              <li key={id} className="flex items-center justify-between px-5 py-3">
                <span className="text-white text-sm">{t(name)}</span>
                <span className="flex items-center gap-2 text-sm text-fc-muted">
                  <span className={`w-2 h-2 rounded-full ${COLORS[s ?? ''] ?? 'bg-fc-hover'}`} aria-hidden />{label(s)}
                </span>
              </li>
            )
          })}
        </ul>
        {data && <p className="text-xs text-fc-muted">{t('status.checked', { when: new Date(data.checked_at).toLocaleTimeString(intlLocale()) })}</p>}
        <Link to="/" className="text-sm text-fc-accent hover:underline">← ForgeChat</Link>
      </div>
    </div>
  )
}
