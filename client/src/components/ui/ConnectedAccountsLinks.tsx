// Comptes connectés rendus visibles par leur propriétaire (GET /users/:id/profile →
// connected_accounts), affichés comme les liens du profil (même gabarit que ProfileLinks).
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import api from '../../api/client'
import { useT } from '../../i18n'
import { publicAccounts } from '../../lib/discordFeatures'
import { PLATFORMS } from '../settings/ConnectedAccountsSection'

const chip = 'inline-flex items-center gap-1 text-xs text-fc-text bg-fc-channel rounded px-2 py-1 max-w-full'

export default function ConnectedAccountsLinks({ userId }: { userId: string }) {
  const t = useT()
  // Même clé que UserPopup : une seule requête partagée.
  const { data: profile } = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => api.get(`/users/${userId}/profile`).then(r => r.data),
    enabled: !!userId,
    staleTime: 30_000,
  })
  const accounts = publicAccounts(profile?.connected_accounts)
  if (!accounts.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5 mb-3" aria-label={t('dfeat.acc.list')}>
      {accounts.map(a => {
        const meta = PLATFORMS.find(p => p.id === a.platform)
        const label = <><span aria-hidden>{meta?.icon ?? <ExternalLink size={11} />}</span><span className="truncate">{a.platform_username}</span></>
        const name = `${meta?.label ?? a.platform} : ${a.platform_username}`
        return (
          <li key={a.platform} className="max-w-full">
            {a.platform_url
              ? <a href={a.platform_url} target="_blank" rel="noopener noreferrer nofollow" title={name} aria-label={name} className={`${chip} hover:bg-fc-hover`}>{label}</a>
              : <span title={name} className={chip}>{label}</span>}
          </li>
        )
      })}
    </ul>
  )
}
