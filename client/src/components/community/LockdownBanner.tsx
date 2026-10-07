// Bandeau d'un serveur verrouillé (manuel ou anti-raid) : seul le staff écrit.
import { ShieldAlert } from 'lucide-react'
import { useT } from '../../i18n'

export function LockdownBanner() {
  const t = useT()
  return (
    <div role="status" className="mx-4 mt-1 flex items-center gap-2 px-4 py-2 rounded-lg bg-fc-red/15 text-fc-red text-sm">
      <ShieldAlert size={15} className="flex-shrink-0" aria-hidden />
      <span>{t('community.lockdown.banner')}</span>
    </div>
  )
}
