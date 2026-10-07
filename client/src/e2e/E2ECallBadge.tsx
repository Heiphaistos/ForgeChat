// Cadenas « appel chiffré de bout en bout » des appels et salons vocaux (§5),
// avec l'alerte des participants dont l'appli ne chiffre pas encore.
import { Lock, ShieldAlert } from 'lucide-react'
import { useT } from '../i18n'

export function E2ECallBadge({ encrypted, outdatedNames }: { encrypted: boolean; outdatedNames: string[] }) {
  const t = useT()
  if (!encrypted) return null
  return (
    <div className="flex flex-col items-center gap-1 px-2 text-xs text-center">
      <span className="inline-flex items-center gap-1 text-green-400" title={t('e2e.call.encryptedDesc')}>
        <Lock size={12} aria-hidden /> {t('e2e.call.encrypted')}
      </span>
      {outdatedNames.length > 0 && (
        <span role="alert" className="inline-flex items-center gap-1 text-fc-yellow">
          <ShieldAlert size={12} aria-hidden className="flex-shrink-0" />
          {t('e2e.call.outdated', { names: outdatedNames.join(', ') })}
        </span>
      )}
    </div>
  )
}
